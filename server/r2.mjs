import { readFileSync } from "node:fs";
import { readFile, stat, rm } from "node:fs/promises";
import {
  randomUUID,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import path from "node:path";
import { cookies } from "./auth.mjs";
import {
  compressedFile,
  photoDisplay,
  displayPath,
  displaySizes,
} from "./display.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
export function readR2Config(root) {
  try {
    const c = JSON.parse(readFileSync(path.join(root, "r2.json"), "utf8"));
    const u = new URL(c.url);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      typeof c.secret !== "string" ||
      c.secret.length < 32
    )
      throw new Error("invalid");
    return { url: u.origin, secret: c.secret };
  } catch {
    return null;
  }
}
export class R2Media {
  constructor(store, config, { fetcher = fetch, now = () => Date.now() } = {}) {
    this.store = store;
    this.config = config;
    this.fetcher = fetcher;
    this.now = now;
    this.pending = new Map();
    this.active = 0;
    this.instance = store.get("settings", "r2-instance")?.value || randomUUID();
    if (config)
      store.put("settings", { id: "r2-instance", value: this.instance });
  }
  logical(ref) {
    return [ref.kind, ref.shareId, ref.id, ref.size].filter(Boolean).join(":");
  }
  valid(ref) {
    if (!Object.hasOwn(displaySizes, ref.size)) return false;
    if (ref.kind === "photo") {
      const p = this.store.get("photo", ref.id);
      return !!p && !p.deleted && !p.deleting;
    }
    if (ref.kind === "creation")
      return !!this.store.get("creation", ref.id)?.file;
    if (ref.kind === "share") {
      const s = this.store.get("share", ref.shareId);
      return (
        !!s &&
        s.state === "active" &&
        (!s.expiresAt || Date.parse(s.expiresAt) > this.now()) &&
        [
          ...(s.photos || []),
          ...(s.creations || []).filter((c) => c.file),
        ].some((p) => p.id === ref.id)
      );
    }
    return false;
  }
  record(ref) {
    return this.store.get("r2Object", this.logical(ref));
  }
  async source(ref) {
    if (!this.valid(ref)) throw new Error("照片不可用");
    if (ref.kind === "photo") return photoDisplay(this.store, ref.id, ref.size);
    const name =
      ref.kind === "share"
        ? `share-${ref.shareId}-${ref.id}`
        : `creation-${ref.id}`;
    const source =
      ref.kind === "share"
        ? path.join(
            this.store.root,
            "shares",
            ref.shareId,
            `${ref.id}-display.jpg`,
          )
        : path.join(
            this.store.root,
            "creations",
            this.store.get("creation", ref.id).file,
          );
    return compressedFile(this.store, name, ref.size, source);
  }
  async upload(ref, file) {
    if (!this.config || !this.valid(ref)) return;
    const id = this.logical(ref);
    if (this.pending.has(id)) return this.pending.get(id);
    if (this.active >= 2) return; // bounded background work; the page receives its local compressed fallback
    const existing = this.record(ref);
    if (existing?.state === "ready" && existing.url === this.config.url) return;
    if (existing?.retryAt > this.now()) return;
    const task = (async () => {
      this.active++;
      try {
        file ||= await this.source(ref);
        const bytes = await readFile(file),
          checksum = hash(bytes);
        const key = `${this.instance}/${ref.kind}/${ref.shareId || "private"}/${ref.id}/${ref.size}/${checksum}.webp`;
        this.store.put("r2Object", {
          id,
          ref,
          key,
          url: this.config.url,
          state: "uploading",
          bytes: bytes.length,
        });
        const response = await this.fetcher(`${this.config.url}/${key}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${this.config.secret}`,
            "Content-Type": "image/webp",
          },
          body: bytes,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`R2 上传失败 (${response.status})`);
        const receipt = await response.json();
        if (receipt.hash !== checksum || receipt.size !== bytes.length)
          throw new Error("R2 校验未通过");
        this.store.put("r2Object", {
          ...this.record(ref),
          state: "ready",
          uploadedAt: this.now(),
          error: null,
        });
      } catch (e) {
        this.store.put("r2Object", {
          ...this.record(ref),
          id,
          ref,
          url: this.config.url,
          state: "error",
          error: e.message,
          retryAt: this.now() + 60000,
        });
      } finally {
        this.active--;
        this.pending.delete(id);
      }
    })();
    this.pending.set(id, task);
    return task;
  }
  ticket(req, ref, key) {
    const c = cookies(req),
      payload = { ref, key, exp: this.now() + 300000 };
    if (ref.kind === "share") {
      const s = this.store.get("share", ref.shareId);
      if (s.password) payload.session = hash(c["share_" + s.id] || "");
    } else payload.session = hash(c.photo_session || "");
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return (
      encoded +
      "." +
      createHmac("sha256", this.config.secret)
        .update(encoded)
        .digest("base64url")
    );
  }
  authorized(ticket, key) {
    try {
      const [body, signature] = ticket.split(".");
      if (
        !same(
          signature,
          createHmac("sha256", this.config.secret)
            .update(body)
            .digest("base64url"),
        )
      )
        return false;
      const p = JSON.parse(Buffer.from(body, "base64url").toString());
      if (
        p.exp <= this.now() ||
        p.exp > this.now() + 360000 ||
        p.key !== key ||
        !this.valid(p.ref)
      )
        return false;
      const r = this.record(p.ref);
      if (r?.state !== "ready" || r.key !== key || r.url !== this.config.url)
        return false;
      if (p.ref.kind === "share") {
        const s = this.store.get("share", p.ref.shareId);
        if (!s.password) return true;
        const session = this.store.get("shareSession", p.session);
        return (
          !!session &&
          session.shareId === s.id &&
          session.expiresAt > this.now()
        );
      }
      const session = this.store.get("session", p.session);
      return (
        !!session &&
        session.expiresAt > this.now() &&
        !this.store.get("account", "admin")?.mustChangePassword
      );
    } catch {
      return false;
    }
  }
  async serve(req, res, ref, file) {
    if (!this.config || req.query.local === "1" || !this.valid(ref))
      return false;
    const r = this.record(ref);
    if (r?.state === "ready" && r.url === this.config.url) {
      res
        .set({
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
        })
        .redirect(
          302,
          `${this.config.url}/${r.key}?ticket=${this.ticket(req, ref, r.key)}`,
        );
      return true;
    }
    void this.upload(ref, file);
    return false;
  }
  async drain() {
    if (!this.config || this.draining) return;
    this.draining = true;
    try {
      for (const r of this.store.all("r2Object")) {
        if (this.closed) break;
        if (this.valid(r.ref) || r.state === "deleted") continue;
        try {
          if (r.key) {
            if (r.url !== this.config.url)
              throw new Error("旧存储地址需要重新连接后清理");
            const response = await this.fetcher(`${this.config.url}/${r.key}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${this.config.secret}` },
              redirect: "error",
              signal: AbortSignal.timeout(15000),
            });
            if (!response.ok)
              throw new Error(`R2 清理失败 (${response.status})`);
          }
          this.store.put("r2Object", {
            ...r,
            state: "deleted",
            deletedAt: this.now(),
            error: null,
          });
          if (r.ref.kind !== "photo")
            await rm(
              displayPath(
                this.store,
                `${r.ref.kind === "share" ? "share-" + r.ref.shareId : "creation"}-${r.ref.id}`,
                r.ref.size,
              ),
              { force: true },
            );
        } catch (e) {
          this.store.put("r2Object", {
            ...r,
            state: "delete-error",
            error: e.message,
          });
        }
      }
      const refs = [];
      for (const p of this.store.all("photo"))
        if (
          !p.deleted &&
          !p.deleting &&
          (p.storage !== "local" || p.displayReady)
        )
          for (const size of Object.keys(displaySizes))
            refs.push({ kind: "photo", id: p.id, size });
      for (const c of this.store.all("creation"))
        if (c.file) refs.push({ kind: "creation", id: c.id, size: "screen" });
      for (const s of this.store.all("share"))
        for (const p of [
          ...(s.photos || []),
          ...(s.creations || []).filter((c) => c.file),
        ])
          for (const size of ["tile", "mobile", "screen"]) {
            const ref = { kind: "share", shareId: s.id, id: p.id, size };
            if (this.valid(ref)) refs.push(ref);
          }
      // Small batches keep CPU, disk and outbound traffic bounded and allow foreground requests to win.
      for (let i = 0; i < refs.length && !this.closed; i += 2)
        await Promise.all(refs.slice(i, i + 2).map((ref) => this.upload(ref)));
    } finally {
      this.draining = false;
    }
  }
  status() {
    const objects = this.store.all("r2Object"),
      ready = objects.filter(
        (r) => r.state === "ready" && r.url === this.config?.url,
      );
    return {
      enabled: !!this.config,
      url: this.config?.url || null,
      ready: ready.length,
      bytes: ready.reduce((n, r) => n + (r.bytes || 0), 0),
      active: this.active,
      failed: objects.filter((r) => ["error", "delete-error"].includes(r.state))
        .length,
    };
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
  }
}
export function registerR2(app, store, config = readR2Config(store.root)) {
  const media = new R2Media(store, config);
  app.locals.r2 = media;
  app.post("/api/media-edge/authorize", (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!config || !same(req.headers.authorization, `Bearer ${config.secret}`))
      return res.status(403).json({ allowed: false });
    const allowed = media.authorized(req.body.ticket, req.body.key);
    res.status(allowed ? 200 : 403).json({ allowed });
  });
  app.get("/api/storage/status", (req, res) => res.json(media.status()));
  app.post("/api/storage/retry", (req, res) => {
    for (const r of store.all("r2Object"))
      if (r.state === "error") store.put("r2Object", { ...r, retryAt: 0 });
    void media.drain();
    res.json(media.status());
  });
  if (config) {
    media.timer = setInterval(() => void media.drain(), 60000);
    media.timer.unref();
    void media.drain();
  }
  return media;
}
