import tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from subprocess import TimeoutExpired
import connector
from vps_manager import Manager,Vault

class FolderInstallTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name).resolve()
 def terminal(self,n):
  program=self.root/('broker '+str(n));program.mkdir();(program/'terminal64.exe').write_bytes(b'terminal');(program/'metaeditor64.exe').write_bytes(b'editor')
  data=self.root/'terminals'/str(n);(data/'MQL5').mkdir(parents=True);(data/'origin.txt').write_bytes(str(program).encode('utf-16'))
  return program,data
 def test_two_program_folders_resolve_to_their_own_live_data_folders(self):
  for n in (1,2):
   program,data=self.terminal(n)
   self.assertEqual(connector.resolve_mt5_folder(program,self.root/'terminals'),data)
   self.assertEqual(connector.resolve_mt5_folder(data/'MQL5'),data)
   self.assertEqual(connector.find_metaeditor(data),program/'metaeditor64.exe')
 def test_ambiguous_program_requires_explicit_data_folder(self):
  program,data=self.terminal(1);other=self.root/'terminals'/'other';(other/'MQL5').mkdir(parents=True);(other/'origin.txt').write_text(str(program))
  with self.assertRaisesRegex(RuntimeError,'MT5_DATA_FOLDER_AMBIGUOUS'):connector.resolve_mt5_folder(program,self.root/'terminals')
  self.assertEqual(connector.resolve_mt5_folder(data),data)
 def test_second_slot_install_and_folder_reservation_survive_restart(self):
  p1,d1=self.terminal(1);p2,d2=self.terminal(2)
  vault=Vault(self.root/'vault',lambda data,decrypt=False:data);m=Manager(self.root/'common',vault)
  def install(folder,editor):return Path(folder)/'MQL5'/'Experts'/'ZenCore'
  with patch('vps_manager.install_ea',side_effect=install) as compile:
   m.install(1,d1,p1/'metaeditor64.exe');m.install(2,d2,p2/'metaeditor64.exe')
   self.assertEqual([x.args[0] for x in compile.call_args_list],[d1,d2])
   with self.assertRaisesRegex(RuntimeError,'MT5_FOLDER_ALREADY_ASSIGNED'):m.install(3,d1)
  other=Manager(self.root/'common',vault)
  self.assertEqual(Path(other.folders[2]),d2)
  other.reset(2);self.assertNotIn(2,other.folders);self.assertFalse(vault.folder_path(2).exists())
  self.assertEqual(Path(other.folders[1]),d1)
 def test_missing_origin_can_use_explicit_metaeditor_for_second_terminal(self):
  _,data=self.terminal(2);(data/'origin.txt').unlink();editor=self.root/'custom'/'metaeditor64.exe';editor.parent.mkdir();editor.write_bytes(b'editor')
  resource=self.root/'resource';resource.mkdir();(resource/'ZenCoreExecutor.mq5').write_text('test EA source')
  def compile(args,**kwargs):
   self.assertEqual(args[0],str(editor));(data/'MQL5'/'Experts'/'ZenCore'/'ZenCoreExecutor.ex5').write_bytes(b'new compiled EA')
  with patch.object(connector,'RESOURCE',resource),patch.object(connector.subprocess,'CREATE_NO_WINDOW',0,create=True),patch.object(connector.subprocess,'run',side_effect=compile):connector.install_ea(data,editor)
 def test_install_errors_show_installation_reason_instead_of_pairing_error(self):
  cases=[(RuntimeError('MT5_DATA_FOLDER_REQUIRED'),'Open Data Folder'),(RuntimeError('METAEDITOR_NOT_FOUND'),'MetaEditor'),(RuntimeError('EA_COMPILE_FAILED'),'compile.log'),(PermissionError('private path'),'permission'),(TimeoutExpired('editor',120),'terlalu lama')]
  for error,expected in cases:
   message=connector.install_error_message(error)
   if isinstance(error,PermissionError):self.assertIn('tidak boleh ditulis',message)
   else:self.assertIn(expected,message)
   self.assertNotIn('private path',message);self.assertNotIn('PAUTAN',message)
 def test_pasted_folder_is_used_without_opening_another_picker(self):
  program,data=self.terminal(2)
  with patch.object(connector,'discover_mt5_folders',side_effect=AssertionError('unexpected discovery')):
   self.assertEqual(connector.choose_mt5_install(None,'Pasang EA','  "'+str(data)+'"  '),(data,program/'metaeditor64.exe'))
 def test_vps_install_uses_pasted_folder_for_requested_slot(self):
  from types import SimpleNamespace
  from vps_manager import App
  from unittest.mock import Mock
  import queue
  program,data=self.terminal(2)
  manager=SimpleNamespace(folders={2:str(data)},install=Mock())
  app=SimpleNamespace(busy=set(),root=None,manager=manager,events=queue.Queue(),
                      task=lambda n,fn,stage:fn())
  with patch('vps_manager.simpledialog.askstring',return_value=str(data)) as prompt,patch.object(connector,'discover_mt5_folders',side_effect=AssertionError('unexpected discovery')):
   App.install(app,2)
  self.assertEqual(prompt.call_args.kwargs['initialvalue'],str(data))
  manager.install.assert_called_once_with(2,data,None)

 def test_vps_copies_compiled_ea_without_metaeditor_and_preserves_existing_on_missing_resource(self):
  from vps_manager import install_ea
  _,data=self.terminal(2)
  resource=self.root/'bundle';resource.mkdir()
  bundled=resource/'ZenCoreExecutor.ex5';payload=b'EX5'+b'fixture'*1024
  bundled.write_bytes(payload)
  with patch('vps_manager.RESOURCE',resource):
   dest=install_ea(data)/'ZenCoreExecutor.ex5'
   self.assertEqual(dest.read_bytes(),payload)
   bundled.unlink()
   with self.assertRaisesRegex(RuntimeError,'VPS_EA_PACKAGE_MISSING'):install_ea(data)
   self.assertEqual(dest.read_bytes(),payload)

 def test_vps_installed_copy_works_if_embedded_ea_is_missing(self):
  from vps_manager import install_ea
  _,data=self.terminal(2)
  app=self.root/'installed';app.mkdir()
  payload=b'EX5'+b'fixture'*1024
  (app/'ZenCoreExecutor.ex5').write_bytes(payload)
  with patch('vps_manager.RESOURCE',self.root/'missing'),patch('vps_manager.sys.frozen',True,create=True),patch('vps_manager.sys.executable',str(app/'ZenCoreVPSManager.exe')):
   self.assertEqual((install_ea(data)/'ZenCoreExecutor.ex5').read_bytes(),payload)
