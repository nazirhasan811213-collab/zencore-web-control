'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {serveIntroVideo}=require('../public-intro-video');
test('public intro media supports seeking, metadata HEAD and bounded asset access',async t=>{
 const server=http.createServer((req,res)=>{if(!serveIntroVideo(req,res,req.url)){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const file=path.join(__dirname,'../assets/landing/introduction-v1.mp4'),size=fs.statSync(file).size;
 const head=await fetch(base+'/media/zencore-introduction-v1.mp4',{method:'HEAD'});
 assert.equal(head.status,200);assert.equal(head.headers.get('content-type'),'video/mp4');assert.equal(Number(head.headers.get('content-length')),size);assert.equal((await head.arrayBuffer()).byteLength,0);
 for(const [range,start,end] of [['bytes=0-15',0,15],['bytes=-16',size-16,size-1],['bytes=100-',100,size-1]]){
  const response=await fetch(base+'/media/zencore-introduction-v1.mp4',{headers:{Range:range}});
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${size}`);
  const actual=Buffer.from(await response.arrayBuffer()),expected=Buffer.alloc(end-start+1),fd=fs.openSync(file,'r');
  try{fs.readSync(fd,expected,0,expected.length,start);}finally{fs.closeSync(fd);}
  assert.deepEqual(actual,expected);
 }
 for(const range of ['bytes=999999999-','bytes=8-2','bytes=-0','bytes=0-2,6-8','junk']){
  const response=await fetch(base+'/media/zencore-introduction-v1.mp4',{headers:{Range:range}});
  assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),`bytes */${size}`);
 }
 const poster=await fetch(base+'/media/zencore-introduction-v1.jpg');assert.equal(poster.status,200);assert.equal(poster.headers.get('content-type'),'image/jpeg');await poster.arrayBuffer();
 assert.equal((await fetch(base+'/media/../server-analysis.js')).status,404);
 assert.equal((await fetch(base+'/media/zencore-introduction-v1.mp4',{method:'POST'})).status,404);
});
