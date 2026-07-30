# xtj · Code 板块 UI 重设计方案

> 基于 Claude 设计系统 (dl_builtin_claude) 作为风格约束
> 仅设计方案 · 不修改代码 · 用于交付给 Codex 执行

---

## 一、现状诊断

### 1.1 Code 板块在项目中的位置

**导航位置**（桌面端 `desktop-workbench-sidebar` + 移动端 `dock-bar`）：
- 帖子 → 聊天 → 小猫AI → 照片墙 → 我的 → **Code（第 6 位，末尾）**

**HTML 结构**（`index.html:553-560`）：
```html
<div class="dock-panel code-panel" id="panelCode">
    <div class="code-welcome" id="codeWelcome">
        <h2>代码工作区</h2>
        <p>选择一个文件夹开始工作</p>
        <button class="code-btn code-btn-primary" id="codeSelectFolderBtn">打开文件夹</button>
    </div>
    <div class="code-workspace" id="codeWorkspace" style="display:none;"></div>
</div>
```

**布局架构**（`css/code-workspace.css` + `js/code-workspace.js`）：
- 三栏布局：Sidebar（260px）| Editor Column（flex:1）| Chat Panel（360px）
- 两个 resizer：`code-resizer-left`（sidebar↔editor）、`code-resizer-right`（editor↔chat）
- 顶部有 tab bar（`code-tab-bar`，38px 高）
- 底部有 context 区（`code-tab-context`，180px 高）

### 1.2 现有设计的问题

| 问题 | 现状 | 影响 |
|------|------|------|
| **视觉风格断层** | code-panel 用绿色系 `--cw-accent: #059669`、深绿黑背景 `#0d1b1f`，与站点其他板块（同样是绿色系）一致，但与 Claude 风格期望差异大 | 如果要往 Claude 风格靠，颜色、字体、圆角、阴影全要换 |
| **三栏过密** | 桌面端 260+360=620px 被侧栏和聊天栏占走，编辑器在 1366 笔记本上只剩 ~700px | 信息密度高，视觉拥挤 |
| **欢迎页过简** | 只有标题 + 一行说明 + 一个按钮，没有引导性视觉 | 首次进入缺乏"这是一个 IDE"的视觉暗示 |
| **导航位置靠后** | Code 排在末尾第 6 位，但它是高频开发功能 | 发现性差，用户不容易注意到 |
| **Tab Bar 样式偏 VSCode** | 当前 tab bar 用底部蓝线下划线表示 active，是经典 IDE 风格 | 与 Claude 的卡片式 / pill 式 tab 风格不一致 |
| **无空状态设计** | 关闭所有 tab 后编辑器区是空白，没有"打开一个文件开始"的引导 | 体验生硬 |
| **Chat Panel 与主站聊天重复** | code-panel 内置 chat-panel（360px），和站点的 #panelChat 功能重叠 | 用户心智模型混乱 |

---

## 二、Claude 设计系统关键 Token 提取

从 `dl_builtin_claude/colors_and_type.css` 提取核心约束：

### 2.1 色彩（Claude 风格）

```css
/* 浅色（Claude 标志色） */
--background: #faf9f5;     /* bg-100 · 暖白纸感 */
--card: #f5f4ef;           /* bg-200 */
--popover: #ffffff;        /* bg-50 */
--muted: #ede9de;          /* bg-300 */
--foreground: #3d3929;     /* text-800 · 暖墨色 */
--muted-foreground: #6e6d68;
--primary: #c96442;        /* brand-500 · Claude 橙 */
--border: #dad9d4;         /* border-300 */
--ring: #c96442;

/* 深色 */
--background: #262624;     /* bg-100 · 暖黑 */
--card: #2c2c2b;
--popover: #30302e;
--foreground: #f1f1ef;     /* text-800 */
--primary: #d97757;        /* brand-500 · 暖橙 */
--border: #3e3e38;
```

**关键差异**：现有 xtj code-panel 用 `#0d1b1f`（冷绿黑）+ `#059669`（翠绿），Claude 用 `#262624`（暖灰黑）+ `#d97757`（暖橙）。色温完全相反。

### 2.2 字体

```css
--font-display: Newsreader, Georgia, serif;  /* 标题/品牌口号 */
--font-sans: Poppins, system-ui, sans-serif;  /* UI 文字 */
--font-serif: Lora, Georgia, serif;            /* 阅读正文 */
--font-mono: Geist Mono, monospace;            /* 代码 */
```

现有 code-panel 用 `Cascadia Code` / `Fira Code` 做 mono，Claude 用 `Geist Mono`。

