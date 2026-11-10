import tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import patch
from vps_manager import Manager,Vault,expected_channel
from connector import discover_mt5_folders
from protocol import atomic_write,encode_fields
from test_protocol import local_heartbeat

class AdminFlowTests(unittest.TestCase):
 def test_folder_discovery_does_not_require_ea_or_expose_credentials(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'hash1'/'MQL5').mkdir(parents=True);(root/'hash1'/'origin.txt').write_text('C:/Broker MT5')
   (root/'not-terminal').mkdir();items=discover_mt5_folders(root)
   self.assertEqual(len(items),1);self.assertEqual(items[0]['folder'],(root/'hash1').resolve());self.assertIn('Broker MT5',items[0]['label'])
 def test_admin_pair_uses_target_user_route_not_client_password_or_on(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);common=root/'common';common.mkdir();calls=[];user=str(uuid.uuid4());pod=str(uuid.uuid4())
   class Api:
    def request(self,path,data=None,token=None):
     calls.append((path,data))
     if path=='/auth/login':return {'user':{'id':'admin','role':'admin','status':'active'}}
     if path=='/api/admin/vps/resolve':return {'client':{'id':user,'state':'ADMIN_SETUP'}}
     return {'podToken':'test-only','podId':pod,'commandSigningKey':'test-only'}
   class Runner:
    def __init__(self,cfg,*_):self.config=cfg
    def run(self):pass
   vault=Vault(root/'vault',lambda data,decrypt=False:data);m=Manager(common,vault,api_factory=Api,runner_factory=Runner)
   h={**local_heartbeat(),'writtenAt':__import__('time').time()*1000};h['writtenAt']=int(h['writtenAt']);channel=expected_channel(common,h);channel.mkdir();atomic_write(channel/'heartbeat.tsv',encode_fields(h))
   m.login_admin('admin@example.test','fake-password');cfg=m.pair(1,channel,'','ZCuser 11')
   self.assertEqual(cfg['zenCoreUserId'],user);self.assertEqual(calls[1][0],'/api/admin/vps/resolve');self.assertEqual(calls[2][0],'/api/admin/clients/'+user+'/setup/ea-connect')
   self.assertEqual(len([x for x in calls if x[0]=='/auth/login']),1);self.assertFalse(any(x[0].endswith('/on') for x in calls));self.assertNotIn('fake-password',vault.path(1).read_text())
 def test_local_slot_clear_after_cloud_receipt_preserves_other_slot(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);vault=Vault(root/'vault',lambda data,decrypt=False:data)
   class Api:
    def request(self,*_,**__):return {'ok':True}
   m=Manager(root/'common',vault,api_factory=Api)
   for n in [1,2]:
    identity={**local_heartbeat(),'account':str(810000+n)};cfg={**identity,'vpsSlot':n,'channel':str(expected_channel(root/'common',identity)),'zenCoreLogin':'ZCuser '+str(n),'zenCoreUserId':'user-'+str(n),'podId':str(uuid.uuid4()),'podToken':'token-'+str(n),'paused':True};m.configs[n]=cfg;vault.save(n,cfg)
   calls=[]
   def admin(path,data=None):
    calls.append((path,data));return {'generation':0} if path.endswith('/handover') else {'completed':True,'brokerCloseConfirmed':False}
   with patch.object(m,'admin_request',side_effect=admin):r=m.clear_slot(1)
   self.assertFalse(r['brokerCloseConfirmed']);self.assertNotIn(1,m.configs);self.assertIn(2,m.configs);self.assertTrue(vault.path(2).exists());self.assertFalse(vault.path(1).exists());self.assertEqual(calls[-1][1]['resetPolicy'],'MASTER_RESET_RELEASE_V3')
