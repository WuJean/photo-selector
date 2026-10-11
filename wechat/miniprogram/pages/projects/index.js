const { call, toast } = require("../../utils/api");
Page({
  data: { projects: [], error: "", loading: false },
  onShow() {
    this.load();
  },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      this.setData({ projects: await call("projects.list") });
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  create() {
    wx.showModal({
      title: "创建项目",
      editable: true,
      placeholderText: "这次旅行的名字",
      success: async (r) => {
        if (!r.confirm) return;
        try {
          const p = await call("projects.create", { name: r.content });
          wx.navigateTo({ url: "/pages/library/index?id=" + p.id });
        } catch (e) {
          toast(e);
        }
      },
    });
  },
  open(e) {
    wx.navigateTo({
      url: "/pages/library/index?id=" + e.currentTarget.dataset.id,
    });
  },
});
