// Eight-role editorial orchestration: deterministic briefs only; no external posting.
export const AGENT_ROLES=Object.freeze([
 {id:'director',name:'GPT Marketing Director',output:'daily campaign brief'},
 {id:'strategy',name:'Campaign Strategist',output:'audience, theme, objective'},
 {id:'copywriter',name:'AI Copywriter',output:'platform scripts and captions'},
 {id:'designer',name:'AI Designer',output:'poster and thumbnail brief'},
 {id:'video',name:'AI Video Producer',output:'9:16 cinematic video storyboard'},
 {id:'social',name:'AI Social Manager',output:'per-platform schedule proposal'},
 {id:'community',name:'AI Community',output:'FAQ and draft replies, never sent'},
 {id:'analytics',name:'AI Analyst',output:'KPI definitions and weekly analysis'}
]);
const safe=(x,max=300)=>typeof x==='string'?x.trim().slice(0,max):'';
export function prepareCampaign({theme,date='2026-10-19',channels=['facebook','instagram','tiktok']}){
 const name=safe(theme);
 if(!name)throw new Error('Theme required');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Invalid date');
 const approved=channels.filter(x=>['facebook','instagram','tiktok'].includes(x));
 if(!approved.length)throw new Error('At least one supported channel required');
 const mission='Introduce verified ZenCore functionality and explain trading risk without profit guarantees.';
 const tasks=[
 {agent:'director',kind:'plan',brief:name+' — '+mission},
 {agent:'strategy',kind:'strategy',brief:'Audience: traders exploring assisted analysis and trade automation; explain workflow truthfully'},
 {agent:'copywriter',kind:'text',brief:'Draft a Malay hook, a caption, CTA and trading risk disclaimer'},
 {agent:'designer',kind:'visual-brief',brief:'Use ONLY real ZenCore screen captures; midnight navy / electric blue; 1080x1350 poster'},
 {agent:'video',kind:'storyboard',brief:'Create a dynamic 9:16 storyboard: 0–3s hook, 3–12s genuine UI screen, 12–25s feature walk-through, 25–30s risk + CTA; no simulated P&L'},
 {agent:'social',kind:'schedule-proposal',brief:'Suggest local-time publishing slots for '+approved.join(', ')+'; never publish'},
 {agent:'community',kind:'faq',brief:'Draft FAQ on connection, auto-trade risks and user onboarding; never send'},
 {agent:'analytics',kind:'metrics',brief:'Track organic reach, engagement, qualified leads, registrations, and active users; do not fabricate results'}
 ];
 return {campaign:name,date,channels:approved,status:'DRAFT',approvalRequired:true,publishingAllowed:false,tasks};
}
