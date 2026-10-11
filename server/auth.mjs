import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
export const hashPassword = (
  password,
  salt = randomBytes(16).toString("hex"),
) => `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
export function verifyPassword(password, encoded) {
  try {
    const [salt, hash] = encoded.split(":");
    return timingSafeEqual(
      scryptSync(String(password), salt, 32),
      Buffer.from(hash, "hex"),
    );
  } catch {
    return false;
  }
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
export function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "").split(";").map((v) => v.trim().split("=")),
  );
}
export function registerAuth(
  app,
  store,
  { password = process.env.PHOTO_SELECTOR_ADMIN_PASSWORD } = {},
) {
  const initialFile = path.join(store.root, "admin-initial-password");
  if (!store.get("account", "admin")) {
    const initial = password || randomBytes(18).toString("base64url");
    store.put("account", { id: "admin", password: hashPassword(initial) });
    if (!password)
      writeFileSync(initialFile, initial + "\n", { mode: 0o600, flag: "wx" });
  }
  const limits = new Map();
  const session = (req) => {
    const token = cookies(req).photo_session;
    if (!token) return null;
    const value = store.get("session", digest(token));
    if (!value || value.expiresAt < Date.now()) return null;
    return value;
  };
  const setCookie = (req, res, token, age) =>
    res.setHeader(
      "Set-Cookie",
      `photo_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${app.locals.publicURL?.startsWith("https:") ? "; Secure" : ""}`,
    );
  app.get("/api/auth/session", (req, res) =>
    res.json({ authenticated: !!session(req) }),
  );
  app.post("/api/auth/login", (req, res) => {
    const key = req.socket.remoteAddress,
      now = Date.now();
    const limit = limits.get(key) || { count: 0, until: now + 900000 };
    if (limit.until < now) {
      limit.count = 0;
      limit.until = now + 900000;
    }
    if (limit.count >= 10)
      return res.status(429).json({ error: "尝试过多，请稍后重试" });
    if (
      !verifyPassword(req.body.password, store.get("account", "admin").password)
    ) {
      limit.count++;
      limits.set(key, limit);
      return res.status(401).json({ error: "密码不正确" });
    }
    limits.delete(key);
    for (const s of store.all("session"))
      if (s.expiresAt < now) store.remove("session", s.id);
    const token = randomBytes(32).toString("base64url");
    store.put("session", { id: digest(token), expiresAt: now + 7 * 86400000 });
    setCookie(req, res, token, 7 * 86400);
    res.json({ ok: true });
  });
  app.post("/api/auth/logout", (req, res) => {
    const s = session(req);
    if (s) store.remove("session", s.id);
    setCookie(req, res, "", 0);
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    if (req.path === "/health" || req.path.startsWith("/public/shares/"))
      return next();
    if (!session(req)) return res.status(401).json({ error: "请先登录" });
    next();
  });
  app.put("/api/auth/password", (req, res) => {
    if (
      !verifyPassword(req.body.current, store.get("account", "admin").password)
    )
      return res.status(403).json({ error: "当前密码不正确" });
    if (typeof req.body.password !== "string" || req.body.password.length < 12)
      throw new Error("新密码至少 12 位");
    store.put("account", {
      id: "admin",
      password: hashPassword(req.body.password),
    });
    for (const s of store.all("session")) store.remove("session", s.id);
    rmSync(initialFile, { force: true });
    setCookie(req, res, "", 0);
    res.json({ ok: true });
  });
}
