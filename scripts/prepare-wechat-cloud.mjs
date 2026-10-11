import { cloudConfig } from "./wechat-config.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { NativeBridge } from "../server/native.mjs";
import { Vault } from "../server/ai.mjs";
// Credentials never enter the repository or command-line arguments.
const source = await cloudConfig();
const privateDir = path.join(os.homedir(), ".codex/private");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
const destination = path.join(privateDir, "photo-selector-cloudbaserc.json");
let existing;
try {
  existing = JSON.parse(await readFile(destination, "utf8"));
} catch {}
const native = new NativeBridge();
try {
  const config = await (
    await fetch("http://127.0.0.1:4173/api/settings")
  ).json();
  const image = await (
    await fetch("http://127.0.0.1:4173/api/settings/image-generation")
  ).json();
  const key = await new Vault(native).get(config);
  if (!key) throw new Error("当前本机 AI 服务没有可读取的钥匙串密钥");
  const workerSecret =
    existing?.functions?.[0]?.envVariables?.WORKER_SECRET ||
    randomBytes(32).toString("hex");
  const owner =
    process.env.PHOTO_ADMIN_OPENID ||
    existing?.functions?.[0]?.envVariables?.ADMIN_OPENIDS ||
    "";
  const variables = {
    AI_BASE_URL: config.baseURL,
    AI_MODEL: config.model,
    AI_API_KEY: key,
    AI_JSON_MODE: String(!!config.jsonMode),
    IMAGE_ENDPOINT: image.endpoint,
    IMAGE_MODEL: image.model || "wan2.7-image",
    PHOTO_WORKER_NAME: "photoWorker",
    PHOTO_NAMESPACE: source.envId,
    PHOTO_REGION: "ap-shanghai",
    CLOUDBASE_ENV_ID: source.envId,
    WORKER_SECRET: workerSecret,
    AI_DAILY_LIMIT: "5000",
    ADMIN_OPENIDS: owner,
    ENABLE_IMAGE_GENERATION: owner ? "true" : "false",
  };
  if (!image.inheritKey) {
    const imageKey = await new Vault(native).get({ baseURL: image.endpoint });
    if (imageKey) variables.IMAGE_API_KEY = imageKey;
  }
  await writeFile(
    destination,
    JSON.stringify(
      {
        ...source,
        functions: source.functions.map((f) => ({
          ...f,
          envVariables: variables,
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "已生成本机私有部署配置，密钥未输出；生图" +
      (owner ? "仅对管理员开启" : "等待管理员身份确认"),
  );
} finally {
  native.close();
}
