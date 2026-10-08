import unittest
from protocol import heartbeat, command_fields
from test_protocol import local_heartbeat, IDENTITY, NOW, signed
class UniversalServers(unittest.TestCase):
 def test_any_valid_broker_server_is_supported_without_new_binary(self):
  for server in ['InterStellarFinancial-Server','InterStellarFinancial-Demo','OtherBroker-Live','Broker-Cent-01']:
   identity={**IDENTITY,'server':server}
   self.assertEqual(heartbeat({**local_heartbeat(),'server':server},identity,NOW)['tradeMode'],'DEMO')
   self.assertEqual(command_fields(signed(),identity)['server'],server)
 def test_empty_and_injected_identity_rejected(self):
  for server in ['', ' Broker-Demo', 'Broker\nDemo', 'Broker\tDemo', 'x'*129]:
   identity={**IDENTITY,'server':server}
   with self.assertRaisesRegex(ValueError,'INVALID_MT5_IDENTITY'):heartbeat({**local_heartbeat(),'server':server},identity,NOW)
 def test_valid_server_switch_still_requires_repairing(self):
  with self.assertRaisesRegex(ValueError,'ACCOUNT_CHANGED'):heartbeat({**local_heartbeat(),'server':'Other'},IDENTITY,NOW)
