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
| 1 | 域名**已 ICP 备案**（工信部） | ❌ `xtj.onrender.com` 是 Render 的域名，**无法备案**（`xtj.vercel.app` 已于 2026-09 弃用、无部署） |
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

### 网页侧为小程序做的适配（2026-09-22）

小程序 web-view 里页面已经在微信导航栏**下方**，但 iOS 仍按「全屏」上报安全区，
导致网页版的顶部多出一块空白、底部 Dock 被顶到屏幕中下部。已在网页侧修好：

| 位置 | 改动 |
|---|---|
| `index.html`（`<head>` 早期脚本） | UA 含 `miniProgram` 时给 `<html>` 加 `.xtj-miniprogram`（公众号/微信内置浏览器不含该关键字，不误伤） |
| `css/ui-shell.css` | 小程序环境下 `.dock-panel` 顶部回到 24px（原本 iOS 竖屏是 `max(52px, inset+12px)`）、sticky header `top: 0`、`.dock-bar` 的 `bottom` 只保留底部 home indicator 的真实安全区 |
| `js/core-parts/06-chat-and-nav.js` | 小程序环境下不再把 `innerHeight − visualViewport` 的差值写进 `--xtj-visual-bottom`（微信里该差值恒 >0 且非键盘所致，会把 Dock 顶上去） |

> 改这几个文件后需 `node scripts/assemble-core.js` 再 `npm run build`（`js/core.js` 由 core-parts 拼装生成）。

---

## 七、怎么"上线"（三条真实路线）

**为什么现在真机打不开、一片空白**：`web-view` 指向的域名必须在「业务域名」白名单里。
`xtj.onrender.com` 是 Render 的域名，进不了白名单（你截图里那句
「不支持打开 https://xtj.onrender.com…」是**微信自己**弹的拦截提示，不是项目代码的问题）。

微信的硬性要求（官方文档：[业务域名](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/domain.html)）：

| 要求 | 说明 |
|---|---|
| 域名**已 ICP 备案** | 服务器域名（`wx.request`）与业务域名（`web-view`）**都**要求备案 |
| 域名**属于你自己** | 备案 + 上传微信校验文件都需要你是域名持有人 |
| 主体**非个人** | 个人主体不能用 `web-view`（后台添加业务域名时会拦住） |

### 路线 1 · 买域名 + 备案 + web-view ← 代码改动最小，推荐

| 步骤 | 做什么 | 成本 / 时间 |
|---|---|---|
| 1 | 在腾讯云 / 阿里云买一个域名 | ¥30–60 / 年 |
| 2 | **备案**：需要境内接入（买最便宜的轻量服务器，或使用备案服务码），提交后等管局审核 | 免费，**7–20 个工作日** |
| 3 | 域名解析到 Render，并在 Render 后台绑定自定义域名（自动 HTTPS） | 0 |
| 4 | 微信后台「开发管理 → 开发设置 → 业务域名」添加该域名；把微信给的 `MP_verify_xxxxxx.txt` **放到本仓库根目录**（已实测：后端 `express.static` 挂的是仓库根目录，`.txt` 会被正常对外提供） | 0，几分钟 |
| 5 | 改 `miniprogram/config.js` 的 `webviewUrl` 为新域名 → 上传代码 → 提交审核 | 审核 1–7 天 |

结果：小程序 = 现有网页版**全部功能**（因为就是同一份站点）。

### 路线 2 · 原生小程序 + 微信云托管（不需要备案域名，但要重写前端）

- 微信「云托管」可以用 `wx.cloud.callContainer` 调用你自己部署的容器，
  **走微信内部通道，不需要在「服务器域名」里配置域名**（见[云托管开发常识](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/guide/debug/know.html)）——
  这是**唯一不需要备案域名**的联网方式。
- 代价：前端必须用 WXML/WXSS 重写（现有 HTML/JS 在小程序里跑不起来），按页面分批做，见第五节。
- 需在后台确认：你的**主体类型是否可开通云托管**。

### 路线 3 · 只做演示（不花钱、不上线）

开发者工具里勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」即可看效果，
适合自己预览或给别人演示。**不能提交审核上线。**

### 决策前需要确认两件事

1. 小程序主体是 **个人** 还是 **企业 / 组织**？→ 个人主体 `web-view` 用不了，路线 1 直接作废。
2. 愿不愿意为「域名 + 备案」花时间和钱？→ 不愿意就只能走路线 2（重写）或路线 3（只演示）。

> 2026-09-22 状态：`vercel.json` 已删除、`xtj.vercel.app` 已无部署。
> 生产环境只有 **Render（应用）+ Supabase（数据库）**，所以不存在"Vercel 反代吞 IP"那条链路了。
