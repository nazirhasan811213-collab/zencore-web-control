import re,unittest
from pathlib import Path
from protocol import CONNECTOR_BUILD,EA_VERSION
from vps_manager import VERSION as MANAGER_VERSION

ROOT=Path(__file__).parent
class PackageContractTests(unittest.TestCase):
 def test_both_installers_match_source_versions_and_do_not_ship_user_pairings(self):
  normal=(ROOT/'installer.iss').read_text();vps=(ROOT/'vps-installer.iss').read_text()
  self.assertIn('#define AppVersion "'+CONNECTOR_BUILD+'"',normal)
  self.assertIn('OutputBaseFilename=ZenCoreSetup-'+CONNECTOR_BUILD,normal)
  self.assertIn('AppVersion='+MANAGER_VERSION,vps)
  self.assertIn('OutputBaseFilename=ZenCoreVPSSetup-'+MANAGER_VERSION,vps)
  for text in (normal,vps):
   self.assertNotIn('[InstallDelete]',text);self.assertNotIn('[UninstallDelete]',text)
   files=text.split('[Files]',1)[1].split('[Icons]',1)[0]
   self.assertNotIn('paired.dpapi',files);self.assertNotIn('terminal-folder.json',files)
   self.assertNotIn('lease.tsv',files)
  self.assertTrue((ROOT/('PANDUAN_INSTALL_'+CONNECTOR_BUILD+'.txt')).is_file())
  self.assertIn('#property version "'+EA_VERSION+'"',(ROOT/'ZenCoreExecutor.mq5').read_text())
 def test_manual_build_uses_current_version_not_obsolete_output_names(self):
  script=(ROOT/'build-windows.ps1').read_text()
  self.assertIn('from protocol import CONNECTOR_BUILD',script)
  self.assertIn('ZenCoreSetup-$buildVersion.exe',script)
  self.assertIn('PANDUAN_INSTALL_$buildVersion.txt',script)
  self.assertNotIn('2.1.2',script)
