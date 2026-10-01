import base64
import copy
import hashlib
import hmac
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from protocol import *
from connector import Runner

ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
POD='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
KEY='test-key-string-more-than-32-characters'
NOW=1791000000000
IDENTITY={'account':'12345678','server':'InterStellarFinancial-Demo'}

def signed(kind='SYSTEM_STOP', payload=None):
    raw={'id':ID,'podId':POD,'userId':'user','type':kind,'createdAt':NOW-1000,'expiresAt':NOW+10000,'payload':payload or {}}
    encoded=json.dumps(raw,separators=(',',':')).encode()
    return {**{k:raw[k] for k in ('id','type','payload','createdAt','expiresAt')},
      'signedEnvelope':base64.urlsafe_b64encode(encoded).decode().rstrip('='),
      'signature':hmac.new(KEY.encode(),encoded,hashlib.sha256).hexdigest()}

def local_heartbeat():
    return {**IDENTITY,'writtenAt':NOW,'tradeMode':'DEMO','terminalBuild':'6204',
       'terminalTradeAllowed':'1','accountTradeAllowed':'1','expertTradeAllowed':'1',
       'specCount':0,'positionCount':0}

class TransportTests(unittest.TestCase):
    def test_hmac_matches_server_key_string_and_rejects_modified_fields(self):
        command=signed()
        self.assertEqual(verified_command(command,KEY,POD,NOW)['id'],ID)
        command['type']='PLACE_SETUP'
        with self.assertRaisesRegex(ValueError,'ENVELOPE_MISMATCH'):verified_command(command,KEY,POD,NOW)
    def test_rejects_expired_wrong_pod_and_bad_signature(self):
        for key,pod,now in [('wrong-key',POD,NOW),(KEY,'wrong-pod',NOW),(KEY,POD,NOW+11000)]:
            with self.assertRaises(ValueError):verified_command(signed(),key,pod,now)
    def test_analysis_prices_must_match_snapshot(self):
        snap={'contractVersion':CONTRACT,'decisionOwner':'ZENCORE_ANALYSIS','decision':'ENTRY_AUTHORIZED',
          'symbol':'XAUUSD','side':'BUY','entry':2500,'sl':2490,'tp1':2505,'tp2':2510,'tp3':2520}
        payload={**{k:snap[k] for k in ('symbol','side','entry','sl','tp1','tp2','tp3')},
          'analysisContractVersion':CONTRACT,'strategy':STRATEGY,'schemaVersion':SCHEMA,
          'analysisSnapshot':snap,'lotPerLayer':0.01,'layers':3}
        command=verified_command(signed('PLACE_SETUP',payload),KEY,POD,NOW)
        fields=command_fields(command,IDENTITY)
        self.assertEqual(fields['lot'],'0.01');self.assertEqual(fields['layers'],3)
        command['payload']['sl']=2400
        with self.assertRaisesRegex(ValueError,'ANALYSIS_PRICE_MISMATCH'):command_fields(command,IDENTITY)
    def test_rejects_unapproved_action_and_local_field_injection(self):
        with self.assertRaises(ValueError):encode_fields({'server':'Demo\naccount\t999'})
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'test';path.write_text('id\t1\nid\t2\n')
            with self.assertRaisesRegex(ValueError,'DUPLICATE'):read_fields(path)
    def test_heartbeat_blocks_account_switch_real_and_stale(self):
        fields=local_heartbeat()
        self.assertEqual(heartbeat(fields,IDENTITY,NOW)['accountMask'],'****5678')
        for changes in ({'account':'999'},{'tradeMode':'REAL'},{'writtenAt':NOW-20000}):
            with self.assertRaises(ValueError):heartbeat({**fields,**changes},IDENTITY,NOW)
    def test_atomic_mailbox_roundtrip(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'command.tsv';atomic_write(path,encode_fields({'id':ID,'layers':3}))
            self.assertEqual(read_fields(path),{'id':ID,'layers':'3'})
            self.assertFalse(path.with_suffix('.tsv.tmp').exists())
    def test_connector_forwards_ack_before_delivering_next_command(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            atomic_write(path/'heartbeat.tsv',encode_fields(local_heartbeat()))
            atomic_write(path/(ID+'.result'),encode_fields({'id':ID,'status':'EXECUTED','code':'STOPPED'}))
            config={**IDENTITY,'channel':folder,'podToken':'hidden','commandSigningKey':KEY,'podId':POD}
            runner=Runner(config,lambda s:None);calls=[]
            class FakeApi:
                def request(self,url,data=None,token=None):
                    calls.append(url)
                    if url.endswith('heartbeat'):return {'ok':True,'desiredState':'STOPPED'}
                    if url.endswith('/next'):return {'ok':True,'command':signed()}
                    return {'ok':True}
            runner.api=FakeApi()
            with patch('protocol.time.time',return_value=NOW/1000),patch('connector.time.time',return_value=NOW/1000):runner.cycle()
            self.assertEqual(calls[1],'/api/execution/commands/'+ID+'/ack')
            self.assertEqual(read_fields(path/'command.tsv')['account'],IDENTITY['account'])
            self.assertFalse((path/(ID+'.result')).exists())
            self.assertEqual(read_fields(path/'lease.tsv')['desiredState'],'STOPPED')
    def test_connector_does_not_deliver_when_ea_offline(self):
        with tempfile.TemporaryDirectory() as folder:
            config={**IDENTITY,'channel':folder,'podToken':'hidden'}
            runner=Runner(config,lambda s:None)
            with self.assertRaises(FileNotFoundError):runner.cycle()
            self.assertFalse((Path(folder)/'lease.tsv').exists())

if __name__=='__main__':unittest.main()

class WindowsProtectionTests(unittest.TestCase):
    @unittest.skipUnless(__import__('sys').platform == 'win32', 'Windows DPAPI requires Windows')
    def test_machine_credentials_roundtrip_under_current_windows_user(self):
        from connector import dpapi
        value=b'{"podToken":"test-only-not-a-real-token"}'
        encrypted=dpapi(value)
        self.assertNotIn(value,encrypted)
        self.assertEqual(dpapi(encrypted,True),value)
