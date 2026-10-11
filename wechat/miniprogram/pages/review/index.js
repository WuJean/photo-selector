const { call, toast, hydrate } = require("../../utils/api");
const { tagsOf } = require("../../utils/domain");
Page({
  data: {
    current: null,
    neighbors: [],
    index: 0,
    total: 0,
    zoom: 1,
    saving: false,
    stage: "rough",
    done: false,
  },
  onLoad() {
    const q = getApp().globalData.review;
    if (!q) {
      wx.navigateBack();
      return;
    }
    this.context = q;
    this.photos = q.photos.slice();
    this.history = [];
    this.setData({ stage: q.stage, total: q.total });
    this.show(
      Math.max(
        0,
        this.photos.findIndex((p) => p.id === q.startId),
      ),
    );
  },
  async show(index) {
    const request = (this.request || 0) + 1;
    this.request = request;
    if (index >= this.photos.length) {
      await this.more();
    }
    if (index < 0 || index >= this.photos.length) {
      this.setData({ done: true, current: null, neighbors: [] });
      return;
    }
    this.setData({ index, zoom: 1, done: false, imageFailed: false });
    const p = this.photos[index];
    try {
      const rows = await hydrate(
        this.photos.slice(Math.max(0, index - 1), index + 2),
        "preview",
      );
      if (this.request !== request) return;
      this.setData({
        current: {
          ...p,
          url: rows.find((v) => v.id === p.id)?.url,
          tags: tagsOf(p),
        },
        neighbors: rows.map((v) => ({
          ...v,
          main: v.id === p.id,
          side:
            this.photos.findIndex((x) => x.id === v.id) < index
              ? "left"
              : "right",
          blur: v.id !== p.id && (!p.similarId || v.similarId !== p.similarId),
        })),
      });
    } catch (e) {
      toast(e);
    }
  },
  async more() {
    if (this.photos.length >= this.context.total) return;
    const rows = await call("photos.get", {
      projectId: this.context.projectId,
      ids: this.context.ids.slice(this.photos.length, this.photos.length + 60),
    });
    this.photos.push(...rows);
  },
  next() {
    if (!this.data.saving) this.show(this.data.index + 1);
  },
  prev() {
    if (!this.data.saving) this.show(Math.max(0, this.data.index - 1));
  },
  choose(e) {
    if (this.data.saving) return;
    const id = e.currentTarget.dataset.id;
    this.show(this.photos.findIndex((p) => p.id === id));
  },
  imageError() {
    this.setData({ imageFailed: true });
  },
  async retryImage() {
    this.setData({ imageFailed: false });
    await this.show(this.data.index);
  },
  scale(e) {
    this.setData({ zoom: e.detail.scale });
  },
  reset() {
    this.setData({ zoom: 1 });
  },
  original() {
    call("files.urls", { ids: [this.data.current.id], variant: "original" })
      .then((r) => wx.previewImage({ urls: [r[0].url] }))
      .catch(toast);
  },
  start(e) {
    this.touchX = e.touches[0].clientX;
    this.multi = e.touches.length > 1;
  },
  move(e) {
    if (e.touches.length > 1) this.multi = true;
  },
  end(e) {
    if (this.multi || this.data.zoom > 1) return;
    const delta = e.changedTouches[0].clientX - this.touchX;
    if (Math.abs(delta) > 60) delta < 0 ? this.next() : this.prev();
  },
  async decide(e) {
    if (this.data.saving) return;
    const p = this.photos[this.data.index];
    this.setData({ saving: true });
    try {
      const r = await call("photos.decide", {
        projectId: this.context.projectId,
        id: p.id,
        revision: p.revision,
        round: this.data.stage === "rough" ? "initial" : "final",
        value: e.currentTarget.dataset.value,
        operationId:
          "op-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      });
      this.history.push({ id: r.historyId, index: this.data.index });
      const key = "undo:" + this.context.projectId;
      wx.setStorageSync(
        key,
        (wx.getStorageSync(key) || []).concat(r.historyId).slice(-30),
      );
      this.photos[this.data.index] = { ...p, ...r.photo };
      await this.show(this.data.index + 1);
    } catch (e) {
      toast(e);
    } finally {
      this.setData({ saving: false });
    }
  },
  async undo() {
    if (this.data.saving || !this.history.length) return;
    const h = this.history[this.history.length - 1];
    this.setData({ saving: true });
    try {
      const r = await call("photos.undo", {
        projectId: this.context.projectId,
        historyId: h.id,
      });
      this.history.pop();
      const key = "undo:" + this.context.projectId;
      wx.setStorageSync(
        key,
        (wx.getStorageSync(key) || []).filter((id) => id !== h.id),
      );
      this.photos[h.index] = { ...this.photos[h.index], ...r.photo };
      await this.show(h.index);
    } catch (e) {
      toast(e);
    } finally {
      this.setData({ saving: false });
    }
  },
  exit() {
    wx.navigateBack();
  },
});
