'use strict';
const {confirmations}=require('../../tf2-solid-80-sop');
const VERSION='TF2_SL065_HEMA_DRAFT_V1';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
// bars: chronological, completed TF2 candles only; current candle excluded.
function plan({side,entry,atr,tickSize,bars}={}){
 const sign=side==='BUY'?1:side==='SELL'?-1:0;
 if(!sign||![entry,atr,tickSize].every(x=>finite(x)&&x>0)||!Array.isArray(bars)||bars.length<3)return {ok:false,reason:'WAIT_DATA'};
 const recent=bars.slice(-3);
 if(recent.some(b=>b.closed!==true||b.timeframe!=='2'||!finite(b.high)||!finite(b.low)||b.low<=0||b.high<b.low||!finite(b.time))||recent.some((b,i)=>i&&b.time<=recent[i-1].time))return {ok:false,reason:'INVALID_STRUCTURE'};
 const structure=sign===1?Math.min(...recent.map(b=>b.low)):Math.max(...recent.map(b=>b.high));
 const rawDistance=sign*(entry-structure)+tickSize;
 if(sign*(entry-structure)<=0)return {ok:false,reason:'WAIT_STRUCTURE'};
 const distance=Math.max(.65*atr,rawDistance);
 const rawSl=entry-sign*distance;
 const sl=(sign===1?Math.floor(rawSl/tickSize+1e-9):Math.ceil(rawSl/tickSize-1e-9))*tickSize;
 const actualDistance=sign*(entry-sl);
 if(sl<=0||actualDistance>.75*atr+1e-8)return {ok:false,reason:'STRUCTURE_TOO_FAR',requiredDistance:actualDistance,maxDistance:.75*atr};
 return {ok:true,version:VERSION,side,entry,atr,structure,sl,distance:actualDistance,tp1:entry+sign*Math.min(.5*atr,2),tp2:entry+sign*atr,tp3:entry+sign*1.5*atr};
}
function evaluate({side,sop={},solidActive=false,...input}={}){
 const c=confirmations(side,sop),h=sop.hema2||{};
 const ribbon=finite(h.fast)&&finite(h.slow)&&(side==='BUY'?h.fast>h.slow:side==='SELL'&&h.fast<h.slow);
 const p=plan({side,...input});
 return {ready:solidActive===true&&c.dataReady&&c.hema40&&c.passed>=5&&ribbon&&p.ok,ribbon,confirmations:c,plan:p};
}
module.exports={VERSION,plan,evaluate};
