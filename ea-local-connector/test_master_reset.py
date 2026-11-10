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
  force=signed('SYSTEM_STOP',{'masterResetVersion':'MASTER_RESET_FORCE_V2','masterResetScope':'ALL_ACCOUNT'})
  self.assertEqual(command_fields(force,IDENTITY)['masterResetScope'],'ALL_ACCOUNT')
  with self.assertRaisesRegex(ValueError,'TYPE_REJECTED'):command_fields(signed('SYSTEM_STOP',{'masterResetVersion':'MASTER_RESET_FORCE_V2'}),IDENTITY)
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
  start=source.index('string MasterResetIdle(){');end=source.index('\nbool MasterResetLease(',start);function=source[start:end]
  cpp=r'''
#include <string>
#include <cassert>
using string=std::string;using ulong=unsigned long;
bool armed=true,resumePending=true;bool manualEnabled=true;long manualSince=100;string ownerPod="old",enabledSymbols="XAUUSD";
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

 @unittest.skipUnless(shutil.which('g++'),'C++ compiler required for deterministic EA logic test')
 def test_actual_force_reset_closes_manual_other_ea_and_orders_and_requires_flat_broker_state(self):
  source=(Path(__file__).parent/'ZenCoreExecutor.mq5').read_text();start=source.index('string MasterResetIdle(){');end=source.index('\nvoid Process(){',start);functions=source[start:end]
  cpp=r'''
#include <string>
#include <vector>
#include <map>
#include <algorithm>
#include <cassert>
using string=std::string;using ulong=unsigned long;
string account="123",server="Broker",eaSession="session",ownerPod="pod",enabledSymbols="XAUUSD";
bool armed=true,resumePending=true;bool manualEnabled=true;long manualSince=100;double manualTp1=9,manualTp2=10,manualTp3=11,manualSl=12;
std::map<string,string> fields;bool readOk=true,permit=true,writeOk=true;int writes=0;ulong selected=0,failClose=0,failOrder=0;
std::vector<ulong> positions,orders,closed,cancelled;
long UtcMs(){return 1000;}long StringToInteger(string x){return std::stol(x);}
string AccountMode(){return "DEMO";}bool ReadFields(string){return readOk;}string Get(string k){return fields[k];}
int PositionsTotal(){return positions.size();}int OrdersTotal(){return orders.size();}
ulong PositionGetTicket(int i){selected=positions[i];return selected;}ulong OrderGetTicket(int i){return orders[i];}
bool IsManaged(ulong){return true;}constexpr int POSITION_MAGIC=1,POSITION_SYMBOL=2;
long PositionGetInteger(int){return selected==1?0:999;}string PositionGetString(int){return selected==1?"XAUUSD":"EURUSD";}
string PermissionReason(){return permit?"READY":"EA_ALGO_DISABLED";}
string Row(string k,string v){return k+v;}bool WriteAtomic(string,string){writes++;return writeOk;}bool SaveManualConfig(){writes++;return writeOk;}
bool BrokerDone(){return true;}
struct Trade{
 void SetExpertMagicNumber(ulong){}void SetTypeFillingBySymbol(string){}
 bool OrderDelete(ulong t){if(t==failOrder)return false;cancelled.push_back(t);orders.erase(std::remove(orders.begin(),orders.end(),t),orders.end());return true;}
 bool PositionClose(ulong t){if(t==failClose)return false;closed.push_back(t);positions.erase(std::remove(positions.begin(),positions.end(),t),positions.end());return true;}
}trade;
void fixture(){
 account="123";ownerPod="pod";manualEnabled=true;manualSince=100;enabledSymbols="XAUUSD";permit=true;readOk=true;writeOk=true;writes=0;failClose=0;failOrder=0;
 positions={1,2};orders={3,4};closed.clear();cancelled.clear();
 fields={{"account","123"},{"server","Broker"},{"tradeMode","DEMO"},{"podId","pod"},{"eaSession","session"},{"expiresAt","2000"},{"desiredState","STOPPED"}};
}
'''+functions+r'''
int main(){
 fixture();assert(MasterResetForce("pod")=="MASTER_RESET_FORCE_READY");assert(positions.empty()&&orders.empty()&&closed.size()==2&&cancelled.size()==2);assert(!manualEnabled&&ownerPod.empty()&&writes==2);
 fixture();failClose=2;assert(MasterResetForce("pod")=="MASTER_RESET_CLOSE_FAILED");assert(positions.size()==1&&positions[0]==2&&orders.empty()&&ownerPod=="pod"&&manualEnabled&&writes==0);
 fixture();failOrder=3;assert(MasterResetForce("pod")=="MASTER_RESET_CLOSE_FAILED");assert(orders.size()==1&&positions.empty()&&writes==0);
 fixture();permit=false;assert(MasterResetForce("pod")=="EA_ALGO_DISABLED");assert(closed.empty()&&cancelled.empty()&&writes==0);
 for(string field:{"account","server","tradeMode","podId","eaSession","expiresAt","desiredState"}){
  fixture();fields[field]=field=="expiresAt"?"1000":"other";assert(MasterResetForce("pod")=="MASTER_RESET_LEASE_REQUIRED");assert(closed.empty()&&cancelled.empty()&&writes==0);
 }
 fixture();ownerPod="another-pod";assert(MasterResetForce("pod")=="MASTER_RESET_LEASE_REQUIRED");assert(closed.empty());
 fixture();writeOk=false;assert(MasterResetForce("pod")=="MASTER_RESET_SAVE_FAILED");
}
'''
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);(p/'test.cpp').write_text(cpp);exe=p/'force.exe';r=subprocess.run(['g++','-std=c++17',str(p/'test.cpp'),'-o',str(exe)],capture_output=True,text=True)
   self.assertEqual(r.returncode,0,r.stderr);subprocess.run([str(exe)],check=True,capture_output=True)
