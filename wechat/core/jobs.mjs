import {uid} from './store.mjs';
import {owned,fail} from './service.mjs';
import {inInitial,inFinal} from '../../shared/domain.mjs';
import {DEFAULT_TAGS,structuredTags,samplePhotos,normalizeTags} from '../../shared/tags.mjs';
import {createHash} from 'node:crypto';
export const versionOf=(v)=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,16);
export async function vocabulary(store,projectId){return await store.get('vocabulary',projectId)||{id:projectId,projectId,tags:structuredTags(DEFAULT_TAGS),version:versionOf(DEFAULT_TAGS),schemaVersion:2};}
export function publicJob({config,...job}){return job;}
export async function jobActions(store,action,input,{config={},dispatch=async()=>{},perform}={}){
 if(action==='settings.status')return {configured:!!config.configured,workerReady:!!config.workerReady,model:config.model||'',imageModel:config.imageModel||'wan2.7-image',dailyLimit:config.dailyLimit||100,canGenerate:!!config.canGenerate};
 if(action==='tags.library'){await owned(store,'project',input.projectId);return vocabulary(store,input.projectId);}
 if(action==='jobs.list'){await owned(store,'project',input.projectId);return (await store.all('job',{projectId:input.projectId})).sort((a,b)=>b.createdAt-a.createdAt).map(publicJob);}
 if(action==='jobs.get'){return publicJob(await owned(store,'job',input.id));}
 if(action==='jobs.confirm'){
  const job=await owned(store,'job',input.id);if(job.state!=='confirmation'||job.type!=='sample')fail('任务尚未到确认步骤');
  const tags=structuredTags(normalizeTags(input.tags));const lib={id:job.projectId,projectId:job.projectId,tags,version:versionOf(tags),schemaVersion:2};await store.put('vocabulary',lib);await store.put('job',{...job,state:'done',confirmedAt:Date.now()});
  return jobActions(store,'jobs.create',{projectId:job.projectId,type:'classify',ids:job.scopeIds},{config,dispatch,perform});
 }
 if(action==='jobs.control'){
  const job=await owned(store,'job',input.id);
  if(!['pause','resume','cancel','retry'].includes(input.action))fail('任务操作无效');
  if(input.action==='cancel'){return publicJob(await store.transaction(async tx=>{const current=await owned(tx,'job',job.id);return tx.put('job',{...current,state:'cancelled',generation:current.generation+1});}));}
  if(input.action==='pause'){return publicJob(await store.transaction(async tx=>{const current=await owned(tx,'job',job.id);return tx.put('job',{...current,state:'paused'});}));}
  if(['cancelled','done','confirmation'].includes(job.state))fail('此任务不能继续');
  if(!config.configured||!config.workerReady)fail('管理员需配置 AI 密钥与异步执行器');
  if(input.action==='retry')for(const item of await store.all('jobItem',{jobId:job.id}))if(['failed','unknown'].includes(item.state))await store.put('jobItem',{...item,state:'pending',attempts:0,nextAt:0,error:''});
  const items=await store.all('jobItem',{jobId:job.id});const next=await store.put('job',{...job,state:'queued',error:'',failed:items.filter(i=>i.state==='failed').length});await dispatch();return publicJob(next);
 }
 if(action!=='jobs.create')return;
 await owned(store,'project',input.projectId);
 if(!['classify','sample','recommend','copy','cover','render'].includes(input.type))fail('任务类型无效');
 if(!config.workerReady)fail('异步执行器尚未部署，请联系管理员','CONFIG');
 if(input.type!=='render'&&!config.configured)fail('AI 服务尚未配置，请联系管理员','CONFIG');
 if(input.type==='cover'&&!config.canGenerate)fail('生图额度尚未开启');
 let all=await store.all('photo',{projectId:input.projectId});
 const isClassification=['classify','sample'].includes(input.type);
 all=all.filter(isClassification?inInitial:inFinal);
 if(input.collectionId){const c=await owned(store,'collection',input.collectionId);if(c.projectId!==input.projectId)fail('作品集不属于当前项目');const members=await store.all('member',{collectionId:c.id});all=all.filter(p=>members.some(m=>m.photoId===p.id));}
 if(input.ids){if(!Array.isArray(input.ids)||input.ids.some(id=>!all.some(p=>p.id===id)))fail('范围包含不可分析或无权访问的照片');all=all.filter(p=>input.ids.includes(p.id));}
 if(!all.length)fail('当前范围没有可用照片');
 if(['copy','cover','render'].includes(input.type)&&!input.collectionId)fail('请先选择保存到哪个作品集');
 const lib=await vocabulary(store,input.projectId);
 const snapshot={baseURL:config.baseURL,model:config.model,jsonMode:!!config.jsonMode,imageEndpoint:config.imageEndpoint,imageModel:config.imageModel};
 const cacheKey=versionOf({snapshot,vocabulary:lib.version});
 let ids=all.filter(p=>input.force||p.ai?.cacheKey!==cacheKey).map(p=>p.id);
 if(input.type==='sample')ids=samplePhotos(all);
 if(!isClassification)ids=all.map(p=>p.id);
 if(!ids.length)return {state:'done',total:0,completed:0,message:'当前范围已完成此版本分类'};
 const id=uid(),generation=1;
 const tasks=isClassification?ids.map(photoId=>({id:uid(),photoId})): [{id:uid()}];
 const job={id,projectId:input.projectId,type:input.type,scopeIds:all.map(p=>p.id),sampleIds:input.type==='sample'?ids:[],vocabulary:input.type==='sample'?{...lib,tags:structuredTags([...(input.tags||[]),...lib.tags])}:lib,cacheKey,config:snapshot,state:'preparing',total:tasks.length,completed:0,failed:0,skipped:0,generation,createdAt:Date.now(),collectionId:input.collectionId||null,prompt:String(input.prompt||'').slice(0,3000),draft:input.draft||null,locked:input.locked||[],current:input.current||[],ratio:input.ratio||'3:4'};
 await store.transaction(async tx=>{const day=new Date().toISOString().slice(0,10),quotaId=versionOf(store.owner+day);const quota=await tx.get('quota',quotaId)||{id:quotaId,used:0};const units=input.type==='render'?0:tasks.length;if(quota.used+units>(config.dailyLimit||100))fail('今日 AI 额度不足，请联系管理员');await tx.put('quota',{...quota,used:quota.used+units,day});await tx.put('job',job);});
 try{for(const t of tasks)await store.put('jobItem',{...t,jobId:id,projectId:job.projectId,state:'pending',attempts:0,generation});await store.put('job',{...job,state:'queued'});await dispatch();}catch(e){await store.put('job',{...job,state:'paused',error:'任务派发失败，可继续：'+e.message});}
 return publicJob(await store.get('job',id));
}
export async function processJob(store,jobId,perform,{concurrency=8,maxItems=Infinity,now=()=>Date.now()}={}){
 const job=await owned(store,'job',jobId);if(!['queued','running'].includes(job.state))return;
 await store.transaction(async tx=>{const current=await owned(tx,'job',jobId);if(current.state==='queued')await tx.put('job',{...current,state:'running'});});
 const items=(await store.all('jobItem',{jobId})).filter(i=>['pending','running'].includes(i.state)).slice(0,maxItems);let cursor=0;
 await Promise.all(Array.from({length:job.type==='sample'?Math.min(4,concurrency):Math.min(8,concurrency)},async()=>{
  while(cursor<items.length){const item=items[cursor++];const claimed=await store.transaction(async tx=>{
   const j=await owned(tx,'job',jobId),v=await owned(tx,'jobItem',item.id);
   if(!['queued','running'].includes(j.state)||j.generation!==job.generation)return null;
   if(v.state==='running'&&v.leaseUntil>now())return null;
   if(!['pending','running'].includes(v.state)||(v.nextAt||0)>now())return null;
   if(v.state==='running'&&['cover'].includes(job.type)){await tx.put('jobItem',{...v,state:'unknown',error:'生图执行中断，结果未知，请确认后重试'});return null;}
   return tx.put('jobItem',{...v,state:'running',leaseUntil:now()+300000,attempts:v.attempts+1,token:uid()});
  });if(!claimed)continue;
  try{
   const p=claimed.photoId?await owned(store,'photo',claimed.photoId):null;
   let result;
   if(p&&!inInitial(p))result={skipped:true};else result=await perform(job,claimed,p);
   await store.transaction(async tx=>{const j=await owned(tx,'job',jobId),v=await owned(tx,'jobItem',claimed.id);if(j.generation!==job.generation||j.state==='cancelled'||v.token!==claimed.token)return;
    if(p&&job.type==='classify'&&!result.skipped){const current=await owned(tx,'photo',p.id);if(!inInitial(current)){result={skipped:true};}else await tx.put('photo',{...current,ai:{...result.analysis,cacheKey:job.cacheKey},aiStatus:'done'});}
    await tx.put('jobItem',{...v,state:result.skipped?'skipped':'done',result,leaseUntil:0});
    await tx.put('job',{...j,completed:j.completed+Number(!result.skipped),skipped:j.skipped+Number(!!result.skipped)});
   });
  }catch(e){await store.transaction(async tx=>{const j=await owned(tx,'job',jobId),v=await owned(tx,'jobItem',claimed.id);if(j.generation!==job.generation||j.state==='cancelled'||v.token!==claimed.token)return;const retry=job.type!=='cover'&&!e.auth&&!e.unknown&&v.attempts<3;await tx.put('jobItem',{...v,state:retry?'pending':e.unknown?'unknown':'failed',nextAt:now()+Math.max(e.retryAfter||0,1000*2**v.attempts),error:e.message,leaseUntil:0});await tx.put('job',{...j,state:e.auth?'paused':j.state,error:e.message});});}
  }
 }));
 const finalItems=await store.all('jobItem',{jobId});
 await store.transaction(async tx=>{const j=await owned(tx,'job',jobId);if(j.generation!==job.generation||j.state==='cancelled')return;
 const pending=finalItems.some(i=>['pending','running'].includes(i.state)),failed=finalItems.filter(i=>['failed','unknown'].includes(i.state)).length;
 const candidates=job.type==='sample'?structuredTags([...job.vocabulary.tags,...finalItems.flatMap(i=>i.result?.tags||[])]):undefined;
 const state=j.state==='paused'?'paused':pending?'queued':failed?'failed':job.type==='sample'?'confirmation':'done';
 await tx.put('job',{...j,state,failed,...(candidates?{candidates}:{}),...(!pending&&finalItems.length===1?{result:finalItems[0].result}:{}),finishedAt:pending?null:now()});
 });
}
