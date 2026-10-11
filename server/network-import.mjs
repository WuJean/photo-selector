import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { requireItem, addEntry, LIBRARY, timestamp } from "./library.mjs";
import { importPhoto } from "./images.mjs";
const blocked = new BlockList();
for (const [a, n] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
])
  blocked.addSubnet(a, n, "ipv4");
const public6 = new BlockList();
public6.addSubnet("2000::", 3, "ipv6");
const blocked6 = new BlockList();
blocked6.addSubnet("2001:db8::", 32, "ipv6");
blocked6.addSubnet("2001::", 32, "ipv6");
export function publicAddress(address) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        public6.check(address, "ipv6") &&
        !blocked6.check(address, "ipv6");
}
export async function checkedURL(input, resolve = lookup) {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("仅支持公开 HTTP(S) 图片地址");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolve(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("禁止访问内网或保留地址");
  return { url, address: addresses[0] };
}
export async function downloadPublic(
  input,
  destination,
  { signal, resolve = lookup, request } = {},
) {
  let current = input;
  try {
    for (let redirect = 0; redirect <= 5; redirect++) {
      const { url, address } = await checkedURL(current, resolve);
      const response = await new Promise((resolve, reject) => {
        const req = (
          request || (url.protocol === "https:" ? https.request : http.request)
        )(
          url,
          {
            method: "GET",
            signal,
            headers: {
              Accept: "image/jpeg,image/*;q=0.8",
              "User-Agent": "PhotoWall/1.0",
            },
            lookup: (_host, options, cb) =>
              options.all
                ? cb(null, [address])
                : cb(null, address.address, address.family),
          },
          resolve,
        );
        req.setTimeout(30000, () => req.destroy(new Error("图片下载超时")));
        req.on("error", reject);
        req.end();
      });
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (!response.headers.location) throw new Error("重定向无目标");
        current = new URL(response.headers.location, url).href;
        continue;
      }
      if (response.statusCode !== 200) {
        response.resume();
        throw new Error(`下载失败 HTTP ${response.statusCode}`);
      }
      if (Number(response.headers["content-length"]) > 100 * 1024 * 1024) {
        response.destroy();
        throw new Error("图片超过 100 MB");
      }
      let size = 0;
      const limit = new Transform({
        transform(chunk, encoding, cb) {
          size += chunk.length;
          cb(
            size > 100 * 1024 * 1024 ? new Error("图片超过 100 MB") : null,
            chunk,
          );
        },
      });
      await pipeline(
        response,
        limit,
        createWriteStream(destination, { flags: "wx", mode: 0o600 }),
        { signal },
      );
      let name;
      try {
        name = decodeURIComponent(url.pathname.split("/").at(-1));
      } catch {}
      return { name: name || "网络照片.jpg", size };
    }
    throw new Error("重定向次数过多");
  } catch (e) {
    await unlink(destination).catch(() => {});
    throw e;
  }
}
export class NetworkQueue {
  constructor(store, onImport, download = downloadPublic) {
    this.store = store;
    this.onImport = onImport;
    this.download = download;
    this.running = new Map();
    for (const j of store.all("networkJob"))
      if (j.state === "running")
        store.put("networkJob", {
          ...j,
          state: "paused",
          items: j.items.map((i) =>
            i.state === "running" ? { ...i, state: "pending" } : i,
          ),
        });
  }
  start(batchId, urls) {
    const b = requireItem(this.store, "batch", batchId);
    if (b.state !== "initial" || b.source !== "network")
      throw new Error("此批次不接受网络导入");
    if (!Array.isArray(urls) || !urls.length || urls.length > 3000)
      throw new Error("每批支持 1–3000 个图片地址");
    const unique = [
      ...new Set(urls.map((u) => String(u).trim()).filter(Boolean)),
    ];
    for (const u of unique) {
      const url = new URL(u);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("图片地址无效");
    }
    const job = {
      id: randomUUID(),
      batchId,
      state: "running",
      items: unique.map((url) => ({ url, state: "pending" })),
      createdAt: timestamp(),
    };
    this.store.put("networkJob", job);
    void this.drain(job.id);
    return job;
  }
  action(id, action) {
    const j = requireItem(this.store, "networkJob", id);
    if (action === "pause") j.state = "paused";
    else if (action === "cancel") {
      j.state = "cancelled";
      this.running.get(id)?.abort();
    } else if (["resume", "retry"].includes(action)) {
      if (j.state === "cancelled") throw new Error("任务已取消，请重新导入");
      j.state = "running";
      if (action === "retry")
        for (const i of j.items) if (i.state === "error") i.state = "pending";
    } else throw new Error("操作无效");
    this.store.put("networkJob", j);
    void this.drain(id);
    return j;
  }
  async drain(id) {
    if (this.running.has(id)) return;
    const controller = new AbortController();
    this.running.set(id, controller);
    const work = async () => {
      while (true) {
        const j = this.store.get("networkJob", id);
        if (j.state !== "running") return;
        const index = j.items.findIndex((i) => i.state === "pending");
        if (index < 0) return;
        j.items[index].state = "running";
        this.store.put("networkJob", j);
        const item = j.items[index],
          file = path.join(this.store.root, "temp", randomUUID() + ".download");
        let photo;
        try {
          const result = await this.download(item.url, file, {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(120000),
            ]),
          });
          if (controller.signal.aborted) throw new Error("已取消");
          photo = await importPhoto(this.store, LIBRARY, file, result.name);
          if (controller.signal.aborted) throw new Error("已取消");
          this.store.put("photo", {
            ...photo,
            storage: "server",
            network: true,
          });
          addEntry(
            this.store,
            j.batchId,
            photo.id,
            requireItem(this.store, "batch", j.batchId).direct,
          );
          this.onImport(photo);
          const fresh = this.store.get("networkJob", id);
          fresh.items[index] = { ...item, state: "done", assetId: photo.id };
          this.store.put("networkJob", fresh);
        } catch (e) {
          const fresh = this.store.get("networkJob", id);
          fresh.items[index] = {
            ...item,
            state: fresh.state === "cancelled" ? "cancelled" : "error",
            error: e.message,
          };
          this.store.put("networkJob", fresh);
          if (photo) {
            for (const variant of ["originals", "thumbs", "previews"])
              await unlink(
                path.join(this.store.root, variant, photo.id + ".jpg"),
              ).catch(() => {});
            this.store.remove("photo", photo.id);
          }
        } finally {
          await unlink(file).catch(() => {});
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: 3 }, work));
      const j = this.store.get("networkJob", id);
      if (
        j.state === "running" &&
        !j.items.some((i) => ["pending", "running"].includes(i.state))
      )
        this.store.put("networkJob", {
          ...j,
          state: j.items.some((i) => i.state === "error") ? "error" : "done",
        });
    } finally {
      this.running.delete(id);
    }
  }
}
export function registerNetwork(app, store, onImport) {
  const queue = new NetworkQueue(store, onImport);
  app.locals.networkQueue = queue;
  app.get("/api/network-jobs", (req, res) => res.json(store.all("networkJob")));
  app.post("/api/batches/:id/network", (req, res) =>
    res.json(queue.start(req.params.id, req.body.urls)),
  );
  app.post("/api/network-jobs/:id/:action", (req, res) =>
    res.json(queue.action(req.params.id, req.params.action)),
  );
  return queue;
}
