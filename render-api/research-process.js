"use strict";
function createResearchProcess(limit = 200000) {
  const entries = [],
    byRole = new Map();
  let size = 0;
  return {
    record(event) {
      const role =
        event.type === "research_thinking"
          ? String(event.agent_role || "模型思考").slice(0, 80)
          : event.type === "research_stage"
            ? "研究进程 · " + String(event.stage || "").slice(0, 40)
            : "";
      const text =
        event.type === "research_thinking"
          ? String(event.chunk || "")
          : String(event.message || "");
      if (!role || !text || size >= limit) return;
      const chunk = text.slice(0, limit - size);
      size += chunk.length;
      if (event.type === "research_thinking" && byRole.has(role))
        byRole.get(role).chunk += chunk;
      else if (entries.length < 100) {
        const entry = { agent_role: role, chunk };
        entries.push(entry);
        if (event.type === "research_thinking") byRole.set(role, entry);
      }
    },
    snapshot() {
      return entries.map((e) => ({ ...e }));
    },
  };
}
module.exports = { createResearchProcess };
