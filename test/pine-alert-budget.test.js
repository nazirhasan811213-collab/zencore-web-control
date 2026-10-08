const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
for (const tf of [2,15]) {
 const source=fs.readFileSync(`ZenCore_TF${tf}_Realtime_Feed.pine`,'utf8');
 // Evaluate the actual Pine scalar budget expressions, rather than a copied policy.
 function expression(name,ctx) {
  const match=source.match(new RegExp(`bool ${name}=(.*)`));
  assert.ok(match, name);
  const js=match[1].replace(/\band\b/g,'&&').replace(/\bor\b/g,'||');
  return vm.runInNewContext(js,ctx);
 }
 function due(state) {
  const ctx={feedChannel:'Execution',sentCount:0,emitEntry:false,bootstrap:false,protectionState:'same',lastSentProtectionState:'same',managementState:'new-sl',lastSentManagementState:'old-sl',timenow:20000,lastManagementSentAt:0,...state};
  ctx.urgentDue=expression('urgentDue',ctx);ctx.trailingDue=expression('trailingDue',ctx);
  return expression('executionDue',ctx);
 }
 test(`TF${tf}: volatile trailing SL cannot consume four reserved slots`,()=>{
  assert.equal(due({sentCount:7}),true);
  for(let count=8;count<12;count++) {assert.equal(due({sentCount:count}),false);assert.equal(due({sentCount:count,emitEntry:true}),true);}
  assert.equal(due({sentCount:12,emitEntry:true}),false);
 });
 test(`TF${tf}: protection stage changes bypass trailing cooldown, not hard quota`,()=>{
  assert.equal(due({timenow:100,protectionState:'TP1',sentCount:11}),true);
  assert.equal(due({timenow:100,sentCount:1}),false);
  assert.equal(due({protectionState:'CLOSED',sentCount:12}),false);
  assert.match(source,/timenow-array.get\(recentFeedSends,0\)>180000/);
  assert.ok(source.indexOf('alert(payload,alert.freq_all)')<source.indexOf('// Mark delivered only after'));
 });
}
