import time
import unittest
from protocol import broker_metadata, account_fingerprint

class BrokerMetadataTests(unittest.TestCase):
    def fields(self):
        return {'writtenAt':str(int(time.time()*1000)),'account':'123456','server':'SomeBroker-Live',
                'tradeMode':'REAL','accountExecutionVersion':'REAL_DEMO_V1','accountBindingVersion':'ACCOUNT_SESSION_V1',
                'eaSession':'a'*32,'terminalBuild':'5000','terminalTradeAllowed':'1','accountTradeAllowed':'1','expertTradeAllowed':'1'}
    def test_monitor_only_metadata_has_full_server_but_no_account_number_or_password(self):
        fields=self.fields();payload=broker_metadata(fields,fields)
        self.assertEqual(payload['mt5ServerName'],'SomeBroker-Live')
        self.assertEqual(payload['accountFingerprint'],account_fingerprint(fields))
        self.assertEqual(set(payload),{'version','mt5ServerName','accountFingerprint'})
        self.assertNotIn('123456',str(payload))
    def test_stale_or_changed_identity_cannot_report_as_current(self):
        fields=self.fields();selected=dict(fields)
        fields['writtenAt']=str(int(time.time()*1000)-20000)
        with self.assertRaises(ValueError):broker_metadata(fields,selected)
        fields=self.fields();selected['server']='Other-Live'
        with self.assertRaises(ValueError):broker_metadata(fields,selected)

if __name__=='__main__':unittest.main()
