import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../core/store.mjs";
import { createService } from "../core/service.mjs";
import { processJob } from "../core/jobs.mjs";
async function setup(n = 12) {
  const store = new MemoryStore();
  await store.put("project", { id: "p" });
  for (let i = 0; i < n; i++)
    await store.put("photo", {
      id: "p" + i,
      projectId: "p",
      status: "keep",
      finalStatus: "unseen",
      revision: 1,
      hash: "h" + i,
      takenAt: new Date(1700000000000 + i * 100000).toISOString(),
    });
  const config = {
    configured: true,
    workerReady: true,
    model: "fixture",
    baseURL: "https://example.test",
    dailyLimit: 100,
  };
  return { store, api: createService({ store, jobs: { config } }) };
}
const analyze = async () => ({
  analysis: { description: "照片", tags: ["风景", "远景"] },
});
test("classification is direct, caches configuration and rejects unreviewed or foreign images", async () => {
  const { store, api } = await setup(3);
  await store.put("photo", { id: "bad", projectId: "p", status: "unseen" });
  await assert.rejects(
    api("jobs.create", { projectId: "p", type: "classify", ids: ["bad"] }),
  );
  const job = await api("jobs.create", { projectId: "p", type: "classify" });
  assert.equal(job.total, 3);
  assert.equal(job.state, "queued");
  assert.equal(job.config, undefined);
  await processJob(store, job.id, analyze);
  assert.equal((await api("jobs.get", { id: job.id })).state, "done");
  assert.equal(
    (await api("jobs.create", { projectId: "p", type: "classify" })).total,
    0,
  );
  assert.deepEqual((await store.get("photo", "p0")).ai.tags, ["风景", "远景"]);
});
test("sampling requires explicit confirmation, saves sampling and freezes vocabulary before labeling", async () => {
  const { store, api } = await setup(30);
  const sample = await api("jobs.create", { projectId: "p", type: "sample" });
  assert.equal(sample.sampleIds.length, 12);
  await assert.rejects(api("jobs.confirm", { id: sample.id, tags: [] }));
  await processJob(store, sample.id, async () => ({
    tags: [{ name: "草原", category: "环境" }],
  }));
  const ready = await api("jobs.get", { id: sample.id });
  assert.equal(ready.state, "confirmation");
  assert(ready.candidates.some((t) => t.name === "草原"));
  assert.equal((await store.get("photo", "p0")).ai, undefined);
  const classification = await api("jobs.confirm", {
    id: sample.id,
    tags: ready.candidates,
  });
  assert.equal(classification.total, 30);
  assert.equal(
    classification.vocabulary.version,
    (await api("tags.library", { projectId: "p" })).version,
  );
});
test("workers really overlap; cancellation rejects late responses without replacing new state", async () => {
  const { store, api } = await setup(8);
  const job = await api("jobs.create", { projectId: "p", type: "classify" });
  let active = 0,
    peak = 0,
    release;
  const gate = new Promise((r) => (release = r));
  const work = processJob(store, job.id, async () => {
    active++;
    peak = Math.max(peak, active);
    await gate;
    active--;
    return analyze();
  });
  while (peak < 8) await new Promise((r) => setImmediate(r));
  await api("jobs.control", { id: job.id, action: "cancel" });
  release();
  await work;
  assert.equal(peak, 8);
  assert.equal((await store.get("photo", "p0")).ai, undefined);
  assert.equal((await api("jobs.get", { id: job.id })).state, "cancelled");
});
test("pause stops dispatch, in-flight success saves, auth pauses and restart resumes pending items", async () => {
  const { store, api } = await setup(3);
  const job = await api("jobs.create", { projectId: "p", type: "classify" });
  let calls = 0;
  await processJob(
    store,
    job.id,
    async () => {
      calls++;
      await api("jobs.control", { id: job.id, action: "pause" });
      return analyze();
    },
    { concurrency: 1 },
  );
  assert.equal(calls, 1);
  assert.equal((await api("jobs.get", { id: job.id })).completed, 1);
  await api("jobs.control", { id: job.id, action: "resume" });
  await processJob(
    store,
    job.id,
    async () => {
      throw Object.assign(Error("密钥失效"), { auth: true });
    },
    { concurrency: 1 },
  );
  assert.equal((await api("jobs.get", { id: job.id })).state, "paused");
  await api("jobs.control", { id: job.id, action: "retry" });
  await processJob(store, job.id, analyze);
  assert.equal((await api("jobs.get", { id: job.id })).state, "done");
});

test("concurrency preferences do not invalidate image understanding cache", async () => {
  const { store, api } = await setup(4);
  const job = await api("jobs.create", { projectId: "p", type: "classify" });
  await processJob(store, job.id, analyze);
  await api("settings.save", {
    sampleConcurrency: 16,
    classifyConcurrency: 16,
    serviceConcurrency: 4,
  });
  assert.equal((await api("settings.status")).serviceConcurrency, 4);
  assert.equal(
    (await api("jobs.create", { projectId: "p", type: "classify" })).total,
    0,
  );
  const redo = await api("jobs.create", {
    projectId: "p",
    type: "classify",
    force: true,
  });
  assert.equal(
    (await store.get("job", redo.id)).config.classifyConcurrency,
    16,
  );
});

test("interrupted task creation recovers missing items without resubmitting completed items", async () => {
  const { store, api } = await setup(3),
    j = await api("jobs.create", { projectId: "p", type: "classify" });
  await processJob(store, j.id, analyze, { maxItems: 1 });
  const items = await store.all("jobItem", { jobId: j.id }),
    pending = items.find((v) => v.state === "pending");
  await store.remove("jobItem", pending.id);
  await api("jobs.control", { id: j.id, action: "pause" });
  await api("jobs.control", { id: j.id, action: "resume" });
  let calls = 0;
  await processJob(store, j.id, async () => {
    calls++;
    return analyze();
  });
  assert.equal(calls, 2);
  assert.equal((await api("jobs.get", { id: j.id })).completed, 3);
});
test("failed classification creation leaves sample confirmation retryable", async () => {
  const { store, api } = await setup(2);
  const sample = await api("jobs.create", { projectId: "p", type: "sample" });
  await processJob(store, sample.id, async () => ({ tags: [] }));
  const quota = (await store.all("quota"))[0];
  await store.put("quota", { ...quota, used: 100 });
  await assert.rejects(
    api("jobs.confirm", { id: sample.id, tags: [] }),
    /额度/,
  );
  assert.equal((await store.get("job", sample.id)).state, "confirmation");
  await store.put("quota", { ...quota, used: 0 });
  const classified = await api("jobs.confirm", { id: sample.id, tags: [] });
  assert.equal(classified.total, 2);
  assert.equal(
    (await store.get("job", sample.id)).classificationId,
    classified.id,
  );
});
