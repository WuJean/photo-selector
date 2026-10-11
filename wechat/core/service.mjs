import { uid } from './store.mjs';
export const fail = (message, code = 'INVALID') => { throw Object.assign(new Error(message), {code}); };
export async function owned(store, kind, id) { return await store.get(kind,id) || fail('内容不存在或无权访问','NOT_FOUND'); }
export const title = (v, fallback='未命名旅行') => String(v || fallback).trim().slice(0,80) || fallback;
export function createService({store, files, env, media}) {
  return async (action, input={}) => {
    if(!store.owner) fail('请在微信中登录','AUTH');
    switch(action) {
      case 'session': return {owner:store.owner, env, version:1};
      case 'projects.list': return store.all('project');
      case 'projects.create': return store.put('project',{id:uid(),name:title(input.name),createdAt:Date.now()});
      case 'projects.rename': { const p=await owned(store,'project',input.projectId);return store.put('project',{...p,name:title(input.name)}); }
      case 'upload.prepare': {
        await owned(store,'project',input.projectId);
        if(!Number.isFinite(input.size)||input.size<=0||input.size>50*1024*1024)fail('单张图片需小于 50 MB');
        const id=uid(),cloudPath=`users/${store.owner}/${input.projectId}/originals/${id}.jpg`;
        return store.put('upload',{id,projectId:input.projectId,name:title(input.name,'照片.jpg'),size:input.size,cloudPath,createdAt:Date.now(),state:'pending'});
      }
      case 'upload.finish': {
        const ticket=await owned(store,'upload',input.id);
        if(ticket.state==='done')return owned(store,'photo',ticket.photoId);
        if(typeof input.fileID!=='string'||!input.fileID.startsWith(`cloud://${env}.`)||!input.fileID.endsWith('/'+ticket.cloudPath))fail('上传文件不属于本次任务');
        const info=await media.inspect(input.fileID);
        return store.transaction(async tx=>{
          const current=await owned(tx,'upload',input.id);
          if(current.state==='done')return owned(tx,'photo',current.photoId);
          const photo=await tx.put('photo',{...info,id:ticket.id,projectId:ticket.projectId,name:ticket.name,originalFile:input.fileID,status:'unseen',finalStatus:'unseen',favorite:false,revision:1,createdAt:Date.now()});
          await tx.put('upload',{...current,state:'done',photoId:photo.id});return photo;
        });
      }
      case 'photos.list': { await owned(store,'project',input.projectId);return store.list('photo',{projectId:input.projectId},{after:input.after||'',limit:60}); }
      case 'files.urls': {
        if(!Array.isArray(input.ids)||input.ids.length>50)fail('一次最多读取 50 张图片');
        const photos=await Promise.all(input.ids.map(id=>owned(store,'photo',id)));
        const field={thumb:'thumbFile',preview:'previewFile',original:'originalFile'}[input.variant||'thumb'];if(!field)fail('图片类型无效');
        const ids=photos.map(p=>p[field]||p.originalFile);return files.urls(ids);
      }
      default: fail('未知操作');
    }
  };
}
