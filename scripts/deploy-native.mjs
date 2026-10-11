import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { deploymentConfig } from "./deploy-config.mjs";
import { accessPolicy } from "../server/access.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = deploymentConfig(root);
const runDir = path.resolve(
  process.env.PHOTO_SELECTOR_RUN_DIR || path.join(root, ".local/run"),
);
mkdirSync(runDir, { recursive: true, mode: 0o700 });
const stateFile = path.join(runDir, "native.json"),
  logFile = path.join(runDir, "native.log"),
  lockFile = path.join(runDir, "deploy.lock");
const readState = () => {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};
function owned(s) {
  if (!s || s.root !== root || !Number.isInteger(s.pid) || !s.marker)
    return false;
  try {
    const args = execFileSync("ps", ["-p", String(s.pid), "-o", "args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return (
      args.includes(path.join(root, "server/index.mjs")) &&
      args.includes("--managed-instance=" + s.marker)
    );
  } catch {
    return false;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function stop() {
  const s = readState();
  if (!owned(s)) {
    if (s) rmSync(stateFile, { force: true });
    console.log("原生服务未运行；未操作其他进程。");
    return;
  }
  process.kill(-s.pid, "SIGTERM");
  for (let i = 0; i < 100 && owned(s); i++) await sleep(100);
  if (owned(s))
    throw new Error("进程仍在退出中，未强制终止；请检查日志后重试。");
  rmSync(stateFile, { force: true });
  console.log("原生服务已停止，照片与配置保留。");
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", () =>
      reject(
        new Error(
          `端口 ${cfg.port} 已被占用；请设置 PHOTO_SELECTOR_PORT，未终止任何未知进程。`,
        ),
      ),
    );
    s.listen(cfg.port, cfg.host, () => s.close(resolve));
  });
}
function command(program, args) {
  execFileSync(program, args, { cwd: root, env: cfg.env, stdio: "inherit" });
}
async function build() {
  if (
    process.platform !== "darwin" ||
    Number(
      execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).split(
        ".",
      )[0],
    ) < 14
  )
    throw new Error("原生部署需要 macOS 14+");
  try {
    execFileSync("npm", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("缺少 npm，请重新安装 Node.js 24。");
  }
  command("npm", ["ci"]);
  command("npm", ["run", "build"]);
  let swift = false;
  try {
    swift = /Swift version (?:[6-9]|\d{2,})\./.test(
      execFileSync("swift", ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {}
  if (swift) {
    try {
      command("npm", ["run", "build:vision"]);
    } catch {
      console.log(
        "Vision 构建失败，将使用已有可用版本或传统 CV。安装/更新 Xcode Command Line Tools 后重新部署。",
      );
    }
  } else
    console.log(
      "Swift 6 不可用；可运行 xcode-select --install 安装工具链后重新部署。",
    );
  console.log(
    existsSync(path.join(root, ".build/release/VisionWorker"))
      ? "Apple Vision 已就绪；支持 macOS 钥匙串。"
      : "Apple Vision 未启用；使用传统 CV 和本地加密凭据。",
  );
}
function addresses() {
  console.log(`本机访问：${cfg.localURL}`);
  for (const address of cfg.addresses) console.log(`局域网访问：${address}`);
  console.log(
    `分享地址：${cfg.publicURL}\n首次密码：passwd。首次登录必须改密；请改密后再分享访问地址。已有密码不变。`,
  );
}
async function start() {
  if (owned(readState())) {
    console.log("原生服务已在运行。");
    return;
  }
  if (
    !existsSync(path.join(root, "dist/web/index.html")) ||
    !existsSync(path.join(root, "node_modules"))
  )
    throw new Error("尚未构建，请先运行 ./deploy.sh");
  await freePort();
  const marker = randomUUID(),
    log = openSync(logFile, "a", 0o600);
  const env = {
    ...cfg.env,
    NODE_ENV: "production",
    HOST: cfg.host,
    PORT: String(cfg.port),
    PHOTO_SELECTOR_DATA_DIR: cfg.dataDir,
    PHOTO_SELECTOR_PUBLIC_URL: cfg.publicURL,
    PHOTO_SELECTOR_ALLOWED_ORIGINS: cfg.allowedOrigins,
  };
  const child = spawn(
    process.execPath,
    [path.join(root, "server/index.mjs"), "--managed-instance=" + marker],
    { cwd: root, env, detached: true, stdio: ["ignore", log, log] },
  );
  closeSync(log);
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const state = {
    pid: child.pid,
    marker,
    root,
    port: cfg.port,
    host: cfg.host,
    publicURL: cfg.publicURL,
    dataDir: cfg.dataDir,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  child.unref();
  const probeHost = ["0.0.0.0", "::"].includes(cfg.host)
    ? "127.0.0.1"
    : cfg.host;
  for (let i = 0; i < 120; i++) {
    if (!owned(state)) throw new Error(`启动失败，请查看 ${logFile}`);
    try {
      const r = await fetch(
        `http://${probeHost.includes(":") ? "[" + probeHost + "]" : probeHost}:${cfg.port}/api/health`,
        { signal: AbortSignal.timeout(1000) },
      );
      if (r.ok) {
        addresses();
        return;
      }
    } catch {}
    await sleep(250);
  }
  await stop();
  throw new Error(`健康检查超时，请查看 ${logFile}`);
}
let locked = false;
try {
  const action = process.argv[2] || "deploy";
  if (action === "logs") {
    command("tail", ["-n", "100", "-f", logFile]);
  } else if (action === "status") {
    const s = readState();
    console.log(
      owned(s)
        ? `运行中 PID ${s.pid}，端口 ${s.port}，分享地址 ${s.publicURL}`
        : "原生服务未运行",
    );
  } else {
    if (!["deploy", "start", "stop", "restart"].includes(action))
      throw new Error("未知操作");
    try {
      const fd = openSync(lockFile, "wx", 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      locked = true;
    } catch {
      throw new Error(
        `另一个部署操作正在运行。若已中断，请确认无部署进程后移除 ${lockFile}`,
      );
    }
    if (action !== "stop") accessPolicy(cfg.publicURL, cfg.allowedOrigins);
    if (action === "deploy") {
      if (!owned(readState())) await freePort();
      await build();
      await stop();
      await start();
    }
    if (action === "start") await start();
    if (action === "stop") await stop();
    if (action === "restart") {
      await stop();
      await start();
    }
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  if (locked) rmSync(lockFile, { force: true });
}
