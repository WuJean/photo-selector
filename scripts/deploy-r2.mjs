// Run with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; secrets never go to stdout.
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
const env = process.env;
const account = env.CLOUDFLARE_ACCOUNT_ID,
  token = env.CLOUDFLARE_API_TOKEN;
const origin = new URL(
  env.PHOTO_SELECTOR_PUBLIC_URL || "http://localhost:4173",
);
const host = env.PHOTO_SELECTOR_MEDIA_HOST,
  zone = env.CLOUDFLARE_ZONE_ID;
if (!account || !token || !zone || !host || origin.protocol !== "https:")
  throw new Error(
    "请配置 Cloudflare 账号、API Token、Zone ID、图片域名和 HTTPS 应用地址（见 docs/R2.md）",
  );
const mediaURL = new URL(`https://${host}`);
if (mediaURL.host !== host) throw new Error("图片域名无效");
const root = path.resolve(env.PHOTO_SELECTOR_DATA_DIR || ".local"),
  file = path.join(root, "r2.json"),
  pending = path.join(root, "r2.pending.json");
const bucket = env.PHOTO_SELECTOR_R2_BUCKET || "photo-selector-display",
  worker = env.PHOTO_SELECTOR_MEDIA_WORKER || "photo-selector-media";
async function request(route, method = "GET", body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(!(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const r = await response.json();
  if (!response.ok || !r.success)
    throw new Error(
      `Cloudflare ${response.status}: ${(r.errors || []).map((e) => e.message).join("; ")}`,
    );
  return r.result;
}
await mkdir(root, { recursive: true });
let config;
try {
  config = JSON.parse(await readFile(file, "utf8"));
} catch {
  try {
    config = JSON.parse(await readFile(pending, "utf8"));
  } catch {
    config = {
      url: mediaURL.origin,
      secret: randomBytes(48).toString("base64url"),
    };
  }
}
if (config.url !== mediaURL.origin)
  throw new Error("已有 R2 地址不同；请先处理旧存储迁移，不能自动覆盖");
await writeFile(pending, JSON.stringify(config) + "\n", { mode: 0o600 });
const base = `/accounts/${account}`;
try {
  await request(`${base}/r2/buckets/${bucket}`);
} catch (e) {
  if (!/404/.test(e.message)) throw e;
  await request(`${base}/r2/buckets`, "POST", {
    name: bucket,
    locationHint: "apac",
    storageClass: "Standard",
  });
}
const domains = await request(`${base}/workers/domains`),
  existing = domains.find((d) => d.hostname === host);
if (existing && existing.service !== worker)
  throw new Error("图片域名已经绑定其他服务，未覆盖");
const dns = await request(
  `/zones/${zone}/dns_records?name=${encodeURIComponent(host)}`,
);
if (dns.length && !existing)
  throw new Error("图片域名已有 DNS 记录，请选择空闲子域名");
const code = await readFile(
    new URL("../cloudflare/media-worker.mjs", import.meta.url),
    "utf8",
  ),
  form = new FormData();
form.append(
  "metadata",
  JSON.stringify({
    main_module: "media-worker.mjs",
    compatibility_date: "2025-09-01",
    bindings: [
      { type: "r2_bucket", name: "PHOTOS", bucket_name: bucket },
      { type: "plain_text", name: "APP_ORIGIN", text: origin.origin },
      {
        type: "plain_text",
        name: "ALLOWED_ORIGINS",
        text: env.PHOTO_SELECTOR_ALLOWED_ORIGINS || "",
      },
    ],
    keep_bindings: ["secret_text"],
  }),
);
form.append(
  "media-worker.mjs",
  new Blob([code], { type: "application/javascript+module" }),
  "media-worker.mjs",
);
await request(`${base}/workers/scripts/${worker}`, "PUT", form);
await request(`${base}/workers/scripts/${worker}/secrets`, "PUT", {
  name: "MEDIA_SECRET",
  type: "secret_text",
  text: config.secret,
});
await request(`${base}/workers/domains`, "PUT", {
  hostname: host,
  service: worker,
  zone_id: zone,
  environment: "production",
  enabled: true,
});
await rename(pending, file);
console.log(
  `R2 已配置：${mediaURL.origin}。重启应用后后台同步压缩展示图；原片不上传 R2。`,
);
