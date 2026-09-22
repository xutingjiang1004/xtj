const config = require('./config.js');

App({
  globalData: {
    config: config
  },
  onLaunch() {
    // 基础库能力探测：web-view 需要基础库 >= 1.6.4（本项目 project.private.config.json 设的是 2.31.0）
    try {
      var info = wx.getSystemInfoSync();
      this.globalData.sdkVersion = info.SDKVersion;
      this.globalData.platform = info.platform;
    } catch (e) {
      this.globalData.sdkVersion = '';
    }
  },
  onError(err) {
    console.error('[xtj-miniprogram] error:', err);
  }
});
