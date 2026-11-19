'use strict';
function maximumAge(market){
 return String(market?.timeframe)==='1'&&market?.strategyNormal?.entrySopVersion==='NORMAL_20261001_TF1_RIBBON_V1'?60000:30000;
}
module.exports={maximumAge};
