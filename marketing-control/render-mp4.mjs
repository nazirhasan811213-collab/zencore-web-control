// Local MP4 draft rendering. No publish/upload functionality, no shell execution.
// FFmpeg must be installed on the private worker. Produces 9:16 original motion title slides.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {storyboard} from './video.mjs';
const LINE_LIMIT=110;
function slideText(scene){return String(scene.caption).replace(/[\r\n]+/g,' ').slice(0,LINE_LIMIT);}
export function renderArgs({workDir,output,fontFile,seconds=30}){
 if(!path.isAbsolute(workDir)||!path.isAbsolute(output)||!path.isAbsolute(fontFile))throw new Error('Absolute paths required');
 const filter=Array.from({length:5},(_,i)=>{
  const duration=[3,8,9,6,4][i],offset=[0,3,11,20,26][i];
  return {duration,offset,textFile:path.join(workDir,'slide'+i+'.txt')};
 });
 const args=['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0x081628:s=1080x1920:r=30:d='+seconds];
 const filters=filter.map(s=>{
  const f=s.textFile.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
  const font=fontFile.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
  return "drawtext=fontfile='"+font+"':textfile='"+f+"':fontcolor=white:fontsize=58:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,"+s.offset+","+(s.offset+s.duration)+")'";
 });
 args.push('-vf',filters.join(','),'-t',String(seconds),'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',output);
 return {args,filter};
}
export async function renderDraftVideo({theme='ZenCore launch',fontFile,ffmpeg='ffmpeg',outputDir,timeoutMs=120000}={}){
 if(typeof fontFile!=='string'||!path.isAbsolute(fontFile))throw new Error('Trusted absolute fontFile required');
 if(typeof outputDir!=='string'||!path.isAbsolute(outputDir))throw new Error('Trusted absolute outputDir required');
 const tmp=await mkdtemp(path.join(os.tmpdir(),'zencore-render-'));
 const name=crypto.randomUUID()+'.mp4',output=path.join(outputDir,name);
 try{
  const scenes=storyboard({theme}).scenes;
  const {args,filter}=renderArgs({workDir:tmp,output,fontFile});
  await Promise.all(filter.map((s,i)=>writeFile(s.textFile,slideText(scenes[i]),{mode:0o600})));
  await new Promise((resolve,reject)=>{
   const child=spawn(ffmpeg,args,{shell:false,stdio:['ignore','ignore','pipe']});
   let stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('FFmpeg timeout'));},timeoutMs);
   child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-1800);});
   child.on('error',e=>{clearTimeout(timer);reject(e);});
   child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('FFmpeg failed: '+stderr));});
  });
  const bytes=(await readFile(output)).length;
  return {file:output,bytes,status:'DRAFT',approvalRequired:true,published:false};
 }finally{await rm(tmp,{recursive:true,force:true});}
}
