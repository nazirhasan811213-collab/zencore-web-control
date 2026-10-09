import {renderDraftVideo} from './render-mp4.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const out=process.env.MARKETING_RENDER_DIR;
const font=process.env.MARKETING_FONT_FILE;
if(!out||!font){console.error('Set MARKETING_RENDER_DIR and MARKETING_FONT_FILE');process.exitCode=2;}else{
 await fs.mkdir(path.resolve(out),{recursive:true});
 const result=await renderDraftVideo({theme:process.argv.slice(2).join(' ')||'ZenCore official launch',outputDir:path.resolve(out),fontFile:path.resolve(font)});
 console.log(JSON.stringify(result,null,2));
}
