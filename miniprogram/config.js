// 小猫AI 小程序端配置 —— 通常只需要改这一个文件
//
// ⚠️ 真机运行的前提（缺一不可）：
//   1) 域名已 ICP 备案（工信部备案）；
//   2) 该域名是「你已经拥有并能上传校验文件」的域名（onrender.com 是 Render 的域名，不属于你）；
//   3) 在小程序后台「开发管理 → 开发设置 → 业务域名」里把它加进去
//      （需要把微信给的校验文件放到域名根目录，本项目放仓库根目录即可，见 miniprogram/README.md）。
//
// 开发者工具里预览不需要上面这些，只要勾选
//   「详情 → 本地设置 → 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
module.exports = {
  // 内嵌网页地址（web-view 的 src）
  webviewUrl: 'https://xtj.onrender.com',

  // 是否启用内嵌网页模式。
  // true  → 首页直接加载 webviewUrl
  // false → 首页跳到 pages/help/help 显示配置说明（个人主体小程序不能用 web-view，请设为 false）
  enableWebview: true
};
