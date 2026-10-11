if (!Object.hasOwn)
  Object.hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
App({
  globalData: { env: "cloud1-d4gpza9qcc9ead069" },
  onLaunch() {
    wx.cloud.init({ env: this.globalData.env, traceUser: false });
  },
});
