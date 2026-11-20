"""Execute the EA's pure config policy, and preserve runtime trading guards."""
import shutil, subprocess, tempfile, unittest
from pathlib import Path
from connector import readiness_message

class ManualConfigPolicyTests(unittest.TestCase):
 def test_ea_policy_for_stopped_entry_and_invalid_contracts(self):
  compiler=shutil.which('g++') or shutil.which('clang++')
  if not compiler:self.skipTest('Portable policy compiler unavailable; MetaEditor CI compiles the complete EA')
  source=(Path(__file__).parent/'ZenCoreExecutor.mq5').read_text()
  start=source.index('string ManualConfigReason(')
  end=source.index('\n}\n',start)+2
  policy=source[start:end]
  program='#include <string>\n#include <cassert>\nusing string=std::string;\n'+policy+'''\nint main(){
 assert(ManualConfigReason(true,true,true,true,true,true,true,true,true)=="READY");
 // Disable remains possible with obsolete TP values or non-hedging mode.
 assert(ManualConfigReason(true,true,true,true,true,false,false,false,false)=="READY");
 assert(ManualConfigReason(false,false,false,true,true,false,true,true,true)=="MANUAL_EXIT_LEASE_NOT_FOUND");
 assert(ManualConfigReason(true,false,true,true,true,true,true,true,true)=="MANUAL_EXIT_LEASE_BINDING_CHANGED");
 assert(ManualConfigReason(true,true,false,true,true,true,true,true,true)=="MANUAL_EXIT_LEASE_EXPIRED");
 assert(ManualConfigReason(true,true,true,false,true,true,true,true,true)=="MANUAL_EXIT_LAYER_POLICY_INVALID");
 assert(ManualConfigReason(true,true,true,true,false,true,true,true,true)=="MANUAL_EXIT_PAIR_SCOPE_INVALID");
 assert(ManualConfigReason(true,true,true,true,true,true,false,true,true)=="MANUAL_EXIT_HEDGING_REQUIRED");
 assert(ManualConfigReason(true,true,true,true,true,true,true,false,true)=="MANUAL_EXIT_DISTANCES_INVALID");
 assert(ManualConfigReason(true,true,true,true,true,true,true,true,false)=="MANUAL_EXIT_VERSION_UNSUPPORTED");
}'''
  with tempfile.TemporaryDirectory() as d:
   src=Path(d)/'policy.cpp';src.write_text(program);exe=Path(d)/'policy.exe'
   subprocess.run([compiler,'-std=c++17',str(src),'-o',str(exe)],check=True,capture_output=True)
   subprocess.run([str(exe)],check=True,capture_output=True)
  # No auto-entry ON is issued when saving config, and broker changes remain gated.
  config=source[source.index(' if(type=="MANUAL_EXIT_CONFIG")'):source.index(' else if(type=="MANUAL_EXIT_ACTION")')]
  self.assertNotIn('armed=true',config)
  self.assertNotIn('Permissions() &&',config)
  manual=source[source.index('void ManageManual()'):source.index('void OnTradeTransaction')]
  self.assertIn('!Permissions()',manual)
  self.assertIn('manualEnabled && ManualLease()',manual)
 def test_rejection_reasons_are_actionable_in_manager(self):
  for code in ['MANUAL_EXIT_LEASE_EXPIRED','MANUAL_EXIT_HEDGING_REQUIRED','MANUAL_EXIT_DISTANCES_INVALID','MANUAL_EXIT_SAVE_FAILED']:
   self.assertNotIn('Arahan ditolak:',readiness_message(code))
