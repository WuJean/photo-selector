import { compressedFile, displaySizes, displayPath } from "./display.mjs";
import { tagCategory } from "../shared/tags.mjs";
import path from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  mkdir,
  unlink,
  copyFile,
  access,
  rm,
  writeFile,
} from "node:fs/promises";
import sharp from "sharp";
import archiver from "archiver";
import { requireItem, timestamp } from "./library.mjs";
import { originalPath, renderPath, digest } from "./images.mjs";
import { hashPassword, verifyPassword, cookies } from "./auth.mjs";
import { tagsOf, uniqueName } from "../shared/domain.mjs";
import { renderDraft } from "./render.mjs";
import { validateDraft } from "../shared/layout.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const directory = (store, s) => path.join(store.root, "shares", s.id);
const filename = (store, s, id, variant) =>
  path.join(
    directory(store, s),
    `${id}-${variant}${variant === "display" ? ".jpg" : ".bin"}`,
  );
const expired = (s) => s.expiresAt && Date.parse(s.expiresAt) <= Date.now();
export function registerShares(app, store, upload) {
  const attempts = new Map();
  let archives = 0,
    rendering = 0;
  const creationLimits = new Map();
  const admin = (s) => {
    const { password, ...rest } = s;
    return {
      ...rest,
      protected: !!password,
      url: app.locals.publicURL
        ? new URL("/s/" + s.token, app.locals.publicURL).href
        : null,
    };
  };
  const valid = (token) => {
    const s = store.all("share").find((s) => s.token === token);
    if (!s || s.state !== "active" || expired(s))
      throw Object.assign(new Error("分享不存在或已失效"), { status: 404 });
    return s;
  };
  const authorize = (req, s) => {
    if (!s.password) return;
    const token = cookies(req)["share_" + s.id];
    const session = token && store.get("shareSession", hash(token));
    if (!session || session.shareId !== s.id || session.expiresAt < Date.now())
      throw Object.assign(new Error("请输入访问密码"), { status: 401 });
  };
  const editable = (id) => {
    const s = requireItem(store, "share", id);
    if (s.state !== "preparing" || expired(s))
      throw new Error("分享已发布或失效");
    return s;
  };
  const write = async (s, id, source, variant) => {
    await mkdir(directory(store, s), { recursive: true });
    const target = filename(store, s, id, variant),
      temp = target + "." + randomUUID() + ".tmp";
    try {
      if (variant === "original") {
        const p = requireItem(store, "photo", id);
        if ((await digest(source)) !== p.hash)
          throw new Error("原片摘要不匹配");
        await copyFile(source, temp);
      } else
        await sharp(source, { limitInputPixels: 120000000 })
          .rotate()
          .resize(2560, 2560, { fit: "inside", withoutEnlargement: true })
          .toColourspace("srgb")
          .jpeg({ quality: 88 })
          .toFile(temp);
      const latest = requireItem(store, "share", s.id);
      if (latest.state !== "preparing") throw new Error("分享已取消");
      const { rename } = await import("node:fs/promises");
      await rename(temp, target);
      const final = editable(s.id);
      store.put("share", {
        ...final,
        prepared: {
          ...final.prepared,
          [id]: { ...final.prepared[id], [variant]: true },
        },
      });
    } finally {
      await unlink(temp).catch(() => {});
    }
  };
  app.get("/api/collections/:id/shares", (req, res) => {
    requireItem(store, "collection", req.params.id);
    res.json(
      store
        .all("share")
        .filter((s) => s.collectionId === req.params.id)
        .map(admin),
    );
  });
  app.post("/api/collections/:id/shares", (req, res) => {
    const c = requireItem(store, "collection", req.params.id);
    const mode = req.body.download || "display";
    if (!["none", "display", "original"].includes(mode))
      throw new Error("下载权限无效");
    const days = Number(req.body.days ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 365)
      throw new Error("有效期为 1–365 天");
    const password = String(req.body.password || "");
    if (password && (password.length < 4 || password.length > 128))
      throw new Error("访问密码为 4–128 位");
    const photos = c.photoIds.map((id) => requireItem(store, "photo", id));
    if (photos.some((p) => p.deleted || p.deleting))
      throw new Error("照片正在清理");
    const creations = store
      .all("creation")
      .filter((v) => v.collectionId === c.id)
      .map((v) => ({
        id: v.id,
        title: v.title,
        kind: v.kind,
        origin: v.origin,
        text: v.kind === "copy" ? v.text : "",
        file: v.file || null,
      }));
    if (!photos.length && !creations.length) throw new Error("作品集为空");
    const s = {
      id: randomUUID(),
      token: randomBytes(32).toString("base64url"),
      collectionId: c.id,
      name: c.name,
      description: c.description,
      assetIds: [...c.photoIds],
      tagDefinitions: [...new Set(photos.flatMap(tagsOf))].map((name) => ({
        name,
        category: tagCategory(
          name,
          store.get("tagLibrary", "library")?.tags || [],
        ),
      })),
      photos: photos.map((p) => ({
        id: p.id,
        name: p.name,
        originalMime: p.originalMime || "image/jpeg",
        width: p.width,
        height: p.height,
        tags: tagsOf(p),
        description: store.publicPhoto(p).description,
        kind: "photo",
      })),
      creations,
      download: mode,
      allowCollage: mode !== "none" && req.body.allowCollage !== false,
      password: password ? hashPassword(password) : null,
      expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
      state: "preparing",
      prepared: {},
      createdAt: timestamp(),
    };
    store.put("share", s);
    res.status(201).json(admin(s));
  });
  app.post("/api/shares/:id/assets/:assetId/server", async (req, res) => {
    const s = editable(req.params.id);
    if (!s.assetIds.includes(req.params.assetId))
      throw new Error("照片不属于分享");
    const source = originalPath(store, req.params.assetId);
    try {
      await access(source);
    } catch {
      return res.status(409).json({ error: "需要从电脑上传此照片" });
    }
    await write(
      s,
      req.params.assetId,
      renderPath(store, req.params.assetId),
      "display",
    );
    if (s.download === "original")
      await write(s, req.params.assetId, source, "original");
    res.json({ ok: true });
  });
  app.post(
    "/api/shares/:id/assets/:assetId/:variant",
    upload.single("photo"),
    async (req, res) => {
      try {
        const s = editable(req.params.id),
          { assetId, variant } = req.params;
        if (
          !s.assetIds.includes(assetId) ||
          !["display", "original"].includes(variant) ||
          (variant === "original" && s.download !== "original") ||
          !req.file
        )
          throw new Error("分享文件无效");
        if ((await sharp(req.file.path).metadata()).format !== "jpeg")
          throw new Error("需要 JPEG 照片");
        await write(s, assetId, req.file.path, variant);
        res.json({ ok: true });
      } finally {
        if (req.file) await unlink(req.file.path).catch(() => {});
      }
    },
  );
  app.post("/api/shares/:id/publish", async (req, res) => {
    const s = editable(req.params.id);
    for (const id of s.assetIds) {
      for (const variant of s.download === "original"
        ? ["display", "original"]
        : ["display"]) {
        if (!s.prepared[id]?.[variant]) throw new Error("还有照片未准备完成");
        await access(filename(store, s, id, variant));
      }
    }
    await mkdir(directory(store, s), { recursive: true });
    for (const c of s.creations.filter((c) => c.file)) {
      const item = requireItem(store, "creation", c.id);
      await sharp(path.join(store.root, "creations", item.file))
        .rotate()
        .resize(2560, 2560, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toFile(filename(store, s, c.id, "display"));
    }
    const latest = editable(s.id);
    store.put("share", {
      ...latest,
      state: "active",
      publishedAt: timestamp(),
    });
    res.json(admin(store.get("share", s.id)));
  });
  app.delete("/api/shares/:id", async (req, res) => {
    const s = requireItem(store, "share", req.params.id);
    store.put("share", { ...s, state: "revoked" });
    for (const session of store.all("shareSession"))
      if (session.shareId === s.id) store.remove("shareSession", session.id);
    await rm(directory(store, s), { recursive: true, force: true });
    await clearDisplay(s);
    res.json({ ok: true });
  });
  app.post("/api/public/shares/:token/unlock", (req, res) => {
    const s = valid(req.params.token);
    const key = s.id + ":" + req.socket.remoteAddress,
      now = Date.now();
    let limit = attempts.get(key) || { count: 0, until: now + 900000 };
    if (limit.until < now) limit = { count: 0, until: now + 900000 };
    if (limit.count >= 10)
      return res.status(429).json({ error: "尝试过多，请稍后重试" });
    if (s.password && !verifyPassword(req.body.password, s.password)) {
      limit.count++;
      attempts.set(key, limit);
      return res.status(401).json({ error: "访问密码不正确" });
    }
    attempts.delete(key);
    const token = randomBytes(32).toString("base64url");
    store.put("shareSession", {
      id: hash(token),
      shareId: s.id,
      expiresAt: Math.min(Date.parse(s.expiresAt), now + 86400000),
    });
    res.setHeader(
      "Set-Cookie",
      `share_${s.id}=${token}; Path=/api/public/shares/${s.token}; HttpOnly; SameSite=Strict; Max-Age=86400${app.locals.publicURL?.startsWith("https:") ? "; Secure" : ""}`,
    );
    res.json({ ok: true });
  });
  app.get("/api/public/shares/:token", (req, res) => {
    const s = valid(req.params.token);
    authorize(req, s);
    res.set("Cache-Control", "no-store").json({
      name: s.name,
      description: s.description,
      photos: s.photos,
      tagDefinitions: s.tagDefinitions || [],
      creations: s.creations.map(({ file, ...c }) => ({
        ...c,
        hasImage: !!file,
      })),
      download: s.download,
      allowCollage: s.download !== "none" && !!s.allowCollage,
      expiresAt: s.expiresAt,
    });
  });
  app.get("/api/public/shares/:token/photos/:id/:variant", async (req, res) => {
    const s = valid(req.params.token);
    authorize(req, s);
    const { id, variant } = req.params;
    const p = s.photos.find((p) => p.id === id),
      creation = s.creations.find((c) => c.id === id && c.file);
    if (
      (!p && !creation) ||
      !["display", "original"].includes(variant) ||
      (variant === "original" && (s.download !== "original" || !p))
    )
      return res.status(404).json({ error: "照片不存在" });
    if (req.query.download && s.download === "none")
      return res.status(403).json({ error: "此作品集不开放下载" });
    if (variant === "display" && !req.query.download && req.query.view) {
      const size = Object.hasOwn(displaySizes, req.query.view)
        ? req.query.view
        : "mobile";
      const file = await compressedFile(
        store,
        `share-${s.id}-${id}`,
        size,
        filename(store, s, id, "display"),
      );
      if (
        await app.locals.r2?.serve(
          req,
          res,
          { kind: "share", shareId: s.id, id, size },
          file,
        )
      )
        return;
      return res
        .set("Cache-Control", "private, no-store")
        .type("webp")
        .sendFile(file, { dotfiles: "allow" });
    }
    res.set("Cache-Control", "private, no-store");
    if (req.query.download)
      res.attachment(
        p
          ? variant === "original"
            ? p.name
            : p.name.replace(/\.[^.]+$/, "") + ".jpg"
          : creation.title + ".jpg",
      );
    res
      .type(
        variant === "original" ? p.originalMime || "image/jpeg" : "image/jpeg",
      )
      .sendFile(filename(store, s, id, variant), { dotfiles: "allow" });
  });
  app.post("/api/public/shares/:token/collages/:action", async (req, res) => {
    const s = valid(req.params.token);
    authorize(req, s);
    if (!s.allowCollage || s.download === "none")
      return res.status(403).json({ error: "此分享未开放拼图" });
    if (!["render", "save"].includes(req.params.action))
      return res.status(404).end();
    if (rendering >= 2)
      return res.status(429).json({ error: "拼图处理中，请稍后重试" });
    const now = Date.now(),
      limit = creationLimits.get(s.id);
    if (limit && limit.until > now && limit.count >= 30)
      return res.status(429).json({ error: "拼图操作较频繁，请稍后再试" });
    creationLimits.set(s.id, {
      until: limit?.until > now ? limit.until : now + 600000,
      count: limit?.until > now ? limit.count + 1 : 1,
    });
    // A public share is a narrow capability: never accept private asset paths or destination IDs.
    const draft = validateDraft(
      { ...req.body, projectId: "library", watermark: {} },
      s.photos,
    );
    draft.longEdge = Math.min(3000, draft.longEdge);
    rendering++;
    let output,
      saved = false;
    const id = randomUUID(),
      file = id + ".jpg";
    try {
      const photos = await Promise.all(
        s.photos
          .filter((p) => draft.slots.some((slot) => slot.photoId === p.id))
          .map(async (p) => {
            const metadata = await sharp(
              filename(store, s, p.id, "display"),
            ).metadata();
            return {
              ...p,
              projectId: "library",
              width: metadata.width,
              height: metadata.height,
            };
          }),
      );
      const bytes = await renderDraft(
        {
          get: (kind, id) =>
            kind === "photo" ? photos.find((p) => p.id === id) : null,
        },
        draft,
        { sourcePath: (id) => filename(store, s, id, "display") },
      );
      let latest = valid(s.token);
      authorize(req, latest);
      if (req.params.action === "render")
        return res
          .set("Cache-Control", "no-store")
          .attachment("拼图.jpg")
          .type("image/jpeg")
          .send(bytes);
      requireItem(store, "collection", s.collectionId);
      await mkdir(path.join(store.root, "creations"), { recursive: true });
      output = path.join(store.root, "creations", file);
      await writeFile(output, bytes, { flag: "wx" });
      await writeFile(filename(store, s, id, "display"), bytes, { flag: "wx" });
      latest = valid(s.token);
      authorize(req, latest);
      requireItem(store, "collection", s.collectionId);
      const creation = {
        id,
        file,
        kind: "collage",
        origin: "guest",
        title: draft.title,
        projectId: "library",
        collectionId: s.collectionId,
        shareId: s.id,
        sourceIds: draft.slots.map((v) => v.photoId),
        draft,
        createdAt: timestamp(),
      };
      store.transaction(() => {
        store.put("creation", creation);
        store.put("share", {
          ...latest,
          creations: [
            ...latest.creations,
            { id, file, kind: "collage", origin: "guest", title: draft.title },
          ],
        });
      });
      saved = true;
      res
        .status(201)
        .json({ id, title: draft.title, kind: "collage", origin: "guest" });
    } finally {
      rendering--;
      if (!saved && output) {
        await unlink(output).catch(() => {});
        await unlink(filename(store, s, id, "display")).catch(() => {});
      }
    }
  });
  app.get("/api/public/shares/:token/download", async (req, res, next) => {
    const s = valid(req.params.token);
    authorize(req, s);
    if (s.download === "none")
      return res.status(403).json({ error: "此作品集不开放下载" });
    if (archives >= 2)
      return res.status(429).json({ error: "下载繁忙，请稍后重试" });
    archives++;
    let closed = false;
    const zip = archiver("zip", { zlib: { level: 0 } });
    res.on("close", () => {
      if (!closed) {
        closed = true;
        archives--;
      }
      zip.abort();
    });
    zip.on("error", (e) => (res.headersSent ? res.destroy(e) : next(e)));
    res.attachment(s.name + ".zip");
    zip.pipe(res);
    const names = new Set();
    for (const p of s.photos)
      zip.file(
        filename(
          store,
          s,
          p.id,
          s.download === "original" ? "original" : "display",
        ),
        {
          name: uniqueName(
            s.download === "original"
              ? p.name
              : p.name.replace(/\.[^.]+$/, "") + ".jpg",
            names,
          ),
        },
      );
    for (const c of s.creations.filter((c) => c.file))
      zip.file(filename(store, s, c.id, "display"), {
        name: uniqueName((c.title || c.kind) + ".jpg", names),
      });
    await zip.finalize();
  });
  async function clearDisplay(s) {
    for (const item of [...(s.photos || []), ...(s.creations || [])])
      for (const size of Object.keys(displaySizes))
        await rm(displayPath(store, `share-${s.id}-${item.id}`, size), {
          force: true,
        }).catch(() => {});
  }
  const sweep = async () => {
    for (const s of store.all("share"))
      if (s.state === "revoked" || expired(s)) {
        if (s.state !== "revoked")
          store.put("share", { ...s, state: "expired" });
        await rm(directory(store, s), { recursive: true, force: true }).catch(
          () => {},
        );
        await clearDisplay(s);
      }
    for (const session of store.all("shareSession"))
      if (session.expiresAt < Date.now())
        store.remove("shareSession", session.id);
  };
  const timer = setInterval(() => void sweep(), 60000);
  timer.unref();
  app.locals.closeShares = () => clearInterval(timer);
  void sweep();
}
