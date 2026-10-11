import sharp from "sharp";
import { scheduler } from "./scheduler.mjs";
import { previewData } from "./images.mjs";
export const IMAGE_ENDPOINT =
  "https://token-plan.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation";
export function normalizeImageConfig(input = {}, ai = {}) {
  const endpoint = String(input.endpoint || IMAGE_ENDPOINT).trim(),
    url = new URL(endpoint);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error("生图服务需要 HTTPS 或本机地址");
  const model = String(input.model || "wan2.7-image").trim();
  if (!model) throw new Error("请填写生图模型");
  const inheritKey = input.inheritKey !== false;
  return {
    id: "image-generation",
    endpoint,
    model,
    inheritKey,
    keyBaseURL: inheritKey ? ai?.baseURL : endpoint,
  };
}
export function imageConfig(store) {
  return normalizeImageConfig(
    store.get("settings", "image-generation") || {},
    store.get("settings", "ai") || {},
  );
}
export async function generateImage(
  config,
  key,
  {
    prompt,
    images = [],
    ratio = "3:4",
    signal,
    fetchImpl = fetch,
    timeoutMs = 240000,
    resultURL,
    onOutput,
  } = {},
) {
  const sizes = {
    "1:1": "1536*1536",
    "3:4": "1536*2048",
    "4:3": "2048*1536",
    "9:16": "1152*2048",
  };
  if (!prompt?.trim() || images.length > 4)
    throw new Error("封面提示词或参考照片无效");
  const content = images.map((data) => ({
    image: "data:image/jpeg;base64," + data.toString("base64"),
  }));
  content.push({ text: prompt.slice(0, 5000) });
  const timeout = AbortSignal.timeout(timeoutMs),
    combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return scheduler.run("image:" + config.endpoint, 1, combined, async () => {
    let url = resultURL;
    if (!url) {
      let response;
      try {
        response = await fetchImpl(config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { Authorization: "Bearer " + key } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            input: { messages: [{ role: "user", content }] },
            parameters: {
              size: sizes[ratio] || sizes["3:4"],
              n: 1,
              enable_sequential: false,
              watermark: false,
            },
          }),
          signal: combined,
        });
      } catch (e) {
        if (signal?.aborted) throw new Error("任务已取消");
        throw new Error(
          "生图连接中断或超时，结果未知；未自动重复提交，请手动重试",
        );
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = String(result.message || result.error?.message || "")
          .slice(0, 200)
          .split(key || "NO-SECRET")
          .join("[已隐藏]");
        const e = new Error(
          `生图服务 HTTP ${response.status}${detail ? "：" + detail : ""}`,
        );
        if ([401, 403].includes(response.status)) e.auth = true;
        throw e;
      }
      url = result.output?.choices
        ?.flatMap((c) => c.message?.content || [])
        .find((v) => v.image)?.image;
      if (!url || typeof url !== "string")
        throw new Error("生图服务未返回图片，未自动重复提交");
      if (onOutput) await onOutput(url);
    }
    let bytes;
    if (url.startsWith("data:image/")) {
      const match = url.match(
        /^data:image\/(?:png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/,
      );
      if (!match || match[1].length > 40 * 1024 * 1024)
        throw new Error("生成图片格式无效");
      bytes = Buffer.from(match[1], "base64");
    } else {
      const address = new URL(url);
      if (
        !["https:", "http:"].includes(address.protocol) ||
        address.username ||
        address.password
      )
        throw new Error("生成图片地址无效");
      const file = await fetchImpl(url, { signal: combined });
      if (!file.ok) throw new Error("生成图片下载失败，请保留服务记录后重试");
      const parts = [];
      let size = 0;
      for await (const part of file.body) {
        size += part.length;
        if (size > 30 * 1024 * 1024) {
          await file.body.cancel?.().catch(() => {});
          throw new Error("生成图片过大");
        }
        parts.push(Buffer.from(part));
      }
      bytes = Buffer.concat(parts);
    }
    if (combined.aborted) throw new Error("任务已取消");
    return sharp(bytes, { limitInputPixels: 40_000_000 }).png().toBuffer();
  });
}
export function registerImageGeneration(app, store) {
  const vault = app.locals.aiVault;
  const publicConfig = async (config) => ({
    ...config,
    hasKey: config.keyBaseURL
      ? !!(await vault.get({ baseURL: config.keyBaseURL }))
      : false,
  });
  app.get("/api/settings/image-generation", async (req, res) =>
    res.json(await publicConfig(imageConfig(store))),
  );
  app.put("/api/settings/image-generation", async (req, res) => {
    const config = normalizeImageConfig(req.body, store.get("settings", "ai"));
    if (req.body.apiKey && !config.inheritKey)
      await vault.set({ baseURL: config.keyBaseURL }, String(req.body.apiKey));
    store.put("settings", config);
    res.json(await publicConfig(config));
  });
  app.delete("/api/settings/image-generation/key", async (req, res) => {
    const config = imageConfig(store);
    if (!config.inheritKey) await vault.remove({ baseURL: config.keyBaseURL });
    res.json({ ok: true });
  });
  app.post("/api/settings/image-generation/test", async (req, res) => {
    const config = normalizeImageConfig(req.body, store.get("settings", "ai")),
      key =
        (!config.inheritKey && req.body.apiKey) ||
        (await vault.get({ baseURL: config.keyBaseURL }));
    const sample = await sharp({
      create: { width: 300, height: 300, channels: 3, background: "#6b8972" },
    })
      .jpeg()
      .toBuffer();
    const bytes = await generateImage(config, key, {
      prompt: "参考图片的绿色，生成简洁的绿色山峰图案。",
      images: [sample],
      ratio: "1:1",
    });
    const info = await sharp(bytes).metadata();
    res.json({ ok: true, width: info.width, height: info.height });
  });
  return async (job, signal) => {
    const config = job.imageConfig || imageConfig(store),
      key = await vault.get({ baseURL: config.keyBaseURL });
    const images = await Promise.all(
      job.plan.referenceIds.map((id) => previewData(store, id)),
    );
    return generateImage(config, key, {
      prompt: job.plan.prompt,
      images,
      ratio: job.ratio,
      signal,
      resultURL: job.generatedURL,
      onOutput: (url) => {
        const current = store.get("creationJob", job.id);
        if (current && current.state !== "cancelled" && !signal?.aborted)
          store.put("creationJob", { ...current, generatedURL: url });
      },
    });
  };
}
