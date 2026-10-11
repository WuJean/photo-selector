const { call, toast } = require("../../utils/api");
Component({
  properties: {
    projectId: {
      type: String,
      observer() {
        if (this.poll) this.poll();
      },
    },
  },
  data: { jobs: [] },
  lifetimes: {
    attached() {
      this.poll();
    },
    detached() {
      clearTimeout(this.timer);
      this.gone = true;
    },
  },
  pageLifetimes: {
    show() {
      this.gone = false;
      this.poll();
    },
    hide() {
      this.gone = true;
      clearTimeout(this.timer);
    },
  },
  methods: {
    async poll() {
      clearTimeout(this.timer);
      if (this.gone || !this.properties.projectId) return;
      try {
        const jobs = await call("jobs.list", {
          projectId: this.properties.projectId,
        });
        const active = jobs.filter(
          (j) => !["done", "cancelled"].includes(j.state),
        );
        this.setData({
          jobs: active.map((j) => ({
            ...j,
            label: {
              classify: "AI 分类",
              sample: "细化分类",
              copy: "生成文案",
              cover: "生成封面",
              render: "导出拼图",
              recommend: "AI 搭配",
            }[j.type],
            percent: Math.round(
              ((j.completed + j.skipped) / Math.max(1, j.total)) * 100,
            ),
          })),
        });
        this.triggerEvent("progress", { jobs });
      } catch (e) {
        this.setData({ error: e.message });
      } finally {
        if (!this.gone) this.timer = setTimeout(() => this.poll(), 4000);
      }
    },
    async control(e) {
      try {
        await call("jobs.control", {
          id: e.currentTarget.dataset.id,
          action: e.currentTarget.dataset.action,
        });
        this.poll();
      } catch (e) {
        toast(e);
      }
    },
    open(e) {
      wx.navigateTo({
        url:
          "/pages/classify/index?id=" +
          this.properties.projectId +
          "&job=" +
          e.currentTarget.dataset.id,
      });
    },
  },
});
