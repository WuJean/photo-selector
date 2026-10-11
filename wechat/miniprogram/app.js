const settings = require("./config");
if (!Object.hasOwn)
  Object.hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
App({
  globalData: { env: settings.env },
  onLaunch() {
    if (!this.globalData.env) { wx.showToast({title:"请先配置云环境",icon:"none"}); return; }
    wx.cloud.init({ env: this.globalData.env, traceUser: false });
  },
});
