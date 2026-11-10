import shutil,subprocess,tempfile,unittest
from pathlib import Path
class EaSessionResumeTests(unittest.TestCase):
 def test_actual_resume_function_requires_saved_intent_permission_and_owner_lease(self):
  compiler=shutil.which('g++')
  if not compiler:self.skipTest('C++ compiler unavailable')
  source=Path(__file__).with_name('ZenCoreExecutor.mq5').read_text();fn=source[source.index('void TryResumeEntry(){'):source.index('int OnInit(){')]
  cpp='''#include <string>
#include <cassert>
using string=std::string;
bool resumePending=true,armed=false,allowed=true,fresh=false;string ownerPod="owner",enabledSymbols="XAUUSD";int saved=0;
bool Permissions(){return allowed;} bool FreshLease(){return fresh;} void SaveState(){saved++;}void Print(string){}
'''+fn+'''
int main(){
 TryResumeEntry();assert(!armed&&resumePending&&saved==0);
 fresh=true;allowed=false;TryResumeEntry();assert(!armed&&resumePending);
 allowed=true;ownerPod="";TryResumeEntry();assert(!armed);
 ownerPod="owner";enabledSymbols="";TryResumeEntry();assert(!armed);
 enabledSymbols="XAUUSD";resumePending=false;TryResumeEntry();assert(!armed);
 resumePending=true;TryResumeEntry();assert(armed&&!resumePending&&saved==1);
 TryResumeEntry();assert(saved==1);
 armed=false;resumePending=false;TryResumeEntry();assert(!armed&&saved==1);
}
'''
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder);(p/'test.cpp').write_text(cpp);r=subprocess.run([compiler,'-std=c++17',str(p/'test.cpp'),'-o',str(p/'test.exe')],capture_output=True,text=True)
   self.assertEqual(r.returncode,0,r.stderr);subprocess.run([str(p/'test.exe')],check=True)
