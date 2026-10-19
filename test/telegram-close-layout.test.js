'use strict';
const test=require('node:test'),a=require('node:assert/strict'),{telegramMessage}=require('../analysis-telegram');
for(const tf of ['3','15'])test(`TF${tf} close is a scoped action, not an execution acknowledgement`,()=>{
 const message=telegramMessage({kind:'CLOSE',symbol:'XAUUSD',timeframe:tf,time:Date.UTC(2026,9,19,1,0),id:'close-1',percent:100,message:`XAUUSD • TF${tf} • CLOSE SEMUA\nChart Close Separuh → CLOSE ALL`});
 a.ok(message.startsWith(`🛑 ZENCORE | CLOSE ALL TF${tf}`));a.match(message,new RegExp(`Tutup semua baki posisi ZenCore TF${tf}`));
 a.match(message,/semak pengesahan close di MT5/);a.match(message,/belum pengesahan posisi MT5 ditutup/);
 a.equal((message.match(/XAUUSD/g)||[]).length,1);a.equal((message.match(/Chart Close Separuh/g)||[]).length,1);
 a.match(message,/09:00:00 MYT/);a.doesNotMatch(message,/SEMUA POSISI SUDAH DITUTUP|undefined/);
});
test('legacy 50% close wording does not turn into a full-close instruction',()=>{
 const message=telegramMessage({kind:'CLOSE',symbol:'XAUUSD',timeframe:'2',time:Date.now(),id:1,percent:50,message:'Partial profit'});
 a.match(message,/CLOSE SEPARUH \(50%\)/);a.match(message,/Tutup 50% posisi/);a.doesNotMatch(message,/Tutup semua baki/);
});
