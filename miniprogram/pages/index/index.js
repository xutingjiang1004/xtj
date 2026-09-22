const config = require('../../config.js');

Page({
  data: {
    url: ''
  },

  onLoad() {
    if (!config.enableWebview) {
      wx.reLaunch({ url: '/pages/help/help' });
      return;
    }
    this.setData({ url: config.webviewUrl });
  },

  // web-view 内嵌页加载完成（注意：这是内嵌网页的 load，不是小程序的 onLoad）
  onWebviewLoad(e) {
    console.log('[xtj-miniprogram] web-view loaded:', e && e.detail);
  },

  // 只有在域名未配置/网络失败等情况下才会触发
  onWebviewError(e) {
    console.error('[xtj-miniprogram] web-view error:', e && e.detail);
    wx.showModal({
      title: '网页加载失败',
      content: '常见原因：业务域名未配置、域名未备案、或网络不可用。点「确定」查看说明。',
      confirmText: '看说明',
      cancelText: '知道了',
      success(res) {
        if (res.confirm) wx.navigateTo({ url: '/pages/help/help' });
      }
    });
  },

  onShareAppMessage() {
    return { title: '小猫AI', path: '/pages/index/index' };
  }
});
