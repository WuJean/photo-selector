import express from 'express';
import multer from 'multer';
import path from 'node:path';
import {unlink} from 'node:fs/promises';
import {Store} from './database.mjs';
import {importPhoto} from './images.mjs';

export function createApp({root=path.resolve('.local'),onImport=()=>{}}={}) {
 const app=express();const store=new Store(root);app.locals.store=store;
 app.disable('x-powered-by');
 app.use((req,res,next)=>{
  const host=(req.headers.host||'').split(':')[0];
  if(!['127.0.0.1','localhost','['].includes(host))return res.status(403).json({error:'仅允许本机访问'});
  if(req.headers.origin&&!['http://127.0.0.1:'+req.socket.localPort,'http://localhost:'+req.socket.localPort].includes(req.headers.origin))return res.status(403).json({error:'不允许跨站请求'});
  next();
 });
 app.use(express.json({limit:'2mb'}));
 const upload=multer({dest:path.join(root,'temp'),limits:{fileSize:100*1024*1024,files:20}});
 app.get('/api/health',(req,res)=>res.json({ok:true,service:'选片助手',version:'0.1.0'}));
 app.get('/api/projects',(req,res)=>res.json(store.all('project').map(p=>({...p,count:store.photos(p.id).length}))));
 app.post('/api/projects',(req,res)=>res.status(201).json(store.project(String(req.body.name||'新的旅行').slice(0,120))));
 app.get('/api/projects/:id/photos',(req,res)=>res.json(store.photos(req.params.id).map(p=>store.publicPhoto(p))));
 app.post('/api/projects/:id/import',upload.array('photos',20),async(req,res,next)=>{
  try {
   if(!store.get('project',req.params.id))throw new Error('项目不存在');
   const results=[];let names=[],modified=[];try{names=JSON.parse(req.body.names||'[]');modified=JSON.parse(req.body.modified||'[]');}catch{}
   for(const [i,file] of (req.files||[]).entries()){
    try{const photo=await importPhoto(store,req.params.id,file.path,names[i]||file.originalname,modified[i]);results.push({photo:store.publicPhoto(photo)});onImport(photo);}catch(error){results.push({name:names[i]||file.originalname,error:error.message});}finally{await unlink(file.path).catch(()=>{});}
   }
   res.json({results});
  }catch(e){for(const f of req.files||[])await unlink(f.path).catch(()=>{});next(e);}
 });
 app.get('/api/photos/:id/:variant',(req,res,next)=>{
  if(!['thumb','preview','original'].includes(req.params.variant))return next();
  const photo=store.get('photo',req.params.id);if(!photo)return res.status(404).json({error:'照片不存在'});
  const folder={thumb:'thumbs',preview:'previews',original:'originals'}[req.params.variant];
  if(req.params.variant==='original')res.attachment(photo.name);
  res.set('Cache-Control','private, max-age=86400');res.sendFile(path.join(root,folder,photo.id+'.jpg'));
 });
 return {app,store,upload};
}
export function errors(app){app.use((error,req,res,next)=>{if(res.headersSent)return next(error);res.status(error.status||400).json({error:error.message||'操作失败'});});}
