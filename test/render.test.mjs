import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import sharp from 'sharp';
import {Store} from '../server/database.mjs';import {importPhoto,digest} from '../server/images.mjs';import {renderDraft,escapeXML} from '../server/render.mjs';import {canvasSize,layoutRects,newDraft,validateDraft,imagePlacement} from '../shared/layout.mjs';
test('all templates stay within canvas, crop zoom anchors and validation rejects foreign ids',()=>{
 for(const name of ['rows','columns','hero','grid','single'])for(const ratio of ['1:1','3:4','4:3','9:16']){const size=canvasSize(ratio,1000);for(const rect of layoutRects(name,size.width,size.height,.02,'caption')){assert.ok(rect.x>=0&&rect.y>=0);assert.ok(rect.x+rect.width<=size.width+1);assert.ok(rect.y+rect.height<=size.height+1);}}
 const placement=imagePlacement({width:200,height:100},{width:100,height:100},{zoom:2,cx:1,cy:0,fit:'cover'});assert.equal(placement.left,-300);assert.equal(placement.top,0);
 assert.throws(()=>validateDraft({...newDraft('p'),slots:[{photoId:'foreign'}]},[]));assert.equal(escapeXML('<script>&"'), '&lt;script&gt;&amp;&quot;');
});
test('render real JPEG collage, watermark and frame; preserve originals and strip EXIF',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'render-'));const store=new Store(path.join(root,'data'));
 try{const project=store.project('作品');const photos=[];for(const [i,color] of ['#ff0000','#00ff00','#0000ff','#dddddd'].entries()){const file=path.join(root,i+'.jpg');await sharp({create:{width:400,height:300,channels:3,background:color}}).jpeg().withMetadata().toFile(file);photos.push(await importPhoto(store,project.id,file,'同名.jpg'));}
 const before=await digest(photos[0].originalPath);let draft=validateDraft({...newDraft(project.id,photos),ratio:'1:1',gap:0,longEdge:600},photos);const result=await renderDraft(store,draft);let info=await sharp(result).metadata();assert.equal(info.width,600);assert.equal(info.height,600);assert.equal(info.exif,undefined);
 const pixel=await sharp(result).extract({left:50,top:50,width:1,height:1}).raw().toBuffer();assert.ok(pixel[0]>240&&pixel[1]<10);
 draft={...draft,frame:'caption',gap:.02,watermark:{...draft.watermark,text:'旅行 <2026>',color:'#ffffff'}};assert.ok((await renderDraft(store,draft)).length>result.length);
 const single={...newDraft(project.id,[photos[0]]),longEdge:3000};info=await sharp(await renderDraft(store,single)).metadata();assert.ok(info.width<=400&&info.height<=400);assert.equal(await digest(photos[0].originalPath),before);
 const zoomed={...newDraft(project.id,[photos[0]]),slots:[{photoId:photos[0].id,zoom:4,cx:1,cy:1,fit:'cover'}]};assert.ok((await renderDraft(store,zoomed)).length>0);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
