'use strict';
const VERSION='TF2_SCALP_ATR_CAP_V1';
const POLICY=Object.freeze({version:VERSION,timeframe:'2',units:'XAUUSD_PRICE_DISTANCE',atrPeriod:14,tp1:{atr:.5,max:2},tp2:{atr:1,max:null},tp3:{atr:1.5,max:null},sl:{atr:.75,max:null},anchor:'SOP_COMPLETION_PRICE_V1'});
function distances(atr){return typeof atr==='number'&&Number.isFinite(atr)&&atr>0?{tp1:Math.min(.5*atr,2),tp2:atr,tp3:1.5*atr,sl:.75*atr}:null;}
function levels(side,entry,atr){const d=distances(atr),sign=side==='BUY'?1:side==='SELL'?-1:0;if(!d||!sign||!(entry>0))return null;return {side,entry,sl:entry-sign*d.sl,tp1:entry+sign*d.tp1,tp2:entry+sign*d.tp2,tp3:entry+sign*d.tp3};}
module.exports={VERSION,POLICY,distances,levels};
