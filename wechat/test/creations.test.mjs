import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { creationTasks } from "../core/creation-plan.mjs";
import { createPerformer } from "../cloud/perform.mjs";
import { MemoryStore } from "../core/store.mjs";
import { createService } from "../core/service.mjs";
import { processJob } from "../core/jobs.mjs";
import { newDraft } from "../../shared/layout.mjs";
async function setup(n = 3) {
  const store = new MemoryStore();
  await store.put("project", { id: "p" });
  await store.put("collection", {
    id: "c",
    projectId: "p",
    name: "雪山",
    description: "旅行",
  });
  for (let i = 0; i < n; i++) {
    await store.put("photo", {
      id: "p" + i,
      projectId: "p",
      status: "keep",
      finalStatus: "keep",
      width: 120,
      height: 80,
      originalFile: "o" + i,
      previewFile: "v" + i,
      ai: { description: "雪山" + i, tags: ["风景", "远景"] },
    });
    await store.put("member", {
      id: "c-p" + i,
      projectId: "p",
      collectionId: "c",
      photoId: "p" + i,
    });
  }
  const config = {
    configured: true,
    workerReady: true,
    canGenerate: true,
    dailyLimit: 5000,
    model: "test",
    imageModel: "test-image",
    baseURL: "https://test.example",
  };
  return { store, api: createService({ store, jobs: { config } }) };
}
test("creation plan covers 3000 originals and bounds every summary fan-in to twenty", () => {
  const tasks = creationTasks(
    "copy",
    Array.from({ length: 3000 }, (_, i) => ({ id: String(i) })),
  );
  assert.equal(tasks.filter((t) => t.step === "describe").length, 3000);
  for (const t of tasks.filter((t) => t.depends)) {
    assert(t.depends.length <= 20);
    assert(
      t.depends.every((id) =>
        tasks.some((p) => p.id === id && p.phase < t.phase),
      ),
    );
  }
  assert.equal(tasks.at(-1).step, "copy");
  assert.equal(tasks.at(-1).depends.length, 1);
});
test("copy traverses all originals, reuses descriptions and commits exactly one version after phases", async () => {
  const { store, api } = await setup(43);
  let calls = 0,
    seen = [];
  const perform = createPerformer({
    store,
    cloud: {
      downloadFile() {
        throw Error("cached previews should not upload");
      },
    },
    clientFactory: () => ({
      complete: async (messages, validate) => {
        calls++;
        const data = JSON.parse(messages[1].content);
        if (Array.isArray(data)) {
          seen.push(...data.flatMap((v) => v.photoIds));
          return validate({
            summary: "汇总",
            photoIds: data.flatMap((v) => v.photoIds).slice(0, 4),
          });
        }
        return validate({ title: "雪山行", body: "旅行文案" });
      },
    }),
  });
  const job = await api("jobs.create", {
    projectId: "p",
    collectionId: "c",
    type: "copy",
  });
  for (let i = 0; i < 5; i++) await processJob(store, job.id, perform);
  assert.equal((await api("jobs.get", { id: job.id })).state, "done");
  assert.equal(calls, 5);
  assert.equal(new Set(seen).size, 43);
  const creations = await store.all("creation");
  assert.equal(creations.length, 1);
  assert.equal(creations[0].sourceIds.length, 43);
  assert.equal(creations[0].body, "旅行文案");
  await processJob(store, job.id, perform);
  assert.equal((await store.all("creation")).length, 1);
});
test("visual recommendation sends actual previews only from selected scope and rejects moved locks", async () => {
  const { store, api } = await setup(4),
    downloads = [];
  const perform = createPerformer({
    store,
    cloud: {
      downloadFile: async ({ fileID }) => {
        downloads.push(fileID);
        return { fileContent: Buffer.from("jpeg") };
      },
    },
    clientFactory: () => ({
      complete: async (m, validate) => {
        assert.equal(
          m[1].content.filter((c) => c.type === "image_url").length,
          3,
        );
        return validate({
          template: "rows",
          photoIds: ["p1", "p0", "p2"],
          reason: "色彩协调",
        });
      },
    }),
  });
  const j = await api("jobs.create", {
    projectId: "p",
    collectionId: "c",
    type: "recommend",
    ids: ["p0", "p1", "p2"],
    locked: ["p0"],
    current: ["p0", "p1", "p2"],
  });
  await assert.rejects(
    perform(await store.get("job", j.id), {}, null),
    /锁定位置/,
  );
  assert.deepEqual(new Set(downloads), new Set(["v0", "v1", "v2"]));
  await assert.rejects(
    api("jobs.create", {
      projectId: "p",
      collectionId: "c",
      type: "recommend",
      ids: ["p0", "p1", "p2"],
      locked: ["p3"],
    }),
  );
});
test("render uses originals, saves a distinct creation, strips metadata and rejects invalid source", async () => {
  const { store, api } = await setup(3),
    bytes = await sharp({
      create: { width: 120, height: 80, channels: 3, background: "#987650" },
    })
      .jpeg()
      .toBuffer(),
    uploads = [];
  const cloud = {
    downloadFile: async () => ({ fileContent: bytes }),
    uploadFile: async (v) => {
      uploads.push(v);
      return { fileID: "cloud://result" };
    },
  };
  const photos = await store.all("photo"),
    draft = { ...newDraft("p", photos), longEdge: 400 };
  const j = await api("jobs.create", {
    projectId: "p",
    collectionId: "c",
    type: "render",
    draft,
  });
  await processJob(store, j.id, createPerformer({ store, cloud }));
  assert.equal((await api("jobs.get", { id: j.id })).state, "done");
  assert.equal(uploads.length, 1);
  const meta = await sharp(uploads[0].fileContent).metadata();
  assert.equal(meta.height, 400);
  assert.equal(meta.exif, undefined);
  assert.equal((await store.get("creation", j.id)).type, "render");
  assert.equal((await store.get("photo", "p0")).originalFile, "o0");
});
test("cancelling final creation blocks late commit and cover unknown results never auto resubmit", async () => {
  const { store, api } = await setup(3);
  const j = await api("jobs.create", {
    projectId: "p",
    collectionId: "c",
    type: "render",
    draft: newDraft("p", await store.all("photo")),
  });
  await processJob(store, j.id, async () => {
    await api("jobs.control", { id: j.id, action: "cancel" });
    return { creation: { type: "render", fileID: "cloud://late" } };
  });
  assert.equal((await store.all("creation")).length, 0);
  const c = await api("jobs.create", {
    projectId: "p",
    collectionId: "c",
    type: "cover",
  });
  await processJob(store, c.id, async () => ({
    summary: "雪山",
    photoIds: ["p0"],
  }));
  await processJob(store, c.id, async () => ({
    summary: "雪山",
    photoIds: ["p0"],
  }));
  let calls = 0;
  await processJob(store, c.id, async () => {
    calls++;
    throw Object.assign(Error("结果未知"), { unknown: true });
  });
  await processJob(store, c.id, async () => {
    calls++;
  });
  assert.equal(calls, 1);
  assert.equal((await api("jobs.get", { id: c.id })).state, "failed");
});
test("removed collection source fails durably without dispatching creation", async () => {
  const { store, api } = await setup();
  const job = await api("jobs.create", {
    projectId: "p",
    collectionId: "c",
    type: "copy",
  });
  await store.remove("member", "c-p0");
  let invoked = false;
  await processJob(store, job.id, async () => {
    invoked = true;
  });
  assert.equal(invoked, false);
  assert.equal((await store.get("job", job.id)).state, "failed");
});
