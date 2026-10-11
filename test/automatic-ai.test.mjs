import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile,mkdir} from 'node:fs/promises';
import sharp from 'sharp';
import {fixture} from './support/library.mjs';
import {addEntry} from '../server/library.mjs';
import {AutomaticAI} from '../server/automatic-ai.mjs';
const config={id:'ai',model:'fake',baseURL:'http://localhost:1234/v1',analysisConcurrency:4};
const output={tags:['风景','远景'],subject:'风景',shot:'远景',description:'山峦在薄雾中延伸。'};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function seed(f,n=1){
 const batch=await f.json('/batches','POST',{source:'upload'});
 const image=await sharp({create:{width:32,height:32,channels:3,background:'green'}}).jpeg().toBuffer();
 for(let i=0;i<n;i++){const id='p'+i;f.store.put('photo',{id,projectId:'library',storage:'server',hash:id,analysisStatus:'done'});await writeFile(path.join(f.root,'originals',id+'.jpg'),image);addEntry(f.store,batch.id,id);}
 return batch;
}
test('automatic classification persists eligibility, appends concurrent work, keeps snapshots and reuses complete descriptions',async()=>{
 const f=await fixture();let queue;try{
 const b=await seed(f,7);f.store.put('settings',config);let active=0,peak=0,calls=0;
 queue=new AutomaticAI(f.store,{get:async()=>''},(cfg)=>({usage:{},analyze:async()=>{assert.equal(cfg.model,'fake');active++;calls++;peak=Math.max(active,peak);await wait(30);active--;return output;}}));
 f.store.onEligibilityChange=ids=>queue.captureMany(ids);
 const decide=ids=>f.json(`/batches/${b.id}/decisions`,'PATCH',{round:'initial',status:'keep',ids});
 await decide(['p0','p1','p2','p3']);const work=queue.drain();await decide(['p4','p5','p6']);await work;
 f.store.put('settings',{...config,model:'changed'});await queue.drain();
 assert.equal(calls,7);assert.equal(peak,4);assert.equal(queue.state().done,7);
 queue.captureMany(['p0']);await queue.drain();assert.equal(calls,7);
 assert.equal(f.store.get('description','p0').text,output.description);
 }finally{queue?.close();await f.close();}
});
test('unconfigured and offline tasks wait, user pause/cancel persist and late rejected results never write back',async()=>{
 const f=await fixture();let queue;try{
 const b=await seed(f,3);queue=new AutomaticAI(f.store,{get:async()=>''},()=>({analyze:async()=>{await wait(35);return output;}}));f.store.onEligibilityChange=ids=>queue.captureMany(ids);
 const decide=(ids,status)=>f.json(`/batches/${b.id}/decisions`,'PATCH',{round:'initial',status,ids});
 await decide(['p0','p1','p2'],'keep');await queue.drain();assert.equal(f.store.get('analysisTask','p0').state,'waiting-config');
 f.store.put('settings',config);f.store.put('photo',{...f.store.get('photo','p2'),storage:'local'});
 queue.action('pause');await queue.drain();assert.equal(queue.state().done,0);
 queue.action('resume');await wait(10);await decide(['p0'],'reject');while(queue.running)await wait(5);
 assert.equal(f.store.get('photo','p0').ai,undefined);assert.equal(f.store.get('analysisTask','p0').state,'skipped');
 assert.equal(f.store.get('analysisTask','p2').state,'waiting-media');
 queue.action('cancel');queue.captureMany(['p2']);await queue.drain();assert.equal(f.store.get('analysisTask','p2').state,'cancelled');
 queue.action('pause');queue.close();queue=new AutomaticAI(f.store,{get:async()=>''},()=>{throw new Error('must not dispatch');});assert.equal(queue.control.paused,true);
 }finally{queue?.close();await f.close();}
});
test('authentication failure pauses queue and restart recovers unfinished work with its snapshot',async()=>{
 const f=await fixture();let q;try{
 const b=await seed(f);f.store.put('settings',config);await f.json(`/batches/${b.id}/decisions`,'PATCH',{round:'initial',status:'keep',ids:['p0']});
 q=new AutomaticAI(f.store,{get:async()=>''},()=>({analyze:async()=>{throw Object.assign(new Error('auth'),{auth:true});}}));q.captureMany(['p0']);await q.drain();assert.equal(q.control.paused,true);assert.equal(q.state().errors,1);q.close();
 q=new AutomaticAI(f.store,{get:async()=>''},()=>({analyze:async()=>output}));q.action('retry');while(q.running)await wait(5);assert.equal(q.state().done,1);
 }finally{q?.close();await f.close();}
});
