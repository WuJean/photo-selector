export const RETENTION_MS = 3 * 60 * 60 * 1000;
export function syncRetention(store, entry, before, now = Date.now()) {
 const id='discard:'+entry.id;
 if (entry.cleaned) return;
 if(entry.status !== 'reject') {
  const old=store.get('cleanup',id);
  if(old && old.state!=='done') store.put('cleanup',{...old,state:'cancelled'});
  store.put('entry',{...entry,cleanupAt:null}); return;
 }
 const old=store.get('cleanup',id);
 const due=before?.status==='reject' && before.cleanupAt ? before.cleanupAt : new Date(now+RETENTION_MS).toISOString();
 store.put('entry',{...entry,cleanupAt:due});
 if(old && !['cancelled','done'].includes(old.state) && old.dueAt===due) return;
 store.put('cleanup',{id,kind:'discard',entryId:entry.id,assetId:entry.assetId,batchId:entry.batchId,state:'pending',dueAt:due,bytes:0,createdAt:new Date(now).toISOString()});
}
