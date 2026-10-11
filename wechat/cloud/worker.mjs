import cloud from "wx-server-sdk";
import { CloudStore, COLLECTION, uid } from "../core/store.mjs";
import { processJob } from "../core/jobs.mjs";
import { createPerformer } from "./perform.mjs";
import { dispatch, sign } from "./dispatch.mjs";
import { timingSafeEqual } from "node:crypto";
cloud.init({ env: process.env.CLOUDBASE_ENV_ID || cloud.DYNAMIC_CURRENT_ENV });
export async function main(event) {
  const secret = process.env.WORKER_SECRET;
  const actual = Buffer.from(String(event.signature || ""));
  const expected = Buffer.from(secret ? sign(event.timestamp, secret) : "");
  const trustedTimer =
    event.Type === "Timer" &&
    event.TriggerName === "photo-queue" &&
    !cloud.getWXContext().OPENID;
  if (
    !trustedTimer &&
    (!secret ||
      Math.abs(Date.now() - event.timestamp) > 300000 ||
      !Number.isFinite(event.timestamp) ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected))
  )
    throw new Error("Worker authentication failed");
  const db = cloud.database(),
    system = new CloudStore(db, "__system");
  const token = uid();
  const locked = await system.transaction(async (tx) => {
    const lock = await tx.get("lease", "worker");
    if (lock?.until > Date.now()) return false;
    await tx.put("lease", { id: "worker", token, until: Date.now() + 900000 });
    return true;
  });
  if (!locked) return { busy: true };
  const start = Date.now();
  try {
    while (Date.now() - start < 450000) {
      const { data } = await db
        .collection(COLLECTION)
        .where({ kind: "job", state: db.command.in(["queued", "running"]) })
        .orderBy("createdAt", "asc")
        .limit(20)
        .get();
      if (!data.length) break;
      let changed = false;
      for (const job of data) {
        const store = new CloudStore(db, job.owner);
        await processJob(store, job.id, createPerformer({ cloud, store }), {
          maxItems: 16,
          concurrency: 16,
        });
        changed = true;
        if (Date.now() - start >= 450000) break;
      }
      if (!changed) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { ok: true };
  } finally {
    await system.transaction(async (tx) => {
      const lock = await tx.get("lease", "worker");
      if (lock?.token === token) await tx.remove("lease", "worker");
    });
    const waiting = await db
      .collection(COLLECTION)
      .where({ kind: "job", state: db.command.in(["queued", "running"]) })
      .limit(1)
      .get();
    if (waiting.data.length) await dispatch();
  }
}
