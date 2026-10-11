import { execFileSync } from "node:child_process";
import { cp, rm, readdir } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("dist/wechat/cloudfunctions");
const api = path.join(root, "photoApiV2");
// Include the exact Linux x64 native packages even when building on macOS.
execFileSync(
  "npm",
  [
    "install",
    "--omit=dev",
    "--ignore-scripts",
    "--force",
    "--no-audit",
    "--no-fund",
  ],
  { cwd: api, stdio: "inherit" },
);
for (const name of await readdir(path.join(api, "node_modules/@img")))
  if (!name.endsWith("linux-x64"))
    await rm(path.join(api, "node_modules/@img", name), {
      recursive: true,
      force: true,
    });
await rm(path.join(root, "photoWorker/node_modules"), {
  recursive: true,
  force: true,
});
await cp(
  path.join(api, "node_modules"),
  path.join(root, "photoWorker/node_modules"),
  { recursive: true },
);
console.log("已打包 Linux 云函数依赖。请使用 installDependency=false 部署。");
