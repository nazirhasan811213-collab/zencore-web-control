'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
for(const tf of ['2','15']){
 const src=fs.readFileSync(`${__dirname}/../ZenCore_TF${tf}_SOP_V7.pine`,'utf8');
 test(`TF${tf}: every planSign reference is inside its declaration scope`,()=>{
  let scope=null,refs=0;
  for(const line of src.split('\n')){
   const text=line.trim();if(!text||text.startsWith('//'))continue;
   const indent=line.length-line.trimStart().length;
   if(scope!==null&&indent<scope)scope=null;
   if(/\bfloat planSign =/.test(text))scope=indent;
   if(/\bplanSign\b/.test(text)){refs++;assert.notEqual(scope,null,text);assert.ok(indent>=scope,text);}
  }
  assert.ok(refs>=7);
 });
 test(`TF${tf}: BTC targets are calculated for every qualification, independently of labels`,()=>{
  const start=src.indexOf('if zc_hold_qualify\n');
  const end=src.indexOf('\n// ',start);
  const body=src.slice(start,end);
  for(const n of [1,2,3])assert.match(body,new RegExp('zc_seq_tp'+n+' := zc_seq_entry\\+planSign\\*btcTp'+n+'Distance'));
  const link=src.indexOf('if zc24_feed and zc_cycle_kind == "FOLLOWUP"');
  if(link>=0){const tail=src.slice(link,src.indexOf('// Execution event expires',link));assert.doesNotMatch(tail,/planSign|zc_seq_tp[123] :=/);}
 });
}
