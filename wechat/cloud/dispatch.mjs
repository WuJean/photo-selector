import {createHmac} from 'node:crypto';
export const sign=(timestamp,secret)=>createHmac('sha256',secret).update(String(timestamp)).digest('hex');
export async function dispatch(){
 if(!process.env.SCF_WORKER_NAME||!process.env.WORKER_SECRET)throw new Error('未配置异步 worker');
 const {default:sdk}=await import('tencentcloud-sdk-nodejs-scf');
 const client=new sdk.scf.v20180416.Client({credential:{secretId:process.env.TENCENTCLOUD_SECRETID||process.env.TENCENTCLOUD_SECRET_ID,secretKey:process.env.TENCENTCLOUD_SECRETKEY||process.env.TENCENTCLOUD_SECRET_KEY,token:process.env.TENCENTCLOUD_SESSIONTOKEN||process.env.TENCENTCLOUD_SESSION_TOKEN},region:process.env.SCF_REGION||'ap-shanghai'});
 const timestamp=Date.now();return client.Invoke({FunctionName:process.env.SCF_WORKER_NAME,Namespace:process.env.SCF_NAMESPACE||'default',InvocationType:'Event',ClientContext:JSON.stringify({timestamp,signature:sign(timestamp,process.env.WORKER_SECRET)})});
}
