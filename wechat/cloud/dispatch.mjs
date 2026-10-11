import { createHmac } from "node:crypto";
export const sign = (timestamp, secret) =>
  createHmac("sha256", secret).update(String(timestamp)).digest("hex");
export async function dispatch() {
  if (!process.env.PHOTO_WORKER_NAME || !process.env.WORKER_SECRET)
    throw new Error("未配置异步 worker");
  const { default: sdk } = await import("tencentcloud-sdk-nodejs-scf");
  const client = new sdk.scf.v20180416.Client({
    credential: {
      secretId:
        process.env.TENCENTCLOUD_SECRETID || process.env.TENCENTCLOUD_SECRET_ID,
      secretKey:
        process.env.TENCENTCLOUD_SECRETKEY ||
        process.env.TENCENTCLOUD_SECRET_KEY,
      token:
        process.env.TENCENTCLOUD_SESSIONTOKEN ||
        process.env.TENCENTCLOUD_SESSION_TOKEN,
    },
    region: process.env.PHOTO_REGION || process.env.TENCENTCLOUD_REGION,
  });
  const timestamp = Date.now();
  return client.Invoke({
    FunctionName: process.env.PHOTO_WORKER_NAME,
    Namespace:
      process.env.PHOTO_NAMESPACE ||
      process.env.TCB_ENV ||
      process.env.CLOUDBASE_ENV_ID,
    InvocationType: "Event",
    ClientContext: JSON.stringify({
      timestamp,
      signature: sign(timestamp, process.env.WORKER_SECRET),
    }),
  });
}
