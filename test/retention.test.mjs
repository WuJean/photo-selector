import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './support/library.mjs';
import {registerCleanup} from '../server/cleanup.mjs';
import {RETENTION_MS} from '../server/retention.mjs';
import {addEntry} from '../server/library.mjs';
import {writeFile,access} from 'node:fs/promises';
import path from 'node:path';
test('retention starts on rejection, cancels on restore, does not reset on repeats and deletes only at expiry',async()=>{
 const f=await fixture(registerCleanup);try{
 const b=await f.json('/batches','POST',{source:'upload'});
 f.store.put('photo',{id:'p',projectId:'library',storage:'server',analysisStatus:'done'});addEntry(f.store,b.id,'p');
 await writeFile(path.join(f.root,'originals','p.jpg'),'test');
 const decide=status=>f.json(`/batches/${b.id}/decisions`,'PATCH',{round:'initial',status,ids:['p']});
 await decide('reject');const task=f.store.all('cleanup')[0];
 assert.ok(Date.parse(task.dueAt)-Date.now()>RETENTION_MS-1000);
 await decide('reject');assert.equal(f.store.get('cleanup',task.id).dueAt,task.dueAt);
 f.app.locals.cleanupQueue.now=()=>Date.parse(task.dueAt)-1;await f.app.locals.cleanupQueue.drain();await access(path.join(f.root,'originals','p.jpg'));
 await f.json(`/batches/${b.id}/finish`,'POST',{round:'initial'});
 await decide('keep');assert.equal(f.store.get('cleanup',task.id).state,'cancelled');
 await decide('reject');const newer=f.store.get('cleanup',task.id);assert.ok(Date.parse(newer.dueAt)>=Date.parse(task.dueAt));
 f.app.locals.cleanupQueue.now=()=>Date.parse(newer.dueAt);await f.app.locals.cleanupQueue.drain();
 assert.equal(f.store.get('photo','p').deleted,true);assert.equal(f.store.all('entry')[0].cleaned,true);
 assert.equal((await f.request(`/batches/${b.id}/decisions`,'PATCH',{round:'initial',status:'keep',ids:['p']})).status,400);
 }finally{await f.close();}
});
