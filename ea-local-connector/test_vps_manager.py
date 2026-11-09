import unittest,tempfile,threading,time,json,uuid
from pathlib import Path
from vps_manager import Manager,Vault,expected_channel,config_valid,slot_number
from protocol import atomic_write,encode_fields,read_fields
from test_protocol import local_heartbeat

class FakeRunner:
    seen=[]
    def __init__(self,config,status,on_unpaired):self.config=config;self.channel=Path(config['channel']);self.stop=threading.Event();self.status=status
    def run(self):self.seen.append(dict(self.config));self.status('CONNECTED');self.stop.wait(10)
    def invalidate_lease(self):atomic_write(Path(self.config['channel'])/'lease.tsv',str(self.config['vpsSlot']))

class VpsManagerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.common=self.root/'common';self.common.mkdir();self.calls=[];FakeRunner.seen=[]
        self.vault=Vault(self.root/'vault',lambda data,decrypt=False:data)
        outer=self
        class Api:
            def request(self,path,data=None):
                outer.calls.append((path,dict(data or {})))
                if path=='/auth/login':
                    self.n=int(data['email'].split()[-1]);return {'user':{'id':str(uuid.uuid4()),'email':'zcuser'+str(self.n)+'@managed.zencore.invalid','role':'client'}}
                if path=='/api/auto-trade/ea-connect':return {'podId':str(uuid.uuid4()),'podToken':'token-'+str(self.n)}
                raise AssertionError('Unexpected network action '+path)
        self.manager=Manager(self.common,self.vault,api_factory=Api,runner_factory=FakeRunner)
    def tearDown(self):self.manager.close();self.tmp.cleanup()
    def channel(self,n):
        f=local_heartbeat();f['account']=str(810000+n);f['writtenAt']=str(int(time.time()*1000));p=expected_channel(self.common,f);p.mkdir(exist_ok=True);atomic_write(p/'heartbeat.tsv',encode_fields(f));return p
    def test_ten_profiles_pair_and_resume_independently_without_turning_trade_on(self):
        for n in range(1,11):self.manager.pair(n,self.channel(n),'bootstrap-secret')
        self.assertEqual(len(self.manager.configs),10);self.assertEqual(len(self.manager.runners),10)
        for n,c in self.manager.configs.items():
            self.assertEqual(c['account'],str(810000+n));self.assertEqual(c['zenCoreLogin'],'ZCuser '+str(n));self.assertNotIn('password',c)
        self.assertEqual(len({c['podToken'] for c in self.manager.configs.values()}),10)
        self.assertFalse(any(p.endswith('/on') for p,_ in self.calls));self.assertEqual(len(self.calls),20)
        self.manager.pause(3);self.assertTrue(self.manager.configs[3]['paused']);self.assertTrue(self.manager.runners[3].stop.is_set());self.assertFalse(self.manager.runners[4].stop.is_set())
        self.manager.close();other=Manager(self.common,self.vault,runner_factory=FakeRunner)
        try:
            other.restore();self.assertEqual(len(other.configs),10);self.assertEqual(len(other.runners),9);self.assertNotIn(3,other.runners);other.start(3);self.assertEqual(len(other.runners),10)
        finally:other.close()
    def test_duplicate_channel_rejected_before_login_and_account_change_cannot_rebind(self):
        p=self.channel(1);self.manager.pair(1,p,'secret');before=len(self.calls)
        with self.assertRaisesRegex(RuntimeError,'MT5_ALREADY_ASSIGNED'):self.manager.pair(2,p,'secret')
        self.assertEqual(len(self.calls),before)
        self.assertEqual(self.manager.configs[1]['account'],'810001')
        cfg=dict(self.manager.configs[1]);cfg['channel']=str(self.root/'elsewhere')
        with self.assertRaisesRegex(ValueError,'CHANNEL_BINDING_INVALID'):config_valid(cfg,1,self.common)
        with self.assertRaisesRegex(ValueError,'PROFILE_IDENTITY_INVALID'):config_valid(self.manager.configs[1],2,self.common)
    def test_discovery_only_accepts_fresh_identity_bound_channels(self):
        self.channel(1);self.channel(2);self.assertEqual(len(self.manager.discover()),2)
        p=self.channel(3);f=local_heartbeat();f['writtenAt']='0';atomic_write(p/'heartbeat.tsv',encode_fields(f));self.assertEqual(len(self.manager.discover()),2)
        wrong=self.common/'unbound';wrong.mkdir();f['writtenAt']=str(int(time.time()*1000));atomic_write(wrong/'heartbeat.tsv',encode_fields(f));self.assertEqual(len(self.manager.discover()),2)
    def test_other_user_login_cannot_be_attached_and_vault_is_per_slot(self):
        class WrongApi:
            def request(self,*args):return {'user':{'id':'other','role':'client','email':'zcuser2@managed.zencore.invalid'}}
        self.manager.api_factory=WrongApi
        with self.assertRaisesRegex(RuntimeError,'ZENCORE_USER_MISMATCH'):self.manager.pair(1,self.channel(1),'secret')
        self.assertFalse(self.manager.configs);self.assertFalse(self.manager.pending)
        for value in [0,11,True,'1']:
            with self.assertRaises(ValueError):slot_number(value)
        self.assertNotEqual(self.vault.path(1),self.vault.path(2))

    def test_reset_one_slot_then_pair_new_client_and_new_mt5_keeps_others_running(self):
        old=self.channel(1);self.manager.pair(1,old,'secret');self.manager.pair(2,self.channel(2),'secret')
        (old/'connector-health.json').write_text('old-client')
        (old/'risk-old.tsv').write_text('broker-protection')
        self.manager.reset(1)
        self.assertNotIn(1,self.manager.configs);self.assertFalse(self.vault.path(1).exists())
        self.assertFalse((old/'connector-health.json').exists());self.assertTrue((old/'risk-old.tsv').exists())
        self.assertEqual(read_fields(old/'lease.tsv')['expiresAt'],'0')
        self.assertFalse(self.manager.runners[2].stop.is_set());self.assertTrue(self.vault.path(2).exists())
        self.manager.pair(1,self.channel(11),'new-secret',login='ZCuser 11')
        self.assertEqual(self.manager.configs[1]['zenCoreLogin'],'ZCuser 11')
        self.assertEqual(self.manager.configs[1]['account'],'810011')
        self.assertEqual(self.calls[-2][1]['email'],'ZCuser 11')
        self.assertFalse(any(p.endswith('/on') or p.endswith('/reset-link') for p,_ in self.calls))
    def test_reset_with_open_positions_preserves_link_paused_and_retryable(self):
        old=self.channel(1);self.manager.pair(1,old,'secret')
        atomic_write(old/'heartbeat.tsv',encode_fields({**local_heartbeat(),'account':'810001','writtenAt':int(time.time()*1000),'positionCount':-1}))
        with self.assertRaisesRegex(RuntimeError,'RESET_POSITIONS_OPEN'):self.manager.reset(1)
        self.assertTrue(self.vault.path(1).exists());self.assertTrue(self.manager.configs[1]['paused'])
        self.assertFalse(self.manager.pending)
        self.channel(1);self.manager.reset(1);self.assertFalse(self.vault.path(1).exists())
    def test_same_client_in_two_slots_is_rejected_before_rotating_cloud_token(self):
        self.manager.pair(1,self.channel(1),'secret')
        previous=self.manager.configs[1]['zenCoreUserId']
        class DuplicateApi:
            calls=[]
            def request(self,path,data=None):
                self.calls.append(path)
                return {'user':{'id':previous,'loginId':'ZCuser 1','role':'client'}}
        self.manager.api_factory=DuplicateApi
        with self.assertRaisesRegex(RuntimeError,'ZENCORE_USER_ALREADY_ASSIGNED'):
            self.manager.pair(2,self.channel(2),'secret',login='ZCuser 1')
        self.assertEqual(DuplicateApi.calls,['/auth/login'])
        self.assertFalse(self.manager.runners[1].stop.is_set())
    def test_empty_slot_reset_does_not_reserve_every_other_mt5_channel(self):
        self.manager.pending[1]={'resetting':True}
        self.manager.pair(2,self.channel(2),'secret')
        self.assertIn(2,self.manager.configs)
        self.manager.pending.clear();self.manager.reset(1)
