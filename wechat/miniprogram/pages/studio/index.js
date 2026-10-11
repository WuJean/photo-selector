const { call, toast, hydrate } = require("../../utils/api");
const {
  TEMPLATES,
  RATIOS,
  canvasSize,
  layoutRects,
  imagePlacement,
  slotFor,
  newDraft,
  PAIRING_SUBJECTS,
  PAIRING_SHOTS,
} = require("../../utils/domain");
Page({
  data: {
    draft: null,
    tiles: [],
    canvasStyle: "",
    photos: [],
    presets: [],
    presetIndex: 0,
    templateNames: Object.values(TEMPLATES).map((t) => t.label),
    templateKeys: Object.keys(TEMPLATES),
    ratios: Object.keys(RATIOS),
    ratioIndex: 1,
    frames: ["无相框", "细边", "留白", "参数底栏"],
    frameKeys: ["none", "thin", "white", "caption"],
    active: 0,
    slot: null,
    replaceOpen: false,
    prompt: "",
    busy: false,
    collections: [],
    proposal: null,
    subjectOptions: ["任意主体", ...PAIRING_SUBJECTS],
    shotOptions: ["任意景别", ...PAIRING_SHOTS],
    editor: null,
    scopeName: "全部精筛入选",
    error: "",
  },
  async onLoad(q) {
    this.projectId = q.id;
    this.collectionId = q.collection || null;
    this.ids = getApp().globalData.studioSelection || [];
    delete getApp().globalData.studioSelection;
    this.setData({
      projectId: q.id,
      scopeName: this.collectionId
        ? "当前作品集"
        : this.ids.length
          ? "所选照片"
          : "全部精筛入选",
    });
    await this.load();
  },
  onUnload() {
    this.gone = true;
  },
  async load() {
    try {
      const scope = {
        projectId: this.projectId,
        collectionId: this.collectionId,
      };
      const [draft, presets, collections] = await Promise.all([
        call("drafts.get", scope),
        call("presets.list", { projectId: this.projectId }),
        call("collections.list", { projectId: this.projectId }),
      ]);
      const all = [];
      let offset = 0;
      for (;;) {
        const r = await call("collections.photos", {
          ...scope,
          unassigned: false,
          offset,
        });
        all.push(...r.photos);
        offset += r.photos.length;
        if (offset >= r.total) break;
      }
      this.available = this.ids.length
        ? all.filter((p) => this.ids.includes(p.id))
        : all;
      this.byId = {};
      this.available.forEach((p) => (this.byId[p.id] = p));
      draft.slots = draft.slots.filter((s) => this.byId[s.photoId]);
      this.setData({
        draft,
        presets,
        collections,
        ratioIndex: this.data.ratios.indexOf(draft.ratio),
        templateIndex: this.data.templateKeys.indexOf(draft.template),
        frameIndex: this.data.frameKeys.indexOf(draft.frame),
      });
      await this.refresh();
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  async refresh() {
    const d = this.data.draft;
    if (!d) return;
    const missing = d.slots
      .map((s) => this.byId[s.photoId])
      .filter((p) => p && !p.url);
    for (const p of await hydrate(missing, "preview")) this.byId[p.id] = p;
    if (d.watermark.assetId && !this.logoAsset) {
      this.logoAsset = await call("assets.get", {
        id: d.watermark.assetId,
        projectId: this.projectId,
      });
      this.setData({ logoURL: this.logoAsset.url });
    }
    const size = canvasSize(d.ratio, 680),
      rects = layoutRects(d.template, size.width, size.height, d.gap, d.frame);
    const tiles = rects.map((r, i) => {
      const s = d.slots[i],
        p = s && this.byId[s.photoId];
      const pos = p ? imagePlacement(p, r, s) : null;
      return {
        index: i,
        url: p && p.url,
        locked: s && s.locked,
        style: `left:${r.x}rpx;top:${r.y}rpx;width:${r.width}rpx;height:${r.height}rpx;`,
        imageStyle: pos
          ? `left:${pos.left}rpx;top:${pos.top}rpx;width:${pos.width}rpx;height:${pos.height}rpx;`
          : "",
      };
    });
    const wm = d.watermark;
    this.setData({
      tiles,
      canvasStyle: `width:${size.width}rpx;height:${size.height}rpx;background:${d.background}`,
      slot: d.slots[this.data.active] || null,
      logoStyle: this.logoAsset
        ? `width:${Math.min(size.width * Math.min(0.3, wm.size * 5), (size.height * 0.15 * this.logoAsset.width) / this.logoAsset.height)}rpx;height:${Math.min(size.height * 0.15, (size.width * Math.min(0.3, wm.size * 5) * this.logoAsset.height) / this.logoAsset.width)}rpx;opacity:${wm.opacity};${wm.position.includes("r") ? "right" : "left"}:${Math.min(size.width, size.height) * wm.margin}rpx;${wm.position.startsWith("b") ? "bottom" : "top"}:${Math.min(size.width, size.height) * wm.margin}rpx;`
        : "",
      watermarkStyle: `font-size:${Math.max(10, size.width * wm.size)}rpx;color:${wm.color};opacity:${wm.opacity};${wm.position.includes("r") ? "right" : "left"}:${size.width * wm.margin}rpx;${wm.position.startsWith("b") ? "bottom" : "top"}:${size.height * wm.margin}rpx;`,
    });
  },
  active(e) {
    this.setData({ active: Number(e.currentTarget.dataset.index) });
    this.refresh();
  },
  async saveDraft() {
    const draft = JSON.parse(JSON.stringify(this.data.draft));
    this.pendingSave = (this.pendingSave || Promise.resolve())
      .catch(() => {})
      .then(() =>
        call("drafts.save", {
          projectId: this.projectId,
          collectionId: this.collectionId,
          draft,
        }),
      );
    await this.pendingSave;
  },
  async logo() {
    try {
      const { tempFiles } = await wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album"],
        sizeType: ["original"],
      });
      const file = tempFiles[0],
        ticket = await call("assets.prepare", {
          projectId: this.projectId,
          size: file.size,
        });
      const { fileID } = await wx.cloud.uploadFile({
        cloudPath: ticket.cloudPath,
        filePath: file.tempFilePath,
      });
      const asset = await call("assets.finish", { id: ticket.id, fileID });
      this.logoAsset = asset;
      this.setData({ "draft.watermark.assetId": asset.id, logoURL: asset.url });
      this.persist();
    } catch (e) {
      if (!/cancel/.test(e.errMsg || "")) toast(e);
    }
  },
  removeLogo() {
    this.logoAsset = null;
    this.setData({ "draft.watermark.assetId": null, logoURL: "" });
    this.persist();
  },
  async persist() {
    try {
      await this.refresh();
      await this.saveDraft();
    } catch (e) {
      toast(e);
    }
  },
  template(e) {
    const template = this.data.templateKeys[Number(e.detail.value)];
    this.setData({
      "draft.template": template,
      "draft.slots": this.data.draft.slots.slice(0, TEMPLATES[template].count),
      templateIndex: Number(e.detail.value),
      active: 0,
    });
    this.persist();
  },
  ratio(e) {
    this.setData({
      "draft.ratio": this.data.ratios[Number(e.detail.value)],
      ratioIndex: Number(e.detail.value),
    });
    this.persist();
  },
  frame(e) {
    this.setData({
      "draft.frame": this.data.frameKeys[Number(e.detail.value)],
      frameIndex: Number(e.detail.value),
    });
    this.persist();
  },
  gap(e) {
    this.setData({ "draft.gap": Number(e.detail.value) / 1000 });
    this.persist();
  },
  background(e) {
    const v = e.detail.value;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      this.setData({ "draft.background": v });
      this.persist();
    }
  },
  watermark(e) {
    this.setData({ "draft.watermark.text": e.detail.value });
    this.persist();
  },
  slotChange(e) {
    const key = e.currentTarget.dataset.key,
      value = Number(e.detail.value) / (key === "zoom" ? 100 : 1000),
      slots = this.data.draft.slots.slice();
    if (!slots[this.data.active]) return;
    slots[this.data.active] = { ...slots[this.data.active], [key]: value };
    this.setData({ "draft.slots": slots });
    this.persist();
  },
  fit() {
    const slots = this.data.draft.slots.slice();
    if (!slots[this.data.active]) return;
    slots[this.data.active] = {
      ...slots[this.data.active],
      fit: slots[this.data.active].fit === "cover" ? "contain" : "cover",
      zoom: 1,
      cx: 0.5,
      cy: 0.5,
    };
    this.setData({ "draft.slots": slots });
    this.persist();
  },
  lock() {
    const slots = this.data.draft.slots.slice();
    if (!slots[this.data.active]) return;
    slots[this.data.active] = {
      ...slots[this.data.active],
      locked: !slots[this.data.active].locked,
    };
    this.setData({ "draft.slots": slots });
    this.persist();
  },
  swap() {
    const slots = this.data.draft.slots.slice(),
      i = this.data.active,
      j = (i + 1) % slots.length;
    if (!slots[i] || !slots[j]) return;
    [slots[i], slots[j]] = [slots[j], slots[i]];
    this.setData({ "draft.slots": slots });
    this.persist();
  },
  async replace() {
    this.setData({ replaceOpen: true, photos: [] });
    await this.morePhotos();
  },
  async morePhotos() {
    const offset = this.data.photos.length;
    try {
      const rows = await hydrate(this.available.slice(offset, offset + 40));
      this.setData({ photos: this.data.photos.concat(rows) });
    } catch (e) {
      toast(e);
    }
  },
  closeReplace() {
    this.setData({ replaceOpen: false });
  },
  pick(e) {
    const p = this.byId[e.currentTarget.dataset.id],
      slots = this.data.draft.slots.slice();
    const index = Math.min(this.data.active, slots.length);
    slots[index] = slotFor(p);
    this.setData({ "draft.slots": slots, active: index, replaceOpen: false });
    this.persist();
  },
  preset(e) {
    this.setData({ presetIndex: Number(e.detail.value) });
  },
  async random() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const result = await call("pairings.random", {
        projectId: this.projectId,
        collectionId: this.collectionId,
        ids: this.ids.length ? this.ids : undefined,
        presetId: this.data.presets[this.data.presetIndex].id,
        slots: this.data.draft.slots,
      });
      const previous = this.data.draft.slots;
      this.setData({
        "draft.template": result.template,
        "draft.slots": result.photoIds.map(
          (id) =>
            previous.find((s) => s.photoId === id && s.locked) ||
            slotFor(this.byId[id]),
        ),
        templateIndex: this.data.templateKeys.indexOf(result.template),
        active: 0,
      });
      await this.persist();
      if (result.unchanged) toast("当前范围只有这一组搭配");
    } catch (e) {
      toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  prompt(e) {
    this.setData({ prompt: e.detail.value });
  },
  async recommend() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const job = await call("jobs.create", {
        projectId: this.projectId,
        collectionId: this.collectionId,
        ids: this.ids.length ? this.ids : undefined,
        type: "recommend",
        prompt: this.data.prompt,
        locked: this.data.draft.slots
          .filter((s) => s.locked)
          .map((s) => s.photoId),
        current: this.data.draft.slots.map((s) => s.photoId),
        ratio: this.data.draft.ratio,
      });
      this.recommendId = job.id;
      this.selectComponent("#tasks").poll();
    } catch (e) {
      toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  progress(e) {
    const job = e.detail.jobs.find((j) => j.id === this.recommendId);
    if (job && job.state === "done" && job.result) {
      this.setData({ proposal: job.result });
      this.recommendId = null;
    }
  },
  applyProposal() {
    const p = this.data.proposal,
      previous = this.data.draft.slots;
    this.setData({
      "draft.title": p.title,
      "draft.template": p.template,
      "draft.slots": p.photoIds.map(
        (id) =>
          previous.find((s) => s.photoId === id && s.locked) ||
          slotFor(this.byId[id]),
      ),
      proposal: null,
      active: 0,
    });
    this.persist();
  },
  dismiss() {
    this.setData({ proposal: null });
  },
  async export() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      let collectionId = this.collectionId;
      if (!collectionId) {
        const c = this.data.collections;
        const r = await wx.showActionSheet({
          itemList: [...c.map((v) => v.name), "＋ 新建作品集"],
        });
        if (r.tapIndex === c.length) {
          const m = await wx.showModal({
            title: "新建作品集",
            editable: true,
            placeholderText: "名称",
          });
          if (!m.confirm) return;
          collectionId = (
            await call("collections.create", {
              projectId: this.projectId,
              name: m.content,
            })
          ).id;
        } else collectionId = c[r.tapIndex].id;
        await call("members.add", {
          projectId: this.projectId,
          collectionId,
          ids: this.data.draft.slots.map((s) => s.photoId),
        });
      }
      await this.saveDraft();
      await call("jobs.create", {
        projectId: this.projectId,
        collectionId,
        type: "render",
        draft: this.data.draft,
        ids: this.data.draft.slots.map((s) => s.photoId),
      });
      this.selectComponent("#tasks").poll();
      toast("完成后保存在作品集的创作中");
    } catch (e) {
      if (!/cancel/.test(e.errMsg || "")) toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  newPreset() {
    this.setData({
      editor: {
        name: "",
        template: "rows",
        roles: Array.from({ length: 3 }, () => ({
          subject: [],
          shot: [],
          subjectIndex: 0,
          shotIndex: 0,
        })),
      },
    });
  },
  presetName(e) {
    this.setData({ "editor.name": e.detail.value });
  },
  presetLayout(e) {
    const i = Number(e.detail.value),
      template = this.data.templateKeys[i];
    if (template === "single") return;
    this.setData({
      "editor.template": template,
      "editor.roles": Array.from(
        { length: TEMPLATES[template].count },
        (_, i) =>
          this.data.editor.roles[i] || {
            subject: [],
            shot: [],
            subjectIndex: 0,
            shotIndex: 0,
          },
      ),
    });
  },
  presetRole(e) {
    const i = Number(e.currentTarget.dataset.index),
      key = e.currentTarget.dataset.key,
      v = Number(e.detail.value),
      options =
        key === "subject" ? this.data.subjectOptions : this.data.shotOptions;
    this.setData({
      ["editor.roles[" + i + "]." + key]: v ? [options[v]] : [],
      ["editor.roles[" + i + "]." + key + "Index"]: v,
    });
  },
  closePreset() {
    this.setData({ editor: null });
  },
  async savePreset() {
    try {
      const p = await call("presets.save", {
        projectId: this.projectId,
        preset: this.data.editor,
      });
      this.setData({
        presets: this.data.presets.concat(p),
        presetIndex: this.data.presets.length,
        editor: null,
      });
    } catch (e) {
      toast(e);
    }
  },
});
