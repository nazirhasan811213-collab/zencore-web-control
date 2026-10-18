'use strict';
// Optional monitoring metadata, accepted only on its authenticated endpoint.
// Broker passwords/account IDs remain forbidden on the execution heartbeat.
const VERSION='MT5_SERVER_MONITOR_V1';
function serverName(value){
 return typeof value==='string'&&value===value.trim()&&/^[A-Za-z0-9][A-Za-z0-9 ._():+\/-]{0,127}$/.test(value)?value:null;
}
function report(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['version','mt5ServerName','accountFingerprint'].includes(k)))return null;
 const name=serverName(input.mt5ServerName);
 if(input.version!==VERSION||!name||typeof input.accountFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.accountFingerprint))return null;
 return {version:VERSION,mt5ServerName:name,accountFingerprint:input.accountFingerprint};
}
module.exports={VERSION,serverName,report};
