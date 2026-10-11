import { build } from "esbuild";
import { cp, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
const out = path.resolve("dist/wechat");
await mkdir(out, { recursive: true });
await cp("wechat/miniprogram", out + "/miniprogram", { recursive: true });
await build({
  entryPoints: ["wechat/core/mobile.mjs"],
  outfile: out + "/miniprogram/utils/domain.js",
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2019",
});
await build({
  entryPoints: ["wechat/cloud/api.mjs"],
  outfile: out + "/cloudfunctions/photoApiV2/application.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  packages: "external",
});
await build({
  entryPoints: ["wechat/cloud/worker.mjs"],
  outfile: out + "/cloudfunctions/photoWorker/application.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  packages: "external",
});
await writeFile(
  out + "/cloudfunctions/photoApiV2/package.json",
  JSON.stringify(
    {
      name: "photo-api",
      version: "1.0.0",
      main: "index.js",
      dependencies: {
        "wx-server-sdk": "4.0.2",
        sharp: "0.33.5",
        "@img/sharp-linux-x64": "0.33.5",
        "@img/sharp-libvips-linux-x64": "1.0.4",
        exifr: "7.1.3",
        "tencentcloud-sdk-nodejs-scf": "4.1.168",
      },
    },
    null,
    2,
  ),
);
await cp(
  out + "/cloudfunctions/photoApiV2/package.json",
  out + "/cloudfunctions/photoWorker/package.json",
);
await writeFile(
  out + "/cloudfunctions/photoApiV2/config.json",
  JSON.stringify({ permissions: { openapi: [] } }, null, 2),
);
for (const name of ["photoApiV2", "photoWorker"])
  await writeFile(
    out + "/cloudfunctions/" + name + "/index.js",
    `exports.main=async function(event,context){try{return await require('./application.js').main(event,context);}catch(error){let message=String(error.message||error);for(const key of ['AI_API_KEY','IMAGE_API_KEY','WORKER_SECRET'])if(process.env[key])message=message.split(process.env[key]).join('[hidden]');console.error(message);return {ok:false,error:{code:'INITIALIZATION',message:'服务暂不可用'}};}};`,
  );
const project = {
  miniprogramRoot: "miniprogram/",
  cloudfunctionRoot: "cloudfunctions/",
  appid: "wxee3c352a685b21c5",
  projectname: "photo-selector",
  compileType: "miniprogram",
  libVersion: "3.17.4",
  setting: { es6: true, enhance: true, minified: true, urlCheck: true },
};
await writeFile(out + "/project.config.json", JSON.stringify(project, null, 2));
if (process.argv.includes("--sync")) {
  const target = "/Users/wujean/WeChatProjects/photo-selector";
  const backup = ".local/wechat-quickstart-backup";
  try {
    await access(backup);
  } catch {
    await cp(target, backup, { recursive: true });
  }
  await cp(out, target, { recursive: true });
  console.log("已同步小程序到 " + target + "；原始模板保存在 " + backup);
}
console.log("微信小程序已构建：" + out);
