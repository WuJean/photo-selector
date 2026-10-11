import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import os from "node:os";
const token = (
  await readFile(
    process.env.WECHAT_MCP_TOKEN_FILE ||
      os.homedir() + "/.codex/private/wechat-mcp-token",
    "utf8",
  )
).trim();
const child = spawn("wechatide", ["mcp", "--token=" + token], {
  stdio: ["pipe", "pipe", "pipe"],
});
let id = 0;
const pending = new Map();
const rl = createInterface({ input: child.stdout });
rl.on("line", (line) => {
  try {
    const value = JSON.parse(line);
    if (value.id && pending.has(value.id)) {
      pending.get(value.id)(value);
      pending.delete(value.id);
    }
  } catch {}
});
const send = (method, params) =>
  new Promise((resolve) => {
    const next = ++id;
    pending.set(next, resolve);
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: next, method, params }) + "\n",
    );
  });
const timer = setTimeout(() => {
  console.error("Wechat tool timed out");
  child.kill();
  process.exitCode = 1;
}, 60000);
try {
  const init = await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "Codex", version: "1.0" },
  });
  if (init.error) console.error(JSON.stringify(init.error));
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n",
  );
  const name = process.argv[2];
  const result = await send(
    name === "list" ? "tools/list" : "tools/call",
    name === "list"
      ? {}
      : {
          name,
          arguments: process.argv[3]
            ? JSON.parse(await readFile(process.argv[3], "utf8"))
            : {},
        },
  );
  if (name === "create_preview_qrcode") {
    const data =
      result.result?.structuredContent ||
      JSON.parse(
        result.result?.content?.find((c) => c.type === "text")?.text || "{}",
      );
    const args = process.argv[3]
      ? JSON.parse(await readFile(process.argv[3], "utf8"))
      : {};
    console.log(
      JSON.stringify({
        success: data.success,
        info: data.info,
        qrcodePath: args["qr-output"],
        error: data.error,
      }),
    );
  } else console.log(JSON.stringify(result).split(token).join("[hidden]"));
} finally {
  clearTimeout(timer);
  child.kill();
  rl.close();
}