### 2.3 圆角与阴影

```css
--radius-sm: 8px;
--radius-md: 12px;
--radius: 16px;      /* 主圆角 */
--radius-xl: 20px;
--radius-2xl: 24px;

--shadow-sm: 0 1px 3px rgba(0,0,0,0.05);
--shadow-md: 0 1px 3px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.1);
```

Claude 阴影非常轻（最大 0.1 透明度），现有 xtj 阴影偏重（`0 8px 32px rgba(3,13,19,0.28)`）。

### 2.4 关键组件风格

- **Card**：`bg-200` + 1px `border-300` + `radius` 16px + 极轻阴影
- **Button**：primary 用 `brand-500` 实心 + `radius-full`（9999px 胶囊）
- **Input**：1px `border-500` + `radius-md` 12px
- **Badge**：`bg-300` + `radius-full` + 小字号
- **Tab**：active 状态用 `popover` 背景 + `border` 边框，不用下划线

---

## 三、重设计方案

### 3.1 导航位置

**保持原有导航顺序不变**：帖子 → 聊天 → 小猫AI → 照片墙 → 我的 → Code

### 3.2 三栏布局重新分配

**现状**：Sidebar 260px | Editor flex | Chat 360px
**建议**：Sidebar 240px | Editor flex | Chat 380px（可折叠到 48px icon rail）

```
┌─────────────────────────────────────────────────────────────┐
│  Top Bar (40px) · workspace name + actions + model selector  │
├──────────┬──────────────────────────────────┬────────────────┤
│          │                                  │                │
│ Sidebar  │  Editor Column                   │  Chat Panel    │
│ 240px    │  (flex: 1, min-width: 0)         │  380px         │
│          │                                  │  (collapsible   │
│ - Files  │  ┌─Tab Bar (38px)─────────────┐  │   to 48px rail)│
│ - Search │  │  file.ts  × │ file2.ts  ×  │  │                │
│ - Outline│  └────────────────────────────┘  │  ┌──────────┐  │
│          │  ┌─Editor────────────────────┐  │  │ Messages  │  │
│          │  │                            │  │  │           │  │
│          │  │   Monaco Editor            │  │  ├──────────┤  │
│          │  │                            │  │  │ Composer  │  │
│          │  └────────────────────────────┘  │  │  + attach │  │
│          │  ┌─Context Bar (120px)────────┐ │  └──────────┘  │
│          │  │ Pinned files · tokens: 2.4k│ │                │
│          │  └────────────────────────────┘ │                │
└──────────┴──────────────────────────────────┴────────────────┘
```

**关键改进**：
1. **顶部加 Top Bar**（40px）：放 workspace 名 + 操作按钮 + 模型选择器，把 tab bar 上的非 tab 操作移上来
2. **Sidebar 从 260→240px**：节省 20px 给编辑器
3. **Chat Panel 可折叠成 48px icon rail**：用户专注写代码时一键收起，参考 VS Code 的辅助栏
4. **Context Bar 从 180px→120px**：太占空间，120px 够放 pinned files + token 计数

### 3.3 视觉风格切换：从绿色系 → Claude 暖橙系

#### 3.3.1 颜色映射表

| Token | 现有（xtj 绿） | 建议改（Claude） | 说明 |
|-------|---------------|-----------------|------|
| `--cw-bg` | `#0d1b1f` 冷绿黑 | `#262624` 暖灰黑 | 主背景换暖色温 |
| `--cw-bg-secondary` | `rgba(18,36,41,0.92)` | `var(--card)` = `#2c2c2b` | 卡片背景 |
| `--cw-bg-tertiary` | `rgba(22,48,56,0.64)` | `var(--muted)` = `#30302e` | 三级背景 |
| `--cw-bg-hover` | `rgba(24,52,60,0.72)` | `rgba(255,255,255,0.04)` | hover 态 |
| `--cw-border` | `rgba(164,216,205,0.12)` 绿调 | `var(--border)` = `#3e3e38` 暖灰 | 边框去绿 |
| `--cw-text` | `#e7f5f3` 偏绿白 | `var(--foreground)` = `#f1f1ef` 暖白 | 主文字 |
| `--cw-text-secondary` | `#b0c7c3` | `var(--muted-foreground)` = `#b7b5a9` | 次文字 |
| `--cw-accent` | `#059669` 翠绿 | `var(--primary)` = `#d97757` Claude 橙 | 强调色 |
| `--cw-accent-soft` | `rgba(5,150,105,0.15)` | `rgba(217,119,87,0.15)` | 软强调 |
| `--cw-danger` | `#ff3b60` | `var(--destructive)` = `#ef4444` | 危险色 |
| `--cw-success` | `#34d399` | `var(--success)` = `#8ca06f` 暖绿 | 成功色 |

