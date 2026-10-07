import tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import connector

class InstallEaTests(unittest.TestCase):
 def test_client_terminal_origin_encodings_select_correct_metaeditor(self):
  for encoding in ['utf-8-sig','utf-16','utf-16-le','utf-16-be']:
   if encoding=='utf-16-be': continue # no-BOM MT5 origin is little endian
   with self.subTest(encoding=encoding),tempfile.TemporaryDirectory() as folder:
    root=Path(folder);data=root/'terminal data';editor=root/'broker terminal';resource=root/'resource'
    (data/'MQL5').mkdir(parents=True);editor.mkdir();resource.mkdir()
    (editor/'metaeditor64.exe').write_bytes(b'editor')
    (data/'origin.txt').write_bytes((str(editor)+'\r\n').encode(encoding))
    (resource/'ZenCoreExecutor.mq5').write_text('new source')
    target=data/'MQL5'/'Experts'/'ZenCore'/'ZenCoreExecutor.ex5';target.parent.mkdir(parents=True);target.write_bytes(b'old binary')
    def compile(args,**kwargs):
     self.assertEqual(args[0],str(editor/'metaeditor64.exe'))
     self.assertFalse(target.exists(),'old binary must be removed before compile')
     target.write_bytes(b'new binary')
    with patch.object(connector,'RESOURCE',resource),patch.object(connector.subprocess,'CREATE_NO_WINDOW',0,create=True),patch.object(connector.subprocess,'run',side_effect=compile):
     connector.install_ea(data)
    self.assertEqual(target.read_bytes(),b'new binary')
 def test_failed_compile_does_not_reuse_old_binary(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'MQL5').mkdir();(root/'metaeditor64.exe').write_bytes(b'editor')
   resource=root/'resource';resource.mkdir();(resource/'ZenCoreExecutor.mq5').write_text('source')
   target=root/'MQL5'/'Experts'/'ZenCore'/'ZenCoreExecutor.ex5';target.parent.mkdir(parents=True);target.write_bytes(b'old')
   with patch.object(connector,'RESOURCE',resource),patch.object(connector.subprocess,'CREATE_NO_WINDOW',0,create=True),patch.object(connector.subprocess,'run'):
    with self.assertRaisesRegex(RuntimeError,'EA_COMPILE_FAILED'):connector.install_ea(root)
   self.assertFalse(target.exists())
