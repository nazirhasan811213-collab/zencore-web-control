import tempfile,time,unittest
from pathlib import Path
from vps_manager import Manager,Vault,expected_channel
from test_protocol import local_heartbeat
class SwitchTests(unittest.TestCase):
 def test_switch_keeps_folder_and_other_slot(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);v=Vault(root/'vault',lambda data,decrypt=False:data)
   class Api:
    def request(self,*a,**kw):return {}
   m=Manager(root/'common',v,api_factory=Api)
   for n in (1,2):
    h={**local_heartbeat(),'account':str(700000+n),'writtenAt':int(time.time()*1000)};channel=expected_channel(m.common,h);channel.mkdir(parents=True)
    cfg={**h,'channel':str(channel),'vpsSlot':n,'zenCoreLogin':'ZCuser '+str(n),'zenCoreUserId':'user'+str(n),'podToken':'secret','podId':'pod'+str(n)}
    m.configs[n]=cfg;v.save(n,cfg);v.save_folder(n,root/str(n));m.folders[n]=str(root/str(n))
   paths=[]
   def request(path,data=None):
    paths.append(path);return {'generation':0} if path.endswith('/handover') else {'completed':True,'brokerCloseConfirmed':False}
   m.admin_request=request;r=m.clear_slot(1,preserve_profile=True)
   self.assertFalse(r['brokerCloseConfirmed']);self.assertFalse(v.path(1).exists());self.assertEqual(v.load_folder(1),str(root/'1'));self.assertTrue(v.path(2).exists());self.assertIn(2,m.configs)
   self.assertTrue(paths[-1].endswith('/switch-mt5'))
