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
    // 带 fromHelp 标记，index 识别后不再重定向回本页，打破来回跳转死循环
    wx.reLaunch({ url: '/pages/index/index?fromHelp=1' });
  }
});
