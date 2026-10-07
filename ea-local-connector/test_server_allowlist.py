import unittest
from protocol import heartbeat,command_fields
from test_protocol import local_heartbeat,IDENTITY,NOW,signed
class ApprovedServers(unittest.TestCase):
 def test_only_two_exact_names_are_accepted(self):
  for server in ['InterStellarFinancial-Server','InterStellarFinancial-Demo']:
   identity={**IDENTITY,'server':server}
   self.assertEqual(heartbeat({**local_heartbeat(),'server':server},identity,NOW)['tradeMode'],'DEMO')
   self.assertEqual(command_fields(signed(),identity)['server'],server)
  for server in ['Other-Demo','interstellarfinancial-demo','InterStellarFinancial-Demo-extra',' InterStellarFinancial-Demo']:
   identity={**IDENTITY,'server':server}
   with self.assertRaisesRegex(ValueError,'SERVER_NOT_ALLOWED'):heartbeat({**local_heartbeat(),'server':server},identity,NOW)
   with self.assertRaisesRegex(ValueError,'SERVER_NOT_ALLOWED'):command_fields(signed(),identity)
 def test_switch_to_an_unapproved_server_rejects_before_account_comparison(self):
  with self.assertRaisesRegex(ValueError,'SERVER_NOT_ALLOWED'):heartbeat({**local_heartbeat(),'server':'Other'},IDENTITY,NOW)
