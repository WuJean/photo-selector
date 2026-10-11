import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export async function wechatConfig({
  required = false,
  root = defaultRoot,
  environment = process.env,
} = {}) {
  let local = {};
  try {
    local = JSON.parse(
      await readFile(path.join(root, "wechat/config.local.json"), "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const config = {
    appId: environment.WECHAT_APP_ID || local.appId || "touristappid",
    envId: environment.WECHAT_ENV_ID || local.envId || "",
    projectDir: environment.WECHAT_PROJECT_DIR || local.projectDir || "",
  };
  if (required && !config.envId)
    throw new Error(
      "请在 wechat/config.local.json 或 WECHAT_ENV_ID 中配置自己的云环境",
    );
  return config;
}
export async function cloudConfig() {
  const root = defaultRoot;
  const template = JSON.parse(
    await readFile(path.join(root, "wechat/cloudbaserc.json"), "utf8"),
  );
  const config = await wechatConfig({ required: true });
  return { ...template, envId: config.envId };
}
