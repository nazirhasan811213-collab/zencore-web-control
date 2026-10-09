// Video storyboard and local render recipe; requires FFmpeg on the rendering host.
// This module produces drafts only and never uploads to social media.
export function storyboard({theme='ZenCore launch',seconds=30}={}){
 const title=String(theme).slice(0,120);
 return {title,aspectRatio:'9:16',seconds,approvalRequired:true,status:'DRAFT',scenes:[
 {from:0,to:3,caption:'MASIH MENGHADAP CHART SEPANJANG HARI?',visual:'Animated original graphic (no fabricated market numbers)'},
 {from:3,to:11,caption:'KENALI ZENCORE',visual:'Authentic product screen capture supplied by Founder'},
 {from:11,to:20,caption:'AI ANALYSIS + MT5 AUTO TRADE CONTROL',visual:'Authentic working dashboard recording, mask account credentials'},
 {from:20,to:26,caption:'TRADER, ENJOY YOUR LIFE. YOU ARE THE BOSS.',visual:'Motion typography with ZenCore branding'},
 {from:26,to:30,caption:'19 OKTOBER 2026 · Trading involves risk.',visual:'Launch call to action and risk notice'}]};
}
export function renderInstructions(){return {inputs:['founder-approved screen recording','licensed music or silent audio','approved branding'],output:'1080x1920 H.264 MP4',engine:'FFmpeg',automaticRelease:false,note:'Do not render fake profits or non-existent product UI.'};}
