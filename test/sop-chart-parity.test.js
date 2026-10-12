const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {build}=require('../scripts/build-sop-chart.cjs');const root=path.resolve(__dirname,'..');
test('generated chart keeps canonical scan function, eligibility, targets and latch',()=>{
 for(const tf of [2,15]){
  const source=fs.readFileSync(path.join(root,`ZenCore_TF${tf}_Realtime_Feed.pine`),'utf8'),chart=fs.readFileSync(path.join(root,`ZenCore_Chart_TF${tf}_SOP_Aligned.pine`),'utf8');
  assert.equal(chart,build(tf));
  const scan=s=>s.slice(s.indexOf('f_scan3()=>'),s.indexOf('var string[] symbols='));
  assert.equal(scan(chart),scan(source));
  assert.equal(chart.match(/bool eligible=[^\n]+/)[0],source.match(/bool eligible=[^\n]+/)[0]);
  assert.match(chart,/zcReady:=eligible/);assert.match(chart,/feedEnabled=input.bool\(false/);
  assert.match(chart,/if barstate.isrealtime and feedEnabled/);
  assert.match(chart,/plot\(zcTp1,title="TP1 — bridge"/);
  assert.match(chart,/SOLID trigger — tunggu pengesahan/);
 }
});
