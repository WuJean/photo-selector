import { cloudConfig } from "./wechat-config.mjs";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const config = await cloudConfig();
const cli = (args) =>
  execFileSync(
    "npm",
    [
      "exec",
      "--yes",
      "--package",
      "@cloudbase/cli@3.8.6",
      "--",
      "tcb",
      ...args,
      "-e",
      config.envId,
      "--json",
    ],
    { encoding: "utf8" },
  );
const indexes = [
  { name: "owner_kind_id", key: { owner: 1, kind: 1, _id: 1 } },
  {
    name: "owner_kind_project_id",
    key: { owner: 1, kind: 1, projectId: 1, _id: 1 },
  },
  { name: "owner_kind_job_id", key: { owner: 1, kind: 1, jobId: 1, _id: 1 } },
  {
    name: "owner_kind_collection_id",
    key: { owner: 1, kind: 1, collectionId: 1, _id: 1 },
  },
  { name: "kind_state_created", key: { kind: 1, state: 1, createdAt: 1 } },
];
cli([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: "photo_selector",
      CommandType: "COMMAND",
      Command: JSON.stringify({ createIndexes: "photo_selector", indexes }),
    },
  ]),
]);
cli([
  "api",
  "tcb",
  "ModifyDatabaseACL",
  "--api-version",
  "2018-06-08",
  "--body",
  JSON.stringify({
    EnvId: config.envId,
    CollectionName: "photo_selector",
    AclTag: "ADMINONLY",
  }),
]);
console.log("业务集合索引已建立；客户端直接读写已禁止。");
