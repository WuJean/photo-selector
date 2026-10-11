const { TAG_CATEGORIES } = require("../../utils/domain");
const { call, toast } = require("../../utils/api");
Page({
  data: { tags: [], busy: false, job: null, extra: "", settings: {} },
  async onLoad(q) {
    this.projectId = q.id;
    this.setData({ projectId: q.id });
    this.ids = q.ids
      ? q.ids.split(",")
      : getApp().globalData.classifyIds || null;
    delete getApp().globalData.classifyIds;
    this.jobId = q.job;
    try {
      const [lib, settings] = await Promise.all([
        call("tags.library", { projectId: q.id }),
        call("settings.status"),
      ]);
      this.setData({
        tags: lib.tags.map((t) => ({ ...t, enabled: true })),
        settings,
      });
      this.domains();
      if (this.jobId) this.readJob();
    } catch (e) {
      toast(e);
    }
  },
  onUnload() {
    clearTimeout(this.timer);
    this.gone = true;
  },
  async readJob() {
    clearTimeout(this.timer);
    if (this.gone) return;
    try {
      const job = await call("jobs.get", { id: this.jobId });
      this.setData({
        job,
        ...(job.state === "confirmation"
          ? { tags: job.candidates.map((t) => ({ ...t, enabled: true })) }
          : {}),
      });
      this.domains();
      if (
        !["done", "failed", "cancelled", "confirmation", "paused"].includes(
          job.state,
        )
      )
        this.timer = setTimeout(() => this.readJob(), 3000);
    } catch (e) {
      toast(e);
    }
  },
  progress(e) {
    const job = e.detail.jobs.find((j) => j.id === this.jobId);
    if (job && job.state !== this.data.job?.state) this.readJob();
  },
  domains() {
    this.setData({
      domains: TAG_CATEGORIES.map((name) => ({
        name,
        tags: this.data.tags
          .map((t, index) => ({ ...t, index }))
          .filter((t) => t.category === name),
      })),
    });
  },
  refine() {
    this.setData({ refining: !this.data.refining });
  },
  advanced() {
    this.setData({ advanced: !this.data.advanced });
  },
  async concurrency(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ["settings." + key]: Number(e.detail.value) });
    try {
      await call("settings.save", this.data.settings);
    } catch (e) {
      toast(e);
    }
  },
  toggle(e) {
    const i = e.currentTarget.dataset.index;
    if (["主体", "景别"].includes(this.data.tags[i].category)) return;
    this.setData({
      tags: this.data.tags.map((t, n) =>
        n === i ? { ...t, enabled: !t.enabled } : t,
      ),
    });
    this.domains();
  },
  extra(e) {
    this.setData({ extra: e.detail.value });
  },
  add() {
    const names = this.data.extra.split(/[，,、\s]+/).filter(Boolean);
    this.setData({
      tags: this.data.tags.concat(
        names
          .filter((name) => !this.data.tags.some((t) => t.name === name))
          .map((name) => ({
            name,
            description: name,
            category: "其他",
            enabled: true,
          })),
      ),
      extra: "",
    });
    this.domains();
  },
  async start(e) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const job = await call("jobs.create", {
        projectId: this.projectId,
        ids: this.ids || undefined,
        type: e.currentTarget.dataset.type,
        force: !!e.currentTarget.dataset.force,
        tags: this.data.tags.filter((t) => t.enabled),
      });
      this.jobId = job.id;
      this.setData({ job });
      if (job.id) this.readJob();
      else toast(job.message);
    } catch (e) {
      toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async confirm() {
    this.setData({ busy: true });
    try {
      const job = await call("jobs.confirm", {
        id: this.jobId,
        tags: this.data.tags.filter((t) => t.enabled),
      });
      this.jobId = job.id;
      this.setData({ job });
      if (job.id) this.readJob();
      else toast(job.message);
    } catch (e) {
      toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
});
