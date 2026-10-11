import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {fixture} from './support/library.mjs';
import heic from './support/heic.mjs';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('PNG and actual HEIC preserve original bytes, render JPEG and retry idempotently',async()=>{
 const f=await fixture();try {
 const batch=await f.json('/batches','POST',{source:'upload'});
 const png=await sharp({create:{width:90,height:120,channels:4,background:'#cc885599'}}).png().toBuffer();
 for(const [ext,bytes] of [['png',png],['heic',Buffer.from(heic,'base64')]]){
  const upload=()=>{const form=new FormData();form.append('uploadId','fixture-upload-'+ext);form.append('photos',new Blob([bytes]),'image.'+ext);return f.json(`/batches/${batch.id}/import`,'POST',form);};
  const first=(await upload()).results[0];assert.ok(first.photo,first.error);
  const id=first.photo.id;
  const again=await Promise.all([upload(),upload()]);assert.ok(again.every(r=>r.results[0].photo.id===id));
  const original=await f.request(`/photos/${id}/original`);assert.equal(hash(Buffer.from(await original.arrayBuffer())),hash(bytes));
  const render=await f.request(`/photos/${id}/render`);assert.equal((await sharp(Buffer.from(await render.arrayBuffer())).metadata()).format,'jpeg');
  const preview=await f.request(`/photos/${id}/preview`);assert.equal(preview.status,200);
 }
 assert.equal(f.store.all('photo').length,2);
 const bad=new FormData();bad.append('photos',new Blob(['broken']),'bad.heic');const failure=await f.json(`/batches/${batch.id}/import`,'POST',bad);assert.ok(failure.results[0].error);
 }finally{await f.close();}
});
