import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store} from '../server/database.mjs';import {History,registerCuration} from '../server/curation.mjs';import {createApp,errors} from '../server/app.mjs';import {filterPhotos} from '../shared/domain.mjs';
test('undo keeps new background analysis and restores independent favorite/status fields',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'history-'));const store=new Store(root);try{const p={id:'a',projectId:'p',status:'unseen',favorite:true};store.put('photo',p);const history=new History(store);
 history.apply('p',[{kind:'photo',value:{...p,status:'keep'},fields:['status']}],'保留');store.put('photo',{...store.get('photo','a'),ai:{tags:['雪山']}});history.undo('p');assert.equal(store.get('photo','a').status,'unseen');assert.equal(store.get('photo','a').favorite,true);assert.deepEqual(store.get('photo','a').ai.tags,['雪山']);
 history.apply('p',[{kind:'collection',value:{id:'c',photoIds:['a']}}],'创建');history.undo('p');assert.equal(store.get('collection','c'),null);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
test('curation API isolates projects, keeps collections independent and validates edits',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'api-'));const {app,store}=createApp({root});registerCuration(app,store);errors(app);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(url,method='GET',body)=>{const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 try{const p=store.project('测试');store.put('photo',{id:'a',projectId:p.id,status:'unseen',favorite:false});store.put('photo',{id:'other',projectId:'elsewhere'});
 assert.equal((await request(`/api/projects/${p.id}/photos`,'PATCH',{ids:['a','other'],patch:{status:'keep'}})).status,400);assert.equal(store.get('photo','a').status,'unseen');
 await request(`/api/projects/${p.id}/photos`,'PATCH',{ids:['a'],patch:{status:'keep',favorite:true}});assert.equal(store.get('photo','a').favorite,true);
 const c=await request(`/api/projects/${p.id}/collections`,'POST',{photoIds:['a'],name:'朋友圈'});assert.equal(c.status,201);await request(`/api/projects/${p.id}/collections/${c.body.id}`,'PUT',{photoIds:['a'],lockedIds:['a','invalid']});assert.deepEqual(store.get('collection',c.body.id).lockedIds,['a']);
 const g=await request(`/api/projects/${p.id}/groups`,'POST',{ids:['a'],type:'scene',name:'雪山'});assert.equal(store.get('photo','a').sceneId,g.body.id);
 }finally{await new Promise(r=>server.close(r));store.close();await rm(root,{recursive:true,force:true});}
});
test('combined filters use semantic tags, focal and shot orientation independently',()=>{
 const p={id:'a',name:'a.jpg',width:100,height:200,status:'keep',favorite:true,focalCategory:'中焦 / 85mm',manualTags:['旅行'],ai:{tags:['雪山'],shot:'远景'}};
 assert.equal(filterPhotos([p],{query:'雪山 远景',favorite:true,orientation:'portrait',focal:'中焦 / 85mm'}).length,1);assert.equal(filterPhotos([p],{query:'近景'}).length,0);
});
