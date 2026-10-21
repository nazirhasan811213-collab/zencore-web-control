'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),{applyEvent,idFor}=require('../current-signal-records'),Results=require('../results-core');
const event=(edit={})=>({kind:'ENTRY',symbol:'XAUUSD',timeframe:'2',setupKey:'A',side:'BUY',time:1000,telegramPlan:{entry:100,sl:98,tp1:102,tp2:104,tp3:106},...edit});
test('records exact entry, observed TP and close without inventing profit',()=>{
 const rows=new Map(),entry=event();a.equal(applyEvent(rows,entry).length,1);a.equal(applyEvent(rows,{...entry,time:1100}).length,0);
 a.equal(applyEvent(rows,event({kind:'TP_HIT',targetNumber:1,currentPrice:101,time:1200})).length,0);
 applyEvent(rows,event({kind:'TP_HIT',targetNumber:2,currentPrice:104,time:1300}));let row=rows.get(idFor(entry));a.equal(row.hitTp1,true);a.equal(row.hitTp2,true);a.equal(row.hitTp3,false);
 a.equal(applyEvent(rows,event({kind:'CLOSE',percent:100,time:1250})).length,0);
 applyEvent(rows,event({kind:'CLOSE',percent:100,time:1400,message:'Native chart close'}));a.equal(row.state,'CLOSED');a.equal(row.outcome,'CLOSE_SIGNAL');
 a.equal(applyEvent(rows,entry).length,0);a.equal(Results.normaliseRow(row).isWin,false);
});
test('TFs, superseded source, invalid/duplicate events and orphan exits remain distinct',()=>{
 const rows=new Map();a.deepEqual(applyEvent(rows,event({kind:'CLOSE',percent:100})),[]);
 a.deepEqual(applyEvent(rows,event({telegramDuplicate:true})),[]);a.deepEqual(applyEvent(rows,event({telegramPlan:null})),[]);
 applyEvent(rows,event());applyEvent(rows,event({timeframe:'15'}));applyEvent(rows,event({setupKey:'B',time:2000,telegramSop:{cycleKind:'FOLLOWUP'}}));
 a.equal(rows.size,3);a.equal(rows.get(idFor(event())).outcome,'SUPERSEDED');a.equal(rows.get(idFor(event({timeframe:'15'}))).state,'OPEN');
 a.equal(rows.get(idFor(event({setupKey:'B'}))).entryType,'REENTRY');
});
test('persisted summary uses full database counts, TF remains in filters and CSV',()=>{
 const r=event(),rows=new Map();applyEvent(rows,r);applyEvent(rows,event({kind:'TP_HIT',targetNumber:1,currentPrice:102,time:1200}));
 const data={records:[...rows.values()],totals:[{timeframe:'2',sample:50,resolved:40,open:10,tp1:30,tp2:10,tp3:3}],lastSync:2000};
 const result=Results.fromStoredRecords(data);a.equal(result.summary.sample,50);a.equal(result.summary.winRate,60);a.equal(result.allRows[0].timeframe,'2');
 a.equal(Results.filterRows(result.allRows,{category:'tp1'}).length,1);a.equal(Results.filterRows(result.allRows,{category:'closed'}).length,0);a.match(Results.buildCsv(result.allRows),/Timeframe/);
});