**浅色模式同样映射**：`#f7fffb` → `#faf9f5`（暖白纸感）

#### 3.3.2 字体替换

```css
/* 现有 */
--cw-font-mono: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', ...;
--cw-font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', ...;

/* 建议 */
--cw-font-mono: var(--font-mono);   /* Geist Mono */
--cw-font-sans: var(--font-sans);   /* Poppins */
```

**额外建议**：欢迎页的 "代码工作区" 标题改用 `--font-display`（Newsreader 衬线），增加品牌质感。

#### 3.3.3 圆角与阴影

```css
/* 现有 */
--cw-radius: 16px;
--cw-radius-sm: 10px;
--cw-shadow: 0 8px 32px rgba(3,13,19,0.28);  /* 太重 */

/* 建议 */
--cw-radius: var(--radius);      /* 16px · 保持 */
--cw-radius-sm: var(--radius-sm); /* 8px · 更小更克制 */
--cw-shadow: var(--shadow-md);   /* 0 1px 3px rgba(0,0,0,0.1) · 极轻 */
--cw-shadow-sm: var(--shadow-sm);
```

### 3.4 欢迎页重设计

**现状**：纯文字 + 一个按钮，视觉空洞
**建议**：参考 Claude 的 card 布局，做一张居中卡片

```
                  ┌─────────────────────────────────┐
                  │                                 │
                  │    [Code 图标 · 64px]            │
                  │                                 │
                  │    代码工作区                    │  ← Newsreader 衬线大标题
                  │    选择一个文件夹开始工作         │  ← Lora 正文
                  │                                 │
                  │    ┌──────────┐  ┌──────────┐    │
                  │    │ 打开文件夹│  │ 从 GitHub │   │  ← 两个并列 primary 按钮
                  │    └──────────┘  └──────────┘    │
                  │                                 │
                  │    · 支持本地文件夹              │
                  │    · 支持 GitHub 仓库            │
                  │    · AI 辅助代码编辑             │
                  │                                 │
                  └─────────────────────────────────┘
```

**样式**：
- 卡片：`background: var(--card)` + `border: 1px solid var(--border)` + `border-radius: var(--radius-2xl)` (24px) + `shadow-lg`
- 宽度：`min(560px, 90vw)`
- 居中：flex center
- 图标用 Claude 的 `file.svg` 或自定义 code 图标，64px，`color: var(--primary)`

### 3.5 Tab Bar 重设计

**现状**：底部蓝线 active 指示（VSCode 风格）
**建议**：Claude 的 pill / card 式 tab

```
现状:  [file.ts ____] [file2.ts ____]
               ↑ 蓝色下划线

建议:  ╭ file.ts  × ╮  ╭ file2.ts  × ╮  + 
       ╰────────────╯  ╰────────────╯
       ↑ active: popover 背景 + 完整边框
         inactive: transparent + hover 时 muted 背景
```

**CSS 关键变化**：
- active tab：`background: var(--popover)` + `border: 1px solid var(--border)` + `border-radius: var(--radius-sm)` (8px)
- inactive tab：`background: transparent` + hover 时 `background: var(--muted)`
- 移除底部下划线 `::after`
- tab 间距：`gap: 4px`
- 关闭按钮：hover 时变 `--destructive` 色

### 3.6 Sidebar 文件树重设计

**现状**：纯文件列表 + 缩进
**建议**：Claude 风格的树形 + 图标

```
现有:
  src
    components
      Button.tsx
    utils.ts
  package.json

建议:
  📁 src
    📁 components
      📄 Button.tsx        ← 文件类型图标 + 文件名
    📄 utils.ts
  📄 package.json
```

**关键点**：
- 文件夹用 Claude 的 `folder.svg` / `folder-open.svg`（已在 icon 库中）
- 文件用 `file.svg`（已有）
- hover：`background: var(--muted)` + `border-radius: var(--radius-sm)`
- active：`background: var(--accent)` (soft) + 左侧 2px `var(--primary)` 竖线
- 字体：`var(--font-sans)` Poppins，size 13px

### 3.7 Chat Panel 重设计

**现状**：和主站 #panelChat 风格重复
**建议**：区别于主站聊天，更接近 Claude.ai 的对话界面

