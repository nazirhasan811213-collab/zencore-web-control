'use strict';
const VERSION='CLOSED_PRICE_TURN_V1',PERIOD={'2':120000,'15':900000};
const finite=Number.isFinite;
function validBar(b,tf){
 return b?.confirmed===true&&b.timeframe===tf&&PERIOD[tf]&&['time','closedAt','observedAt','open','high','low','close','wt1','wt2','atr'].every(k=>finite(b[k]))&&b.time>0&&b.closedAt===b.time+PERIOD[tf]&&b.observedAt>=b.closedAt-1000&&b.observedAt-b.closedAt<=60000&&b.atr>0&&[b.open,b.high,b.low,b.close].every(x=>x>0)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close);
}
function point(m,tf){
 const time=m?.sourceBarTime??m?.time;
 const b={time,timeframe:tf,closedAt:time+PERIOD[tf],observedAt:m?.signalObservedAt,confirmed:m?.confirmed===true,open:m?.open,high:m?.high,low:m?.low,close:m?.close,wt1:m?.waveTrend1,wt2:m?.waveTrend2,atr:m?.atr};
 return validBar(b,tf)&&finite(m.price)&&Math.abs(m.price-b.close)<=1e-8?b:null;
}
function confirm(side,bestPrice,rows){
 const sign=side==='BUY'?1:side==='SELL'?-1:0,bar=rows?.at(-1),prev=rows?.at(-2),before=rows?.at(-3),tf=bar?.timeframe;
 if(!sign||!finite(bestPrice)||bestPrice<=0||!validBar(bar,tf)||!validBar(prev,tf)||bar.time-prev.time!==PERIOD[tf])return null;
 const range=bar.high-bar.low,body=sign*(bar.close-bar.open),gap=sign*(bar.wt1-bar.wt2),previousGap=sign*(prev.wt1-prev.wt2);
 const adverseCandle=body<0&&range>0&&Math.abs(body)>=range*.20;
 const adverseClose=sign*(bar.close-prev.close)<0;
 const priceBreak=sign===1?bar.close<prev.low:bar.close>prev.high;
 const twoCloses=!!(validBar(before,tf)&&prev.time-before.time===PERIOD[tf]&&sign*(prev.close-before.close)<0&&adverseClose);
 const momentumAgainst=gap<=0,momentumWeakening=gap<previousGap;
 const retracement=sign*(bestPrice-bar.close),minimumRetracement=bar.atr*.20;
 if(!adverseCandle||!adverseClose||!(priceBreak||twoCloses)||!(momentumAgainst||momentumWeakening)||retracement<minimumRetracement)return null;
 return {version:VERSION,bars:[...(twoCloses?[before]:[]),prev,bar],priceBreak,twoCloses,momentumAgainst,momentumWeakening,retracement,minimumRetracement};
}
function allowed(e){
 const evidence=e.reversalEvidence,bar=evidence?.bars?.at(-1);
 if(evidence?.version!==VERSION||bar?.timeframe!==String(e.timeframe)||bar.observedAt!==e.observedAt||bar.close!==e.currentPrice)return false;
 const checked=confirm(e.side,e.bestPrice,evidence.bars);
 return !!checked&&['priceBreak','twoCloses','momentumAgainst','momentumWeakening'].every(k=>evidence[k]===checked[k]);
}
module.exports={VERSION,point,confirm,allowed};
