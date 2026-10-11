const { call, toast, hydrate } = require("../../utils/api");
const {
  visibleCards,
  DEFAULT_TAGS,
  TAG_CATEGORIES,
  FOCAL_LABELS,
  tagsOf,
} = require("../../utils/domain");
const uploads = require("../../utils/upload");
Page({
  data: {
    photos: [],
    cards: [],
    stage: "rough",
    processed: false,
    counts: {},
    total: 0,
    pageOffset: 0,
    pageNumber: 1,
    pageCount: 1,
    error: "",
    loading: false,
    more: true,
    uploading: false,
    uploadDone: 0,
    uploadTotal: 0,
    uploadFailures: 0,
    filterOpen: false,
    filter: { tags: [], tagMode: "all" },
    domains: [],
    focals: ["全部焦段", ...FOCAL_LABELS],
    expanded: [],
    selected: [],
    choosing: false,
  },
  onLoad(q) {
    this.projectId = q.id;
    this.setData({ projectId: q.id });
    this.history = wx.getStorageSync("undo:" + q.id) || [];
    this.refreshDomains();
  },
  onShow() {
    this.history = wx.getStorageSync("undo:" + this.projectId) || [];
    this.stopped = false;
    if (getApp().globalData.libraryStage) {
      this.setData({
        stage: getApp().globalData.libraryStage,
        processed: false,
        pageOffset: 0,
      });
      delete getApp().globalData.libraryStage;
    }
    this.load(true, this.data.pageOffset);
    call("tags.library", { projectId: this.projectId })
      .then((lib) => {
        this.libraryTags = lib.tags;
        this.refreshDomains();
      })
      .catch(() => {});
    this.uploadProgress(uploads.read(this.projectId));
  },
  onHide() {
    this.stopped = true;
  },
  onUnload() {
    this.stopped = true;
  },
  refreshDomains() {
    this.setData({
      domains: TAG_CATEGORIES.map((name) => ({
        name,
        selected: this.data.filter.tags.filter((tag) =>
          (this.libraryTags || DEFAULT_TAGS).some(
            (t) => t.category === name && t.name === tag,
          ),
        ).length,
        options: (this.libraryTags || DEFAULT_TAGS)
          .filter((t) => t.category === name)
          .map((t) => ({
            ...t,
            selected: this.data.filter.tags.includes(t.name),
          })),
      })),
    });
  },
  async taskProgress(e) {
    const n = e.detail.jobs.reduce((n, j) => n + j.completed, 0);
    if (
      this.lastProgress !== undefined &&
      n !== this.lastProgress &&
      !this.data.loading
    ) {
      try {
        const rows = [];
        const ids = this.data.photos.map((p) => p.id);
        for (let start = 0; start < ids.length; start += 60)
          rows.push(
            ...(await call("photos.get", {
              projectId: this.projectId,
              ids: ids.slice(start, start + 60),
            })),
          );
        const updated = new Map(rows.map((p) => [p.id, p]));
        const photos = this.data.photos.map((p) => ({
          ...p,
          ...updated.get(p.id),
          tags: tagsOf(updated.get(p.id) || p),
        }));
        this.setData({
          photos,
          cards: visibleCards(photos, this.data.expanded),
        });
      } catch (e) {
        toast(e);
      }
    }
    this.lastProgress = n;
  },
  async load(reset = false, targetOffset) {
    if (this.data.loading) {
      if (reset) this.reloadPending = true;
      return;
    }
    this.reloadPending = false;
    this.setData({ loading: true, error: "" });
    try {
      const offset = Number.isFinite(targetOffset)
        ? targetOffset
        : reset
          ? 0
          : this.data.pageOffset + 60;
      const result = await call("photos.query", {
        projectId: this.projectId,
        stage: this.data.stage,
        processed: this.data.processed,
        filter: this.data.filter,
        offset,
      });
      if (this.reloadPending) return;
      if (result.ids) this.reviewIds = result.ids;
      const photos = (await hydrate(result.photos)).map((p) => ({
        ...p,
        tags: tagsOf(p),
      }));
      if (this.reloadPending) return;
      this.setData({
        photos,
        cards: visibleCards(photos, this.data.expanded),
        total: result.total,
        counts: result.counts,
        pageOffset: offset,
        pageNumber: Math.floor(offset / 60) + 1,
        pageCount: Math.max(1, Math.ceil(result.total / 60)),
        selected: [],
        more: offset + photos.length < result.total,
      });
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
      if (this.reloadPending) this.load(true);
    }
  },
  async nextPage() {
    if (this.data.more && !this.data.loading) {
      await this.load(false);
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    }
  },
  async prevPage() {
    if (this.data.pageOffset && !this.data.loading) {
      await this.load(false, Math.max(0, this.data.pageOffset - 60));
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    }
  },
  retry() {
    this.load(true);
  },
  stage(e) {
    const stage = e.currentTarget.dataset.stage;
    if (stage === "portfolio") {
      wx.navigateTo({ url: "/pages/portfolio/index?id=" + this.projectId });
      return;
    }
    this.setData({ stage, processed: false, selected: [] });
    this.load(true);
  },
  processed() {
    this.setData({ processed: !this.data.processed });
    this.load(true);
  },
  domain(e) {
    this.setData({
      openDomain:
        this.data.openDomain === e.currentTarget.dataset.name
          ? ""
          : e.currentTarget.dataset.name,
    });
  },
  filters() {
    this.setData({ filterOpen: !this.data.filterOpen });
  },
  tag(e) {
    const tag = e.currentTarget.dataset.tag;
    let tags = this.data.filter.tags;
    tags = tags.includes(tag)
      ? tags.filter((t) => t !== tag)
      : tags.concat(tag);
    this.setData({ "filter.tags": tags });
    this.refreshDomains();
  },
  mode() {
    this.setData({
      "filter.tagMode": this.data.filter.tagMode === "all" ? "any" : "all",
    });
  },
  focal(e) {
    this.setData({
      "filter.focal": Number(e.detail.value)
        ? FOCAL_LABELS[Number(e.detail.value) - 1]
        : "",
    });
  },
  orientation(e) {
    this.setData({ "filter.orientation": e.currentTarget.dataset.value });
  },
  applyFilters() {
    this.setData({ filterOpen: false, selected: [] });
    this.load(true);
  },
  clearFilters() {
    this.setData({ filter: { tags: [], tagMode: "all" } });
    this.refreshDomains();
  },
  group(e) {
    const id = e.currentTarget.dataset.id,
      expanded = this.data.expanded.includes(id)
        ? this.data.expanded.filter((v) => v !== id)
        : this.data.expanded.concat(id);
    this.setData({ expanded, cards: visibleCards(this.data.photos, expanded) });
  },
  foldAll() {
    const expanded = this.data.expanded.length
      ? []
      : this.data.photos.map((p) => p.similarId || p.id);
    this.setData({ expanded, cards: visibleCards(this.data.photos, expanded) });
  },
  selectMode() {
    this.setData({ choosing: !this.data.choosing, selected: [] });
  },
  open(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.choosing) {
      const selected = this.data.selected.includes(id)
        ? this.data.selected.filter((v) => v !== id)
        : this.data.selected.concat(id);
      this.setData({
        selected,
        cards: this.data.cards.map((p) => ({
          ...p,
          selected: selected.includes(p.id),
        })),
      });
      return;
    }
    getApp().globalData.review = {
      projectId: this.projectId,
      photos: this.data.photos,
      ids: this.reviewIds,
      startId: id,
      stage: this.data.stage,
      processed: this.data.processed,
      filter: this.data.filter,
      total: this.data.total,
    };
    wx.navigateTo({ url: "/pages/review/index" });
  },
  async details(e) {
    const p = this.data.photos.find((p) => p.id === e.currentTarget.dataset.id);
    if (!p) return;
    const focal = p.focal
      ? p.focal +
        " mm" +
        (p.focalEquivalent ? "（等效 " + p.focalEquivalent + " mm）" : "")
      : "焦距未知";
    wx.showModal({
      title: p.name,
      content: [
        p.width + " × " + p.height,
        p.takenAt || "拍摄时间未知",
        p.camera,
        p.lens,
        focal,
        p.aperture ? "f/" + p.aperture : "",
        p.iso ? "ISO " + p.iso : "",
        p.shutter ? p.shutter + " 秒" : "",
        p.ai?.description || "",
      ]
        .filter(Boolean)
        .join("\n"),
      showCancel: false,
    });
  },
  date(e) {
    this.setData({ ["filter." + e.currentTarget.dataset.key]: e.detail.value });
  },
  favorites() {
    this.setData({ "filter.favorite": !this.data.filter.favorite });
  },
  async selectedActions() {
    const ids = this.data.selected;
    if (!ids.length) return;
    try {
      const choice = await wx.showActionSheet({
        itemList: ["合并相似组", "拆开相似组", "标为喜欢", "取消喜欢"],
      });
      if (choice.tapIndex < 2) {
        await call("photos.group", {
          projectId: this.projectId,
          ids,
          split: choice.tapIndex === 1,
        });
      } else {
        for (const id of ids) {
          const p = this.data.photos.find((p) => p.id === id);
          const r = await call("photos.favorite", {
            projectId: this.projectId,
            id,
            revision: p.revision,
            value: choice.tapIndex === 2,
            operationId:
              "op-" + Date.now() + "-" + Math.random().toString(36).slice(2),
          });
          this.history.push(r.historyId);
        }
        wx.setStorageSync("undo:" + this.projectId, this.history.slice(-30));
      }
      this.setData({ selected: [], choosing: false });
      await this.load(true);
    } catch (e) {
      if (!/cancel/.test(e.errMsg || "")) toast(e);
    }
  },
  async imageError(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      cards: this.data.cards.map((p) =>
        p.id === id ? { ...p, imageError: true } : p,
      ),
    });
  },
  async retryImage(e) {
    try {
      const id = e.currentTarget.dataset.id,
        p = this.data.photos.find((p) => p.id === id);
      await call("photos.repair", { projectId: this.projectId, id });
      const [next] = await hydrate([p]);
      this.setData({
        cards: this.data.cards.map((p) =>
          p.id === id ? { ...p, ...next } : p,
        ),
      });
    } catch (e) {
      toast(e);
    }
  },
  uploadProgress(rows) {
    this.setData({
      uploadTotal: rows.length,
      uploadDone: rows.filter((v) => v.state === "done").length,
      uploadFailures: rows.filter((v) => v.state === "error").length,
    });
  },
  async resumeUpload() {
    if (this.data.uploading) return;
    this.setData({ uploading: true });
    try {
      await uploads.run(
        this.projectId,
        (rows) => this.uploadProgress(rows),
        () => this.stopped,
      );
      await call("photos.regroup", { projectId: this.projectId });
      await this.load(true);
    } catch (e) {
      toast(e);
    } finally {
      this.setData({ uploading: false });
    }
  },
  async upload() {
    try {
      const r = await wx.chooseMedia({
        count: 9,
        mediaType: ["image"],
        sourceType: ["album"],
        sizeType: ["original"],
      });
      await uploads.add(this.projectId, r.tempFiles);
      this.resumeUpload();
    } catch (e) {
      if (!/cancel/.test(e.errMsg || "")) toast(e);
    }
  },
  async decide(e) {
    if (this.saving) return;
    const p = this.data.photos.find((p) => p.id === e.currentTarget.dataset.id);
    this.saving = true;
    try {
      const r = await call("photos.decide", {
        projectId: this.projectId,
        id: p.id,
        round: this.data.stage === "rough" ? "initial" : "final",
        value: e.currentTarget.dataset.value,
        revision: p.revision,
        operationId:
          "op-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      });
      this.history.push(r.historyId);
      wx.setStorageSync("undo:" + this.projectId, this.history.slice(-30));
      await this.load(true, this.data.pageOffset);
    } catch (e) {
      toast(e);
    } finally {
      this.saving = false;
    }
  },
  async undo() {
    const h = this.history[this.history.length - 1];
    if (!h) return;
    try {
      await call("photos.undo", { projectId: this.projectId, historyId: h });
      this.history.pop();
      wx.setStorageSync("undo:" + this.projectId, this.history);
      await this.load(true);
    } catch (e) {
      toast(e);
    }
  },
  ai() {
    getApp().globalData.classifyIds = this.data.selected.length
      ? this.data.selected
      : this.reviewIds;
    wx.navigateTo({ url: "/pages/classify/index?id=" + this.projectId });
  },
});
