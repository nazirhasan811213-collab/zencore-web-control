'use strict';
// Usage: node scripts/sync-signal-desk.cjs /absolute/path/to/site/dist
// Copies only public source assets, never Site identity or repository credentials.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const source=process.argv[2];if(!source||!path.isAbsolute(source))throw new Error('Provide the absolute Site dist directory.');
const dest=path.resolve(__dirname,'../signal-desk'),files=['index.html','styles.css','app.js','evidence.js','fusion.js','fusion-ui.js','live.js','website.js','visual-live.js'],hashes={};
fs.mkdirSync(dest,{recursive:true});
for(const file of files){const data=fs.readFileSync(path.join(source,file));fs.writeFileSync(path.join(dest,file),data);hashes[file]=crypto.createHash('sha256').update(data).digest('hex');}
fs.writeFileSync(path.join(dest,'bundle-manifest.json'),JSON.stringify({project:'appgprj_6ae177b62cdc8191be4df1b7ab8db208',files:hashes},null,2)+'\n');
console.log('Signal Desk bundle synchronized: '+files.length+' shared assets.');
