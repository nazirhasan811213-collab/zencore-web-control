import {prepareCampaign} from './orchestrator.mjs';
import {generateDraft} from './agents.mjs';
const DAY=24*60*60*1000;
export function createEditorialSchedule(start='2026-10-09',end='2026-10-19'){
 const from=new Date(start+'T00:00:00Z'),to=new Date(end+'T00:00:00Z');
 if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||to<from||to-from>90*DAY)throw Error('Invalid campaign period');
 const themes=['Brand introduction','Why traders need an analysis checklist','Real ZenCore dashboard tour','How the signal analysis works','Understanding auto-trade controls','Risk management and stop loss','ZenCore feature FAQ','Live walkthrough using real screenshots','Founder introduction','Countdown to launch','Official launch walkthrough'];
 const posts=[];
 for(let t=from.getTime(),i=0;t<=to.getTime();t+=DAY,i++){
  const day=new Date(t).toISOString().slice(0,10);
  const theme=themes[Math.min(i,themes.length-1)];
  posts.push({date:day,theme,platforms:['facebook','instagram','tiktok'],status:'PLAN_ONLY',approvalRequired:true});
 }
 return posts;
}
export async function generateDailyQueue({date,theme,save,modelEnabled=false}){
 const campaigns=prepareCampaign({theme,date});
 const results=[];
 for(const channel of campaigns.channels){
  const draft=modelEnabled?await generateDraft({channel,theme,language:'ms'}):{
   title:'ZenCore · '+theme,
   caption:`Kenali ZenCore: ${theme}. Sistem menawarkan analisis carta dan kawalan auto trade yang perlu dipantau pengguna. Trading mempunyai risiko kerugian modal. Pelancaran 19 Oktober 2026. #ZenCore #TradingEducation`,
   channel,source:'template-draft'
  };
  results.push(await save(draft));
 }
 return {date,theme,items:results,status:'DRAFT_ONLY'};
}
