const { call, toast, hydrate } = require("../../utils/api");
const { tagsOf, DEFAULT_TAGS, TAG_CATEGORIES } = require("../../utils/domain");
Page({
  data: {
    collections: [],
    collectionId: "",
    tab: "photos",
    unassigned: true,
    photos: [],
    creations: [],
    selected: [],
    total: 0,
    filterOpen: false,
    filter: { tags: [], tagMode: "all" },
    domains: [],
    description: "",
    name: "",
    busy: false,
    error: "",
  },
  onLoad(q) {
    this.projectId = q.id;
    this.setData({ projectId: q.id });
    this.loadLibrary();
  },
  onShow() {
    this.load(true);
  },
  async loadLibrary() {
    try {
      const lib = await call("tags.library", { projectId: this.projectId });
      this.library = lib.tags;
      this.domains();
    } catch (e) {
      toast(e);
    }
  },
  domains() {
    this.setData({
      domains: TAG_CATEGORIES.map((name) => ({
        name,
        selected: this.data.filter.tags.filter((v) =>
          (this.library || DEFAULT_TAGS).some(
            (t) => t.category === name && t.name === v,
          ),
        ).length,
        options: (this.library || DEFAULT_TAGS)
          .filter((t) => t.category === name)
          .map((t) => ({
            ...t,
            selected: this.data.filter.tags.includes(t.name),
          })),
      })),
    });
  },
  async load(reset) {
    if (this.data.busy) {
      if (reset) this.reloadPending = true;
      return;
    }
    this.reloadPending = false;
    this.setData({ busy: true, error: "" });
    try {
      const collections = await call("collections.list", {
        projectId: this.projectId,
      });
      this.setData({ collections });
      if (this.data.tab === "creations" && this.data.collectionId) {
        const creations = await call("creations.list", {
          projectId: this.projectId,
          collectionId: this.data.collectionId,
        });
        if (!this.reloadPending) this.setData({ creations });
      } else {
        const before = reset ? [] : this.data.photos;
        const r = await call("collections.photos", {
          projectId: this.projectId,
          collectionId: this.data.collectionId || undefined,
          unassigned: this.data.unassigned,
          filter: this.data.filter,
          offset: before.length,
        });
        const photos = before.concat(
          (await hydrate(r.photos)).map((p) => ({
            ...p,
            tags: tagsOf(p),
            selected: this.data.selected.includes(p.id),
          })),
        );
        if (!this.reloadPending) this.setData({ photos, total: r.total });
      }
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ busy: false });
      if (this.reloadPending) this.load(true);
    }
  },
  retry() {
    this.load(true);
  },
  onReachBottom() {
    if (this.data.tab === "photos" && this.data.photos.length < this.data.total)
      this.load(false);
  },
  stage(e) {
    getApp().globalData.libraryStage = e.currentTarget.dataset.stage;
    wx.navigateBack();
  },
  choose(e) {
    const id = e.currentTarget.dataset.id || "",
      c = this.data.collections.find((c) => c.id === id);
    this.setData({
      collectionId: id,
      name: c ? c.name : "",
      description: c ? c.description : "",
      selected: [],
      tab: "photos",
    });
    this.load(true);
  },
  async create() {
    try {
      const r = await wx.showModal({
        title: "新建作品集",
        editable: true,
        placeholderText: "作品集名称",
      });
      if (!r.confirm || !r.content.trim()) return;
      const c = await call("collections.create", {
        projectId: this.projectId,
        name: r.content,
      });
      this.setData({
        collectionId: c.id,
        name: c.name,
        description: "",
        selected: [],
      });
      await this.load(true);
    } catch (e) {
      toast(e);
    }
  },
  async edit() {
    try {
      const r = await wx.showModal({
        title: "作品集描述",
        editable: true,
        content: this.data.description,
        placeholderText: "这段旅行的故事或创作方向",
      });
      if (!r.confirm) return;
      await call("collections.update", {
        projectId: this.projectId,
        collectionId: this.data.collectionId,
        description: r.content,
      });
      this.setData({ description: r.content });
    } catch (e) {
      toast(e);
    }
  },
  tab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    this.load(true);
  },
  scope() {
    this.setData({ unassigned: !this.data.unassigned, selected: [] });
    this.load(true);
  },
  select(e) {
    const id = e.currentTarget.dataset.id,
      selected = this.data.selected.includes(id)
        ? this.data.selected.filter((v) => v !== id)
        : this.data.selected.concat(id);
    this.setData({
      selected,
      photos: this.data.photos.map((p) => ({
        ...p,
        selected: selected.includes(p.id),
      })),
    });
  },
  async view(e) {
    try {
      const p = this.data.photos.find(
          (p) => p.id === e.currentTarget.dataset.id,
        ),
        [v] = await hydrate([p], "preview");
      await wx.previewImage({ urls: [v.url] });
    } catch (e) {
      toast(e);
    }
  },
  async add() {
    if (!this.data.selected.length) return;
    try {
      const c = this.data.collections;
      if (!c.length) {
        toast("请先新建作品集");
        return;
      }
      const r = await wx.showActionSheet({ itemList: c.map((c) => c.name) });
      await call("members.add", {
        projectId: this.projectId,
        collectionId: c[r.tapIndex].id,
        ids: this.data.selected,
      });
      this.setData({ selected: [] });
      this.load(true);
    } catch (e) {
      if (!/cancel/.test(e.errMsg || "")) toast(e);
    }
  },
  async remove() {
    try {
      await call("members.remove", {
        projectId: this.projectId,
        collectionId: this.data.collectionId,
        ids: this.data.selected,
      });
      this.setData({ selected: [] });
      this.load(true);
    } catch (e) {
      toast(e);
    }
  },
  studio() {
    getApp().globalData.studioSelection = this.data.selected;
    wx.navigateTo({
      url:
        "/pages/studio/index?id=" +
        this.projectId +
        "&collection=" +
        this.data.collectionId,
    });
  },
  async generate(e) {
    try {
      const type = e.currentTarget.dataset.type;
      await call("jobs.create", {
        projectId: this.projectId,
        collectionId: this.data.collectionId,
        type,
      });
      this.selectComponent("#tasks").poll();
    } catch (e) {
      toast(e);
    }
  },
  progress(e) {
    const done = e.detail.jobs.filter((j) => j.state === "done").length;
    if (this.lastDone !== undefined && done !== this.lastDone) this.load(true);
    this.lastDone = done;
  },
  filters() {
    this.setData({ filterOpen: !this.data.filterOpen });
  },
  domain(e) {
    this.setData({
      openDomain:
        this.data.openDomain === e.currentTarget.dataset.name
          ? ""
          : e.currentTarget.dataset.name,
    });
  },
  tag(e) {
    const t = e.currentTarget.dataset.tag,
      values = this.data.filter.tags;
    this.setData({
      "filter.tags": values.includes(t)
        ? values.filter((v) => v !== t)
        : values.concat(t),
    });
    this.domains();
  },
  mode() {
    this.setData({
      "filter.tagMode": this.data.filter.tagMode === "all" ? "any" : "all",
    });
  },
  apply() {
    this.setData({ filterOpen: false, selected: [] });
    this.load(true);
  },
  async download(e) {
    try {
      const c = this.data.creations.find(
        (c) => c.id === e.currentTarget.dataset.id,
      );
      if (c.type === "copy") {
        wx.setClipboardData({ data: c.title + "\n" + c.body });
        return;
      }
      const { tempFilePath } = await wx.cloud.downloadFile({
        fileID: c.fileID,
      });
      await wx.saveImageToPhotosAlbum({ filePath: tempFilePath });
      toast("已保存到相册");
    } catch (e) {
      toast(e);
    }
  },
  async editCopy(e) {
    const c = this.data.creations.find(
      (c) => c.id === e.currentTarget.dataset.id,
    );
    this.setData({ editing: c });
  },
  copyInput(e) {
    this.setData({ "editing.body": e.detail.value });
  },
  closeEdit() {
    this.setData({ editing: null });
  },
  async saveCopy() {
    try {
      await call("creations.edit", {
        projectId: this.projectId,
        ...this.data.editing,
      });
      this.closeEdit();
      this.load(true);
    } catch (e) {
      toast(e);
    }
  },
  async viewCreation(e) {
    const c = this.data.creations.find(
      (c) => c.id === e.currentTarget.dataset.id,
    );
    if (c.url) wx.previewImage({ urls: [c.url] });
  },
  async references(e) {
    const c = this.data.creations.find(
      (c) => c.id === e.currentTarget.dataset.id,
    );
    try {
      const ids = (c.referenceIds || c.sourceIds || []).slice(0, 60),
        photos = await call("photos.get", { projectId: this.projectId, ids });
      const rows = await hydrate(photos, "preview");
      wx.previewImage({ urls: rows.map((p) => p.url) });
    } catch (e) {
      toast(e);
    }
  },
});
