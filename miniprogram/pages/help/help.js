const config = require('../../config.js');

Page({
  data: {
    url: config.webviewUrl,
    subjectTip: '个人（已确认）—— web-view 组件不可用'
  },

  copyUrl() {
    wx.setClipboardData({
      data: this.data.url,
      success() {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  goIndex() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
