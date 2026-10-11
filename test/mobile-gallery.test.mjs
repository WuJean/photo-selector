import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support/library.mjs';
test('album cursor pages all 3000 assets in order, keeps other albums private and timeline compact', async () => {
 const f=await fixture();
 try {
 const ids=Array.from({length:3000},(_,i)=>`page-${i}`);
 f.store.transaction(()=>{for(const id of [...ids,'private']) f.store.put('photo',{id,projectId:'library',name:id,storage:'server',width:800,height:600});});
 f.store.put('collection',{id:'album',projectId:'library',name:'Album',photoIds:ids,date:'2020-01-01'});
 const timeline=await f.json('/timeline');
 assert.equal(timeline.length,1);assert.equal(timeline[0].cover.id,ids[0]);assert.equal(timeline[0].collection.photoIds,undefined);
 let cursor='',all=[]; do {const page=await f.json(`/collections/album/photos?limit=40&cursor=${cursor}`);assert.ok(page.items.length<=40);all.push(...page.items.map(p=>p.id));cursor=page.nextCursor;}while(cursor);
 assert.deepEqual(all,ids);
 assert.equal((await f.request('/collections/album/photos?cursor=private')).status,409);
 assert.equal((await fetch(f.base+'/api/collections/album/photos')).status,401);
 }finally{await f.close();}
});
