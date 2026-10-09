// Draft-generation helper. Never publishes, sends messages or spends on ads.
// OpenAI API key is only read on the server, never returned to clients.
const API='https://api.openai.com/v1/responses';
const allowed=new Set(['facebook','instagram','tiktok']);
const facts=Object.freeze({
 brand:'ZenCore',
 launch:'19 October 2026',
 features:['AI analysis dashboard','trade signal monitoring','MT5 auto-trade controls'],
 slogan:"TRADER, ENJOY YOUR LIFE. YOU'RE THE BOSS. BIAR ZENCORE TRADE UNTUK ANDA.",
});
export async function generateDraft({channel,theme,language='ms'}){
 if(!allowed.has(channel))throw new Error('Invalid channel');
 if(typeof theme!=='string'||!theme.trim()||theme.length>300)throw new Error('Invalid theme');
 if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY not configured');
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),20000);
 const instructions='Create one marketing DRAFT for the ZenCore product. Return plain text caption only, under 900 characters. Platform: '+channel+'. Language: '+language+'. Theme: '+theme+'. Verified facts: '+JSON.stringify(facts)+'. Do NOT invent live performance, user testimonials, win rates, profit percentages, broker regulation, screenshots or guarantees. Include natural risk disclosure that trading can lose money. Do not claim the system is risk-free. Do not claim the content was published.';
 try{
  const response=await fetch(API,{method:'POST',signal:controller.signal,headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.MARKETING_MODEL||'gpt-4.1-mini',instructions,input:'Create the draft caption now.',max_output_tokens:450})});
  if(!response.ok)throw new Error('OpenAI request failed: '+response.status);
  const json=await response.json();
  const text=(json.output||[]).flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('\n').trim();
  if(!text)throw new Error('No draft generated');
  return {title:'ZenCore · '+theme.slice(0,90),caption:text.slice(0,5000),channel,source:'ai-draft',model:process.env.MARKETING_MODEL||'gpt-4.1-mini'};
 }finally{clearTimeout(timeout);}
}
