import shutil,subprocess,tempfile,unittest
from pathlib import Path
from protocol import command_fields
from test_protocol import signed,IDENTITY
from vps_manager import Manager,Vault,expected_channel
from protocol import atomic_write,encode_fields
from test_protocol import local_heartbeat
import time

class MasterResetTests(unittest.TestCase):
 def test_only_signed_stop_can_carry_master_reset_flag(self):
  cmd=signed('SYSTEM_STOP',{'masterResetVersion':'MASTER_RESET_V1'})
  self.assertEqual(command_fields(cmd,IDENTITY)['masterResetVersion'],'MASTER_RESET_V1')
  self.assertNotIn('masterResetVersion',command_fields(signed('SYSTEM_STOP'),IDENTITY))
  with self.assertRaisesRegex(ValueError,'TYPE_REJECTED'):command_fields(signed('SYSTEM_STOP',{'masterResetVersion':'BAD'}),IDENTITY)
 def test_server_revocation_clears_only_own_slot_token_and_folder(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);v=Vault(root/'vault',lambda data,decrypt=False:data);m=Manager(root/'common',v)
   for n in (1,2):
    h={**local_heartbeat(),'account':str(700000+n),'writtenAt':int(time.time()*1000)};channel=expected_channel(m.common,h);channel.mkdir(parents=True)
    cfg={**h,'channel':str(channel),'vpsSlot':n,'zenCoreLogin':'ZCuser '+str(n),'zenCoreUserId':'user'+str(n),'podToken':'secret','podId':'pod'+str(n)}
    m.configs[n]=cfg;v.save(n,cfg);v.save_folder(n,root/str(n));m.folders[n]=str(root/str(n));(channel/'connector-health.json').write_text('old')
   m.unpaired(1)
   self.assertFalse(v.path(1).exists());self.assertFalse(v.folder_path(1).exists());self.assertNotIn(1,m.configs);self.assertNotIn(1,m.folders)
   self.assertTrue(v.path(2).exists());self.assertTrue(v.folder_path(2).exists());self.assertIn(2,m.configs)
 @unittest.skipUnless(shutil.which('g++'),'C++ compiler required for deterministic EA logic test')
 def test_actual_ea_master_reset_function_never_clears_live_position_state(self):
  source=(Path(__file__).parent/'ZenCoreExecutor.mq5').read_text()
  start=source.index('string MasterResetIdle(){');end=source.index('\nvoid Process(){',start);function=source[start:end]
  cpp=r'''
#include <string>
#include <cassert>
using string=std::string;using ulong=unsigned long;
bool manualEnabled=true;long manualSince=100;string ownerPod="old",enabledSymbols="XAUUSD";
double manualTp1=9,manualTp2=10,manualTp3=11,manualSl=12;
bool owned=true,writeOk=true;int writes=0;
int PositionsTotal(){return 1;}ulong PositionGetTicket(int){return 1;}bool IsManaged(ulong){return owned;}
string Row(string k,string v){return k+v;}bool WriteAtomic(string,string){writes++;return writeOk;}bool SaveManualConfig(){writes++;return writeOk;}
'''+function+r'''
int main(){
 assert(MasterResetIdle()=="MASTER_RESET_POSITIONS_OPEN");assert(ownerPod=="old"&&manualEnabled&&writes==0);
 owned=false;assert(MasterResetIdle()=="MASTER_RESET_READY");assert(ownerPod.empty()&&enabledSymbols.empty()&&!manualEnabled&&manualSince==0);assert(manualTp1==2&&manualTp2==4&&manualTp3==6&&manualSl==3&&writes==2);
 writeOk=false;assert(MasterResetIdle()=="MASTER_RESET_SAVE_FAILED");
}
'''
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);(p/'test.cpp').write_text(cpp);exe=p/'test.exe'
   subprocess.run(['g++','-std=c++17',str(p/'test.cpp'),'-o',str(exe)],check=True,capture_output=True);subprocess.run([str(exe)],check=True,capture_output=True)
