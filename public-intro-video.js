'use strict';
const fs=require('node:fs'),path=require('node:path');
const ASSETS={
 '/media/zencore-introduction-v1.mp4':['introduction-v1.mp4','video/mp4'],
 '/media/zencore-introduction-v1.jpg':['introduction-v1.jpg','image/jpeg']
};
function serveIntroVideo(req,res,pathname){
 const asset=ASSETS[pathname];
 if(!asset||!['GET','HEAD'].includes(req.method))return false;
 const file=path.join(__dirname,'assets','landing',asset[0]);
 let size;try{size=fs.statSync(file).size;}catch{res.writeHead(404);res.end();return true;}
 const headers={'Content-Type':asset[1],'Accept-Ranges':'bytes','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'};
 let start=0,end=size-1,status=200;
 if(req.headers.range){
  const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  let valid=!!m&&(m[1]!==''||m[2]!=='');
  if(valid){
   if(m[1]===''){const suffix=Number(m[2]);valid=Number.isSafeInteger(suffix)&&suffix>0;start=Math.max(0,size-suffix);}
   else{start=Number(m[1]);end=m[2]===''?size-1:Math.min(size-1,Number(m[2]));}
   valid=valid&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start;
  }
  if(!valid){res.writeHead(416,{...headers,'Content-Range':`bytes */${size}`,'Content-Length':0});res.end();return true;}
  status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;
 }
 headers['Content-Length']=end-start+1;
 res.writeHead(status,headers);
 if(req.method==='HEAD'){res.end();return true;}
 const stream=fs.createReadStream(file,{start,end});
 stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 return true;
}
module.exports={serveIntroVideo};