```
┌────────────────────────────┐
│  Code Assistant    [model] │  ← header + 模型选择 pill
├────────────────────────────┤
│                            │
│  ┌─ User ────────────────┐ │
│  │ 帮我重构这个函数      │ │  ← 用户消息: muted 背景
│  └──────────────────────┘ │
│                            │
│  ┌─ Assistant ───────────┐ │
│  │ 我来帮你重构...        │ │  ← AI 消息: card 背景 + border
│  │ ```diff                │ │
│  │ - old code             │ │  ← 代码块用 var(--popover) 背景
│  │ + new code             │ │
│  │ ```                    │ │
│  └──────────────────────┘ │
│                            │
├────────────────────────────┤
│  📎 pinned: 2 files · 2.4k │  ← 附件状态条
│  ┌────────────────────────┐│
│  │ 输入消息...            ││  ← composer: radius 12px
│  │                    [↑] ││
│  └────────────────────────┘│
└────────────────────────────┘
```

**关键变化**：
- 消息气泡用圆角卡片而非气泡（`radius-md` 12px）
- User 消息：`background: var(--muted)` + 无边框
- Assistant 消息：`background: var(--card)` + `1px solid var(--border)`
- 代码块：`background: var(--popover)` + `radius-sm` 8px + `font-mono`
- Composer 输入框：`radius-md` 12px + 1px border + focus 时 `ring` 色

### 3.8 移动端适配

**现状**：`CODE_PHONE_MAX_WIDTH = 767`，移动端隐藏 sidebar 和 chat panel，只显示 editor
**建议**：保留单栏，但加底部 tab 切换

```
移动端 (< 768px):
┌─────────────────────┐
│  Top Bar (40px)     │  ← workspace + menu
├─────────────────────┤
│                     │
│  Editor / Chat      │  ← 单栏切换
│  (根据底部 tab)      │
│                     │
├─────────────────────┤
│ [Files][Editor][AI] │  ← 底部 3 tab 切换
└─────────────────────┘
```

---

## 四、实施优先级

| 优先级 | 任务 | 改动范围 | 风险 |
|--------|------|---------|------|
| **P0** | 颜色 token 替换（`--cw-*` 全部映射到 Claude token） | `code-workspace.css` 前 72 行 | 低 · 纯变量值替换 |
| **P0** | 字体替换为 Claude 字体栈 | `code-workspace.css` 41-42 行 | 低 |
| **P1** | 欢迎页卡片化 | `index.html:553-558` + CSS | 低 |
| **P1** | Tab Bar 改 pill 式 | `code-workspace.css` 350-460 行 | 中 · 需测试交互 |
| **P2** | Sidebar 文件树加图标 | JS render 逻辑 + CSS | 中 |
| **P2** | Chat Panel 消息气泡重设计 | JS render + CSS | 中 |
| **P2** | Top Bar 新增 | HTML + CSS + JS | 中 |
| **P3** | 移动端底部 tab 切换 | JS + CSS | 高 · 改动较大 |
---

## 五、给 Codex 的实施建议

### 5.1 第一阶段（必做 · 低风险）
1. 在 `css/code-workspace.css` 顶部导入 Claude token：
   ```css
   @import url('../.design_library/Claude/colors_and_type.css');
   ```
   或直接在 `:root` 里复制 Claude 的 token

2. 把 `--cw-*` 变量值全部替换为 Claude 对应 token（见 3.3.1 映射表）

3. 字体栈改为 `var(--font-sans)` / `var(--font-mono)`

4. 阴影改为 `var(--shadow-sm)` / `var(--shadow-md)`

### 5.2 第二阶段（推荐 · 中风险）
5. 重写 `.code-welcome` 为居中卡片布局（见 3.4）
6. 重写 `.code-tab` 和 `.code-tab.active` 为 pill 式（见 3.5）

### 5.3 第三阶段（可选 · 高投入）
7. Sidebar 加文件类型图标
8. Chat Panel 消息气泡重设计
9. 新增 Top Bar 组件
10. 移动端底部 tab 切换

---

## 六、验证标准

实施后应满足：
1. 暗色模式下 code-panel 背景为 `#262624` 暖灰黑，不是绿色调
2. 强调色为 `#d97757` Claude 橙
3. 字体使用 Poppins（UI）+ Geist Mono（代码）
4. 圆角体系统一为 8/12/16/20/24px
5. 阴影极轻，最大透明度 0.1
6. 欢迎页为居中卡片，不是左对齐文字
7. Tab 为 pill 式，不是底部下划线
8. 与站点其他板块（帖子/聊天/照片墙）的视觉风格有明确区分但同源
