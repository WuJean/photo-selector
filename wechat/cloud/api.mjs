import cloud from 'wx-server-sdk';
import { CloudStore, COLLECTION } from '../core/store.mjs';
import { createService } from '../core/service.mjs';
import { inspectImage } from './media.mjs';
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
const db=cloud.database();
let ready;
export async function main(event) {
  try {
    const {OPENID,ENV}=cloud.getWXContext();
    if(!OPENID)throw new Error('请在微信中登录');
    ready ||= db.createCollection(COLLECTION).catch(e=>{if(!/exist|已存在|-502002/i.test(e.message)) {ready=null;throw e;}});
    await ready;
    const store=new CloudStore(db,OPENID);
    const files={urls:async ids=>(await cloud.getTempFileURL({fileList:ids})).fileList.map(v=>({fileID:v.fileID,url:v.tempFileURL,status:v.status}))};
    const service=createService({store,files,env:ENV||process.env.TCB_ENV,media:{inspect:fileID=>inspectImage(cloud,fileID)}});
    return {ok:true,data:await service(event.action,event.data)};
  }catch(e){return {ok:false,error:{code:e.code||'FAILED',message:e.message||'操作失败'}};}
}
