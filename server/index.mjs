import path from 'node:path';
import {createApp,errors} from './app.mjs';
const root=path.resolve(process.env.PHOTO_SELECTOR_DATA_DIR||'.local');
const {app,store}=createApp({root});
if(process.env.NODE_ENV==='production'){
 const {default:express}=await import('express');app.use(express.static(path.resolve('dist/web')));app.get('/{*path}',(req,res)=>res.sendFile(path.resolve('dist/web/index.html')));
}else{const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
errors(app);
const port=Number(process.env.PORT||4173);
app.listen(port,'127.0.0.1',()=>console.log(`选片助手 http://127.0.0.1:${port}`));
