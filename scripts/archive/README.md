# scripts/archive/ —— 一次性脚本归档

本目录存放已合入源码的历史一次性补丁/诊断脚本及诊断输出，仅作追溯参考。

## 说明

- 以下脚本均针对特定历史代码状态编写（部分以源码行号偏移 + 字符串锚点改写 `js/*` 与 `js/core-parts/*`），对应改动已合入当前源码。**请勿重跑**——锚点失效时重跑会报错或静默误改源码：
  - `patch-early-feed-consume.js`
  - `patch-feed-boot-watchdog.js`
  - `patch-network-timeouts.js`
  - `plus-menu-system-a.js`
  - `rewrite-plus-menu.js`
  - `probe-console-errors.js` / `probe-core-runtime.js` / `probe-edge-quick.js` / `probe-empirical.js` / `probe-feed-load.js` / `probe-feed-load2.js` / `probe-pending.js`
- `probe-empirical-out.txt` / `probe-empirical-out2.txt` 为当时诊断输出的留存副本，无执行价值，可随时删除。

（原始脚本仍保留在 `scripts/` 目录并在文件头部标注"一次性补丁/诊断脚本 —— 请勿重跑"；如需彻底清理，确认无人引用后可整体移入本目录或删除。）
