# 小猫AI 微信小程序端（`miniprogram/`）

> 这个目录是**微信小程序**的代码。项目根目录的其余部分仍然是原来的**网页版 + 后端**，两者互不影响。

---

## 一、先读这一段：为什么不是"原生小程序"

网页版 xtj 是 **HTML + CSS + JS + Express 后端**（`index.html` 87KB、`js/core.js` 871KB、`render-api/server.js` 26,000+ 行）。
小程序**不是浏览器**：它跑的是 WXML/WXSS + 一个没有 DOM、没有 `window`/`document` 的 JS 沙箱，
不能用 `<script src>`、不能用 jQuery/GSAP、不能直接跑现有前端代码。

所以把它变成小程序只有两条路：

| 方案 | 工作量 | 说明 |
|---|---|---|
| **A. 内嵌网页（web-view）** ← 当前已实现 | 已就绪 | 小程序只有一个页面，里面装现有网站。功能与网页版 100% 一致（因为就是同一份）。**但受下面第三节的域名限制** |
| B. 原生重写 | 很大（按页面拆，通常数周） | 用 WXML/WXSS 重写界面 + `wx.request` 调后端。需要按功能逐个做（帖子流/详情/照片墙/AI 对话/私信/后台…）。**并且同样受域名备案限制** |

> 换句话说：**域名这道门槛过不了，A 和 B 在真机上都跑不起来**（见第三节）。

---

## 二、在微信开发者工具里马上跑起来（不需要任何域名配置）

1. 用开发者工具「导入项目」，目录选择**仓库根目录**（不是 `miniprogram/`）。
   根目录的 `project.config.json` 已经配置了 `"miniprogramRoot": "miniprogram/"`，工具会自动找到小程序代码，不会再报
   `app.json: 在项目根目录未找到 app.json`。
2. 右上角「详情 → 本地设置」，勾选
   ☑ **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**
3. 点「编译」。首页会加载 `https://xtj.onrender.com`（地址在 `miniprogram/config.js` 里改）。

配置项只有一处：

```js
// miniprogram/config.js
module.exports = {
  webviewUrl: 'https://xtj.onrender.com',  // ← 改成你自己的域名
  enableWebview: true                       // false 则首页跳到说明页
};
```

---

## 三、真机运行（发布）必须满足的条件 ⚠️

`web-view` 组件**只能在「业务域名」白名单内的网页上使用**，而微信对业务域名有三重要求：

| # | 要求 | 现状 |
|---|---|---|
| 1 | 域名**已 ICP 备案**（工信部） | ❌ `xtj.onrender.com` 是 Render 的域名，**无法备案**；`xtj.vercel.app` 同理 |
| 2 | 域名**属于你自己**，能把微信给的校验文件放到该域名根目录 | ❌ 同上（别人的域名，上传不了文件） |
| 3 | 小程序主体为**非个人**（个人主体不能用 web-view） | ❓ 需你在小程序后台确认主体类型 |
| 4 | 在「小程序后台 → 开发管理 → 开发设置 → 业务域名」里添加该域名 | ❌ 待办 |

**结论**：要真机可用，必须先有一个**你自己的、已备案的域名**（例如 `xtj.yourdomain.com`），
把它解析到 Render（Render 支持绑定自定义域名），然后：

1. 在微信后台下载校验文件（形如 `MP_verify_xxxxxxxx.txt`）；
2. **把该文件放到本仓库根目录**（`D:\xtj\MP_verify_xxxxxxxx.txt`）—— 已确认可行：
   后端用 `express.static` 挂了仓库根目录，且敏感路径黑名单只拦 `.md/.sql/render-api/` 等，
   `.txt` 会被正常对外提供（可直接用 `https://你的域名/MP_verify_xxxxxxxx.txt` 验证）；
3. 在微信后台点「保存」，校验通过即完成；
4. 把 `miniprogram/config.js` 的 `webviewUrl` 改成新域名，提交审核。

> 一次配置，长期有效：域名的校验文件留在仓库里即可，不要删。

---

## 四、目录说明

```
project.config.json              微信开发者工具项目配置（含 appid、miniprogramRoot）
miniprogram/                     小程序代码根目录
├── app.json                     全局配置（页面列表 / 窗口样式）
├── app.js                       小程序入口
├── app.wxss                     全局样式
├── sitemap.json                 搜索索引配置
├── config.js                    ★ 唯一需要改的配置（内嵌地址 / 开关）
└── pages/
    ├── index/                   首页：只有一个 <web-view>（微信要求它必须独占整页）
    └── help/                    说明页：域名没配好 / 个人主体时显示的指引
```

`project.private.config.json` 是**本地私有配置**（含本机项目名、基础库版本等），
已加入 `.gitignore`，不进版本库（这是微信官方推荐做法）。

---

## 五、后续想走"原生小程序"（方案 B）

可以按功能分批做，建议顺序（每批都能单独上线）：

1. **只读部分**：帖子列表（`GET /api/feed`）+ 帖子详情（`GET /api/post/detail/:id`）+ 照片墙
2. **互动**：点赞 / 评论
3. **登录**：`wx.login` 换 code → 后端换 openid → 绑定现有账号体系
4. **AI 对话**：`wx.request` 的 `enableChunked` 支持 SSE 流式，可复用现有 `/api/agent/chat/stream`
5. **私信 / 后台**：量最大，最后做

> 提醒：方案 B 的每一步都**同样需要备案域名**（`wx.request` 的 request 合法域名也要求备案）。

---

## 六、注意事项

- 首页 `pages/index/index.wxml` **只能有 `<web-view>`**，加别的组件会报错；提示信息放在 `pages/help/help`。
- 小程序端不要写 `window` / `document`，那是网页 API。
- 本项目根目录的 `npm run build` / `npm test` **不会处理** `miniprogram/`（构建脚本用的是显式文件清单，不是通配符），所以两边完全解耦。
