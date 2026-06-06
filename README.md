# XTJ

当前前端版本：`v0.72`

这是一个以帖子流、照片墙、聊天、公告、统计和后台管理为核心的前端项目，当前仓库同时包含用户端页面和管理后台页面。

## 当前版本

### v0.72 - 2026-06-06
这一版主要收口了三个方向：举报弹层重做、统计/我的页互动修复、后台用户操作提效。

- 举报弹层改成顶部双标签结构：`发起举报 / 举报记录` 分开展示。
- 举报记录改成独立卡片层级，状态、原因、时间、管理员回复不再叠在一起。
- 浏览记录排除“用户浏览自己的帖子”，旧本地脏记录也会自动清掉。
- 总动态、总浏览、点赞评论、我的点赞、我的评论统一改成“有图才显示缩略图”。
- 修复我的页面点赞记录和评论记录排版被破坏的问题。
- 聊天列表和聊天详情加载动画统一为照片墙同款。
- 深色模式下“我的”页个人资料、深色模式、通知、关于去掉白色磨砂。
- 后台用户主列表支持直接快速 `禁言 / 封禁 / 拉黑`。
- 后台 `封禁 / 禁言 / 黑名单` 管理区改成上方配置、下方直接点用户执行。

## 主要页面

- `index.html`
  - 用户端首页、帖子流、照片墙、聊天、统计、我的页面、公告、举报弹层。
- `admin.html`
  - 后台管理入口，包含用户、帖子、举报、封禁、禁言、黑名单、照片管理。

## 关键目录

- `css/`
  - 站点样式文件。
- `js/`
  - 用户端核心逻辑和后台管理逻辑。
- `render-api/`
  - 后端服务相关代码。
- `scripts/`
  - 构建脚本。

## 常用文件

- [index.html](C:/Users/Administrator/Desktop/最新index/xtj/index.html)
- [admin.html](C:/Users/Administrator/Desktop/最新index/xtj/admin.html)
- [js/core.js](C:/Users/Administrator/Desktop/最新index/xtj/js/core.js)
- [js/admin/admin.js](C:/Users/Administrator/Desktop/最新index/xtj/js/admin/admin.js)
- [CHANGELOG.md](C:/Users/Administrator/Desktop/最新index/xtj/CHANGELOG.md)

## 开发说明

- 用户端“关于”当前显示版本号：`xtj v0.72`
- 管理后台脚本缓存版本已同步到 `v0.72`
- 详细历史改动请查看 [CHANGELOG.md](C:/Users/Administrator/Desktop/最新index/xtj/CHANGELOG.md)
