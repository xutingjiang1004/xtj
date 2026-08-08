# xtj-ai-agent

## 状态：占位（未实现）

> 本目录目前是空占位，**尚未实现**任何 MCP Server 功能，没有 `server.js` 或 `package.json`。

## 说明

该 server 名称 `xtj-ai-agent` 预留用于 XTJ 的 AI Agent 相关 MCP 能力。

- **当前行为**：目录为空。配置（如 `.trae/mcp.json`）中**未引用**本 server，因此不会加载，也不会影响现有功能。
- **下一步**：如需启用，请参考同目录下已实现 server 的模式进行开发：
  - `../xtj-admin/server.js` — 管理后台 MCP（基于 `@modelcontextprotocol/sdk` + zod）
  - `../xtj-email/server.js` — 邮件发送 MCP（ESM、`McpServer` API、stdio transport）
  - `../xtj-image/server.js` — 图片处理 MCP
- **注意事项**：实现需经过验证后再放入配置，避免加载未验证的代码。

## 配置引用检查记录

| 配置文件 | 是否引用 xtj-ai-agent |
| --- | --- |
| `E:\xtj\.trae\mcp.json` | 否 |
| `E:\xtj\.cursor\` | 目录为空，无配置 |
| 其他（`grep xtj-ai-agent` 全仓搜索） | 未找到任何引用 |
