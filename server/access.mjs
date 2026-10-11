export function accessPolicy(publicURL = "", allowedOrigins = "") {
  const configured = new Set();
  for (const address of [publicURL, ...allowedOrigins.split(",")]
    .map((v) => v.trim())
    .filter(Boolean)) {
    const url = new URL(address);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.hostname.includes("*") ||
      ["0.0.0.0", "[::]"].includes(url.hostname)
    )
      throw new Error(
        "访问地址必须是完整 HTTP(S) 地址，不含路径、凭据或通配符",
      );
    configured.add(url.origin);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
        const alias = new URL(url);
        alias.hostname = host;
        configured.add(alias.origin);
      }
    }
  }
  return (req, res, next) => {
    const origins = new Set(configured);
    for (const host of ["localhost", "127.0.0.1", "[::1]"])
      origins.add(`http://${host}:${req.socket.localPort}`);
    const hosts = new Set([...origins].map((origin) => new URL(origin).host));
    if (!hosts.has(req.headers.host))
      return res.status(403).json({ error: "访问地址未配置" });
    if (req.headers.origin && !origins.has(req.headers.origin))
      return res.status(403).json({ error: "不允许跨站请求" });
    next();
  };
}
