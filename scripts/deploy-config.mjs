import { networkInterfaces } from "node:os";
import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";
import path from "node:path";
export function privateAddresses(interfaces = networkInterfaces()) {
  return [
    ...new Set(
      Object.values(interfaces)
        .flat()
        .filter(
          (v) =>
            v &&
            !v.internal &&
            v.family === "IPv4" &&
            /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v.address),
        )
        .map((v) => v.address),
    ),
  ];
}
export function deploymentConfig(root, environment = process.env, interfaces) {
  let file = {};
  try {
    file = parseEnv(readFileSync(path.join(root, ".env"), "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const pick = (...keys) =>
    keys.map((k) => environment[k]).find((v) => v !== undefined) ??
    keys.map((k) => file[k]).find((v) => v !== undefined);
  const port = Number(pick("PORT", "PHOTO_SELECTOR_PORT") || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("端口必须为 1–65535");
  const host = pick("HOST", "PHOTO_SELECTOR_BIND") || "0.0.0.0";
  const ips =
    host === "127.0.0.1" || host === "::1" ? [] : privateAddresses(interfaces);
  const publicURL =
    pick("PHOTO_SELECTOR_PUBLIC_URL") ||
    `http://${ips[0] || "localhost"}:${port}`;
  const local = ["localhost", "127.0.0.1", "[::1]", ...ips].map(
    (ip) => `http://${ip}:${port}`,
  );
  const allowedOrigins = [
    ...new Set([
      ...local,
      ...(pick("PHOTO_SELECTOR_ALLOWED_ORIGINS") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ]),
  ].join(",");
  return {
    port,
    host,
    publicURL,
    allowedOrigins,
    localURL: `http://localhost:${port}`,
    addresses: ips.map((ip) => `http://${ip}:${port}`),
    dataDir: path.resolve(root, pick("PHOTO_SELECTOR_DATA_DIR") || ".local"),
    env: { ...file, ...environment },
  };
}
