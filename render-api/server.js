// xtj Admin API service for Render deployment.
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
var nodemailer = null;
try { nodemailer = require('nodemailer'); } catch(e) { console.warn('[INIT] nodemailer not available, email disabled'); }

const app = express();

// 简单 cookie 解析中间件
app.use((req, res, next) => {
  req.cookies = {};
  var cookieHeader = req.headers.cookie || '';
  cookieHeader.split(';').forEach(function(pair) {
    var idx = pair.indexOf('=');
    if (idx > 0) {
      req.cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  });
  next();
});

// 信任反向代理（Render 会设置 X-Forwarded-For）
app.set('trust proxy', 1);

// 全局禁用 X-Powered-By（必须在任何路由之前）
app.disable('x-powered-by');

// ===================== 配置 =====================
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'xxz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const API_SECRET = process.env.API_SECRET;
if (!API_SECRET) {
  console.error('[FATAL] API_SECRET 环境变量未设置，拒绝启动。在 Render Dashboard 中设置 API_SECRET。');
  process.exit(1);
}
const ADMIN_TOKEN_EXPIRY_HOURS = Math.min(
  Math.max(parseInt(process.env.ADMIN_TOKEN_EXPIRY_HOURS || '72', 10) || 72, 1),
  168
);
const TOKEN_EXPIRY_MS = ADMIN_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ithowxqignlhkwaykglt.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_SERVICE_KEY) {
  console.error('[FATAL] SUPABASE_SERVICE_KEY 环境变量未设置，拒绝启动。');
  process.exit(1);
}

// Allowed frontend origins.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
// 服务器自身域名（用于 CORS 自动检测同域请求）
const SERVER_HOSTNAME = process.env.SERVER_HOSTNAME || process.env.RENDER_EXTERNAL_HOSTNAME || '';
if (ALLOWED_ORIGINS.length === 0) {
  // 未配置时允许所有同源请求（自动检测当前部署域名）
  console.log('[CONFIG] ALLOWED_ORIGINS not set, will auto-detect from request origin');
  if (SERVER_HOSTNAME) console.log('[CONFIG] Server hostname: ' + SERVER_HOSTNAME);
}

if (!ADMIN_PASSWORD) {
  console.warn('[WARN] ADMIN_PASSWORD is not configured.');
}

// 初始化 Supabase 客户端（仅使用 service_role key，禁止 anon key 兜底）
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY
);

// ===================== DeepSeek AI 配置 =====================
// ★ DeepSeek API Key 只能放后端环境变量，绝对不能放前端
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL_REASONER = process.env.DEEPSEEK_MODEL_REASONER || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_TIMEOUT_MS = 60000; // 60 秒超时
const AI_AGENT_DAILY_LIMIT = 300; // 每用户每天 AI 调用次数
const AI_AGENT_HOURLY_LIMIT = 50; // 每用户每小时 AI 调用次数
// 文件解析库（预先 require，避免每次调用时重复加载）
let pdfParser = null, mammothParser = null, xlsxParser = null;
try { pdfParser = require('pdf-parse'); } catch(e) { console.warn('[FILE] pdf-parse not available'); }
try { mammothParser = require('mammoth'); } catch(e) { console.warn('[FILE] mammoth not available'); }
try { xlsxParser = require('xlsx'); } catch(e) { console.warn('[FILE] xlsx not available'); }

// ===================== P: 深度研究模式 (Deep Research / Multi-Agent) =====================
// P 改动:
//   - MAX_WORKERS 10 -> 5
//   - Planner 自主动态决策 (可拆 0/1/2..5 agent, 简单问题不调 agent)
//   - Planner 可决定每个 agent 是否搜索
//   - Synthesizer 风格改成 ChatGPT pro thinking (不要研究报告, 简单问题直接答)
// Planner → Workers (parallel, optional) → Synthesizer → SSE progress
const DEEP_THINK_CONFIG = {
  MAX_DURATION_MS: 10 * 60 * 1000,   // 10 分钟总预算
  PLANNER_TIMEOUT_MS: 60 * 1000,      // Planner 1 分钟
  WORKER_TIMEOUT_MS: 5 * 60 * 1000,   // 单 worker 5 分钟上限
  SYNTHESIZER_TIMEOUT_MS: 3 * 60 * 1000, // Synthesizer 3 分钟
  MAX_WORKERS: 6,                     // 最多 6 个并行 agent (可由 config.deep_think.max_workers 覆盖)
  MIN_WORKERS: 0,                     // 0 = 允许直接回答 (可由 config.deep_think.min_workers 覆盖)
  DEFAULT_WORKERS_IF_PLANNER_FAILS: 3, // Planner 失败时 fallback 3 个通用方向
  FORCE_SPLIT_MIN_LENGTH: 24,         // 超过此长度且疑似复杂, 强制拆分 (可由 config.deep_think.force_split_min_length 覆盖)
  WORKER_MAX_TOOL_ROUNDS: 5,          // 单 worker 内部最多 tool_use (可由 config.deep_think.worker_max_tool_rounds 覆盖)
  HEARTBEAT_MS: 3000                  // 3s 推一次进度
};

// 全局活跃深度思考任务 (按 conv_id 索引) — 用于 cancel
const activeDeepThinkJobs = new Map(); // conv_id → { cancelled, startTime, controller }

// 简单 exact-match 缓存 (TTL 5 分钟, key = userName + '::' + message + '::' + thinking_mode)
const aiResponseCache = new Map();
const AI_CACHE_TTL_MS = 5 * 60 * 1000;
const AI_CACHE_MAX_SIZE = 500;
function limitAiCacheSize() {
  if (aiResponseCache.size <= AI_CACHE_MAX_SIZE) return;
  var overflow = aiResponseCache.size - AI_CACHE_MAX_SIZE;
  var keys = Array.from(aiResponseCache.keys());
  for (var i = 0; i < overflow && i < keys.length; i++) aiResponseCache.delete(keys[i]);
}
// 每 5 分钟清理过期缓存 + 限制大小
setInterval(function() {
  var now = Date.now();
  aiResponseCache.forEach(function(val, key) {
    if (now > val.expiresAt) aiResponseCache.delete(key);
  });
  limitAiCacheSize();
}, 5 * 60 * 1000);

// ===================== 共享工具函数 (提取自 M/R 架构) =====================
function buildHistoryContext(ctx, message) {
  if (!ctx || !Array.isArray(ctx.history) || ctx.history.length === 0) return '';
  var lines = ['\n\n[历史对话上下文 (重要! 你必须看到这些)]\n'];
  // ★ 缓存优化：最近 6 条 (原 10)，每条 ≤ 500 字符。太多历史会撑爆 user 消息
  var recentHistory = ctx.history.slice(-6);
  recentHistory.forEach(function(h, i) {
    var role = h.role === 'user' ? '用户' : (h.role === 'assistant' ? 'AI' : h.role);
    var content = String(h.content || '').slice(0, 500);
    lines.push((i + 1) + '. [' + role + '] ' + content);
  });
  lines.push('\n[当前用户新消息]: ' + (message || ''));
  return lines.join('\n');
}

// 判断用户问题是否值得强制拆分多个 agent
// minLen: 最小长度阈值, 可从 config.deep_think.force_split_min_length 传入
function shouldForceSplitAgents(message, minLen) {
  if (!message) return false;
  var m = String(message).trim();
  if (!m) return false;
  if (minLen <= 1) return true;
  // 数学/代码单行表达式仍然直接答
  if (/^[\d\+\-\*\/\^\(\)\s\.=<>!]+$/.test(m.replace(/\s/g, ''))) return false;
  return m.length >= minLen;
}

// 深度研究模式：不再根据字数跳过多 agent 分析
// AI 自主判断是否需要深度研究，直接交给 Planner 决策
function isTrivialNewMessage(message) {
  return false;
}

function buildDefaultAgents(message) {
  var m = String(message || '');
  // 智能截断：优先在句号/问号/换行处断开，保证搜索关键词完整
  function smartTruncate(text, maxLen) {
    if (text.length <= maxLen) return text;
    var cut = text.slice(0, maxLen);
    var lastPunct = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('？'), cut.lastIndexOf('！'), cut.lastIndexOf('，'), cut.lastIndexOf('；'), cut.lastIndexOf('\n'));
    if (lastPunct > maxLen * 0.5) return text.slice(0, lastPunct + 1);
    var lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > maxLen * 0.5) return text.slice(0, lastSpace);
    return cut;
  }

  // 如果消息很短（<=5字），从多个解读角度分析
  if (m.length <= 10) {
    return [
      { role: '意图解析', task_description: '分析用户可能的意图和需求', need_search: false, search_queries: [] },
      { role: '多角度解读', task_description: '从不同角度理解问题和深层含义', need_search: true, search_queries: [smartTruncate(m, 40)] },
      { role: '深度回答', task_description: '给出有深度的回答和建议', need_search: false, search_queries: [] }
    ];
  }

  var agents = [];
  // 代码/技术: 要求至少出现 2 个不同的代码特征字符，避免误触
  var codeSpecials = m.match(/[\{\}\(\)\[\];<>\/\\=]/g) || [];
  var uniqueSpecials = {};
  codeSpecials.forEach(function(c) { uniqueSpecials[c] = true; });
  var codeSpecialCount = Object.keys(uniqueSpecials).length;
  if ((codeSpecialCount >= 2 || /[\{\}<>]/.test(m)) && /(代码|编程|程序|bug|报错|算法|api|框架|库|组件|函数|class|import|export|def|function)/i.test(m)) {
    agents.push({ role: '代码诊断', task_description: '检查代码语法、报错原因、边界条件', need_search: true, search_queries: [smartTruncate(m, 40) + ' 报错', smartTruncate(m, 40) + ' 解决方案'] });
    agents.push({ role: '架构建议', task_description: '评估实现方案、最佳实践、可维护性', need_search: true, search_queries: [smartTruncate(m, 40) + ' best practice'] });
    agents.push({ role: '安全审查', task_description: '检查潜在安全风险和性能隐患', need_search: false, search_queries: [] });
    return agents;
  }
  // 决策/购买
  if (/(对比|比较|区别|优劣|哪个|选择|推荐|建议|值得|买|选)/.test(m)) {
    agents.push({ role: '方案梳理', task_description: '整理可选方案/产品/选项', need_search: true, search_queries: [smartTruncate(m, 40)] });
    agents.push({ role: '优劣分析', task_description: '对比各方案优缺点、适用场景', need_search: true, search_queries: [smartTruncate(m, 40) + ' 评测'] });
    agents.push({ role: '决策建议', task_description: '结合需求给出推荐和注意事项', need_search: false, search_queries: [] });
    return agents;
  }
  // 通用分析
  agents.push({ role: '背景梳理', task_description: '梳理问题背景、核心概念和已知事实', need_search: true, search_queries: [smartTruncate(m, 48)] });
  agents.push({ role: '深度分析', task_description: '分析原因、机制、影响因素', need_search: true, search_queries: [smartTruncate(m, 48) + ' 分析'] });
  agents.push({ role: '结论建议', task_description: '总结要点并给出 actionable 建议', need_search: false, search_queries: [] });
  return agents;
}

function buildToolExecutor(sseSend, agentRole, sourcesAccum, queriesAccum, searchCountAccum) {
  return async function(tc) {
    var tRes = null;
    try { tRes = await executeToolCall(tc); } catch (e) {
      tRes = { tool_name: (tc.function && tc.function.name) || '', error: (e && e.message) || '工具执行失败' };
    }
    if (tc.function && tc.function.name === 'search_web') {
      if (searchCountAccum) searchCountAccum.count = (searchCountAccum.count || 0) + 1;
      try {
        var wArgs = JSON.parse(tc.function.arguments || '{}');
        if (wArgs && wArgs.query && queriesAccum) queriesAccum.push(String(wArgs.query).slice(0, 100));
      } catch (e) {}
      var lastQuery = queriesAccum ? queriesAccum[queriesAccum.length - 1] || '' : '';
      if (sseSend) {
        sseSend({ type: 'deep_think_tool', agent_role: agentRole, tool_name: 'search_web', count: (tRes && tRes.results_count) || 0, query: lastQuery });
        sseSend({ type: 'deep_think_stage', stage: 'searching', message: '正在搜索: ' + lastQuery });
      }
      if (tRes && Array.isArray(tRes.results) === false && tRes.content && sourcesAccum) {
        try {
          var wItems = JSON.parse(tRes.content || '[]');
          if (Array.isArray(wItems)) {
            wItems.forEach(function(it) {
              if (it && it.url) sourcesAccum.push({ title: it.title || '', url: it.url, snippet: it.snippet || '', source: it.source || '' });
            });
          }
        } catch (e) {}
      }
    }
    return tRes;
  };
}

// Planner 提示词 — ★ U3 硬核升级: 领域专精引导 + 自我校验 + 智能长度控制
const DEEP_THINK_PLANNER_PROMPT = `你是 XTJ AI 深度研究模式的任务规划器 (Planner).
你的职责: 判断问题复杂度、领域类型, 决定要不要拆解成多个并行 agent, 拆几个, 是否需要搜索.
目标是像顶尖分析师一样 —— **精确、严谨、不啰嗦、该深则深该浅则浅**.

输出严格 JSON (无 markdown 代码块, 无任何额外文字):
{
  "complexity": "low|medium|high",
  "domain": "general|code|finance|science|travel|health|legal",
  "reasoning": "为什么这样安排 (简短一句, 30 字内)",
  "agents": [
    {
      "role": "角色名 (2-6字中文, 如'代码审查'、'数据分析')",
      "task_description": "该 agent 负责什么, 要具体 (60 字内)",
      "need_search": true|false,
      "search_queries": ["关键词1", "关键词2"]
    }
  ]
}

**领域识别规则 (domain):**
- code: 编程/代码/算法/调试/架构设计 → 需要精确逻辑, 可以搜索文档/API
- finance: 投资/理财/股票/加密货币/经济 → 需要实时数据, agent 必搜
- science: 数学/物理/化学/生物/AI/工程 → 需要严谨推理, 可搜学术资料
- travel: 旅游/景点/路线/住宿/签证 → 需要实用信息, agent 必搜
- health: 医疗/养生/药品/症状 → 谨慎(加免责标注), agent 必搜
- legal: 法律/法规/合同/维权 → 必须精确引用法条, agent 必搜
- general: 其他通用问题

**关键决策规则 (★ U3 优化: 按需拆分, 别烧token):**

1. **极简单/闲聊问题 (1+1, 你好, 天气, 时间)**: **agents = [], complexity: low**
   - 直接给答案, 不需要 agent, 不需要搜索
   - 这是纯浪费 token, 直接回答最快

2. **普通/常识问题 (定义解释, 生活常识, 短知识)**: **0-1 个 agent, complexity: low**
   - 不需要搜索, 基于已有知识回答
   - 最多 1 个 agent 找相关数据

3. **稍微复杂的单一主题问题**: **1-2 个 agent, complexity: medium**
   - 代码审查/调试/优化: 拆成 语法+逻辑 两个方向
   - 需要实时数据/最新信息: agent 配搜索

4. **复杂研究/方案对比/跨学科**: **2-{maxWorkers} 个 agent, complexity: high**
   - 每个 agent 独立方面, 不重叠
   - 需要事实/数据时, agent 配搜索

**核心原则: 能少拆就少拆。每个 agent 都在烧 token 和钱。简单问题别装专业。**

**自我校验:**
- 代码相关: 确保 agent 会检查语法正确性、边界条件、安全性
- 金融相关: 确保 agent 会标注数据时效性、提醒投资风险
- 健康相关: 确保 agent 会添加"仅供参考，请咨询专业医生"标注
- 法律相关: 确保 agent 会添加"具体案件请咨询专业律师"标注

**搜索判断:**
- 闲聊/常识/简单计算: need_search = false
- 实时信息/具体数据/事件/API/代码文档: need_search = true
- **景点/地点/旅游/景区/公园/酒店/餐厅/活动**: need_search = true (用户需要最新信息如门票价格、开放时间、当前状况)
- 不确定就 true

`;

const DEEP_THINK_SYNTHESIZER_PROMPT = `你是 XTJ AI 深度研究模式的答案整合者 (Synthesizer).
你的职责: 把 Planner 拆出来的 agent 报告整合成最终答案.

**风格: 像顶尖研究分析师 —— 深度、严谨、有洞察力, 不敷衍不浅薄.**

整合规则 (按 复杂度 + 领域 自适应):

1. **通用原则**: 无论问题长短, 都要给出有深度的回答
   - 短问题也要挖掘深层含义, 从多角度解读
   - 不要因为用户只问了几个字就给 1-2 句敷衍
   - 展现推理过程和分析深度

2. **complexity=medium (中等复杂)**:
   - 整合 agent 内容, 按领域调整结构:
   - 代码领域: 直接给代码+简要说明, 不用标题堆砌. 500-1500 字
   - 金融/科学领域: 数据先行+解释, 2-4 段连贯文字. 500-2000 字
   - 其他领域: 2-4 段连贯文字. 400-1500 字

3. **complexity=high (复杂研究)**:
   - 代码领域: 分块展示 (思路→代码→注意事项), 1000-3000 字
   - 金融/法律/科学: 结构化但口语化, 1000-3500 字
   - 旅游: 用清单/路线, 800-2500 字
   - 健康: 必须加"以上内容仅供参考, 请咨询专业医生". 800-2500 字

**领域专精规则:**
- 代码: 代码块用三反引号包裹, 标注语言, 检查边界条件和安全性
- 金融: 标注数据时效性, 加投资风险提示
- 法律: "以上为法律常识参考, 具体案件请咨询专业律师"
- 健康: "以上内容仅供参考, 请务必咨询执业医师"
- 科学: 区分"已知结论"和"推测/假说", 不确定的标注"可能存在, 需验证"

**多 Agent 整合规则:**
- 你不是简单罗列每个 agent 的报告, 而是把它们融合成一篇连贯答案.
- 识别各 agent 观点的共识与分歧, 明确呈现最终判断.
- 如果 agent 之间有冲突, 指出原因并给出你的综合结论.
- 充分利用搜索结果, 确保数据真实可查, 不要编造.

**通用规则:**
- 直接给答案, 不要说"作为一个 AI"、"以下是..."
- 不要列原始 URL
- 中文回复, 自然口语化
- 不确定就说不确定, 别编
- 代码/列表/标题该用就用
- **深度优先**: 宁可多分析不可浅尝辄止, 每个 agent 的发现都要充分展开`;

// 单价配置（CNY / 1M tokens），可通过环境变量覆盖
//   缓存未命中输入 1 元/1M tokens → DEEPSEEK_INPUT_PRICE_PER_1M
//   缓存命中输入 0.02 元/1M tokens → DEEPSEEK_CACHE_HIT_PRICE_PER_1M
//   输出 2 元/1M tokens → DEEPSEEK_OUTPUT_PRICE_PER_1M
// 若使用 deepseek-v4-pro：INPUT=3, CACHE_HIT=0.025, OUTPUT=6
const DEEPSEEK_INPUT_PRICE_PER_1M   = parseFloat(process.env.DEEPSEEK_INPUT_PRICE_PER_1M   || '1');
const DEEPSEEK_OUTPUT_PRICE_PER_1M  = parseFloat(process.env.DEEPSEEK_OUTPUT_PRICE_PER_1M  || '2');
const DEEPSEEK_CACHE_HIT_PRICE_PER_1M = parseFloat(process.env.DEEPSEEK_CACHE_HIT_PRICE_PER_1M || '0.02');
const DEEPSEEK_CURRENCY = process.env.DEEPSEEK_CURRENCY || 'CNY';
console.log('[AI-CONFIG] DEEPSEEK_API_KEY:', DEEPSEEK_API_KEY ? '已设置' : '未设置（开发模式将使用 mock 回复）');
console.log('[AI-CONFIG] DEEPSEEK_MODEL_REASONER:', DEEPSEEK_MODEL_REASONER);

const AI_AGENT_CONVERSATION_LIST_LIMIT = 50;

// ===================== DeepSeek Function Calling 工具定义 =====================
const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: '搜索网络获取实时信息。使用原则：\n- 必须搜：最新新闻/实时数据/具体事件/价格汇率/天气/人物动态\n- 不要搜：常识问答/简单计算/闲聊寒暄\n- 复杂问题（攻略、对比、调研）拆成3-5 个不同关键词分别搜\n返回结果包含标题、链接、摘要和来源。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，要精准、具体。一个复杂问题可以拆成多个关键词分多次搜索，每次搜索一个具体方面' },
          max_results: { type: 'integer', description: '返回结果数量，默认20', default: 20 }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询某个城市的当前天气和今日天气预报，包括温度、湿度、风速、天气状况、降雨概率。只有在用户明确询问天气时才使用。',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: '城市名称或地区名称，如北京、上海、巴黎、东京等' }
        },
        required: ['location']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: '获取当前的日期、时间、星期几、时区信息。当用户问"几点了""今天几号""今天星期几""现在几点"等时间相关问题时使用。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
];

// Function Calling 工具执行器
async function executeToolCall(toolCall) {
  var name = toolCall.function && toolCall.function.name ? toolCall.function.name : '';
  var rawArgs = toolCall.function && toolCall.function.arguments ? toolCall.function.arguments : '{}';
  var args;
  try { args = JSON.parse(rawArgs); } catch (e) { args = {}; }

  switch (name) {
    case 'search_web': {
      var q = String(args.query || '').trim().slice(0, 200);
      var maxR = Math.min(Math.max(parseInt(args.max_results) || 20, 1), 20);
      if (!q) return { tool_name: name, error: '搜索关键词为空' };
      try {
        var result = await searchWeb(q, maxR);
        var resultsArr = result && result.results ? result.results : [];
        return {
          tool_name: name,
          query: q,
          results_count: resultsArr.length,
          content: JSON.stringify(resultsArr.slice(0, 20)),
          diagnostics: result && result.diagnostics ? result.diagnostics : null
        };
      } catch (e) {
        return { tool_name: name, query: q, error: e && e.message || '搜索失败' };
      }
    }
    case 'get_weather': {
      var loc = String(args.location || '').trim().slice(0, 50);
      if (!loc) return { tool_name: name, error: '位置为空' };
      try {
        var weatherResult = await queryWeather(loc);
        if (weatherResult) {
          return { tool_name: name, location: loc, content: weatherResult };
        }
        // 如果不在已知城市列表，尝试搜索
        return { tool_name: name, location: loc, error: '暂不支持该城市天气查询，支持的城市：北京、上海、广州、深圳、杭州、湖州、安吉、东京、大阪、首尔、济州岛、巴黎、伦敦、纽约' };
      } catch (e) {
        return { tool_name: name, location: loc, error: e && e.message || '天气查询失败' };
      }
    }
    case 'get_current_time': {
      var now = new Date();
      var weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
      var cnf = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
      var weekday = weekdays[now.getDay()];
      var timeResult = '【当前时间】\n北京时间：' + cnf + '\n星期：' + weekday + '\n时区：Asia/Shanghai (UTC+8)';
      return { tool_name: name, content: timeResult };
    }
    default:
      return { tool_name: name, error: '未知工具: ' + name };
  }
}

// 搜索结果自动补全：当结果不足时，从已有结果提取关键词补充搜索
async function autoSupplementSearch(originalQuery, currentResults, maxR) {
  if (!Array.isArray(currentResults)) currentResults = [];
  if (currentResults.length >= 5) return currentResults;
  // 从已有结果的标题/摘要中提取中文关键词
  var keywords = [];
  currentResults.forEach(function(r) {
    var text = (r.title || '') + ' ' + (r.snippet || '');
    var words = text.match(/[\u4e00-\u9fff]{2,6}/g) || [];
    words.forEach(function(w) {
      if (w.length >= 2 && keywords.indexOf(w) < 0) keywords.push(w);
    });
  });
  // 过滤掉原始查询中已出现的词
  var queryWords = originalQuery.match(/[\u4e00-\u9fff]{2,6}/g) || [];
  var newKeywords = keywords.filter(function(k) {
    return !queryWords.some(function(qw) { return qw.indexOf(k) >= 0 || k.indexOf(qw) >= 0; });
  });
  newKeywords = newKeywords.slice(0, 3);
  if (newKeywords.length === 0) return currentResults;
  var existingUrls = {};
  currentResults.forEach(function(r) { if (r.url) existingUrls[r.url] = true; });
  // 并行补充搜索
  var supplementPromises = newKeywords.map(function(kw) {
    return searchWeb(kw, Math.ceil(maxR / 2)).then(function(sr) {
      return (sr && sr.results) || [];
    });
  });
  var extraResultsArrays = await Promise.all(supplementPromises);
  extraResultsArrays.forEach(function(extra) {
    extra.forEach(function(r) {
      if (r.url && !existingUrls[r.url] && r.title) {
        existingUrls[r.url] = true;
        currentResults.push(r);
      }
    });
  });
  return currentResults.slice(0, maxR);
}

// 搜索扩展：当 AI 只搜了少量关键词时，自动提取用户问题中的实体并生成更多搜索
function generateExpandedQueries(userMessage, existingQueries, maxExtra) {
  maxExtra = maxExtra || 3;
  var extra = [];
  var msg = String(userMessage || '').trim().slice(0, 300);

  // 提取地点关键词（严格模式：只提取明显是地名的词）
  var msgClean = msg.replace(/[在去来]/g, ' ').trim();
  var locations = [];
  // 方式1：匹配已知常见地点/城市名（按使用频率排序）
  var knownPlaces = [
    '北京','上海','广州','深圳','杭州','成都','重庆','武汉','西安','南京','苏州','天津','长沙','郑州','东莞','青岛',
    '昆明','大连','厦门','合肥','佛山','福州','哈尔滨','济南','温州','贵阳','南宁','长春','泉州','珠海','太原','南昌',
    '巴黎','伦敦','纽约','东京','悉尼','新加坡','曼谷','香港','澳门','台北','首尔','济州岛','巴厘岛','普吉岛',
    '北海道','大阪','京都','马尔代夫','罗马','米兰','威尼斯','佛罗伦萨','巴塞罗那','马德里','阿姆斯特丹',
    '柏林','慕尼黑','苏黎世','日内瓦','维也纳','布拉格','布达佩斯','迪拜','伊斯坦布尔','开罗','清迈',
    '三亚','丽江','大理','桂林','黄山','张家界','敦煌','拉萨','林芝','九寨沟','峨眉山','长城','故宫'
  ];
  knownPlaces.forEach(function(p) {
    if (msgClean.indexOf(p) >= 0 && locations.indexOf(p) < 0) locations.push(p);
  });
  // 方式2：匹配"X地"模式（X地旅游/攻略/美食等），只取明显带地名的后缀
  var placeSuffixHits = (msgClean.match(/([\u4e00-\u9fff]{2,4})(?:旅游|景点|攻略|美食|天气|新闻|大学|机场|车站|广场|公园|博物馆|美术馆|图书馆|景区)/g) || []);
  placeSuffixHits.forEach(function(s) {
    var place = s.replace(/(旅游|景点|攻略|美食|天气|新闻|大学|机场|车站|广场|公园|博物馆|美术馆|图书馆|景区)$/, '');
    if (!/^(我们|他们|你们|大家|自己|这个|那个|什么|怎么|哪个|这些|那些|所有|没有|还是|或者|可以|需要|应该|想要|正在|已经|之前|之后|目前|一直|经常|有时|很少|不能|可能|必须|一定|随便|一般|基本|整体|感觉|觉得|知道|考虑|打算|计划|建议|推荐|分享|提供|选择|决定|比较|了解|看看|问问|试试|结果|情况|消息|内容|方面|部分|方式|方法|原因|理由|目的|意义|影响|关系)$/.test(place) && place.length >= 2) {
      if (locations.indexOf(place) < 0) locations.push(place);
    }
  });

  var topics = [];
  // 从用户消息提取可能的搜索方向
  if (/攻略|旅游|玩|景点|去/.test(msg)) {
    topics = topics.concat(['攻略', '景点推荐', '美食', '交通', '住宿', '路线', '最佳季节', '注意事项']);
  } else if (/对比|区别|哪个好|vs|VS|还是/.test(msg)) {
    topics = topics.concat(['对比', '评测', '推荐', '价格', '性价比']);
  } else if (/新闻|资讯|最新|报道/.test(msg)) {
    topics = topics.concat(['最新消息', '最新进展', '动态']);
  } else if (/价格|多少钱|费用|预算/.test(msg)) {
    topics = topics.concat(['价格', '费用', '性价比', '优惠']);
  }

  // 已有查询去重
  var existingStr = existingQueries.join('');
  var uniqueTopics = [];
  for (var ti = 0; ti < topics.length; ti++) {
    if (uniqueTopics.length >= maxExtra) break;
    var t = topics[ti];
    if (existingStr.indexOf(t) < 0) uniqueTopics.push(t);
  }

  // 用地点+主题组合生成新搜索词
  var usedLoc = locations.length > 0 ? locations[0] : '';
  for (var ui = 0; ui < uniqueTopics.length; ui++) {
    var q = usedLoc ? usedLoc + uniqueTopics[ui] : uniqueTopics[ui];
    extra.push(q);
  }
  return extra.slice(0, maxExtra);
}

// AI 配置缓存
var aiConfigCache = null;
var aiConfigFetchedAt = 0;

// Web Search 配置
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;   // 有结果缓存 5 分钟
const SEARCH_EMPTY_CACHE_TTL_MS = 30 * 1000;  // 无结果缓存 30 秒
const searchCache = new Map();
const SEARCH_CACHE_MAX_SIZE = 1000;
function limitSearchCacheSize() {
  if (searchCache.size <= SEARCH_CACHE_MAX_SIZE) return;
  var overflow = searchCache.size - SEARCH_CACHE_MAX_SIZE;
  var keys = Array.from(searchCache.keys());
  for (var i = 0; i < overflow && i < keys.length; i++) searchCache.delete(keys[i]);
}
// 每 10 分钟清理过期搜索缓存
setInterval(function() {
  var now = Date.now();
  searchCache.forEach(function(val, key) {
    if (val.expiresAt && now > val.expiresAt) searchCache.delete(key);
  });
  limitSearchCacheSize();
}, 10 * 60 * 1000);

// ===================== 搜索 Provider 架构 =====================
// 每个 provider 返回 { results: [...], error: string|null }
// results 每条为 { title, url, snippet, source, published_at }

// Provider 1: Tavily API
async function searchTavily(query, maxResults) {
  var apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { results: [], error: null }; // 未配置，跳过
  try {
    var resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        max_results: Math.min(maxResults || 5, 20),
        search_depth: 'basic',
        include_answer: false
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) {
      var errBody = await resp.text().catch(function() { return ''; });
      return { results: [], error: 'Tavily status=' + resp.status + ' ' + errBody.slice(0, 100) };
    }
    var data = await resp.json();
    var raw = data && data.results;
    if (!Array.isArray(raw) || !raw.length) return { results: [], error: 'Tavily returned 0 results' };
    var results = raw.map(function(r) {
      return {
        title: String(r.title || '').trim().slice(0, 200),
        url: String(r.url || '').trim(),
        snippet: String(r.content || r.snippet || '').trim().slice(0, 500),
        source: r.source || 'tavily',
        published_at: r.published_date || ''
      };
    }).filter(function(r) { return r.title && r.url; });
    return { results: results.slice(0, maxResults || 5), error: null };
  } catch (e) {
    return { results: [], error: 'Tavily error: ' + (e.message || 'unknown') };
  }
}

// Provider 2: Brave Search API
async function searchBrave(query, maxResults) {
  var apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return { results: [], error: null };
  try {
    var resp = await fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=' + (maxResults || 5), {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) return { results: [], error: 'Brave status=' + resp.status };
    var data = await resp.json();
    var web = data && data.web;
    var raw = web && web.results;
    if (!Array.isArray(raw) || !raw.length) return { results: [], error: 'Brave returned 0 results' };
    var results = raw.map(function(r) {
      return {
        title: String(r.title || '').trim().slice(0, 200),
        url: String(r.url || '').trim(),
        snippet: String(r.description || '').trim().slice(0, 500),
        source: r.source || 'brave',
        published_at: r.age || r.published_date || r.pub_date || ''
      };
    }).filter(function(r) { return r.title && r.url; });
    return { results: results.slice(0, maxResults || 5), error: null };
  } catch (e) {
    return { results: [], error: 'Brave error: ' + (e.message || 'unknown') };
  }
}

// Provider 3: Serper / Google Search API
async function searchSerper(query, maxResults) {
  var apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return { results: [], error: null };
  try {
    var resp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ q: query, num: Math.min(maxResults || 5, 20) }),
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return { results: [], error: 'Serper status=' + resp.status };
    var data = await resp.json();
    var raw = data && data.organic;
    if (!Array.isArray(raw) || !raw.length) return { results: [], error: 'Serper returned 0 results' };
    var results = raw.map(function(r) {
      return {
        title: String(r.title || '').trim().slice(0, 200),
        url: String(r.link || '').trim(),
        snippet: String(r.snippet || '').trim().slice(0, 500),
        source: r.source || 'serper',
        published_at: r.date || r.publicationDate || ''
      };
    }).filter(function(r) { return r.title && r.url; });
    return { results: results.slice(0, maxResults || 5), error: null };
  } catch (e) {
    return { results: [], error: 'Serper error: ' + (e.message || 'unknown') };
  }
}

// Provider 4: 自定义 SEARCH_API_URL（兼容 SearXNG 格式）
async function searchCustomApi(query, maxResults) {
  var apiUrl = process.env.SEARCH_API_URL;
  if (!apiUrl) return { results: [], error: null };
  try {
    var parsedUrl = new URL(apiUrl);
    if (parsedUrl.protocol !== 'https:') return { results: [], error: 'CustomApi must use https' };
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(parsedUrl.hostname)) return { results: [], error: 'CustomApi invalid hostname' };
    apiUrl = apiUrl.replace(/\/+$/, '');
    var url = apiUrl + '/search?q=' + encodeURIComponent(query) + '&format=json&language=zh-CN&safesearch=1&pageno=1&categories=general';
    var resp = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return { results: [], error: 'CustomApi status=' + resp.status };
    var data = await resp.json();
    var raw = data && data.results;
    if (!Array.isArray(raw) || !raw.length) return { results: [], error: 'CustomApi returned 0 results' };
    var results = raw.map(function(r) {
      return {
        title: String(r.title || '').trim().slice(0, 200),
        url: String(r.url || '').trim(),
        snippet: String(r.content || r.snippet || '').trim().slice(0, 500),
        source: r.engine || 'custom',
        published_at: r.publishedDate || ''
      };
    }).filter(function(r) { return r.title && r.url; });
    return { results: results.slice(0, maxResults || 5), error: null };
  } catch (e) {
    return { results: [], error: 'CustomApi error: ' + (e.message || 'unknown') };
  }
}

// Provider 5: SearXNG 公共实例
async function searchSearxng(query, maxResults) {
  var instances = [
    'https://searx.work', 'https://search.leptons.xyz', 'https://searx.si',
    'https://search.sapti.me', 'https://searx.be', 'https://search.projectsegfau.lt',
    'https://searx.raghav.site', 'https://searx.frankfurt.systems',
    'https://searx.foss.family', 'https://searx.tuxcloud.net'
  ];
  if (process.env.SEARCH_API_URL) {
    try {
      var parsedUrl = new URL(process.env.SEARCH_API_URL);
      if (parsedUrl.protocol !== 'https:') throw new Error('must be https');
      if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(parsedUrl.hostname)) throw new Error('invalid hostname');
      var customUrl = process.env.SEARCH_API_URL.replace(/\/+$/, '');
      if (instances.indexOf(customUrl) < 0) instances.unshift(customUrl);
    } catch (e) {
      console.warn('[SEARCH] invalid SEARCH_API_URL, ignored:', e.message);
    }
  }
  var category = /新闻|资讯|报道|快讯|新闻|头条/i.test(query) ? 'news' : 'general';
  var fetchers = instances.map(function(baseUrl) {
    var url = baseUrl + '/search?q=' + encodeURIComponent(query) + '&format=json&language=zh-CN&safesearch=1&categories=' + category + '&pageno=1';
    return fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000)
    }).then(function(r) {
      if (!r.ok) throw new Error(baseUrl.slice(0, 30) + ' status=' + r.status);
      return r.json();
    }).then(function(data) {
      var raw = data && data.results;
      if (!Array.isArray(raw) || !raw.length) throw new Error(baseUrl.slice(0, 30) + ' no results');
      return raw.map(function(item) {
        return {
          title: String(item.title || '').trim().slice(0, 200),
          url: String(item.url || '').trim(),
          snippet: String(item.content || item.snippet || '').trim().slice(0, 500),
          source: item.engine || 'searxng',
          published_at: item.publishedDate || ''
        };
      }).filter(function(r) { return r.title && r.url; });
    }).catch(function(e) {
      throw new Error(e.message || 'unknown error');
    });
  });
  try {
    var winner = await Promise.any(fetchers);
    return { results: (winner || []).slice(0, maxResults || 5), error: null };
  } catch (e) {
    return { results: [], error: 'SearXNG error: all instances failed' };
  }
}

// Provider 6: Bing HTML 解析（最后兜底）
async function searchBingHtml(query, maxResults) {
  try {
    var url = 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&count=' + (maxResults || 5) + '&mkt=zh-CN';
    var resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml'
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) return { results: [], error: 'BingHtml status=' + resp.status };
    var html = await resp.text();
    var items = [];
    var pos = 0;
    while (true) {
      var start = html.indexOf('b_algo', pos);
      if (start < 0) break;
      var liStart = html.lastIndexOf('<li', start);
      if (liStart < 0) { pos = start + 1; continue; }
      var liEnd = html.indexOf('</li>', liStart);
      if (liEnd < 0) { pos = start + 1; continue; }
      var block = html.slice(liStart, liEnd + 5);
      var aHref = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/i);
      var title = aHref ? aHref[2].replace(/<[^>]+>/g, '').trim() : '';
      var urlVal = aHref ? aHref[1] : '';
      var pMatch = block.match(/<p[^>]*>(.*?)<\/p>/i);
      var snippet = pMatch ? pMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      if (title && urlVal) items.push({ title: title, url: urlVal, snippet: snippet, source: 'bing', published_at: '' });
      pos = liEnd + 5;
    }
    return { results: items.slice(0, maxResults || 5), error: null };
  } catch (e) {
    return { results: [], error: 'BingHtml error: ' + (e.message || 'unknown') };
  }
}

// 主搜索函数：按优先级依次尝试 Provider，取第一个成功的结果（避免浪费 API 配额）
async function searchWeb(query, maxResults) {
  maxResults = maxResults || 5;
  var searchQuery = buildSearchQuery(query);
  if (!searchQuery) searchQuery = String(query || '').trim().slice(0, 120);
  var cacheKey = searchQuery.toLowerCase().trim().slice(0, 100);
  var cached = searchCache.get(cacheKey);
  if (cached && cached.results) {
    var cachedResults = cached.results.results || [];
    var cacheTtl = cachedResults.length > 0 ? SEARCH_CACHE_TTL_MS : SEARCH_EMPTY_CACHE_TTL_MS;
    if ((Date.now() - cached.ts) < cacheTtl) return cached.results;
    searchCache.delete(cacheKey);
  }

  // 缓存大小限制（最多 500 条，超出删最旧的）
  if (searchCache.size >= 500) {
    var oldKey = searchCache.keys().next().value;
    if (oldKey) searchCache.delete(oldKey);
  }

  // 按优先级定义 provider 列表（串行：前面的成功就不走后面的，省 API 配额）
  var providerList = [
    { name: 'Tavily', fn: function() { return searchTavily(searchQuery, maxResults); }, requiresEnv: 'TAVILY_API_KEY', enabled: !!process.env.TAVILY_API_KEY },
    { name: 'Brave', fn: function() { return searchBrave(searchQuery, maxResults); }, requiresEnv: 'BRAVE_SEARCH_API_KEY', enabled: !!process.env.BRAVE_SEARCH_API_KEY },
    { name: 'Serper', fn: function() { return searchSerper(searchQuery, maxResults); }, requiresEnv: 'SERPER_API_KEY', enabled: !!process.env.SERPER_API_KEY },
    { name: 'CustomApi', fn: function() { return searchCustomApi(searchQuery, maxResults); }, requiresEnv: 'SEARCH_API_URL', enabled: !!process.env.SEARCH_API_URL },
    { name: 'BingHtml', fn: function() { return searchBingHtml(searchQuery, maxResults); }, requiresEnv: null, enabled: true },
    { name: 'SearXNG', fn: function() { return searchSearxng(searchQuery, maxResults); }, requiresEnv: null, enabled: true }
  ];

  var diagnostics = {
    query: searchQuery,
    enabled_providers: [],
    missing_env: [],
    provider_results: [],
    provider_errors: []
  };

  var mergedResults = [];
  var usedProvider = null;

  // 整体搜索总超时 25 秒
  var searchTimedOut = false;
  var searchTimer = setTimeout(function() { searchTimedOut = true; }, 25000);

  for (var pi = 0; pi < providerList.length; pi++) {
    if (searchTimedOut) break;
    var provider = providerList[pi];
    if (!provider.enabled) {
      diagnostics.missing_env.push(provider.requiresEnv);
      continue;
    }
    diagnostics.enabled_providers.push(provider.name);
    try {
      var result = await provider.fn();
      if (result.error) {
        diagnostics.provider_errors.push({ provider: provider.name, error: result.error });
      } else if (result.results && result.results.length > 0) {
        diagnostics.provider_results.push({ provider: provider.name, count: result.results.length });
        // 取第一个有结果的 provider
        mergedResults = result.results;
        usedProvider = provider.name;
        break;
      } else {
        diagnostics.provider_results.push({ provider: provider.name, count: 0 });
      }
    } catch (e) {
      diagnostics.provider_errors.push({ provider: provider.name, error: e.message || 'unknown' });
    }
  }

  var finalResult = {
    results: mergedResults,
    diagnostics: diagnostics,
    used_provider: usedProvider
  };

  var cacheTtl = mergedResults.length > 0 ? SEARCH_CACHE_TTL_MS : SEARCH_EMPTY_CACHE_TTL_MS;
  searchCache.set(cacheKey, { ts: Date.now(), results: finalResult, expiresAt: Date.now() + cacheTtl });
  limitSearchCacheSize();
  clearTimeout(searchTimer);

  if (searchTimedOut && mergedResults.length === 0) {
    console.warn('[SEARCH] total search timeout (25s) for:', searchQuery);
  }

  return finalResult;
}

// 清洗 AI 最终回复正文，删除括号舞台动作/心理动作/环境描写
// 策略：
//   1. 删除所有独立成行的括号内容（（...）、(...)、【...】）
//   2. 删除以明显动作描述词开头的行
//   3. 删除正文中内联的括号舞台动作
//   保留合法的括号内容：API 说明、价格、编号、技术术语、英文缩写
function sanitizeAssistantVisibleText(text) {
  var s = String(text || '');
  if (!s) return s;

  // 1. 删除所有独立成行的括号内容（允许全角/半角/方括号，至少 3 个字符）
  s = s.replace(/^\s*[（(【][^）)】]{3,200}[）)】]\s*$/gm, '');

  // 2-3. 拆分清洗正则避免单次超长表达式导致的 ReDoS
  var actionSets = [
    '屏幕[上中前里]|镜头[拉推切]|背景[音乐音效]|空气[里中]?[仿佛凝]|灯光[暗亮闪]|白芒|光芒[闪四]',
    '低声[说笑]|笑了笑|轻轻一笑|轻笑[着]?[道说]?|苦笑[着]?[道说]?|沉默[了半片]|叹了[口]?气|叹道|叹了口气',
    '抬起头|低下头|偏了偏头|歪了歪头|侧了侧头|扭了扭头|转过头|转过身|伸出手|伸出爪|缩回[了手成]|抖了抖|晃了晃',
    '点了点头|摇了摇头|摆了摆手|挥了挥手|站起[身来]?|坐[了下]?下|趴[了下]?下|蹲[了下]?下',
    '走[向到进过]|退了[几步回]|眯起眼|瞪[大了]|睁[大了]|眨了眨眼|抿了抿嘴|舔了舔|吞了吞|咽了咽',
    '摇了摇[头尾]|甩了甩[头尾]|敲了敲|靠在[了]?[床头墙椅]?|抱着[了]?[手臂胸]?|搂着[了]?',
    '发出[一]?[阵阵声]|传来[一]?[阵阵声]|响起[一]?[阵阵声]|回荡[着在]|充满[了]?|浮现[出在]',
    '感到[一]?[阵阵]?|仿佛[一]?[股阵道]|猛[地然]|瞬间[间]?|顿[了]?[顿]?|愣[了]?[愣]?|怔[了]?[怔]?|呆[了]?[呆]?',
    '张[了]?[嘴口]|闭[了]?[嘴眼]|合[了]?[上眼]|按下[了]?|周[围的环境]|四[周环]|窗[外口]|门[外口]',
    '不再[说言语]|再也[不没]|终于[还]|仍然[还]|依然[还]|瞥[了]?[一]?眼|盯[着]?[了]?',
    '扯[了]?[嘴嘴角]?|勾[了]?[嘴角]?|扬[了]?[眉嘴角]?|挑[了]?[眉]?|皱[了]?[眉]?',
    '呼出[一]?[口气]?|深吸[一]?[口气]?|爪子[轻挠挠]|猫耳[竖抖]|毛茸茸[的尾巴脑袋]?|尾巴[轻晃摇]'
  ];

  for (var ai = 0; ai < actionSets.length; ai++) {
    var pattern = '^\\s*(' + actionSets[ai] + ')[^。！？\\n]{0,100}[。！？]?\\s*$';
    s = s.replace(new RegExp(pattern, 'gmi'), '');
  }

  for (var ai2 = 0; ai2 < actionSets.length; ai2++) {
    var pattern2 = '[（(【][^）)】]{0,60}(' + actionSets[ai2] + ')[^）)】]{0,80}[）)】]';
    s = s.replace(new RegExp(pattern2, 'gmi'), '');
  }

  // 4. 清理多余空行
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  // 5. 如果清洗后为空，返回标记字符串
  if (!s) return '我刚刚生成了不合规的动作描写，已自动删除。请重新问一次。';

  return s;
}

// Open-Meteo 免费天气查询（无需 API Key）
var CITY_COORDS = {
  '北京': { lat: 39.9042, lon: 116.4074 },
  '上海': { lat: 31.2304, lon: 121.4737 },
  '广州': { lat: 23.1291, lon: 113.2644 },
  '深圳': { lat: 22.5431, lon: 114.0579 },
  '杭州': { lat: 30.2741, lon: 120.1551 },
  '湖州': { lat: 30.8932, lon: 120.0963 },
  '安吉': { lat: 30.6249, lon: 119.6766 },
  '东京': { lat: 35.6762, lon: 139.6503 },
  '大阪': { lat: 34.6937, lon: 135.5023 },
  '首尔': { lat: 37.5665, lon: 126.978 },
  '济州岛': { lat: 33.489, lon: 126.4983 },
  '巴黎': { lat: 48.8566, lon: 2.3522 },
  '伦敦': { lat: 51.5074, lon: -0.1278 },
  '纽约': { lat: 40.7128, lon: -74.006 }
};

async function queryWeather(query) {
  try {
    var matchedCity = null;
    // ★ U3: 按城市名长度倒序匹配, 避免"济州岛"先匹配到"济"或"京"等子串
    var cityNames = Object.keys(CITY_COORDS).sort(function(a, b) { return b.length - a.length; });
    for (var i = 0; i < cityNames.length; i++) {
      var cityName = cityNames[i];
      if (query.indexOf(cityName) >= 0) {
        matchedCity = { name: cityName, coords: CITY_COORDS[cityName] };
        break;
      }
    }
    if (!matchedCity) return null;

    var lat = matchedCity.coords.lat;
    var lon = matchedCity.coords.lon;
    var weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FShanghai';

    var resp = await fetch(weatherUrl, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    var data = await resp.json();
    if (!data || !data.current) return null;

    var current = data.current;
    var daily = data.daily;

    // WMO 天气代码转中文
    var weatherCodes = { 0:'晴天', 1:'大部晴', 2:'多云', 3:'阴天', 45:'雾', 48:'雾凇', 51:'小毛毛雨', 53:'中毛毛雨', 55:'大毛毛雨', 61:'小雨', 63:'中雨', 65:'大雨', 71:'小雪', 73:'中雪', 75:'大雪', 80:'阵雨', 81:'中阵雨', 82:'大阵雨', 85:'小阵雪', 86:'大阵雪', 95:'雷暴', 96:'雷暴加小冰雹', 99:'雷暴加大冰雹' };
    var wmoCode = current.weather_code;
    var weatherDesc = weatherCodes[wmoCode] || ('天气代码 ' + wmoCode);

    var result = '【天气工具结果】\n查询时间：' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + '（北京时间）\n地点：' + matchedCity.name + '\n天气状况：' + weatherDesc + '\n当前温度：' + current.temperature_2m + '°C\n湿度：' + current.relative_humidity_2m + '%\n风速：' + current.wind_speed_10m + 'km/h';
    if (daily) {
      if (daily.temperature_2m_max && daily.temperature_2m_max[0] !== undefined) result += '\n今日最高：' + daily.temperature_2m_max[0] + '°C';
      if (daily.temperature_2m_min && daily.temperature_2m_min[0] !== undefined) result += '\n今日最低：' + daily.temperature_2m_min[0] + '°C';
      if (daily.precipitation_probability_max && daily.precipitation_probability_max[0] !== undefined) result += '\n降雨概率：' + daily.precipitation_probability_max[0] + '%';
    }
    result += '\n\n要求：必须基于以上工具结果回答，不准编造天气数据。';
    return result;
  } catch (e) {
    console.error('[WEATHER] query error:', e && e.message);
    return null;
  }
}

// 网页搜素函数 - 双引擎并行：Bing（全局可用）+ SearXNG（Render US 可用）
// 无需 API Key，取最快返回有效结果的那一个
function writeSse(res, payload) {
  try {
    if (res && !res.writableEnded && res.headersSent) {
      var data = 'data: ' + JSON.stringify(payload) + '\n\n';
      if (!res._sseBuffer) res._sseBuffer = [];
      if (res._sseBuffer.length > 0) {
        res._sseBuffer.push(data);
        return;
      }
      var ok = res.write(data);
      if (!ok) {
        res._sseBuffer.push(data);
        if (!res._sseDrainQueued) {
          res._sseDrainQueued = true;
          res.once('drain', function() {
            res._sseDrainQueued = false;
            if (res._sseBuffer && res._sseBuffer.length > 0) {
              var buf = res._sseBuffer.slice();
              res._sseBuffer = [];
              buf.forEach(function(d) { try { if (!res.writableEnded) res.write(d); } catch(e) {} });
            }
          });
        }
      }
    }
  } catch (e) {
    console.error('[SSE] write error:', e && e.message);
  }
}

// 统一流结束收尾：保存消息 + 发送 done
async function finishStream(res, opt) {
  if (res.writableEnded) return;
  var rawContent = String(opt.contentBuffer || '');
  var content = sanitizeAssistantVisibleText(rawContent);
  var reasoning = String(opt.reasoningBuffer || '');
  var hasContent = content.length > 0;
  var saved = false;
  var finishReason = opt.finishReason || 'upstream_closed';
  var thinkingMode = opt.thinkingMode || 'off';
  var useThinking = opt.useThinking || false;
  var usedModel = opt.usedModel || DEEPSEEK_MODEL_REASONER;
  var isComplete = finishReason === 'stop' || finishReason === 'length' || (hasContent && finishReason === 'upstream_closed') || finishReason === 'idle_timeout' || finishReason === 'partial_content';
  var contentWasFiltered = rawContent.length > 0 && content !== rawContent;
  var searchMeta = opt.searchMeta || null;
  var thinkingElapsedMs = opt.reasoningStartedAt > 0 ? Date.now() - opt.reasoningStartedAt : 0;

  // 有内容时尽量保存
  if (hasContent && opt.userName && opt.convId && opt.message) {
    try {
      var nowSave = Date.now();
      var usageToStore = Object.assign({}, opt.usage || {}, {
        thinking_mode: thinkingMode,
        model: usedModel,
        requested_thinking_mode: thinkingMode,
        applied_thinking_mode: useThinking ? thinkingMode : 'off'
      });
      var seqUser = (opt.streamSeq || 0) + 1;
      var seqAssistant = (opt.streamSeq || 0) + 2;
      var userCreatedAt = new Date(nowSave).toISOString();
      var assistantCreatedAt = new Date(nowSave + 1).toISOString();
      await supabase.from('posts').insert([
        {
          user_name: opt.userName,
          content: opt.message,
          media_type: AI_AGENT_MESSAGE_MARKER,
          media_url: buildMsgMeta('user', opt.convId, null, null, seqUser),
          actor_key: 'ai_msg_conv_' + opt.convId + '_user_' + opt.userName + '_' + nowSave,
          created_at: userCreatedAt
        },
        {
          user_name: opt.userName,
          content: content,
          media_type: AI_AGENT_MESSAGE_MARKER,
          media_url: buildMsgMeta('assistant', opt.convId, usageToStore, reasoning, seqAssistant, searchMeta, thinkingElapsedMs),
          actor_key: 'ai_msg_conv_' + opt.convId + '_agent_' + opt.userName + '_' + (nowSave + 1),
          created_at: assistantCreatedAt
        }
      ]);
      saved = true;
      // console.log('[AGENT-STREAM] saved', 'userName:', opt.userName, 'convId:', String(opt.convId).slice(0, 8), 'content_len:', content.length, 'reasoning_len:', reasoning.length, 'finish_reason:', finishReason);
    } catch (saveErr) {
      console.error('[AGENT-STREAM] save failed:', saveErr && saveErr.message, 'userName:', opt.userName, 'convId:', String(opt.convId).slice(0, 8), 'content_len:', content.length, 'reasoning_len:', reasoning.length);
    }
  }

  // 发送 done
  try { console.log('[SRV-DONE] hasContent:', hasContent, 'content_len:', content.length, 'reasoning_len:', reasoning.length, 'filtered:', contentWasFiltered); } catch(_) {}
  writeSse(res, {
    type: 'done',
    complete: isComplete,
    interrupted: !isComplete,
    saved: saved,
    finish_reason: finishReason,
    content: hasContent ? content : '',
    sanitized_content: contentWasFiltered ? content : undefined,
    filtered: contentWasFiltered || undefined,
    reasoning: thinkingMode !== 'off' ? reasoning : '',
    usage: null,
    model: usedModel,
    thinking_mode: thinkingMode,
    requested_thinking_mode: thinkingMode,
    applied_thinking_mode: useThinking ? thinkingMode : 'off',
    reasoning_length: reasoning.length,
    content_length: content.length,
    search_count: searchMeta ? searchMeta.count : undefined,
    search_query: searchMeta ? searchMeta.query : undefined,
    // ★ P1 关键修复：done 事件带完整 search_results 和 expires_at
    //   前端可立即渲染徽章和结果列表
    search_results: searchMeta && Array.isArray(searchMeta.results) ? searchMeta.results : undefined,
    search_expires_at: searchMeta && typeof searchMeta.expires_at === 'number' ? searchMeta.expires_at : undefined
  });

  // console.log('[AGENT-STREAM] done finish_reason=', finishReason, 'complete=', isComplete, 'saved=', saved, 'content_len=', content.length);

  // 异步更新会话摘要（仅成功保存时）
  if (hasContent && saved) {
    var histArr = opt.ctx ? (opt.ctx.history || []) : [];
    maybeUpdateConversationSummary(opt.userName, opt.convId, histArr).catch(function() {});
  }

  return { saved: saved, content: content };
}

function buildSearchQuery(message) {
  var q = String(message || '').trim();
  var hasTimeWord = /今天|现在|当前|实时|最新/i.test(q);
  var hasNewest = /最新/i.test(q);
  // 不再删除时效词 — 保留原样获得更精准的搜索
  var cleaned = q.slice(0, 120);
  // 包含时效词的问题：追加当前中文日期, 让搜索更精准
  // ★ U3: 避免重复追加 (如"最新的XX"已经有"最新", 不再追加)
  if (hasTimeWord) {
    var now = new Date();
    var dateStr = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日';
    cleaned = cleaned + ' ' + dateStr;
    if (!hasNewest) cleaned = cleaned + ' 最新';
  }
  if (/新闻|资讯|报道|快讯/i.test(q)) {
    return (cleaned + ' 新闻').slice(0, 120);
  }
  if (/价格|多少钱|售价/i.test(q)) {
    return (cleaned + ' 价格').slice(0, 120);
  }
  if (/天气|温度|下雨|降雨/i.test(q)) {
    return ''; // 天气不走搜索
  }
  return cleaned.slice(0, 120);
}

function cleanSearchResults(results, maxCount) {
  maxCount = maxCount || 25;
  if (!Array.isArray(results)) return [];
  var out = [];
  var seenUrl = {};
  var seenTitle = {};
  // ★ U3: URL 协议白名单, 防止 javascript:/data:text/html 等危险协议
  var ALLOWED_URL_PROTOCOLS = ['http:', 'https:'];
  function isUrlSafe(url) {
    if (!url) return false;
    var lower = url.toLowerCase().trim();
    // 提取协议部分
    var colonIdx = lower.indexOf(':');
    if (colonIdx < 0) return true; // 相对路径
    var proto = lower.slice(0, colonIdx + 1);
    for (var i = 0; i < ALLOWED_URL_PROTOCOLS.length; i++) {
      if (proto === ALLOWED_URL_PROTOCOLS[i]) return true;
    }
    return false;
  }
  results.forEach(function(r) {
    if (!r) return;
    var u = (r.url || '').trim();
    var t = (r.title || '').trim();
    var s = (r.snippet || '').trim();
    // ★ U3: 过滤危险协议 URL
    if (u && !isUrlSafe(u)) return;
    // 跳过完全没有内容的结果
    if (!u && !t && !s) return;
    // URL 去重
    if (u && seenUrl[u]) return;
    if (u) seenUrl[u] = true;
    // 标题模糊去重：取标题前 10 个字作为指纹
    var titleKey = t.replace(/[\s\-—·•·,，。！？、；：""''（）()\[\]【】《》<>]/g, '').slice(0, 10);
    if (titleKey && seenTitle[titleKey]) return;
    if (titleKey) seenTitle[titleKey] = true;
    // 标题兜底
    if (!t) t = (s || u || '').slice(0, 40);
    // 评分：有摘要的优先，有来源的优先，标题更完整的优先
    var score = 0;
    if (s.length > 20) score += 3;
    else if (s.length > 0) score += 1;
    if (r.source && r.source !== 'web') score += 1;
    if (t.length > 8) score += 1;
    if (u) score += 1;
    out.push({ url: u, title: t, snippet: s, source: (r.source || 'web'), published_at: r.published_at || '', _score: score });
  });
  // 按评分降序排列，高分优先
  out.sort(function(a, b) { return (b._score || 0) - (a._score || 0); });
  // 去掉 _score 字段再返回
  return out.slice(0, maxCount).map(function(item) {
    return { url: item.url, title: item.title, snippet: item.snippet, source: item.source, published_at: item.published_at };
  });
}

// ===================== Gmail SMTP 邮件配置 =====================
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
// ★ 启动时打印邮件环境变量状态（便于 Render Dashboard Logs 调试）
console.log('[MAIL-CONFIG] GMAIL_USER:', GMAIL_USER ? '已设置' : '未设置');
console.log('[MAIL-CONFIG] GMAIL_APP_PASSWORD:', GMAIL_APP_PASSWORD ? '已设置' : '未设置');
console.log('[MAIL-CONFIG] SENDGRID_API_KEY:', process.env.SENDGRID_API_KEY ? '已设置' : '未设置');
console.log('[MAIL-CONFIG] GMAIL_GAS_URL:', process.env.GMAIL_GAS_URL ? '已设置' : '未设置');
var mailTransporter = null;
var mailTransporterPort = null;
function getMailTransporter() {
  if (mailTransporter && mailTransporterPort) return mailTransporter;
  if (!nodemailer) {
    console.warn('[MAIL] nodemailer 未安装，邮件功能不可用');
    return null;
  }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.warn('[MAIL] GMAIL_USER 或 GMAIL_APP_PASSWORD 未配置，邮件功能不可用');
    return null;
  }
  // 优先使用 465 SSL，如果连接失败在 sendMail 时自动回退到 587
  mailTransporterPort = process.env.SMTP_PORT || '465';
  var isSecure = mailTransporterPort === '465';
  mailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: parseInt(mailTransporterPort),
    secure: isSecure,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000
  });
  return mailTransporter;
}

// ===================== 输入校验 =====================
const MAX_USERNAME_LEN = 50;
const MAX_REASON_LEN = 500;
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 5000;

// ===================== 系统 marker 常量（集中定义，避免 TDZ 问题） =====================
// 所有 media_type 字符串集中在文件前面定义，下方 helper / 路由可直接引用
const REPORT_MARKER = '__report__';
const DM_MARKER = '__dm__';
const AUTH_MARKER = '__auth__';
const VISIT_MARKER = '__visit__';
const ATTACK_MARKER = '__attack__';
const ADMIN_AUTH_MARKER = '__admin_auth__';
const ADMIN_META_MARKER = '__admin_meta__';
const USER_INFO_MARKER = '__user_info__';
const USER_VISIT_MARKER = '__user_visit__';
const LOGIN_EVENT_MARKER = '__login_event__';
const SECURITY_ALERT_MARKER = '__security_alert__';
const AUDIT_LOG_MARKER = '__admin_audit__';
const CLIENT_ERROR_MARKER = '__client_error__';
// VIP / Pro 相关
const VIP_MARKER = '__vip__';
const VIP_ORDER_MARKER = '__vip_order__';
const VIP_PLAN_MARKER = '__vip_plan__';
const PRO_GIFT_MARKER = '__pro_gift__';
const PRO_GIFT_CLAIM_MARKER = '__pro_gift_claim__';
// 公告已读（跨设备同步用户已读公告）
const ANN_READ_MARKER = '__ann_read__';
// 邮件 / 历史邮箱
const EMAIL_SENT_MARKER = '__email_sent__';
const EMAIL_RECIPIENT_MARKER = '__email_recipient_history__';

// ===================== AI 智能体 marker =====================
// 所有 AI 相关数据使用 posts 表 + marker 集中存储（与现有 Pro Gift / VIP / 公告同模式）
// ★ 必须加入 applyPublicPostExclusions() 避免出现在普通帖子 feed、统计、后台列表
const AI_AGENT_PROFILE_MARKER = '__ai_agent_profile__';
const AI_AGENT_MESSAGE_MARKER = '__ai_agent_msg__';
const AI_AGENT_CONFIG_MARKER = '__ai_agent_config__';
const AI_AGENT_CONV_SUMMARY_MARKER = '**ai_agent_conv_summary**';
const USER_STYLE_MARKER = '__user_style__';
const AI_ENGLISH_LEARNING_MARKER = '__ai_english_learning__';
const REVOKED_TOKEN_MARKER = '__revoked_token__';

const LOGIN_LOG_RETENTION_DAYS = 90;
const SECURITY_LOG_RETENTION_DAYS = 90;
const ERROR_LOG_RETENTION_DAYS = 30;

// ===================== 通用 posts 查询过滤 helper =====================
// 集中处理普通帖子 / 总动态 / 后台管理 / 统计 端点需要排除的 system media_type
// 与前端 applyVisiblePostQueryFilters 保持一致（22 个 marker）
// 必须放在所有 marker 常量定义之后、路由定义之前
function applyPublicPostExclusions(query) {
  if (!query || typeof query.neq !== 'function') return query;
  return query
    .neq('media_type', AUTH_MARKER)
    .neq('media_type', ADMIN_AUTH_MARKER)
    .neq('media_type', ADMIN_META_MARKER)
    .neq('media_type', DM_MARKER)
    .neq('media_type', REPORT_MARKER)
    .neq('media_type', '__avatar__')
    .neq('media_type', USER_INFO_MARKER)
    .neq('media_type', '__photo_wall__')
    .neq('media_type', VISIT_MARKER)
    .neq('media_type', ATTACK_MARKER)
    .neq('media_type', USER_VISIT_MARKER)
    .neq('media_type', '__ann__')
    .neq('media_type', VIP_MARKER)
    .neq('media_type', VIP_ORDER_MARKER)
    .neq('media_type', VIP_PLAN_MARKER)
    .neq('media_type', USER_STYLE_MARKER)
    .neq('media_type', PRO_GIFT_MARKER)
    .neq('media_type', PRO_GIFT_CLAIM_MARKER)
    .neq('media_type', LOGIN_EVENT_MARKER)
    .neq('media_type', SECURITY_ALERT_MARKER)
    .neq('media_type', AUDIT_LOG_MARKER)
    .neq('media_type', CLIENT_ERROR_MARKER)
    .neq('media_type', EMAIL_SENT_MARKER)
    .neq('media_type', EMAIL_RECIPIENT_MARKER)
    .neq('media_type', ANN_READ_MARKER)
    .neq('media_type', AI_AGENT_PROFILE_MARKER)
    .neq('media_type', AI_AGENT_MESSAGE_MARKER)
    .neq('media_type', AI_AGENT_CONFIG_MARKER)
    .neq('media_type', AI_AGENT_CONV_SUMMARY_MARKER)
    .neq('media_type', AI_ENGLISH_LEARNING_MARKER)
    .neq('media_type', REVOKED_TOKEN_MARKER);
}

// 统计数据内存缓存（减少数据库查询，带 promise 锁防并发重复查询）
let statsCache = { data: null, ts: 0, pending: null };
const STATS_CACHE_TTL = 60000; // 1分钟

// 记录访问日志
async function logVisit(ip) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('posts').insert([{
      user_name: ip || 'unknown',
      content: JSON.stringify({ date: today }),
      media_type: VISIT_MARKER,
      media_url: today,
      actor_key: 'visit_' + Date.now()
    }]);
  } catch(e) { console.warn('[LOG] Visit logging failed:', e && e.message); }
}

// 记录攻击/拦截日志
async function logAttack(ip, type, detail) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('posts').insert([{
      user_name: ip || 'unknown',
      content: JSON.stringify({ type, detail: String(detail || '').slice(0, 200), date: today }),
      media_type: ATTACK_MARKER,
      media_url: type,
      actor_key: 'attack_' + Date.now()
    }]);
  } catch(e) { console.warn('[LOG] Visit logging failed:', e && e.message); }
}

// 访问计数去重（同IP同天只计一次，按天自动清理）
const visitCache = new Map(); // ip_date -> true
let visitCacheCleanupTimeout = null;
function shouldCountVisit(ip) {
  const today = new Date().toISOString().slice(0, 10);
  const key = ip + '_' + today;
  if (visitCache.has(key)) return false;
  visitCache.set(key, true);
  // ★ 修复 M7：异步延迟清理，避免同步 forEach 阻塞事件循环
  if (visitCache.size > 10000 && !visitCacheCleanupTimeout) {
    visitCacheCleanupTimeout = setTimeout(function() {
      visitCacheCleanupTimeout = null;
      var keysToDelete = [];
      visitCache.forEach(function(_, k) {
        if (!k.endsWith('_' + today)) keysToDelete.push(k);
      });
      keysToDelete.forEach(function(k) { visitCache.delete(k); });
    }, 100);
  }
  return true;
}

const ADMIN_STATS_PAGE_SIZE = 1000;

function safeJsonParse(input) {
  try {
    const parsed = JSON.parse(input || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function toTimeMs(value) {
  if (!value) return NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function pickEarlierIso(currentValue, candidateValue) {
  const currentMs = toTimeMs(currentValue);
  const candidateMs = toTimeMs(candidateValue);
  if (!Number.isFinite(candidateMs)) return currentValue || null;
  if (!Number.isFinite(currentMs) || candidateMs < currentMs) return candidateValue;
  return currentValue || null;
}

function pickLaterIso(currentValue, candidateValue) {
  const currentMs = toTimeMs(currentValue);
  const candidateMs = toTimeMs(candidateValue);
  if (!Number.isFinite(candidateMs)) return currentValue || null;
  if (!Number.isFinite(currentMs) || candidateMs > currentMs) return candidateValue;
  return currentValue || null;
}

function getUtcDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = toTimeMs(value);
  if (!Number.isFinite(ms)) {
    return typeof value === 'string' ? value.slice(0, 10) : '';
  }
  return new Date(ms).toISOString().slice(0, 10);
}

async function fetchAllPostsByMediaType(mediaType, selectFields) {
  let from = 0;
  let results = [];
  while (true) {
    const { data, error } = await supabase.from('posts')
      .select(selectFields)
      .eq('media_type', mediaType)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + ADMIN_STATS_PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = data || [];
    results = results.concat(chunk);
    if (chunk.length < ADMIN_STATS_PAGE_SIZE) break;
    from += ADMIN_STATS_PAGE_SIZE;
  }
  return results;
}

function buildAuthUserMap(authRows) {
  const authMap = {};
  (authRows || []).forEach(row => {
    const userName = String(row && row.user_name || '').trim();
    if (!userName) return;
    const createdAt = row.created_at || null;
    if (!authMap[userName]) {
      authMap[userName] = { user_name: userName, auth_created_at: createdAt };
      return;
    }
    authMap[userName].auth_created_at = pickEarlierIso(authMap[userName].auth_created_at, createdAt);
  });
  return authMap;
}

function buildUserInfoMap(userInfoRows) {
  const userInfoMap = {};
  (userInfoRows || []).forEach(row => {
    const userName = String(row && row.user_name || '').trim();
    if (!userName) return;
    const info = safeJsonParse(row.content);
    if (!userInfoMap[userName]) {
      userInfoMap[userName] = {
        reg_time: info.reg_time || null,
        last_login: info.last_login || null,
        last_visit: info.last_visit || null
      };
      return;
    }
    userInfoMap[userName].reg_time = pickEarlierIso(userInfoMap[userName].reg_time, info.reg_time);
    userInfoMap[userName].last_login = pickLaterIso(userInfoMap[userName].last_login, info.last_login);
    userInfoMap[userName].last_visit = pickLaterIso(userInfoMap[userName].last_visit, info.last_visit);
  });
  return userInfoMap;
}

function buildUserVisitMap(visitRows) {
  const userVisitMap = {};
  (visitRows || []).forEach(row => {
    const userName = String(row && row.user_name || '').trim();
    if (!userName) return;
    if (!userVisitMap[userName]) {
      userVisitMap[userName] = { total_visits: 0, daily_visits: {}, last_visit: null };
    }
    userVisitMap[userName].total_visits += 1;
    const content = safeJsonParse(row.content);
    const visitDateKey = getUtcDateKey(row.media_url || content.date || row.created_at);
    if (visitDateKey) {
      userVisitMap[userName].daily_visits[visitDateKey] = (userVisitMap[userName].daily_visits[visitDateKey] || 0) + 1;
    }
    userVisitMap[userName].last_visit = pickLaterIso(userVisitMap[userName].last_visit, row.created_at || null);
  });
  return userVisitMap;
}

function getEffectiveRegTime(authInfo, userInfo) {
  return userInfo && userInfo.reg_time || authInfo && authInfo.auth_created_at || null;
}

function buildAdminUsersPayload(authRows, userInfoRows) {
  const authMap = buildAuthUserMap(authRows);
  const userInfoMap = buildUserInfoMap(userInfoRows);
  const allUserNames = new Set([
    ...Object.keys(authMap),
    ...Object.keys(userInfoMap)
  ]);

  return Array.from(allUserNames).map(userName => {
    const authInfo = authMap[userName] || {};
    const info = userInfoMap[userName] || {};
    const effectiveRegTime = getEffectiveRegTime(authInfo, info);
    return {
      user_name: userName,
      created_at: effectiveRegTime,
      content: JSON.stringify({
        reg_time: effectiveRegTime,
        auth_created_at: authInfo.auth_created_at || null,
        last_login: info.last_login || null,
        last_visit: info.last_visit || null
      })
    };
  }).sort((a, b) => {
    const ta = toTimeMs(a.created_at);
    const tb = toTimeMs(b.created_at);
    if ((Number.isFinite(tb) ? tb : 0) !== (Number.isFinite(ta) ? ta : 0)) {
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    }
    return String(a.user_name || '').localeCompare(String(b.user_name || ''), 'zh-CN');
  });
}

function buildRegisteredUsersByDate(authMap) {
  const dateMap = {};
  Object.keys(authMap || {}).forEach(userName => {
    const authCreatedAt = authMap[userName] && authMap[userName].auth_created_at;
    const dateKey = getUtcDateKey(authCreatedAt);
    if (dateKey) dateMap[dateKey] = (dateMap[dateKey] || 0) + 1;
  });
  return dateMap;
}

async function getAdminMetaRecord(mediaUrl) {
  var query = supabase.from('posts')
    .select('id, content, created_at')
    .eq('media_type', ADMIN_META_MARKER)
    .eq('user_name', ADMIN_USERNAME);
  if (mediaUrl) query = query.eq('media_url', mediaUrl);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

async function saveAdminMetaFields(fields, mediaUrl) {
  var query = supabase.from('posts')
    .select('id, content, created_at')
    .eq('media_type', ADMIN_META_MARKER)
    .eq('user_name', ADMIN_USERNAME);
  if (mediaUrl) query = query.eq('media_url', mediaUrl);
  const { data: existingRows } = await query.order('created_at', { ascending: false }).limit(1);
  var existing = existingRows && existingRows.length ? existingRows[0] : null;
  const nextContent = Object.assign({}, safeJsonParse(existing && existing.content), fields || {});
  if (existing && existing.id) {
    const { error } = await supabase.from('posts')
      .update({ content: JSON.stringify(nextContent) })
      .eq('id', existing.id);
    if (error) throw error;
    return { id: existing.id, content: nextContent };
  }
  var insertPayload = {
    user_name: ADMIN_USERNAME,
    content: JSON.stringify(nextContent),
    media_type: ADMIN_META_MARKER,
    actor_key: ADMIN_META_MARKER
  };
  if (mediaUrl) insertPayload.media_url = mediaUrl;
  const { data, error } = await supabase.from('posts').insert([insertPayload]).select('id, content').limit(1);
  if (error) throw error;
  return data && data.length ? data[0] : { id: null, content: nextContent };
}

function buildUnreadRegisterAlertPayload(authMap, baselineIso) {
  const baselineMs = toTimeMs(baselineIso);
  const unreadUsers = Object.keys(authMap || {}).map(userName => {
    return {
      user_name: userName,
      register_time: authMap[userName] && authMap[userName].auth_created_at || null
    };
  }).filter(entry => {
    const registerMs = toTimeMs(entry.register_time);
    return Number.isFinite(registerMs) && Number.isFinite(baselineMs) && registerMs > baselineMs;
  }).sort((a, b) => {
    return (toTimeMs(b.register_time) || 0) - (toTimeMs(a.register_time) || 0);
  });
  return {
    unread_count: unreadUsers.length,
    latest_register_at: unreadUsers.length ? unreadUsers[0].register_time : null,
    users: unreadUsers
  };
}

function sanitizeError(err) {
  if (!err) return '操作失败';
  console.error('[API Error]', err.message || err);
  if (err.code === '42501' || err.code === 'PGRST301') return '权限不足';
  if (err.code === '23505') return '数据已存在';
  return '操作失败，请稍后重试';
}
async function sendAdminDm(toUserName, content) {
  if (!toUserName || !content || toUserName === ADMIN_USERNAME) return;
  try {
    await supabase.from('posts').insert([{
      user_name: ADMIN_USERNAME,
      content: String(content).slice(0, 2000),
      media_type: DM_MARKER,
      media_url: toUserName,
      actor_key: 'admin_notify_' + Date.now()
    }]);
  } catch(e) {
    console.error('[admin dm send]', e && e.message ? e.message : e);
  }
}
function validateString(val, maxLen, fieldName) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (s.length > maxLen) {
    return { error: `${fieldName}不能超过${maxLen}个字符` };
  }
  return s || null;
}

function isProtectedAdminTarget(userName) {
  return String(userName || '').trim() === ADMIN_USERNAME;
}

function validateDurationHours(value) {
  const raw = value === undefined || value === null || value === '' ? 0 : Number(value);
  if (!Number.isFinite(raw) || raw < 0) return { error: '时长格式不正确' };
  if (raw > 24 * 365) return { error: '时长不能超过1年' };
  return { value: Math.floor(raw) };
}

// ===================== 中间件 ======================
// CORS 限制：自动检测 + 白名单
app.use(cors({
  origin: function (origin, callback) {
    // 允许无 origin 的请求（如 curl、Postman、同源请求）
    if (!origin) return callback(null, true);
    // 检查白名单
    if (ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    // 自动检测模式：检查是否匹配服务器域名或已知域名
    if (ALLOWED_ORIGINS.length === 0) {
      try {
        var originHost = new URL(origin).hostname;
        // 允许同域名（通过 SERVER_HOSTNAME 或 Render 环境变量）、本地开发域名
        if (originHost === SERVER_HOSTNAME || originHost === 'localhost' || originHost === '127.0.0.1') {
          return callback(null, true);
        }
      } catch(e) {}
    }
    // 返回 403（错误由后续错误处理器记录日志并返回 403）
    var err = new Error('不允许的来源');
    err.status = 403;
    callback(err);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));

// CORS 错误处理器（此处的 req 可用，用于记录攻击日志）
app.use(function corsErrorHandler(err, req, res, next) {
  if (err.message === '不允许的来源') {
    console.warn('[CORS] Rejected origin ' + (req.headers.origin || 'unknown'));
    logAttack(getRealIp(req), 'CORS', 'Rejected origin: ' + (req.headers.origin || '').slice(0, 100));
    return res.status(403).json({ error: '不允许的来源' });
  }
  next(err);
});

app.use(express.json({ limit: '5mb' }));

// HTTPS 重定向（生产环境强制跳转 HTTPS）
app.use((req, res, next) => {
  if (!req.secure && req.headers['x-forwarded-proto'] !== 'https') {
    const host = (req.headers.host || '').toLowerCase();
    // ★ U3: 白名单域名防止 open redirect
    const allowedHosts = [
      'xtj.onrender.com',
      'localhost',
      '127.0.0.1'
    ];
    var hostAllowed = false;
    for (var hi = 0; hi < allowedHosts.length; hi++) {
      if (host === allowedHosts[hi] || host.endsWith('.' + allowedHosts[hi])) {
        hostAllowed = true;
        break;
      }
    }
    if (hostAllowed && !host.startsWith('localhost:') && !host.startsWith('127.0.0.1:')) {
      return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
    }
  }
  next();
});

// 安全响应头 + CSRF 防护 + 访问记录（放在静态文件之前，确保 HTML 也带上安全头）
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://ithowxqignlhkwaykglt.supabase.co https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; media-src 'self' https:; connect-src 'self' https://ithowxqignlhkwaykglt.supabase.co wss://ithowxqignlhkwaykglt.supabase.co; font-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});

// 访问记录 + CSRF 防护（必须放在 express.static 之前，否则 GET / 被静态文件截断不会记录）
app.use(function(req, res, next) {
  // 访问记录（只记录 GET /，排除 /health 避免 cron ping 产生垃圾数据）
  const ip = getRealIp(req);
  if (req.method === 'GET' && req.path === '/') {
    if (shouldCountVisit(ip)) {
      logVisit(ip);
    }
  }

  // CSRF 防护：对非 GET/HEAD/OPTIONS 请求检查 Origin/Referer
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers['origin'] || '';
    const referer = req.headers['referer'] || '';
    const host = req.headers['host'] || '';
    // 同源判断：无 origin（curl/Postman）、或 origin 匹配 Host 头、或匹配服务器域名
    const isSameOrigin = !origin || (function() {
      try {
        var originHost = new URL(origin).host;
        // 精确匹配：origin 的 host 必须等于 Host 头或服务器域名
        return originHost === host || originHost === SERVER_HOSTNAME;
      } catch(e) { return false; }
    })();
    const allowed = isSameOrigin || ALLOWED_ORIGINS.some(function(o) {
      return origin === o || referer.startsWith(o + '/');
    });
    if (!allowed && origin) {
      logAttack(ip, 'CSRF', 'Origin: ' + origin.slice(0, 100));
      return res.status(403).json({ error: '拒绝跨站请求' });
    }
  }

  next();
});

// 阻止敏感路径被静态文件服务泄露
app.use(function(req, res, next) {
  var p = req.path;
  // 精确文件匹配
  var exact = ['/package.json', '/package-lock.json', '/render.yaml', '/vercel.json', '/README.md', '/CHANGELOG.md', '/bug_audit_report.md', '/security_best_practices_report.md'];
  if (exact.indexOf(p) >= 0) return res.status(404).end();
  // 目录前缀匹配
  var dirs = ['/render-api/', '/scripts/', '/tests/', '/supabase/', '/mcp-servers/', '/node_modules/', '/docs/', '/.git/'];
  for (var i = 0; i < dirs.length; i++) { if (p.indexOf(dirs[i]) === 0) return res.status(404).end(); }
  // 后缀匹配
  if (p.endsWith('.bak') || p.endsWith('.md') || p.indexOf('/fix-') === 0 || p.indexOf('/scan-') === 0 || p.indexOf('/check-') === 0) return res.status(404).end();
  next();
});

// 托管前端静态文件（index.html, admin.html, js/ 等）
app.use(express.static(path.join(__dirname, '..'), {
  maxAge: '1h',
  setHeaders: function(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// 频率限制中间件
const rateLimitStore = new Map();
// 每5分钟清理过期的限流记录，防止内存泄漏
setInterval(function() {
  var now = Date.now();
  rateLimitStore.forEach(function(record, key) {
    if (now > record.resetAt) rateLimitStore.delete(key);
  });
}, 300000);
function getRealIp(req) {
  // trust proxy 已配置，req.ip 返回真实客户端 IP
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// 获取客户端 IP（信任 req.ip，由 trust proxy 解析 X-Forwarded-For，用于登录事件记录）
function getClientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// UA 解析（后端用，与前端 js/login-device.js 规则一致）
function detectDeviceTypeFromUA(ua) {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile\/\w+/i.test(ua))) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mobi/i.test(ua)) return 'Mobile';
  return 'Desktop';
}

function detectOSFromUA(ua) {
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile\/\w+/i.test(ua))) return 'iPadOS';
  if (/iPhone|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

function detectBrowserFromUA(ua) {
  if (/MicroMessenger/i.test(ua)) return 'WeChat';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'Unknown';
}


// 根据屏幕参数推测 iPhone 疑似型号（iOS/Safari 不稳定暴露具体型号，非精确识别）
function getPossibleDeviceModel(info) {
  info = info || {};
  var ua = String(info.user_agent || '');
  var platform = String(info.platform || '');
  var maxTouchPoints = Number(info.max_touch_points || 0);
  var sw = Number(info.screen_width || info.visual_viewport_width || info.inner_width || (info.screen && String(info.screen).split('x')[0])) || 0;
  var sh = Number(info.screen_height || info.visual_viewport_height || info.inner_height || (info.screen && String(info.screen).split('x')[1])) || 0;
  var dpr = Number(info.device_pixel_ratio || info.dpr) || 0;
  var isIPhone = /iPhone/i.test(ua) || (/Mac/i.test(platform) && maxTouchPoints > 1 && Math.min(sw, sh) < 600);
  if (!isIPhone) return '';
  if (!sw || !sh) return '';
  var key = Math.min(sw, sh) + 'x' + Math.max(sw, sh) + '@' + (dpr || '');
  var modelMap = {
    '440x956@3': '疑似 iPhone 16 Pro Max / iPhone 17 Pro Max',
    '402x874@3': '疑似 iPhone 16 Pro / iPhone 17 / iPhone 17 Pro',
    '393x852@3': '疑似 iPhone 14 Pro / iPhone 15 / iPhone 15 Pro / iPhone 16',
    '430x932@3': '疑似 iPhone 14 Pro Max / iPhone 15 Plus / iPhone 15 Pro Max / iPhone 16 Plus',
    '428x926@3': '疑似 iPhone 12 Pro Max / iPhone 13 Pro Max / iPhone 14 Plus',
    '390x844@3': '疑似 iPhone 12 / iPhone 12 Pro / iPhone 13 / iPhone 13 Pro / iPhone 14',
    '375x812@3': '疑似 iPhone X / iPhone XS / iPhone 11 Pro / iPhone 12 mini / iPhone 13 mini',
    '414x896@3': '疑似 iPhone XS Max / iPhone 11 Pro Max',
    '414x896@2': '疑似 iPhone XR / iPhone 11',
    '414x736@3': '疑似 iPhone 6 Plus / 6s Plus / 7 Plus / 8 Plus',
    '375x667@2': '疑似 iPhone 6 / 6s / 7 / 8 / SE（第 2/3 代）',
    '320x568@2': '疑似 iPhone 5 / 5s / SE（第 1 代）'
  };
  return modelMap[key] || '';
}

// 记录管理员登录事件（静默，不影响登录流程）
async function logAdminLoginEvent(req) {
  try {
    const ip = getClientIp(req);
    const ua = String(req.headers['user-agent'] || '');
    const deviceId = 'admin_' + crypto.createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 32);
    const loginAt = new Date().toISOString();
    const random = Math.random().toString(36).slice(2, 10);

    var ipLocation = null;
    try { ipLocation = await resolveIpLocation(ip); } catch(e) {}

    const { error } = await supabase.from('posts').insert([{
      user_name: ADMIN_USERNAME,
      media_type: LOGIN_EVENT_MARKER,
      media_url: deviceId,
      content: JSON.stringify({
        device_id: deviceId,
        device_type: detectDeviceTypeFromUA(ua),
        os: detectOSFromUA(ua),
        browser: detectBrowserFromUA(ua),
        user_agent: ua,
        ip: ip,
        ip_location: ipLocation,
        login_at: loginAt,
        is_admin: true,
        source: 'admin_login'
      }),
      actor_key: 'admin_login_' + Date.now() + '_' + random
    }]);
    if (error) {
      console.warn('[AdminLoginEvent] 写入失败:', error.message || error);
    }

    // 同步更新管理员 user_info
    if (!error) {
      try {
        const now = new Date().toISOString();
        const { data: existingInfo } = await supabase.from('posts')
          .select('id, content')
          .eq('user_name', ADMIN_USERNAME)
          .eq('media_type', USER_INFO_MARKER)
          .maybeSingle();

        var info = {};
        if (existingInfo) {
          try { info = JSON.parse(existingInfo.content || '{}'); } catch(e) {}
        }

        info.last_login = now;
        if (!info.last_visit) info.last_visit = now;
        info.last_device = detectDeviceTypeFromUA(ua) + ' · ' + detectOSFromUA(ua) + ' · ' + detectBrowserFromUA(ua);
        info.last_ip = ip;
        if (ipLocation) info.last_ip_location = ipLocation;

        if (existingInfo) {
          await supabase.from('posts').update({ content: JSON.stringify(info) }).eq('id', existingInfo.id);
        }
      } catch(e) {
        console.warn('[AdminLoginEvent] 同步 user_info 失败:', e.message || e);
      }
    }
  } catch(e) {
    console.warn('[AdminLoginEvent] 记录异常:', e.message || e);
  }
}

// IP 地区解析（多源 fallback: ip-api.com → ipapi.co → ipwho.is）
async function resolveIpLocation(ip) {
  if (!ip || ip === 'unknown') return null;
  if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return null;
  if (ip.match(/^172\.(1[6-9]|2\d|3[01])\./)) return null;
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return null;

  const fetchers = [
    async function() {
      var controller = new AbortController();
      var timeout = setTimeout(function() { controller.abort(); }, 2000);
      var resp = await fetch('https://ip-api.com/json/' + encodeURIComponent(ip) + '?fields=status,country,regionName,city,query,as,org,isp,mobile,proxy,hosting', { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error('ip-api.com HTTP ' + resp.status);
      var data = await resp.json();
      if (data.status !== 'success') throw new Error('ip-api.com status: ' + data.status);
      return { country: data.country || '', region: data.regionName || '', city: data.city || '', asn: data.as || '', isp: data.isp || '', org: data.org || '', is_mobile: !!data.mobile, is_proxy: !!data.proxy, is_hosting: !!data.hosting };
    },
    async function() {
      var controller = new AbortController();
      var timeout = setTimeout(function() { controller.abort(); }, 2500);
      var resp = await fetch('https://ipapi.co/' + encodeURIComponent(ip) + '/json/', { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error('ipapi.co HTTP ' + resp.status);
      var data = await resp.json();
      if (data.error) throw new Error('ipapi.co error: ' + (data.reason || data.error));
      return { country: data.country_name || '', region: data.region || '', city: data.city || '' };
    },
    async function() {
      var controller = new AbortController();
      var timeout = setTimeout(function() { controller.abort(); }, 2500);
      var resp = await fetch('https://ipwho.is/' + encodeURIComponent(ip), { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error('ipwho.is HTTP ' + resp.status);
      var data = await resp.json();
      if (!data.success) throw new Error('ipwho.is not success');
      return { country: data.country || '', region: data.region || '', city: data.city || '' };
    }
  ];

  for (var i = 0; i < fetchers.length; i++) {
    try {
      var result = await fetchers[i]();
      var parts = [result.country, result.region, result.city].filter(Boolean);
      return {
        country: result.country,
        region: result.region,
        city: result.city,
        text: parts.length > 0 ? parts.join(' · ') : '未知',
        asn: result.asn || '',
        isp: result.isp || '',
        org: result.org || '',
        is_mobile: result.is_mobile || false,
        is_proxy: result.is_proxy || false,
        is_hosting: result.is_hosting || false
      };
    } catch(e) {
      console.warn('[IP] 解析源 ' + (i + 1) + ' 失败:', e.message || e);
    }
  }
  console.warn('[IP] 所有解析源均失败，返回 null:', ip);
  return null;
}

// ===================== 安全检测逻辑 =====================

// 写入安全提醒到 posts 表
async function insertSecurityAlert(alert) {
  try {
    await supabase.from('posts').insert([{
      user_name: alert.user_name || 'system',
      media_type: SECURITY_ALERT_MARKER,
      media_url: alert.type || 'unknown',
      content: JSON.stringify({
        type: alert.type,
        level: alert.level || 'warning',
        user_name: alert.user_name,
        ip: alert.ip || null,
        ip_location_text: alert.ip_location_text || null,
        related_users: alert.related_users || [],
        reason: alert.reason || '',
        is_read: false,
        ignored: false,
        false_positive: false,
        reviewed_at: null,
        reviewed_by: null
      }),
      actor_key: 'sec_alert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
    }]);
  } catch(e) {
    console.warn('[Security] 写入安全提醒失败:', e.message || e);
  }
}

// 管理员审计日志
async function logAdminAudit(action, operator, detail) {
  try {
    await supabase.from('posts').insert([{
      user_name: operator || 'system',
      media_type: AUDIT_LOG_MARKER,
      media_url: action,
      content: JSON.stringify({
        action: action,
        operator: operator,
        detail: String(detail || '').slice(0, 500),
        timestamp: new Date().toISOString()
      }),
      actor_key: 'audit_' + Date.now()
    }]);
  } catch(e) {
    console.warn('[Audit] 审计日志写入失败:', e.message);
  }
}

// 自动清理旧日志
async function cleanupOldLogs(type) {
  try {
    var days = type === 'error' ? ERROR_LOG_RETENTION_DAYS : (type === 'login' || type === 'security' ? LOGIN_LOG_RETENTION_DAYS : 90);
    var cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    var mediaType;
    if (type === 'login') mediaType = LOGIN_EVENT_MARKER;
    else if (type === 'security') mediaType = SECURITY_ALERT_MARKER;
    else if (type === 'error') mediaType = CLIENT_ERROR_MARKER;
    else return { deleted: 0 };

    var { data, error } = await supabase.from('posts')
      .select('id')
      .eq('media_type', mediaType)
      .lt('created_at', cutoff);
    if (error || !data || !data.length) return { deleted: 0 };

    var ids = data.map(function(r) { return r.id; });
    // Delete in batches of 100
    var deleted = 0;
    for (var i = 0; i < ids.length; i += 100) {
      var batch = ids.slice(i, i + 100);
      await supabase.from('posts').delete().in('id', batch);
      deleted += batch.length;
    }
    return { deleted: deleted };
  } catch(e) {
    console.warn('[Cleanup] 清理 ' + type + ' 日志失败:', e.message);
    return { deleted: 0, error: e.message };
  }
}

// 检查同 IP 24h 内多账号登录
async function checkSameIpMultiUsers(userName, ip, ipLocation) {
  if (!ip || ip === 'unknown') return;
  var since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    var { data } = await supabase.from('posts')
      .select('user_name, content')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    if (!data || !data.length) return;

    var ipUsers = {};
    data.forEach(function(row) {
      try {
        var c = JSON.parse(row.content || '{}');
        if (c.ip === ip && row.user_name !== userName) {
          ipUsers[row.user_name] = true;
        }
      } catch(e) {}
    });

    var related = Object.keys(ipUsers);
    if (related.length >= 1) {
      var ipLevel = related.length >= 3 ? 'high' : 'warning';
      // 去重检查
      var dupSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      var { data: existingAlert } = await supabase.from('posts')
        .select('id')
        .eq('media_type', SECURITY_ALERT_MARKER)
        .eq('media_url', 'same_ip_multi_users')
        .eq('user_name', userName)
        .gte('created_at', dupSince)
        .limit(1);
      if (existingAlert && existingAlert.length > 0) return;

      await insertSecurityAlert({
        type: 'same_ip_multi_users',
        level: ipLevel,
        user_name: userName,
        ip: ip,
        ip_location_text: ipLocation ? ipLocation.text : null,
        related_users: [userName].concat(related),
        reason: '同一 IP ' + ip + ' 在 24 小时内登录了 ' + (related.length + 1) + ' 个账号'
      });
    }
  } catch(e) {
    console.warn('[Security] checkSameIpMultiUsers 异常:', e.message || e);
  }
}

// 检查同 device_id 多账号登录
async function checkSameDeviceMultiUsers(userName, deviceId, ip, ipLocation) {
  if (!deviceId) return;
  try {
    var { data } = await supabase.from('posts')
      .select('user_name, content')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .eq('media_url', deviceId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (!data || !data.length) return;

    var deviceUsers = {};
    data.forEach(function(row) {
      if (row.user_name !== userName) {
        deviceUsers[row.user_name] = true;
      }
    });

    var related = Object.keys(deviceUsers);
    if (related.length >= 1) {
      // 去重检查
      var dupSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      var { data: existingAlert } = await supabase.from('posts')
        .select('id')
        .eq('media_type', SECURITY_ALERT_MARKER)
        .eq('media_url', 'same_device_multi_users')
        .eq('user_name', userName)
        .gte('created_at', dupSince)
        .limit(1);
      if (existingAlert && existingAlert.length > 0) return;

      await insertSecurityAlert({
        type: 'same_device_multi_users',
        level: 'high',
        user_name: userName,
        ip: ip,
        ip_location_text: ipLocation ? ipLocation.text : null,
        related_users: [userName].concat(related),
        reason: '同一设备 ID ' + deviceId.slice(0, 12) + '... 登录了 ' + (related.length + 1) + ' 个账号'
      });
    }
  } catch(e) {
    console.warn('[Security] checkSameDeviceMultiUsers 异常:', e.message || e);
  }
}

// 检查同账号短时间内多 IP
async function checkMultiIpSameUser(userName, ip, ipLocation) {
  if (!ip || ip === 'unknown') return;
  var since = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1小时
  try {
    var { data } = await supabase.from('posts')
      .select('content, created_at')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .eq('user_name', userName)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!data || !data.length) return;

    var ips = {};
    data.forEach(function(row) {
      try {
        var c = JSON.parse(row.content || '{}');
        if (c.ip && c.ip !== ip) {
          ips[c.ip] = true;
        }
      } catch(e) {}
    });

    var diffIps = Object.keys(ips);
    if (diffIps.length >= 2) {
      // 去重检查
      var dupSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      var { data: existingAlert } = await supabase.from('posts')
        .select('id')
        .eq('media_type', SECURITY_ALERT_MARKER)
        .eq('media_url', 'multi_ip_same_user')
        .eq('user_name', userName)
        .gte('created_at', dupSince)
        .limit(1);
      if (existingAlert && existingAlert.length > 0) return;

      await insertSecurityAlert({
        type: 'multi_ip_same_user',
        level: 'high',
        user_name: userName,
        ip: ip,
        ip_location_text: ipLocation ? ipLocation.text : null,
        related_users: [userName],
        reason: '账号 ' + userName + ' 在 1 小时内使用了 ' + (diffIps.length + 1) + ' 个不同 IP'
      });
    }
  } catch(e) {
    console.warn('[Security] checkMultiIpSameUser 异常:', e.message || e);
  }
}

// 检查同账号地区变化
async function checkGeoChange(userName, ipLocation, currentLoginAt) {
  if (!ipLocation || !ipLocation.country) return;
  try {
    var { data } = await supabase.from('posts')
      .select('content')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .eq('user_name', userName)
      .lt('created_at', currentLoginAt)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!data || !data.length) return;

    var lastLoc = null;
    for (var i = 0; i < data.length; i++) {
      try {
        var c = JSON.parse(data[i].content || '{}');
        if (c.ip_location && c.ip_location.country) {
          lastLoc = c.ip_location;
          break;
        }
      } catch(e) {}
    }

    if (lastLoc && lastLoc.country !== ipLocation.country) {
      // 去重检查
      var dupSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      var { data: existingAlert } = await supabase.from('posts')
        .select('id')
        .eq('media_type', SECURITY_ALERT_MARKER)
        .eq('media_url', 'geo_change')
        .eq('user_name', userName)
        .gte('created_at', dupSince)
        .limit(1);
      if (existingAlert && existingAlert.length > 0) return;

      await insertSecurityAlert({
        type: 'geo_change',
        level: 'info',
        user_name: userName,
        ip: null,
        ip_location_text: ipLocation.text,
        related_users: [userName],
        reason: '账号 ' + userName + ' 地区从 ' + (lastLoc.text || lastLoc.country) + ' 变为 ' + ipLocation.text
      });
    }
  } catch(e) {
    console.warn('[Security] checkGeoChange 异常:', e.message || e);
  }
}

// 检查同账号短时间内 page_visit 过多
async function checkHighFrequencyVisit(userName, source, ip, ipLocation) {
  if (source !== 'page_visit') return;
  var since = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5分钟
  try {
    var { data } = await supabase.from('posts')
      .select('id')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .eq('user_name', userName)
      .gte('created_at', since)
      .limit(100);
    if (!data || data.length < 30) return;

    // 检查最近是否已生成同类提醒（去重）
    var recentSince = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    var { data: existing } = await supabase.from('posts')
      .select('id')
      .eq('media_type', SECURITY_ALERT_MARKER)
      .eq('media_url', 'high_frequency_visit')
      .eq('user_name', userName)
      .gte('created_at', recentSince)
      .limit(1);

    if (existing && existing.length > 0) return;

    await insertSecurityAlert({
      type: 'high_frequency_visit',
      level: 'info',
      user_name: userName,
      ip: ip,
      ip_location_text: ipLocation ? ipLocation.text : null,
      related_users: [userName],
      reason: '账号 ' + userName + ' 在 5 分钟内产生了 ' + data.length + ' 次页面访问'
    });
  } catch(e) {
    console.warn('[Security] checkHighFrequencyVisit 异常:', e.message || e);
  }
}

// 检查相同浏览器指纹多账号登录
async function checkSameBrowserFingerprintMultiUsers(userName, browserFp, ip, ipLocation) {
  if (!browserFp) return;
  var since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    var { data } = await supabase.from('posts')
      .select('user_name, content')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500);
    if (!data || !data.length) return;

    var fpUsers = {};
    data.forEach(function(row) {
      if (row.user_name === userName) return;
      try {
        var c = JSON.parse(row.content || '{}');
        if (c.browser_fingerprint_hash === browserFp) {
          fpUsers[row.user_name] = true;
        }
      } catch(e) {}
    });

    var related = Object.keys(fpUsers);
    if (related.length >= 1) {
      // 去重
      var dupSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      var { data: existingAlert } = await supabase.from('posts')
        .select('id')
        .eq('media_type', SECURITY_ALERT_MARKER)
        .eq('media_url', 'same_browser_fp_multi_users')
        .eq('user_name', userName)
        .gte('created_at', dupSince)
        .limit(1);
      if (existingAlert && existingAlert.length > 0) return;

      await insertSecurityAlert({
        type: 'same_browser_fp_multi_users',
        level: 'warning',
        user_name: userName,
        ip: ip,
        ip_location_text: ipLocation ? ipLocation.text : null,
        related_users: [userName].concat(related),
        reason: '相同浏览器指纹 ' + browserFp.slice(0, 12) + '... 登录了 ' + (related.length + 1) + ' 个账号'
      });
    }
  } catch(e) {
    console.warn('[Security] checkSameBrowserFingerprintMultiUsers 异常:', e.message || e);
  }
}

// 检查相同 Canvas 指纹多账号登录
async function checkSameCanvasFingerprintMultiUsers(userName, canvasFp, ip, ipLocation) {
  if (!canvasFp) return;
  var since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    var { data } = await supabase.from('posts')
      .select('user_name, content')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500);
    if (!data || !data.length) return;

    var fpUsers = {};
    data.forEach(function(row) {
      if (row.user_name === userName) return;
      try {
        var c = JSON.parse(row.content || '{}');
        if (c.canvas_fingerprint_hash === canvasFp) {
          fpUsers[row.user_name] = true;
        }
      } catch(e) {}
    });

    var related = Object.keys(fpUsers);
    if (related.length >= 1) {
      // 去重
      var dupSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      var { data: existingAlert } = await supabase.from('posts')
        .select('id')
        .eq('media_type', SECURITY_ALERT_MARKER)
        .eq('media_url', 'same_canvas_fp_multi_users')
        .eq('user_name', userName)
        .gte('created_at', dupSince)
        .limit(1);
      if (existingAlert && existingAlert.length > 0) return;

      await insertSecurityAlert({
        type: 'same_canvas_fp_multi_users',
        level: 'warning',
        user_name: userName,
        ip: ip,
        ip_location_text: ipLocation ? ipLocation.text : null,
        related_users: [userName].concat(related),
        reason: '相同 Canvas 指纹 ' + canvasFp.slice(0, 12) + '... 登录了 ' + (related.length + 1) + ' 个账号'
      });
    }
  } catch(e) {
    console.warn('[Security] checkSameCanvasFingerprintMultiUsers 异常:', e.message || e);
  }
}

// 统一安全检测入口（登录事件写入后调用）
async function runSecurityChecks(userName, deviceId, ip, ipLocation, source, currentLoginAt, browserFp, canvasFp) {
  // 检查安全提醒开关
  try {
    var { data: settingsData } = await supabase.from('posts')
      .select('content')
      .eq('media_type', ADMIN_META_MARKER)
      .eq('media_url', 'security_settings')
      .maybeSingle();
    if (settingsData && settingsData.content) {
      var s = JSON.parse(settingsData.content);
      if (s.security_alerts === false) return;
    }
  } catch(e) {}
  // 并行执行各项检查
  await Promise.allSettled
    ? await Promise.allSettled([
        checkSameIpMultiUsers(userName, ip, ipLocation),
        checkSameDeviceMultiUsers(userName, deviceId, ip, ipLocation),
        checkMultiIpSameUser(userName, ip, ipLocation),
        checkGeoChange(userName, ipLocation, currentLoginAt),
        checkHighFrequencyVisit(userName, source, ip, ipLocation),
        checkSameBrowserFingerprintMultiUsers(userName, browserFp, ip, ipLocation),
        checkSameCanvasFingerprintMultiUsers(userName, canvasFp, ip, ipLocation)
      ])
    : await Promise.all([
        checkSameIpMultiUsers(userName, ip, ipLocation).catch(function(){}),
        checkSameDeviceMultiUsers(userName, deviceId, ip, ipLocation).catch(function(){}),
        checkMultiIpSameUser(userName, ip, ipLocation).catch(function(){}),
        checkGeoChange(userName, ipLocation, currentLoginAt).catch(function(){}),
        checkHighFrequencyVisit(userName, source, ip, ipLocation).catch(function(){}),
        checkSameBrowserFingerprintMultiUsers(userName, browserFp, ip, ipLocation).catch(function(){}),
        checkSameCanvasFingerprintMultiUsers(userName, canvasFp, ip, ipLocation).catch(function(){})
      ]);
}

function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const key = getRealIp(req) + ':' + req.path;
    const now = Date.now();
    const record = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }
    if (record.count >= maxRequests) {
      logAttack(key, 'RATE_LIMIT', req.method + ' ' + req.path);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    record.count++;
    rateLimitStore.set(key, record);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));
    next();
  };
}

// ===================== DeepSeek 统一调用封装 =====================
// ★ 调用 DeepSeek API 的唯一入口
// - API Key 从后端 DEEPSEEK_API_KEY 读取，绝对不出现在前端 / 日志
// - 内置 25s 超时控制（AbortController），避免长请求拖死 Express 进程
// - 未配置 API Key 时返 mock 回复（开发模式 + 本地无 Key 测试）
// - 错误信息统一脱敏，不暴露 DeepSeek 原始错误给前端调用方
// ===================== 文件内容提取 (PDF/DOCX/XLSX/TXT) =====================
async function extractEmbeddedFiles(text) {
  if (!text || typeof text !== 'string') return text;
  var result = text;
  // 匹配 ![](data:...) 和 [](data:...) 模式
  var fileRegex = /(!?)\[([^\]]*)\]\(data:([^,;]+);?[^,]*?(?:;base64)?,(.+?)\)/g;
  var match;
  var fileIndex = 0;
  var totalBytes = 0;
  while ((match = fileRegex.exec(text)) !== null) {
    var fileName = match[2] || ('file_' + (fileIndex + 1));
    var mimeType = match[3];
    var base64Data = match[4];
    fileIndex++;
    var extractedText = '';
    var estimatedBytes = Math.ceil(base64Data.length * 0.75);
    totalBytes += estimatedBytes;
    try {
      if (fileIndex > 10) {
        extractedText = '\n\n【文件数量超过 10 个，跳过剩余文件】\n\n';
      } else if (estimatedBytes > 10 * 1024 * 1024 || totalBytes > 50 * 1024 * 1024) {
        extractedText = '\n\n【文件: ' + fileName + ' 超过大小限制，跳过解析】\n\n';
      } else {
        var buffer = Buffer.from(base64Data, 'base64');
        if (mimeType === 'application/pdf' && pdfParser) {
          var pdfData = await pdfParser(buffer);
          extractedText = pdfData.text || '';
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && mammothParser) {
          var mammothResult = await mammothParser.extractRawText({ buffer: buffer });
          extractedText = mammothResult.value || '';
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && xlsxParser) {
          var workbook = xlsxParser.read(buffer, { type: 'buffer' });
          var sheets = [];
          workbook.SheetNames.forEach(function(sName) {
            var sheet = workbook.Sheets[sName];
            var csv = xlsxParser.utils.sheet_to_csv(sheet, { blankrows: false });
            sheets.push('【工作表: ' + sName + '】\n' + csv);
          });
          extractedText = sheets.join('\n\n');
        } else if (mimeType.startsWith('text/') || mimeType === 'text/csv') {
          extractedText = buffer.toString('utf-8');
        } else if (mimeType.startsWith('image/')) {
          extractedText = '[用户上传了一张图片: ' + fileName + ' (' + mimeType + '), 当前暂不支持图片识别]';
        } else {
          try {
            extractedText = buffer.toString('utf-8').slice(0, 5000);
            if (!extractedText.trim()) extractedText = '[文件: ' + fileName + ' (' + mimeType + '), 无法提取可读内容]';
          } catch (e) {
            extractedText = '[文件: ' + fileName + ' (' + mimeType + '), 无法解析内容]';
          }
        }
        if (extractedText.length > 10000) extractedText = extractedText.slice(0, 10000) + '\n\n[内容过长, 已截断]';
        extractedText = '\n\n【用户上传文件: ' + fileName + '】\n' + extractedText + '\n【文件结束】\n\n';
      }
    } catch (e) {
      extractedText = '\n\n【用户上传文件: ' + fileName + '】\n[文件解析失败: ' + (e.message || '') + ']\n【文件结束】\n\n';
    }
    // 所有分支都替换，不保留原始 Base64
    result = result.replace(match[0], extractedText || '\n\n【文件解析跳过】\n\n');
  }
  return result;
}

// ===================== 1. DeepSeek 统一封装 =====================
// 比旧 callDeepSeek 更干净的接口，支持 jsonMode、stream、tools
// 使用方式:
//   const result = await callDeepSeekAI({ messages, jsonMode: true })
//   const content = await callDeepSeekAI({ messages, system: '你是个助手' })
async function callDeepSeekAI(opts) {
  var messages = opts.messages || [];
  var system = opts.system || '';
  var jsonMode = opts.jsonMode === true;
  var stream = opts.stream === true;
  var model = opts.model || DEEPSEEK_MODEL_REASONER;
  var thinkingMode = opts.thinking_mode || 'low';
  var maxTokens = opts.max_tokens || 2048;
  var temperature = opts.temperature ?? 0.3;

  if (system) messages = [{ role: 'system', content: system }, ...messages];

  var apiOpts = {
    thinking_mode: thinkingMode,
    model: model,
    max_tokens: maxTokens,
    temperature: temperature
  };
  if (jsonMode) apiOpts.response_format = { type: 'json_object' };
  if (stream) {
    apiOpts.onThinkingChunk = opts.onThinkingChunk;
    apiOpts.onContentChunk = opts.onContentChunk;
  }

  try {
    var result = await callDeepSeek(messages, apiOpts);
    var content = result.content || '';
    if (jsonMode) {
      try { return JSON.parse(content); } catch (e) {
        var m = content.match(/\{[\s\S]*\}/);
        if (m) try { return JSON.parse(m[0]); } catch (e2) {}
        return null;
      }
    }
    return content;
  } catch (e) {
    console.error('[AI] callDeepSeekAI failed:', e && e.message);
    return jsonMode ? null : '';
  }
}

// ===================== 2. 异步 Job 队列 =====================
// 用于 brain 整理、深度思考等后台任务
async function enqueueJob(userName, jobType, refTable, refId) {
  try {
    await supabase.from('ai_jobs').insert({
      user_name: userName, job_type: jobType,
      ref_table: refTable, ref_id: refId,
      status: 'queued', scheduled_at: new Date().toISOString()
    });
  } catch (e) { console.error('[JOBS] enqueue error:', e && e.message); }
}

async function processBrainJob(job) {
  var refId = job.ref_id;
  try {
    await supabase.from('ai_jobs').update({ status: 'running' }).eq('id', job.id);
    var { data: row } = await supabase.from('brain_nodes').select('*').eq('id', refId).single();
    if (!row || !row.raw_content) throw new Error('记录不存在');

    var prompt = '你是一个知识整理助手。分析以下内容，提取结构化信息。\n\n' +
      '内容: "' + String(row.raw_content).slice(0, 2000) + '"\n\n' +
      '严格按 JSON 格式返回，不要多余文字:\n' +
      '{\n  "title": "简短标题（10字内）",\n  "summary": "一句话总结（20字内）",\n' +
      '  "tags": ["标签1","标签2"],\n  "people": ["提到的人名"],\n' +
      '  "type": "knowledge|idea|diary|plan|question",\n  "mood": "happy|sad|neutral|excited|anxious"\n}\n\n' +
      '规则: tags 2-5个关键词；people 提取所有人名，没人则[]；type 判断内容类型；mood 判断情绪。';

    var result = await callDeepSeekAI({ messages: [{ role: 'user', content: '' }], system: prompt, jsonMode: true, max_tokens: 1024 });
    var updateData = {
      status: result ? 'completed' : 'failed',
      ai_title: (result && result.title) || '',
      ai_summary: (result && result.summary) || '',
      tags: (result && Array.isArray(result.tags)) ? result.tags : [],
      people: (result && Array.isArray(result.people)) ? result.people : [],
      node_type: (result && result.type) || 'note',
      updated_at: new Date().toISOString()
    };
    await supabase.from('brain_nodes').update(updateData).eq('id', refId);
    await supabase.from('ai_jobs').update({ status: 'succeeded', result: 'ok', updated_at: new Date().toISOString() }).eq('id', job.id);
  } catch (e) {
    console.error('[JOBS] process error for', refId, ':', e && e.message);
    await supabase.from('ai_jobs').update({ status: 'failed', error: String(e && e.message || '').slice(0, 500), updated_at: new Date().toISOString() }).eq('id', job.id);
    await supabase.from('brain_nodes').update({ status: 'failed' }).eq('id', refId);
  }
}

async function processNextJob() {
  try {
    var { data: jobs } = await supabase.from('ai_jobs')
      .select('*').eq('status', 'queued').order('scheduled_at', { ascending: true }).limit(1);
    if (!jobs || !jobs.length) return;
    var job = jobs[0];
    if (job.job_type === 'organize' && job.ref_table === 'brain_nodes') await processBrainJob(job);
  } catch (e) { console.error('[JOBS] processNext error:', e && e.message); }
}

// worker 轮询（每 5 秒）
setInterval(function() { processNextJob().catch(function() {}); }, 5000);

// ===================== 3. Brain/Memory CRUD =====================
app.post('/api/brain/add', authenticateUser, async (req, res) => {
  try {
    var userName = req.userName;
    var rawContent = String(req.body && req.body.content || '').trim();
    var isPublic = req.body && req.body.is_public === true;
    if (!rawContent) return res.status(400).json({ error: '内容不能为空' });
    if (rawContent.length > 10000) return res.status(400).json({ error: '内容太长' });

    var { data, error } = await supabase.from('brain_nodes').insert({
      user_name: userName, raw_content: rawContent, node_type: 'note', status: 'pending', is_public: isPublic
    }).select('id').single();
    if (error) return res.status(500).json({ error: '保存失败' });

    await enqueueJob(userName, 'organize', 'brain_nodes', data.id);
    res.json({ ok: true, id: data.id, status: 'pending' });
  } catch (e) { res.status(500).json({ error: '服务器错误' }); }
});

app.get('/api/brain/list', authenticateUser, async (req, res) => {
  try {
    var userName = req.userName;
    var tag = String(req.query.tag || '').trim();
    var type = String(req.query.type || '').trim();
    var limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    var offset = Math.max(parseInt(req.query.offset) || 0, 0);

    var query = supabase.from('brain_nodes').select('*', { count: 'exact' })
      .eq('user_name', userName).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (tag) query = query.contains('tags', [tag]);
    if (type) query = query.eq('node_type', type);

    var { data, count, error } = await query;
    if (error) return res.status(500).json({ error: '查询失败' });
    res.json({ ok: true, data: data || [], total: count || 0 });
  } catch (e) { res.status(500).json({ error: '服务器错误' }); }
});

app.get('/api/brain/graph', authenticateUser, async (req, res) => {
  try {
    var userName = req.userName;
    var { data } = await supabase.from('brain_nodes')
      .select('tags, people').eq('user_name', userName).not('people', 'is', null).not('people', 'eq', '{}');

    var personMap = {}, tagMap = {}, edges = [];
    (data || []).forEach(function(row) {
      (row.people || []).forEach(function(p) { personMap[p] = (personMap[p] || 0) + 1; });
      (row.tags || []).forEach(function(t) { tagMap[t] = (tagMap[t] || 0) + 1; });
      (row.people || []).forEach(function(p) { (row.tags || []).forEach(function(t) { edges.push({ source: p, target: t }); }); });
    });

    var nodes = [];
    Object.keys(personMap).forEach(function(k) { nodes.push({ id: k, type: 'person', weight: personMap[k] }); });
    Object.keys(tagMap).forEach(function(k) { nodes.push({ id: k, type: 'tag', weight: tagMap[k] }); });
    res.json({ ok: true, nodes: nodes, edges: edges });
  } catch (e) { res.status(500).json({ error: '查询失败' }); }
});

async function callDeepSeek(messages, options) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('AI 调用参数无效');
  }

  // 开发模式：API Key 未配置时返 mock 回复
  if (!DEEPSEEK_API_KEY) {
    var lastUser = null;
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i] && messages[i].role === 'user') { lastUser = messages[i].content; break; }
    }
    return {
      content: '[MOCK 回复 · DeepSeek API Key 未配置]\n' +
             '我已收到你的消息：' + String(lastUser || '').slice(0, 80) + '\n\n' +
             '请在 Render Dashboard 配置 DEEPSEEK_API_KEY 后重启服务即可使用真实模型。',
      usage: null,
      tool_calls_info: []
    };
  }

  var thinkingLevel = (options && options.thinking_mode) || 'off';
  var useThinking = thinkingLevel !== 'off';
  var model = DEEPSEEK_MODEL_REASONER;
  if (options && options.model) model = options.model;
  var reasoningEffort = useThinking ? thinkingLevel : '';
  var useTools = !!(options && options.tools && Array.isArray(options.tools) && options.tools.length > 0);
  var toolChoice = (options && options.tool_choice) || (useTools ? 'auto' : null);
  var toolExecutor = (options && typeof options.tool_executor === 'function') ? options.tool_executor : executeToolCall;
  // ★ 防止爆：tool_use 最多循环 4 次
  var maxToolRounds = Math.min(Math.max(parseInt(options && options.max_tool_rounds) || 4, 1), 8);
  try { console.log('[DEEPSEEK] thinking_mode:', thinkingLevel, 'useThinking:', useThinking, 'model:', model, 'reasoning_effort:', reasoningEffort, 'useTools:', useTools); } catch (e) {}
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, useThinking ? 120000 : DEEPSEEK_TIMEOUT_MS);
  // ★ U3 修复: signal listener 内存泄漏 — 用 { once: true } 自动清理
  if (options && options.signal) {
    var _onExternalAbort = function() { try { controller.abort(); } catch (e) {} };
    if (options.signal.aborted) {
      try { controller.abort(); } catch (e) {}
    } else {
      options.signal.addEventListener('abort', _onExternalAbort, { once: true });
    }
  }

  // 用于汇总 tool_use 信息（返回给上层做徽章 / 计费 / 统计）
  var toolCallsInfo = [];
  // 用于 usage 累计
  var totalUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 0
  };

  try {
    var finalContent = '';
    var finalReasoning = '';
    var finalModel = model;
    var workingMessages = messages.slice();
    var lastUsage = null;

    for (var round = 0; round < maxToolRounds; round++) {
      if (round > 0) {
        clearTimeout(timer);
        timer = setTimeout(function() { controller.abort(); }, useThinking ? 120000 : DEEPSEEK_TIMEOUT_MS);
      }
      // V2: 只要给了 onThinkingChunk 或 onContentChunk 回调就用流式, 让答案也能流式推送
      var hasThinkCb = (options && typeof options.onThinkingChunk === 'function');
      var hasContentCb = (options && typeof options.onContentChunk === 'function');
      var useStream = !!(hasThinkCb || hasContentCb);
      // 第 2+ 轮 tool round 禁用流式(避免混乱), 只在最终答案轮(无tool_calls时)用流式
      if (round > 0) useStream = false;
      var apiBody = {
        model: model,
        messages: workingMessages,
        stream: useStream
      };
      if (useThinking) {
        apiBody.thinking = { type: 'enabled' };
        apiBody.reasoning_effort = thinkingLevel;
      }
      if (options && options.response_format) {
        apiBody.response_format = options.response_format;
      }
      if (useTools) {
        apiBody.tools = options.tools;
        if (toolChoice) apiBody.tool_choice = toolChoice;
      }
      if (options && options.max_tokens && typeof options.max_tokens === 'number') {
        apiBody.max_tokens = options.max_tokens;
      }

      var resp = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + DEEPSEEK_API_KEY
        },
        body: JSON.stringify(apiBody),
        signal: controller.signal
      });

      if (!resp.ok) {
        var errTxt = '';
        try { var ej = await resp.json().catch(function() { return {}; }); errTxt = (ej && ej.error && ej.error.message) ? String(ej.error.message).slice(0, 200) : ''; } catch (e) {}
        console.error('[DEEPSEEK] API error', resp.status, errTxt, 'round', round);
        if (useThinking && (errTxt.indexOf('thinking') >= 0 || errTxt.indexOf('reasoning_effort') >= 0 || resp.status === 400)) {
          throw new Error('AI 调用失败：当前模型不支持思考模式，请关闭思考模式后重试');
        }
        throw new Error('AI 调用失败（HTTP ' + resp.status + '）');
      }

      var content = '';
      var toolCalls = [];
      var streamToolCallMap = {};

      if (useStream) {
        // ===== 流式解析 (round 0 with thinking) =====
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var sBuffer = '';
        var streamDone = false;

        while (!streamDone) {
          var rd;
          try { rd = await reader.read(); } catch (e) { break; }
          if (rd.done) break;
          sBuffer += decoder.decode(rd.value, { stream: true });
          var sLines = sBuffer.split('\n');
          sBuffer = sLines.pop() || '';

          for (var sl = 0; sl < sLines.length; sl++) {
            var sLine = sLines[sl].trim();
            if (!sLine || sLine.indexOf('data: ') !== 0) continue;
            var sData = sLine.slice(6);
            if (sData === '[DONE]') { streamDone = true; break; }
            var sJson;
            try { sJson = JSON.parse(sData); } catch (e) { continue; }
            if (!sJson || !sJson.choices || !sJson.choices[0]) continue;
            var sChoice = sJson.choices[0];
            var sDelta = sChoice.delta || {};

            // reasoning_content chunk → 推给回调
            if (typeof sDelta.reasoning_content === 'string' && sDelta.reasoning_content) {
              try { options.onThinkingChunk(String(sDelta.reasoning_content).slice(0, 4000)); } catch (e) {}
            }
            // content chunk → 累积 + V2: 推给 onContentChunk 回调(流式答案)
            if (typeof sDelta.content === 'string' && sDelta.content) {
              content += sDelta.content;
              try { if (hasContentCb) options.onContentChunk(String(sDelta.content).slice(0, 4000)); } catch (e) {}
            }
            // tool_calls chunk → 累积
            if (Array.isArray(sDelta.tool_calls)) {
              for (var st=0; st < sDelta.tool_calls.length; st++) {
                var stc = sDelta.tool_calls[st];
                var stcIdx = stc.index || 0;
                if (!streamToolCallMap[stcIdx]) {
                  streamToolCallMap[stcIdx] = {
                    id: stc.id || '',
                    type: 'function',
                    function: { name: '', arguments: '' }
                  };
                }
                if (stc.id) streamToolCallMap[stcIdx].id = stc.id;
                if (stc.function) {
                  if (stc.function.name) streamToolCallMap[stcIdx].function.name = (streamToolCallMap[stcIdx].function.name || '') + stc.function.name;
                  if (stc.function.arguments) streamToolCallMap[stcIdx].function.arguments += stc.function.arguments;
                }
              }
            }
            // usage (last delta usually)
            if (sJson.usage) {
              lastUsage = sJson.usage;
              totalUsage.prompt_tokens = sJson.usage.prompt_tokens || 0;
              totalUsage.completion_tokens = sJson.usage.completion_tokens || 0;
              totalUsage.total_tokens = sJson.usage.total_tokens || 0;
              if (typeof sJson.usage.prompt_cache_hit_tokens === 'number') totalUsage.prompt_cache_hit_tokens += sJson.usage.prompt_cache_hit_tokens;
              if (typeof sJson.usage.prompt_cache_miss_tokens === 'number') totalUsage.prompt_cache_miss_tokens += sJson.usage.prompt_cache_miss_tokens;
            }
          }
        }
        try { reader.cancel(); } catch (e) {}

        // 收集流式积累的 tool_calls
        var stcKeys = Object.keys(streamToolCallMap).sort(function(a,b) { return parseInt(a)-parseInt(b); });
        for (var sk=0; sk<stcKeys.length; sk++) {
          toolCalls.push(streamToolCallMap[stcKeys[sk]]);
        }
        // reasoning_content 已通过 onThinkingChunk 实时推送, finalReasoning 置空
        finalReasoning = '';
      } else {
        // ===== 非流式 (standard) =====
        var data = await resp.json().catch(function() { return {}; });
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
          console.error('[DEEPSEEK] unexpected response shape');
          throw new Error('AI 返回格式异常');
        }
        var choice = data.choices[0];
        var message = choice.message || {};
        content = typeof message.content === 'string' ? message.content : '';
        toolCalls = message.tool_calls || [];
        if (data.usage) {
          lastUsage = data.usage;
          totalUsage.prompt_tokens += data.usage.prompt_tokens || 0;
          totalUsage.completion_tokens += data.usage.completion_tokens || 0;
          totalUsage.total_tokens += data.usage.total_tokens || 0;
          if (typeof data.usage.prompt_cache_hit_tokens === 'number') totalUsage.prompt_cache_hit_tokens = data.usage.prompt_cache_hit_tokens;
          if (typeof data.usage.prompt_cache_miss_tokens === 'number') totalUsage.prompt_cache_miss_tokens = data.usage.prompt_cache_miss_tokens;
        }
        if (useThinking) {
          var r = message.reasoning_content;
          if (typeof r === 'string' && r) finalReasoning = r;
        }
      }

      // 没 tool_calls：最终回复
      if (!toolCalls || toolCalls.length === 0) {
        finalContent = content;
        break;
      }

      // 有 tool_calls：追加 assistant 消息 → 执行 tool → 进入下一轮
      workingMessages.push({
        role: 'assistant',
        content: content || '',
        tool_calls: toolCalls
      });

      // ★ 并行执行所有工具调用 (原串行 for 循环改为 Promise.all)
      var toolResults = await Promise.all(toolCalls.map(async function(tc, t) {
        var tcName = tc.function && tc.function.name ? tc.function.name : '';
        var tcArgs = tc.function && tc.function.arguments ? tc.function.arguments : '{}';
        var tcId = tc.id || ('call_' + Date.now() + '_' + t);
        var tStart = Date.now();
        var toolResult = null;
        try { toolResult = await toolExecutor(tc); } catch (e) { toolResult = { tool_name: tcName, error: (e && e.message) || '工具执行失败' }; }
        var tElapsed = Date.now() - tStart;
        try { console.log('[DEEPSEEK] tool_call', tcName, 'elapsed_ms', tElapsed); } catch (e) {}
        return { tcId: tcId, tcName: tcName, tcArgs: tcArgs, toolResult: toolResult, tElapsed: tElapsed };
      }));
      toolResults.forEach(function(r) {
        toolCallsInfo.push({ id: r.tcId, name: r.tcName, args: r.tcArgs, elapsed_ms: r.tElapsed, ok: !r.toolResult || !r.toolResult.error });
        if (r.tcName === 'search_web' && r.toolResult && typeof r.toolResult.results_count === 'number') {
          toolCallsInfo[toolCallsInfo.length - 1].results_count = r.toolResult.results_count;
        }
        var toolContent = r.toolResult ? JSON.stringify(r.toolResult).slice(0, 8000) : '{}';
        workingMessages.push({ role: 'tool', tool_call_id: r.tcId, content: toolContent });
      });
    }

    // 如果循环结束还有 tool_calls（达到 maxToolRounds），最后内容可能为空
    // ★ O 修复 Bug 5: 不再用最后一轮的 content（可能是 planning 文本或 []），
    //   强制再调一次 DeepSeek（不带 tools），让它基于已有 context 给出最终答案
    if (!finalContent) {
      if (workingMessages.length > 0) {
        try {
          var noToolBody = {
            model: model,
            messages: workingMessages.slice(),
            stream: false
          };
          if (useThinking) {
            noToolBody.thinking = { type: 'enabled' };
            noToolBody.reasoning_effort = thinkingLevel;
          }
          if (options && options.max_tokens && typeof options.max_tokens === 'number') {
            noToolBody.max_tokens = options.max_tokens;
          }
          var noToolController = new AbortController();
          var noToolTimer = setTimeout(function() { noToolController.abort(); }, useThinking ? 120000 : 60000);
          var noToolResp = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + DEEPSEEK_API_KEY
            },
            body: JSON.stringify(noToolBody),
            signal: noToolController.signal
          });
          clearTimeout(noToolTimer);
          var noToolData = await noToolResp.json().catch(function() { return {}; });
          if (noToolResp.ok && noToolData && noToolData.choices && noToolData.choices[0] && noToolData.choices[0].message) {
            var noToolMsg = noToolData.choices[0].message;
            var noToolContent = typeof noToolMsg.content === 'string' ? noToolMsg.content : '';
            if (noToolContent && noToolContent.length > 10) {
              // 过滤疑似 JSON 残留
              if (noToolContent.indexOf('{') === 0 && noToolContent.length < 500) {
                finalContent = '（AI 调用了太多工具, 已达上限, 请简化问题重试）';
              } else {
                finalContent = noToolContent;
              }
            }
          }
        } catch (e) {
          clearTimeout(noToolTimer);
          console.error('[DEEPSEEK] noTool follow-up failed:', e && e.message);
        }
      }
      if (!finalContent) {
        finalContent = '（AI 思考过多轮但未给出最终回复, 请简化问题重试）';
      }
    } else {
      // 已有 finalContent（最后一轮没 tool_call 时）
      // ★ O 修复 Bug 5: 过滤疑似 tool_call args 残留 (e.g. {"query":"..."})
      if (typeof finalContent === 'string') {
        var trimmed = finalContent.trim();
        if (trimmed.length < 200 && trimmed.charAt(0) === '{' && trimmed.charAt(trimmed.length - 1) === '}') {
          // 检查是否像 JSON args
          try {
            var parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && (parsed.query || parsed.location || parsed.command)) {
              finalContent = '（AI 返回了工具参数, 不是最终答案, 请重试）';
            }
          } catch (e) {}
        }
      }
    }

    // off 模式强制清空 reasoning
    if (!useThinking) finalReasoning = '';
    finalModel = model;

    // 组装 usage（和单次调用返回结构一致）
    var usage = null;
    if (lastUsage) {
      // 用累计的 total（如果多轮）+ 最后一次的 cache 字段
      var hit = typeof totalUsage.prompt_cache_hit_tokens === 'number' ? totalUsage.prompt_cache_hit_tokens : 0;
      var miss;
      if (typeof totalUsage.prompt_cache_miss_tokens === 'number') {
        miss = totalUsage.prompt_cache_miss_tokens;
      } else {
        miss = Math.max(0, totalUsage.prompt_tokens - hit);
      }
      var cost = null;
      if (DEEPSEEK_INPUT_PRICE_PER_1M || DEEPSEEK_OUTPUT_PRICE_PER_1M) {
        var cacheHitPrice = typeof DEEPSEEK_CACHE_HIT_PRICE_PER_1M === 'number' ? DEEPSEEK_CACHE_HIT_PRICE_PER_1M : 0;
        var inputCost  = (miss * DEEPSEEK_INPUT_PRICE_PER_1M / 1000000) + (hit * cacheHitPrice / 1000000);
        var outputCost = (totalUsage.completion_tokens * DEEPSEEK_OUTPUT_PRICE_PER_1M / 1000000);
        cost = Math.round((inputCost + outputCost) * 1000000) / 1000000;
      }
      usage = {
        prompt_tokens: totalUsage.prompt_tokens || lastUsage.prompt_tokens || 0,
        completion_tokens: totalUsage.completion_tokens || lastUsage.completion_tokens || 0,
        total_tokens: totalUsage.total_tokens || lastUsage.total_tokens || 0,
        prompt_cache_hit_tokens: typeof lastUsage.prompt_cache_hit_tokens === 'number' ? lastUsage.prompt_cache_hit_tokens : null,
        prompt_cache_miss_tokens: typeof lastUsage.prompt_cache_miss_tokens === 'number' ? lastUsage.prompt_cache_miss_tokens : null,
        cost: cost,
        currency: DEEPSEEK_CURRENCY,
        // ★ U3: tool_call_rounds 是有 tool_call 的轮数, 即 max(round)+1; 简化用 count 替代
        tool_call_count: toolCallsInfo.length
      };
    }

    return {
      content: finalContent,
      reasoning: finalReasoning,
      usage: usage,
      model: finalModel,
      tool_calls_info: toolCallsInfo,
      finalMessages: workingMessages
    };
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') {
      console.error('[DEEPSEEK] request timeout after', DEEPSEEK_TIMEOUT_MS, 'ms');
      throw new Error('AI 调用超时，请稍后再试');
    }
    if (e && e.message && (e.message.indexOf('AI 调用失败') === 0 || e.message.indexOf('AI 返回格式') === 0)) throw e;
    console.error('[DEEPSEEK] unexpected error:', e && e.message);
    throw new Error('AI 调用异常，请稍后再试');
  } finally {
    clearTimeout(timer);
  }
}

// ===================== M: 深度研究模式 — 多智能体架构 (Planner→Workers→Synthesizer) =====================
// 适用于 thinking_mode = 'max'
// 流程: 1 次 Planner 拆解 → 并行 Worker 执行 → 1 次 Synthesizer 整合
async function runMultiAgentFlow(opts) {
  var res = opts.res;
  var userName = opts.userName;
  var message = opts.message;
  var convId = opts.convId;
  var config = opts.config;
  var ctx = opts.ctx;
  var startTime = opts.startTime || Date.now();
  var cancelToken = opts.cancelToken || { cancelled: false };
  var deepThinkThinkingMode = (opts.thinking_mode) || (config && config.deep_think && config.deep_think.default_thinking_mode) || 'max';
  if (['low', 'medium', 'high', 'max'].indexOf(deepThinkThinkingMode) < 0) deepThinkThinkingMode = 'max';

  var thinkingLog = [];
  var sources = [];
  var searchQueries = [];

  function sseSend(obj) {
    if (res.writableEnded) return;
    if (obj && obj.type === 'thinking_chunk') {
      try { thinkingLog.push({ agent_role: obj.agent_role || 'AI 智能体', chunk: obj.chunk, round: obj.round || 0, ts: Date.now() }); } catch (e) {}
    }
    try { writeSse(res, obj); } catch (e) {}
  }
  function isCancelled() { return cancelToken.cancelled === true; }
  function timeLeft() { return DEEP_THINK_CONFIG.MAX_DURATION_MS - (Date.now() - startTime); }

  var historyContext = buildHistoryContext(ctx, message);

  if (isCancelled()) return { cancelled: true, partial: true, finalContent: '' };

  // 从 config 覆盖 DEEP_THINK_CONFIG (管理员可在后台自定义)
  var dtCfg = (config && config.deep_think) || {};
  var effectiveMaxWorkers = Math.min(parseInt(dtCfg.max_workers) || DEEP_THINK_CONFIG.MAX_WORKERS, 10);
  var effectiveWorkerToolRounds = parseInt(dtCfg.worker_max_tool_rounds) || DEEP_THINK_CONFIG.WORKER_MAX_TOOL_ROUNDS;
  var effectiveForceSplitLen = parseInt(dtCfg.force_split_min_length) || DEEP_THINK_CONFIG.FORCE_SPLIT_MIN_LENGTH;
  var effectiveMinWorkers = parseInt(dtCfg.min_workers) || DEEP_THINK_CONFIG.MIN_WORKERS;

  // 共享前缀：所有角色共用 buildAiCorePrompt 以利用 DeepSeek prompt cache
  var sharedPrefix = buildAiCorePrompt(config);

  // 1. 推 init 事件
  sseSend({ type: 'meta', conversation_id: convId, deep_think: true, start_time: startTime });
    sseSend({ type: 'deep_think_init', message: '深度研究已启动, Planner 分析中...', agent_count: 1 });
  sseSend({ type: 'deep_think_stage', stage: 'agent', message: 'Planner 分析中...' });

  // 2. 调用 Planner (★ U3: +超时机制 + 流式thinking)
  var plannerContent = '';
  try {
    var plannerAbortController = new AbortController();
    var plannerPromise = callDeepSeek(
      [
        { role: 'system', content: sharedPrefix + '\n\n---\n\n' + DEEP_THINK_PLANNER_PROMPT.replace('{maxWorkers}', String(effectiveMaxWorkers)).replace('{minComplex}', String(Math.min(4, effectiveMaxWorkers - 1))) },
        { role: 'user', content: message + '\n\n' + (historyContext || '') + '\n\n请输出你的规划 JSON。' }
      ],
      {
        thinking_mode: deepThinkThinkingMode,
        model: DEEPSEEK_MODEL_REASONER,
        // ★ P3 修复 bug 2: max_tokens 2048→4096, 防止 max 思考消耗完 token 导致 Planner 输出空 agents:[] 触发退路
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        signal: plannerAbortController.signal,
        // ★ 流式推 Planner 的思考过程，用户实时看到规划中的思考，不再空等 15-20 秒
        onThinkingChunk: function(chunk) {
          sseSend({ type: 'thinking_chunk', agent_role: 'Planner', chunk: chunk, round: 0 });
        }
      }
    );
    var plannerTimeout = new Promise(function(_, reject) {
      setTimeout(function() { plannerAbortController.abort(); reject(new Error('Planner 超时')); }, DEEP_THINK_CONFIG.PLANNER_TIMEOUT_MS);
    });
    var plannerResult = await Promise.race([plannerPromise, plannerTimeout]);
    plannerContent = plannerResult.content || '';
  } catch (e) {
    console.error('[MULTI-AGENT] Planner failed:', e && e.message);
    sseSend({ type: 'deep_think_stage', stage: 'error', message: '规划失败，回退通用多智能体' });
    plannerContent = '{"complexity":"medium","reasoning":"Planner失败，使用通用方向并行分析","agents":[]}';
  }

  if (isCancelled()) return { cancelled: true, partial: true, finalContent: '' };

  // 3. 解析 Planner 输出
  var plan = null;
  try {
    plan = JSON.parse(plannerContent);
  } catch (e) {
    try {
      var m = plannerContent.match(/\{[\s\S]*\}/);
      if (m) plan = JSON.parse(m[0]);
    } catch (e2) { plan = null; }
  }
  if (!plan || typeof plan !== 'object') {
    plan = { complexity: 'low', reasoning: '解析失败，直接回答', agents: [] };
  }
  var agents = Array.isArray(plan.agents) ? plan.agents : [];
  var agentCount = agents.length;

  // ★ 最小 agent 数强制: 如果 Planner 生成的 agent 数低于 min_workers, 用默认 agent 兜底
  if (agentCount < effectiveMinWorkers && effectiveMinWorkers > 0) {
    agents = buildDefaultAgents(message);
    agentCount = agents.length;
    plan.complexity = plan.complexity || 'medium';
    plan.reasoning = '最小agent数强制拆分';
  }

  sseSend({ type: 'deep_think_planned', complexity: plan.complexity || 'auto', reasoning: plan.reasoning || '', agents: agents.map(function(a) { return { role: a.role, status: 'pending', need_search: a.need_search }; }) });

  if (isCancelled()) return { cancelled: true, partial: true, finalContent: '' };

  var workerResults = [];
  var allSources = [];
  var allQueries = [];

  // 4. agents=[] → 深度思考模式下强制拆分多 agent
  //   修复 bug 2: 用户主动开启深度思考, 期待 Planner→Workers→Synthesizer 多角度分析
  //   之前: Planner 输出 agents=[] + 不满足 shouldForceSplitAgents (长度 < 24) → 走"直接回答", 看起来多 agent "消失"
  //   现在: 深度思考模式下 Planner 输出空时无条件 buildDefaultAgents, 保证一定有 Workers 并行执行
  if (agentCount === 0) {
    if (shouldForceSplitAgents(message, effectiveForceSplitLen) || deepThinkThinkingMode === 'max') {
      agents = buildDefaultAgents(message);
      agentCount = agents.length;
      plan.complexity = plan.complexity || 'medium';
      plan.reasoning = plan.reasoning || '问题涉及分析/决策, 自动拆分多方向并行研究';
      sseSend({ type: 'deep_think_planned', complexity: plan.complexity, reasoning: plan.reasoning, agents: agents.map(function(a) { return { role: a.role, status: 'pending', need_search: a.need_search }; }) });
    }
  }

  if (agentCount === 0) {
    sseSend({ type: 'deep_think_stage', stage: 'agent', message: '正在进行深度分析...' });
    try {
      var corePrompt = buildAiCorePrompt(config);
      var directPrompt = corePrompt + '\n\n用户问题: ' + message + '\n\n作为深度研究模式，请从以下角度进行全面分析：\n1. 问题的核心是什么？\n2. 从哪些维度可以深入探讨？\n3. 给出有深度的分析和结论\n不要因为问题简短就敷衍。';
      var directResult = await callDeepSeek(
        [{ role: 'system', content: directPrompt + (historyContext || '') }],
        { thinking_mode: deepThinkThinkingMode, max_tokens: 8192,
          onThinkingChunk: function(chunk) { sseSend({ type: 'thinking_chunk', agent_role: 'AI 智能体', chunk: chunk }); },
          onContentChunk: function(chunk) { sseSend({ type: 'answer_chunk', chunk: chunk }); }
        }
      );
      var fakePlanner = { complexity: 'medium', reasoning: '深度模式直接分析', agent_count: 1, agents: [{ role: 'AI 研究员', need_search: false }] };
      return {
        cancelled: false, finalContent: directResult.content || '', planner: fakePlanner, worker_results: [],
        thinking_log: thinkingLog, usage: directResult.usage, model: directResult.model || DEEPSEEK_MODEL_REASONER,
        search_count: 0, search_results: [], search_query: '', sources: [], queries: []
      };
    } catch (e) {
      return { cancelled: false, finalContent: '（AI 无法回答: ' + (e.message || '') + '）', planner: { agent_count: 0 }, worker_results: [], thinking_log: thinkingLog, usage: null, model: DEEPSEEK_MODEL_REASONER, search_count: 0, search_results: [], sources: [], queries: [] };
    }
  }

  // 5. 有 agent → 并行执行 Workers
  sseSend({ type: 'deep_think_stage', stage: 'agent', message: '正在并行研究 (' + agentCount + ' 个方向)...' });

  var workerPromises = agents.map(function(agent, idx) {
    return runDeepThinkWorker({
      agent: agent,
      originalMessage: message,
      cancelToken: cancelToken,
      timeLeft: timeLeft,
      sseSend: sseSend,
      onRound: function(round) {
        sseSend({ type: 'deep_think_stage', stage: 'agent', message: '[' + agent.role + '] 第 ' + round + ' 轮分析...' });
      },
      thinkingMode: deepThinkThinkingMode,
      needSearch: agent.need_search !== false,
      historyContext: historyContext,
      workerMaxToolRounds: effectiveWorkerToolRounds,
      sharedPrefix: sharedPrefix
    }).then(function(wr) {
      if (wr && wr.sources) {
        wr.sources.forEach(function(s) { allSources.push(s); });
      }
      if (wr && wr.queries) {
        wr.queries.forEach(function(q) { if (allQueries.indexOf(q) < 0) allQueries.push(q); });
      }
      return { role: agent.role, status: 'success', elapsed_ms: 0, content: wr ? wr.content : '', sources: wr ? wr.sources : [] };
    }).catch(function(e) {
      console.error('[MULTI-AGENT] worker failed:', agent.role, e && e.message);
      return { role: agent.role, status: 'failed', elapsed_ms: 0, content: '', error: e && e.message };
    });
  });

  workerResults = await Promise.all(workerPromises);
  if (isCancelled()) return { cancelled: true, partial: true, finalContent: '' };

  // 去重合并所有来源
  allSources = cleanSearchResults(allSources, 50);
  sources = allSources;
  allQueries = allQueries.slice(0, 10);

  // 6. Synthesizer 整合
  sseSend({ type: 'deep_think_stage', stage: 'agent', message: 'Synthesizer 整合答案中...' });

  var synthMessages = [
    { role: 'system', content: sharedPrefix + '\n\n---\n\n' + DEEP_THINK_SYNTHESIZER_PROMPT },
    { role: 'user', content: '用户原始问题: ' + message + '\n\n' + (historyContext || '') }
  ];

  // 把 worker 结果拼进去 (★ U3: 截断每个 worker 内容到 1500 字, 防止 prompt 超限)
  if (workerResults.length > 0) {
    var workerSummary = '\n\n【各方向分析结果】\n';
    workerResults.forEach(function(wr, idx) {
      var wrContent = String(wr.content || '(无内容)');
      if (wrContent.length > 1500) wrContent = wrContent.slice(0, 1500) + '\n...(截断)';
      workerSummary += '\n--- ' + (wr.role || ('方向' + (idx + 1))) + ' ---\n';
      workerSummary += wrContent + '\n';
    });
    synthMessages.push({ role: 'user', content: workerSummary });
  }

  if (allSources.length > 0) {
    var sourceList = '\n\n【搜索结果引用列表 (供整合参考)】\n';
    allSources.forEach(function(sr, idx) {
      sourceList += (idx + 1) + '. ' + (sr.title || '无标题') + ' - ' + (sr.url || '') + '\n';
    });
    synthMessages.push({ role: 'user', content: sourceList });
  }

  synthMessages.push({ role: 'user', content: '请基于以上各方向的分析结果，整合成最终答案发给用户。不要列来源和链接。' });

  var synthContent = '';
  var synthUsage = null;
  var synthModel = DEEPSEEK_MODEL_REASONER;
  try {
    // ★ U3: Synthesizer 超时机制
    var synthPromise = callDeepSeek(synthMessages, {
      thinking_mode: deepThinkThinkingMode, max_tokens: 16384,
      onThinkingChunk: function(chunk) { sseSend({ type: 'thinking_chunk', agent_role: 'Synthesizer', chunk: chunk }); },
      onContentChunk: function(chunk) { sseSend({ type: 'answer_chunk', chunk: chunk }); }
    });
    var synthTimeout = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('Synthesizer 超时')); }, DEEP_THINK_CONFIG.SYNTHESIZER_TIMEOUT_MS);
    });
    var synthResult = await Promise.race([synthPromise, synthTimeout]);
    synthContent = synthResult.content || '';
    synthUsage = synthResult.usage;
    synthModel = synthResult.model || DEEPSEEK_MODEL_REASONER;
  } catch (e) {
    console.error('[MULTI-AGENT] Synthesizer failed:', e && e.message);
    // ★ U3 修复: Synthesizer 失败时 fallback 拼接 worker 结果, 不让用户看到空内容
    if (workerResults && workerResults.length > 0) {
      var parts2 = ['(Synthesizer 整合失败: ' + (e.message || '') + ', 以下是各方向原始分析)\n'];
      workerResults.forEach(function(wr, idx) {
        var wrC = String(wr.content || '(无内容)');
        if (wrC.length > 1500) wrC = wrC.slice(0, 1500) + '\n...(截断)';
        parts2.push('\n【' + (wr.role || ('方向' + (idx + 1))) + '】\n' + wrC);
      });
      synthContent = parts2.join('\n');
    } else {
      synthContent = '(整合答案失败: ' + (e.message || '') + ')';
    }
  }

  if (isCancelled()) return { cancelled: true, partial: true, finalContent: synthContent };

  var fakePlanner = { complexity: plan.complexity || 'auto', reasoning: plan.reasoning || '', agent_count: agentCount, agents: agents };
  var fakeWorkerResults = workerResults.map(function(wr) { return { role: wr.role, status: wr.status, elapsed_ms: wr.elapsed_ms || 0, content: wr.content || '' }; });

  return {
    cancelled: false,
    finalContent: synthContent,
    synth_content: synthContent,
    planner: fakePlanner,
    worker_results: fakeWorkerResults,
    thinking_log: thinkingLog,
    usage: synthUsage,
    model: synthModel,
    search_count: allSources.length,
    search_results: allSources,
    search_query: allQueries[0] || '',
    sources: allSources,
    queries: allQueries,
    synth_usage: synthUsage
  };
}

// ===================== R: 深度研究模式 — 单智能体架构 (单智能体深度分析) =====================
// 之前 M 架构: Planner → Workers 并行 → Synthesizer (3 步, 像研究报告)
// R 架构: 1 个 DeepSeek 智能体, thinking + tool_use 自由决定是否搜索 (1 步, 像 ChatGPT pro thinking)
//   - 1 次 callDeepSeek, 内部最多 5 轮 tool_use
//   - 思考过程通过 thinking_chunk SSE 实时推
//   - 搜索结果通过 tool_use 自动获取, 内部引用
//   - 最终答案通过 done event 推
async function runDeepThinkAgent(opts) {
  var res = opts.res;
  var userName = opts.userName;
  var message = opts.message;
  var convId = opts.convId;
  var config = opts.config;
  var ctx = opts.ctx;
  var startTime = opts.startTime || Date.now();
  var cancelToken = opts.cancelToken || { cancelled: false };
  // ★ R 改: 思考程度从 opts 读, fallback 到 config.deep_think.default_thinking_mode, 默认 max
  var deepThinkThinkingMode = (opts.thinking_mode)
    || (config && config.deep_think && config.deep_think.default_thinking_mode)
    || 'max';
  if (['low', 'medium', 'high', 'max'].indexOf(deepThinkThinkingMode) < 0) deepThinkThinkingMode = 'max';

  // ★ P 改: 思考程度差异化参数
  var disableSearch = opts.disableSearch === true;
  var maxToolRounds = (typeof opts.max_tool_rounds === 'number') ? opts.max_tool_rounds : 5;
  var maxTokensLimit = (typeof opts.max_tokens === 'number') ? opts.max_tokens : 32768;

  var thinkingLog = []; // [{ agent_role, chunk, round, ts }]
  var searchCount = 0;
  var sources = [];
  var searchQueries = [];

  // SSE helpers
  function sseSend(obj) {
    if (res.writableEnded) return;
    // ★ R: 记录 thinking_chunk 到 thinkingLog
    if (obj && obj.type === 'thinking_chunk') {
      try {
        thinkingLog.push({ agent_role: obj.agent_role || 'AI 智能体', chunk: obj.chunk, round: obj.round || 0, ts: Date.now() });
      } catch (e) {}
    }
    try { writeSse(res, obj); } catch (e) {}
  }
  function isCancelled() { return cancelToken.cancelled === true; }
  function timeLeft() { return DEEP_THINK_CONFIG.MAX_DURATION_MS - (Date.now() - startTime); }

  var historyContext = buildHistoryContext(ctx, message);

  // ★ R: 单智能体 prompt — 融合 buildAiCorePrompt + 深度研究特定指令
  var corePrompt = buildAiCorePrompt(config);

  // ★ 缓存优化：紧凑 prompt，节省 token
  var DEEP_THINK_AGENT_PROMPT = corePrompt + '\n\n' +
    '你处于"深度研究模式"。工作方式：\n' +
    '1) 理解：判断领域(闲聊/代码/金融/科学/法律/健康/通用)，是否需搜(常识/闲聊/计算 → 不搜；实时数据/事件/地点 → 搜)。\n' +
    '2) 分析：深度挖掘问题本质，从多角度审视。需搜则拆 1-3 个不同关键词；不搜则深入推理。\n' +
    '3) 回答：无论问题长短，都要给出有深度的分析。宁可多分析不可浅尝辄止。\n' +
    '不确定就说不确定。别写"作为 AI/根据分析"开场。别用"## 一、引言"论文体。';

  // ★ R: 取消 token 检查
  if (isCancelled()) return { cancelled: true, partial: true, finalContent: '' };

  // ★ R: 推 init event
  sseSend({
    type: 'meta',
    conversation_id: convId,
    deep_think: true,
    start_time: startTime
  });
  sseSend({
    type: 'deep_think_init',
    message: '深度研究已启动, 智能体正在分析...',
    agent_count: 1
  });
  sseSend({
    type: 'deep_think_planned',
    complexity: 'auto',
    reasoning: '单智能体动态决策',
    agents: [{ role: 'AI 智能体', status: 'pending', need_search: null }]
  });
  sseSend({
    type: 'deep_think_stage',
    stage: 'agent',
    message: 'AI 智能体思考中...'
  });

  var agentStartTime = Date.now();
  var finalContent = '';
  var finalReasoning = '';
  var usage = null;
  var finalModel = DEEPSEEK_MODEL_REASONER;
  var toolCallsInfo = [];
  // V2: thinking chunk 节流缓冲区 — 首包立即推 + 后续 80ms 合并 (更流畅, 更低延迟)
  var _thinkingChunkBuf = '';
  var _thinkingChunkTimer = null;
  var _thinkingFirstFlushed = false;
  function _flushThinkingChunk() {
    if (_thinkingChunkTimer) { clearTimeout(_thinkingChunkTimer); _thinkingChunkTimer = null; }
    var flushed = _thinkingChunkBuf;
    _thinkingChunkBuf = '';
    if (flushed) sseSend({ type: 'thinking_chunk', agent_role: 'AI 智能体', chunk: flushed.slice(0, 4000) });
  }
  // V2: answer chunk 节流缓冲区 — 首包立即推 + 后续 50ms 合并 (答案比思考更敏感, 要快)
  var _answerChunkBuf = '';
  var _answerChunkTimer = null;
  var _answerFirstFlushed = false;
  function _flushAnswerChunk() {
    if (_answerChunkTimer) { clearTimeout(_answerChunkTimer); _answerChunkTimer = null; }
    var flushed = _answerChunkBuf;
    _answerChunkBuf = '';
    if (flushed) sseSend({ type: 'answer_chunk', chunk: flushed.slice(0, 8000) });
  }

  try {
    // ★ R: 1 个 callDeepSeek, 根据思考程度差异化传参
    var deepSeekOpts = {
      thinking_mode: deepThinkThinkingMode,
      max_tool_rounds: maxToolRounds,
      max_tokens: maxTokensLimit,
      onThinkingChunk: function(chunk) {
        // V2: 首包立即推送(无延迟), 后续 80ms 合并推送, 显著降低首字延迟
        _thinkingChunkBuf += String(chunk || '');
        if (!_thinkingFirstFlushed) {
          _thinkingFirstFlushed = true;
          _flushThinkingChunk();
          return;
        }
        if (_thinkingChunkTimer) return;
        _thinkingChunkTimer = setTimeout(function() { _flushThinkingChunk(); }, 80);
      },
      onContentChunk: function(chunk) {
        // V2: 答案流 — 首包立即推 + 50ms 合并, 极低延迟
        _answerChunkBuf += String(chunk || '');
        if (!_answerFirstFlushed) {
          _answerFirstFlushed = true;
          _flushAnswerChunk();
          return;
        }
        if (_answerChunkTimer) return;
        _answerChunkTimer = setTimeout(function() { _flushAnswerChunk(); }, 50);
      }
    };
    var searchCountAccum = { count: 0 };
    // ★ P 改: 思考程度 low 时不传 tools(禁止搜索), 其他级别正常传
    if (!disableSearch) {
      deepSeekOpts.tools = AI_TOOLS;
      deepSeekOpts.tool_choice = 'auto';
      deepSeekOpts.tool_executor = buildToolExecutor(sseSend, 'AI 智能体', sources, searchQueries, searchCountAccum);
    }
    var result = await callDeepSeek(
      [
        { role: 'system', content: DEEP_THINK_AGENT_PROMPT + (historyContext || '') },
        { role: 'user', content: message }
      ],
      deepSeekOpts
    );
    searchCount = searchCountAccum.count || 0;

    finalContent = result.content || '';
    usage = result.usage;
    finalModel = result.model || DEEPSEEK_MODEL_REASONER;
    toolCallsInfo = result.tool_calls_info || [];
    // ★ V2: 推送最后残留的 thinking + answer chunk buffer
    _flushThinkingChunk();
    _flushAnswerChunk();
    // thinking_chunk 已通过 onThinkingChunk 流式推送, thinkingLog 已由 sseSend 记录
  } catch (e) {
    console.error('[DEEP-THINK] agent failed:', e && e.message);
    _flushThinkingChunk();
    _flushAnswerChunk();
    sseSend({ type: 'deep_think_stage', stage: 'error', message: 'AI 思考失败: ' + (e.message || '未知错误') });
    return {
      cancelled: isCancelled(),
      finalContent: '（AI 思考失败, 请重试: ' + (e.message || '') + '）',
      worker_results: [{
        role: 'AI 智能体',
        status: 'failed',
        elapsed_ms: Date.now() - agentStartTime
      }],
      thinking_log: thinkingLog,
      usage: null,
      model: finalModel
    };
  }

  var agentElapsed = Date.now() - agentStartTime;
  if (isCancelled()) {
    return {
      cancelled: true,
      partial: true,
      finalContent: finalContent,
      worker_results: [{
        role: 'AI 智能体',
        status: 'cancelled',
        elapsed_ms: agentElapsed
      }],
      thinking_log: thinkingLog,
      usage: usage,
      model: finalModel
    };
  }

  // ★ R: 兼容旧的 field 名 (handleDeepThinkChat 还在用 planner / worker_results)
  var fakePlanner = {
    complexity: 'auto',
    reasoning: '单智能体 (R 架构)',
    agent_count: 1,
    agents: [{ role: 'AI 智能体', task_description: message, need_search: searchCount > 0, search_queries: searchQueries }]
  };
  var fakeWorkerResults = [{
    role: 'AI 智能体',
    status: 'success',
    elapsed_ms: agentElapsed,
    content: finalContent,
    sources: sources
  }];

  return {
    cancelled: false,
    finalContent: finalContent,
    planner: fakePlanner,
    worker_results: fakeWorkerResults,
    thinking_log: thinkingLog,
    usage: usage,
    model: finalModel,
    search_count: searchCount,
    search_results: sources,
    search_query: searchQueries[0] || ''
  };
}

// runDeepThinkWorker: 单个 worker agent 执行 (内部 tool_use 循环)
// ★ U3: 使用共享 buildToolExecutor + r.finalMessages 修复 tool_result 丢失问题
async function runDeepThinkWorker(opts) {
  var agent = opts.agent;
  var originalMessage = opts.originalMessage;
  var cancelToken = opts.cancelToken;
  var timeLeft = opts.timeLeft;
  var sseSend = opts.sseSend;
  var onRound = opts.onRound;
  var thinkingMode = opts.thinkingMode || 'max';
  if (['low', 'medium', 'high', 'max'].indexOf(thinkingMode) < 0) thinkingMode = 'max';
  var needSearch = opts.needSearch !== false;
  var workerHistoryContext = opts.historyContext || '';
  var workerMaxToolRounds = opts.workerMaxToolRounds || DEEP_THINK_CONFIG.WORKER_MAX_TOOL_ROUNDS;
  var sharedPrefix = opts.sharedPrefix || '';

  var sources = [];
  var queries = [];
  var searchCountAccum = { count: 0 };

  var searchHint = needSearch
    ? '**本任务需要搜索**: 请调用 search_web 工具获取最新/具体数据 (1-3 次足够, 别刷屏)'
    : '**本任务不需要搜索**: 直接基于你的知识回答, 别调用 search_web 浪费 token';

  var workerSystemPrompt = sharedPrefix + '\n\n---\n\n你是 XTJ 深度研究模式下的 [' + agent.role + '] 专家.\n' +
    '你的具体任务: ' + agent.task_description + '\n' +
    (needSearch ? '建议搜索关键词: ' + (agent.search_queries || []).join(' | ') + '\n' : '') +
    (workerHistoryContext || '') + '\n\n' +
    searchHint + '\n\n' +
    '执行规则 (务必精炼, 不要废话):\n' +
    '1. ' + (needSearch ? '最多搜 2 次, 关键词要不同角度, 别反复搜同样的' : '**不调用** search_web, 直接基于知识回答') + '\n' +
    '2. 产出 200-800 字的本方面深入分析 (深度挖掘, 充分展开)\n' +
    '3. 输出结构: 【结论】→【关键依据】→【深入分析】→【不确定点】\n' +
    '4. 只关注本方面 (' + agent.role + '), 不要涉及其他 agent 的领域\n' +
    '5. 不要做最终总结, Synthesizer 会整合\n' +
    '6. 严禁以下废话开头: "考虑历史"/"根据系统提示"/"作为 AI"/"我们需要"/"根据规则"\n' +
    '7. 直接开始分析本方面, 不要先复述用户问题或解释你在做什么\n' +
    '8. ★ 看到 [历史对话上下文] 时, 只用它理解语境, 不要把历史当新问题去搜\n' +
    '9. ★ 深度优先, 充分展现你的专业分析能力';

  var messages = [
    { role: 'system', content: workerSystemPrompt },
    { role: 'user', content: '用户原始问题: ' + originalMessage + '\n\n请基于你的任务开始' + (needSearch ? '专业分析, 必要时调用 search_web' : '回答 (不需要搜索)') + '.' }
  ];

  // ★ U3: 超时机制 — 对每个 worker 单次 callDeepSeek 用 Promise.race 强制执行超时
  var workerTimeoutMs = DEEP_THINK_CONFIG.WORKER_TIMEOUT_MS;

  for (var round = 1; round <= workerMaxToolRounds; round++) {
    if (cancelToken.cancelled) break;
    if (timeLeft() < 30000) { console.log('[DEEP-THINK] worker time budget low, breaking'); break; }

    if (onRound) onRound(round);

    var r = null;
    try {
      var callOpts = {
        thinking_mode: thinkingMode,
        max_tokens: 8192,
        max_tool_rounds: 1
      };
      if (needSearch) {
        callOpts.tools = AI_TOOLS;
        callOpts.tool_choice = 'auto';
        callOpts.tool_executor = buildToolExecutor(sseSend, agent.role, sources, queries, searchCountAccum);
      }
      // ★ U3: Promise.race 强制超时（同时中止底层 HTTP 请求）
      var workerAbortController = new AbortController();
      var callPromise = callDeepSeek(messages, Object.assign({}, callOpts, { signal: workerAbortController.signal }));
      var timeoutPromise = new Promise(function(_, reject) {
        setTimeout(function() { workerAbortController.abort(); reject(new Error('Worker 超时 (' + Math.round(workerTimeoutMs / 1000) + 's)')); }, workerTimeoutMs);
      });
      r = await Promise.race([callPromise, timeoutPromise]);
    } catch (e) {
      console.error('[DEEP-THINK] worker callDeepSeek failed:', e && e.message);
      throw e;
    }

    if (r.reasoning && r.reasoning.length > 0) {
      sseSend({ type: 'thinking_chunk', agent_role: agent.role, chunk: String(r.reasoning).slice(0, 4000), round: round });
    }

    // ★ U3 Bug 1 修复: 使用 r.finalMessages 获取真实的 tool_result 上下文
    if (r.finalMessages && Array.isArray(r.finalMessages)) {
      messages = r.finalMessages;
    }

    if (r.tool_calls_info && r.tool_calls_info.length > 0) {
      continue;
    }

    var finalText = r.content || '';
    return { content: finalText, sources: sources, queries: queries };
  }

  var lastAssistant = '';
  for (var mi = messages.length - 1; mi >= 0; mi--) {
    if (messages[mi].role === 'assistant' && messages[mi].content) {
      lastAssistant = messages[mi].content;
      break;
    }
  }
  return { content: lastAssistant || '(无内容)', sources: sources, queries: queries };
}

// ===================== AI 用户级限流（按 userName 而非 IP） =====================
// ★ AI 智能体调用按 userName 限流，避免 IP 共享用户互相挤占额度
// 限流维度：每用户每天 AI_AGENT_DAILY_LIMIT 次 / 每小时 AI_AGENT_HOURLY_LIMIT 次
var aiUserRateStore = new Map(); // userName -> { hourly: {count, resetAt}, daily: {count, resetAt} }
// 限流防竞态锁
var aiRateLimitMutex = new Map();
function checkAiUserRateLimit(userName) {
  if (!userName) return { allowed: false, reason: 'no_user' };
  // 串行化同用户限流检查，防并发竞态
  if (aiRateLimitMutex.get(userName)) {
    return { allowed: false, reason: 'concurrent' };
  }
  aiRateLimitMutex.set(userName, true);
  try {
    var now = Date.now();
    var record = aiUserRateStore.get(userName);
    if (!record) {
      record = {
        hourly: { count: 0, resetAt: now + 3600000 },
        daily:  { count: 0, resetAt: now + 86400000 }
      };
      aiUserRateStore.set(userName, record);
    }

    if (now > record.hourly.resetAt) {
      record.hourly = { count: 0, resetAt: now + 3600000 };
    }
    if (now > record.daily.resetAt) {
      record.daily = { count: 0, resetAt: now + 86400000 };
    }

    if (record.hourly.count >= AI_AGENT_HOURLY_LIMIT) {
      return { allowed: false, reason: 'hourly_limit', remainingHour: 0, remainingDay: Math.max(0, AI_AGENT_DAILY_LIMIT - record.daily.count) };
    }
    if (record.daily.count >= AI_AGENT_DAILY_LIMIT) {
      return { allowed: false, reason: 'daily_limit', remainingHour: Math.max(0, AI_AGENT_HOURLY_LIMIT - record.hourly.count), remainingDay: 0 };
    }

    record.hourly.count++;
    record.daily.count++;

    return {
      allowed: true,
      remainingHour: Math.max(0, AI_AGENT_HOURLY_LIMIT - record.hourly.count),
      remainingDay:  Math.max(0, AI_AGENT_DAILY_LIMIT  - record.daily.count)
    };
  } finally {
    aiRateLimitMutex.delete(userName);
  }
}

// ===================== Token 管理（无状态签名令牌，服务重启不掉登录） =====================
const adminTokens = new Map(); // token -> { expiresAt }（仅用于延长有效期跟踪）
const revokedTokens = new Map(); // token -> expiry（主动退出的令牌，过期前拒绝使用）
// 每10分钟清理过期 token
setInterval(function() {
  var now = Date.now();
  adminTokens.forEach(function(session, token) {
    if (now > session.expiresAt) adminTokens.delete(token);
  });
  revokedTokens.forEach(function(expiry, token) {
    if (now > expiry) revokedTokens.delete(token);
  });
  // 清理过期的限流记录（超过上次重置后 48h 的肯定用不上了）
  aiUserRateStore.forEach(function(record, name) {
    if (now > record.daily.resetAt + 86400000) aiUserRateStore.delete(name);
  });
  // 清理过期 revokedTokenHashes（异步）
  loadRevokedTokenHashes().catch(function(){});
}, 600000);

// 生成签名 token：base64(payload) + '.' + HMAC
function _signPayload(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', API_SECRET).update(b64).digest('base64url');
  return b64 + '.' + sig;
}

function _verifyToken(token) {
  try {
    var parts = token.split('.');
    if (parts.length !== 2) return null;
    var b64 = parts[0], sig = parts[1];
    var expectedSig = crypto.createHmac('sha256', API_SECRET).update(b64).digest('base64url');
    var sigBuf = Buffer.from(sig);
    var expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    var payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch(e) { return null; }
}

function signToken() {
  return _signPayload({ exp: Date.now() + TOKEN_EXPIRY_MS, user: ADMIN_USERNAME });
}

function verifySignedToken(token) {
  return _verifyToken(token);
}

function signUserToken(userName, expireHours) {
  var USER_TOKEN_EXPIRY_MS = (expireHours || 720) * 60 * 60 * 1000;
  return _signPayload({ exp: Date.now() + USER_TOKEN_EXPIRY_MS, user_name: userName, type: 'user' });
}

function verifyUserToken(token) {
  var payload = _verifyToken(token);
  if (!payload || payload.type !== 'user' || !payload.user_name) return null;
  return payload;
}

function _getTokenFromRequest(req) {
  var authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return '';
}

// ===== 吊销 token 持久化 =====
async function persistRevokedToken(token, expiresAt) {
  try {
    await supabase.from('posts').insert([{
      content: JSON.stringify({ token_hash: crypto.createHash('sha256').update(token).digest('hex'), expires_at: expiresAt }),
      media_type: REVOKED_TOKEN_MARKER,
      media_url: crypto.createHash('sha256').update(token).digest('hex'),
      user_name: ADMIN_USERNAME
    }]);
    revokedTokenHashes.add(crypto.createHash('sha256').update(token).digest('hex'));
  } catch(e) { console.warn('[Revoke] 持久化撤销失败:', e.message); }
}

async function loadRevokedTokenHashes() {
  try {
    var now = new Date().toISOString();
    var { data } = await supabase.from('posts')
      .select('id, media_url, content')
      .eq('media_type', REVOKED_TOKEN_MARKER)
      .not('media_url', 'is', null);
    (data || []).forEach(function(row) {
      try {
        var info = JSON.parse(row.content || '{}');
        if (info.expires_at && new Date(info.expires_at).getTime() > Date.now()) {
          revokedTokenHashes.add(row.media_url);
        }
      } catch(e) {}
    });
    // 清理过期吊销记录
    var expiredIds = [];
    for (var i = 0; i < (data || []).length; i++) {
      try {
        var r = data[i];
        var info = JSON.parse(r.content || '{}');
        if (info.expires_at && new Date(info.expires_at).getTime() <= Date.now()) {
          expiredIds.push(r.id);
        }
      } catch(e) {}
    }
    if (expiredIds.length > 0) {
      supabase.from('posts').delete().in('id', expiredIds).then(function(){}).catch(function(e){ console.warn('[Revoke] 清理过期吊销记录失败:', e && e.message); });
    }
  } catch(e) { console.warn('[Revoke] 加载吊销列表失败:', e.message); }
}

var revokedTokenHashes = new Set();
var revokedTokenHashesReady = false;
loadRevokedTokenHashes().then(function() { revokedTokenHashesReady = true; }).catch(function(){});

function isTokenRevoked(token) {
  if (revokedTokens.has(token)) return true;
  var hash = crypto.createHash('sha256').update(token).digest('hex');
  return revokedTokenHashes.has(hash);
}

function verifyToken(req, res, next) {
  var token = _getTokenFromRequest(req);

  // 从 HttpOnly Cookie 读取（优先级高于 Authorization header）
  if (!token && req.cookies && req.cookies.xtj_admin_token) {
    token = req.cookies.xtj_admin_token;
  }

  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  if (isTokenRevoked(token)) {
    return res.status(401).json({ error: '令牌已注销，请重新登录' });
  }

  var payload = verifySignedToken(token);
  if (payload) {
    req.adminToken = token;
    req.adminName = payload.user || payload.user_name || 'admin';
    return next();
  }

  const session = adminTokens.get(token);
  if (!session || Date.now() > session.expiresAt) {
    adminTokens.delete(token);
    return res.status(401).json({ error: '令牌已过期或无效，请重新登录' });
  }

  req.adminToken = token;
  req.adminName = session.userName || 'admin';
  next();
}

// ===================== 健康检查 ======================
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// 邮件配置健康检查（需管理员鉴权）
app.get('/health/mail', verifyToken, (req, res) => {
  res.json({
    ok: true,
    mail_config: {
      GMAIL_USER: GMAIL_USER ? '已设置' : '未设置',
      GMAIL_APP_PASSWORD: GMAIL_APP_PASSWORD ? '已设置' : '未设置',
      SENDGRID_API_KEY: process.env.SENDGRID_API_KEY ? '已设置' : '未设置',
      GMAIL_GAS_URL: process.env.GMAIL_GAS_URL ? '已设置' : '未设置',
      active_provider: GMAIL_GAS_URL ? 'GAS' : (process.env.SENDGRID_API_KEY ? 'SendGrid' : 'Gmail_SMTP')
    }
  });
});

// ===================== 管理员登录 ======================
app.post('/admin/login', rateLimit(60000, 10), async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }
  
  // 输入长度校验
  if (username.length > MAX_USERNAME_LEN) {
    return res.status(400).json({ error: '账号格式不正确' });
  }
  if (password.length > 128) {
    return res.status(400).json({ error: '密码格式不正确' });
  }
  
  // 防止用户名枚举：无论用户名是否存在，都进行密码比对，返回统一错误
  if (username !== ADMIN_USERNAME || !ADMIN_PASSWORD) {
    // 用户名不存在或密码未配置 → 执行虚拟比对防时序
    const dummyPw = Buffer.from('dummy');
    const dummyAdmin = Buffer.from('dummy');
    crypto.timingSafeEqual(dummyPw, dummyAdmin);
    return res.status(401).json({ error: '账号或密码错误' });
  }
  // 使用 timingSafeEqual 防止时序侧信道攻击
  const pwBuf = Buffer.from(password);
  const adminBuf = Buffer.from(ADMIN_PASSWORD);
  const pwMatch = pwBuf.length === adminBuf.length && crypto.timingSafeEqual(pwBuf, adminBuf);
  if (!pwMatch) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  
  const token = signToken();
  adminTokens.set(token, { expiresAt: Date.now() + TOKEN_EXPIRY_MS });

  // 记录管理员登录设备/IP
  logAdminLoginEvent(req).catch(function(){});

  // 设置 HttpOnly Secure SameSite Cookie（XSS 无法窃取）
  try {
    var cookieOpts = {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: ADMIN_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
      path: '/'
    };
    res.cookie('xtj_admin_token', token, cookieOpts);
  } catch(e) {}

  return res.json({ ok: true, username: ADMIN_USERNAME });
});

// ===================== 用户 Token 认证（JWT 替代 password_hash） =====================
const USER_TOKEN_HEADER_HOURS = 720; // 用户 token 有效期 30 天

async function authenticateUser(req, res, next) {
  // 优先验证 Authorization header 中的用户 token
  var token = _getTokenFromRequest(req);
  if (token) {
    var payload = verifyUserToken(token);
    if (payload && payload.user_name) {
      // 确认该用户仍存在于系统中
      try {
        var { data: userExists } = await supabase.from('posts')
          .select('id')
          .eq('user_name', payload.user_name)
          .eq('media_type', AUTH_MARKER)
          .maybeSingle();
        if (!userExists) {
          return res.status(401).json({ error: '用户不存在或已注销' });
        }
      } catch(e) {
        return res.status(500).json({ error: '认证查询失败' });
      }
      req.userName = payload.user_name;
      return next();
    }
  }

  // 兼容旧 password_hash（逐步废弃）
  // ★ 关键修复：GET 请求 req.body 可能为空，必须从 req.query 兜底
  //   同时确保 password_hash 也能从 query 读取（前端 GET history 走 query 兜底）
  var body = req.body || {};
  var query = req.query || {};
  var password_hash = body.password_hash || query.password_hash || '';
  var userName = body.user_name || query.user_name || body.reporter_name || query.reporter_name || '';
  var userNameVal = validateString(userName, MAX_USERNAME_LEN, '用户名');
  if (!userNameVal || !password_hash) {
    return res.status(401).json({ error: '缺少身份验证' });
  }
  try {
    var { data: authRec } = await supabase.from('posts')
      .select('media_url')
      .eq('user_name', userNameVal)
      .eq('media_type', AUTH_MARKER)
      .maybeSingle();
    if (!authRec || !authRec.media_url) {
      return res.status(403).json({ error: '身份验证失败' });
    }
    if (!crypto.timingSafeEqual(Buffer.from(authRec.media_url), Buffer.from(password_hash))) {
      return res.status(403).json({ error: '身份验证失败' });
    }
    req.userName = userNameVal;
    next();
  } catch(e) {
    return res.status(500).json({ error: '认证查询失败' });
  }
}

// 用户登录/获取 token（用 password_hash 换取 JWT token）
app.post('/api/user/login', rateLimit(60000, 10), async (req, res) => {
  try {
    var { user_name, password_hash } = req.body;
    var userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
    if (!userNameVal || !password_hash) {
      return res.status(400).json({ error: '缺少用户名或密码' });
    }
    var { data: authRec } = await supabase.from('posts')
      .select('media_url')
      .eq('user_name', userNameVal)
      .eq('media_type', AUTH_MARKER)
      .maybeSingle();
    if (!authRec || !authRec.media_url || !crypto.timingSafeEqual(Buffer.from(authRec.media_url), Buffer.from(password_hash))) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    var token = signUserToken(userNameVal);
    return res.json({ ok: true, token: token, user_name: userNameVal });
  } catch(e) {
    console.error('[API] 用户登录失败:', e.message);
    return res.status(500).json({ error: '登录失败' });
  }
});

// 验证 token 是否有效
app.get('/admin/verify', verifyToken, (req, res) => {
  return res.json({ ok: true });
});

// 管理员登出
app.post('/admin/logout', verifyToken, (req, res) => {
  var token = req.adminToken;
  adminTokens.delete(token);
  var payload = verifySignedToken(token);
  var exp = payload ? payload.exp : Date.now() + TOKEN_EXPIRY_MS;
  revokedTokens.set(token, exp);
  persistRevokedToken(token, exp).catch(function(){});
  res.clearCookie('xtj_admin_token', { path: '/' });
  return res.json({ ok: true });
});

// ===================== 自动过期函数 ======================
async function autoExpireOverdueRecords() {
  const now = new Date().toISOString();
  try {
    // 自动解除过期的封禁
    await supabase.from('bans').update({
      is_active: false, lifted_at: now, lifted_by: 'system'
    }).eq('is_active', true).lt('expires_at', now).not('expires_at', 'is', null);

    // 自动解除过期的禁言
    await supabase.from('mutes').update({
      is_active: false, lifted_at: now, lifted_by: 'system'
    }).eq('is_active', true).lt('expires_at', now).not('expires_at', 'is', null);

    // 自动解除过期的黑名单
    await supabase.from('blacklist').update({
      is_active: false, lifted_at: now, lifted_by: 'system'
    }).eq('is_active', true).lt('expires_at', now).not('expires_at', 'is', null);
  } catch (e) {
    console.warn('[auto-expire] 检查失败:', e.message);
  }
}

// ===================== 数据加载（只读，但需要认证） ======================
app.get('/admin/data', verifyToken, rateLimit(60000, 30), async (req, res) => {
  try {
    // 每次加载管理后台数据时，先检查并自动解除过期记录
    autoExpireOverdueRecords().catch(function() {});

    const [postRes, likeRes, commRes, banRes, annRes] = await Promise.all([
      applyPublicPostExclusions(supabase.from('posts').select('*')).order('created_at', { ascending: false }).limit(5000),
      supabase.from('likes').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('comments').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('bans').select('*').order('banned_at', { ascending: false }).limit(500),
      supabase.from('posts').select('*').eq('media_type', '__ann__').order('created_at', { ascending: false }).limit(500)
    ]);
    
    return res.json({
      posts: postRes.data || [],
      likes: likeRes.data || [],
      comments: commRes.data || [],
      bans: banRes.data || [],
      announcements: annRes.data || []
    });
  } catch (e) {
    console.error('[API] 数据加载失败:', e.message);
    return res.status(500).json({ error: '数据加载失败' });
  }
});

// ===================== 公告管理 ======================
app.post('/admin/announcement', verifyToken, rateLimit(60000, 20), async (req, res) => {
  const { title, content } = req.body;
  if (!title && !content) {
    return res.status(400).json({ error: '请至少填写标题或内容' });
  }
  
  const titleVal = validateString(title, MAX_TITLE_LEN, '标题');
  if (titleVal && titleVal.error) return res.status(400).json({ error: titleVal.error });
  const contentVal = validateString(content, MAX_CONTENT_LEN, '内容');
  if (contentVal && contentVal.error) return res.status(400).json({ error: contentVal.error });
  
  const storeData = JSON.stringify({ title: titleVal || '', content: contentVal || '' });
  const { data, error } = await supabase.from('posts').insert([{
    user_name: ADMIN_USERNAME,
    content: storeData,
    media_type: '__ann__',
    media_url: '',
    actor_key: 'admin_' + Date.now()
  }]).select().single();
  
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true, data });
});

app.delete('/admin/announcement/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { data: post } = await supabase.from('posts').select('actor_key').eq('id', id).maybeSingle();
  const actorKey = (post && post.actor_key) || 'admin_' + Date.now();
  const { error } = await supabase.rpc('delete_post_with_actor', {
    p_post_id: id,
    p_actor_key: actorKey
  });
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// ===================== 公告已读（跨设备同步） ======================
// 复用 posts marker（media_type=__ann_read__, media_url=announcementId）
// 同一用户对同一公告只允许一条记录（actor_key 唯一 + 23505 错误处理）
app.get('/api/announcements/read', authenticateUser, async (req, res) => {
  try {
    const userName = req.userName;
    const { data, error } = await supabase
      .from('posts')
      .select('media_url, created_at')
      .eq('media_type', ANN_READ_MARKER)
      .eq('user_name', userName);
    if (error) {
      console.error('[ann_read_get]', error);
      return res.status(500).json({ error: '查询已读记录失败' });
    }
    // 返回 {id: read_at_iso} 格式，前端可 Set 化
    const reads = {};
    (data || []).forEach(function(row) {
      if (row && row.media_url) {
        reads[String(row.media_url)] = row.created_at || null;
      }
    });
    return res.json({ reads: reads });
  } catch (err) {
    console.error('[ann_read_get_exception]', err);
    return res.status(500).json({ error: '查询失败' });
  }
});

app.post('/api/announcements/read', authenticateUser, async (req, res) => {
  try {
    const userName = req.userName;
    const body = req.body || {};
    let ids = body.announcement_ids;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'announcement_ids 必须是数组' });
    }
    if (ids.length > 100) {
      return res.status(400).json({ error: '一次最多 100 条' });
    }
    // 清洗 + 去重 + 限长
    const seen = new Set();
    const cleanIds = [];
    for (const raw of ids) {
      if (raw === undefined || raw === null) continue;
      const s = String(raw).trim();
      if (!s) continue;
      if (s.length > 128) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      cleanIds.push(s);
    }
    if (!cleanIds.length) {
      return res.json({ ok: true, marked: 0 });
    }
    // 查询已存在记录，避免重复插入
    const { data: existing, error: existErr } = await supabase
      .from('posts')
      .select('media_url')
      .eq('media_type', ANN_READ_MARKER)
      .eq('user_name', userName)
      .in('media_url', cleanIds);
    if (existErr) {
      console.error('[ann_read_existing]', existErr);
      return res.status(500).json({ error: '查询已读失败' });
    }
    const existingSet = new Set((existing || []).map(function(r) { return r && r.media_url ? String(r.media_url) : null; }).filter(Boolean));
    const toInsert = cleanIds.filter(function(id) { return !existingSet.has(id); });
    if (!toInsert.length) {
      return res.json({ ok: true, marked: 0, already_read: cleanIds.length });
    }
    // 批量插入（每条记录 actor_key 唯一）
    const rows = toInsert.map(function(id) {
      return {
        user_name: userName,
        content: '',
        media_type: ANN_READ_MARKER,
        media_url: id,
        actor_key: 'ann_read:' + userName + ':' + id
      };
    });
    const { error: insErr } = await supabase
      .from('posts')
      .insert(rows);
    if (insErr) {
      // 23505 = 唯一约束冲突（并发情况），当作成功处理
      if (insErr.code === '23505') {
        return res.json({ ok: true, marked: toInsert.length, note: '部分已存在' });
      }
      console.error('[ann_read_insert]', insErr);
      return res.status(500).json({ error: '保存已读失败' });
    }
    return res.json({ ok: true, marked: toInsert.length });
  } catch (err) {
    console.error('[ann_read_post_exception]', err);
    return res.status(500).json({ error: '保存失败' });
  }
});

// ===================== 帖子管理 ======================
app.delete('/admin/post/:id', verifyToken, rateLimit(1000, 30), async (req, res) => {
  var auditUser = 'unknown';
  try {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    var parts = token.split('.');
    if (parts.length >= 2) {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      auditUser = payload.user || 'unknown';
    }
  } catch(e) {}
  const { id } = req.params;
  // 先获取帖子的 actor_key
  const { data: post } = await supabase.from('posts').select('actor_key').eq('id', id).maybeSingle();
  const actorKey = (post && post.actor_key) || 'admin_' + Date.now();
  
  const { error } = await supabase.rpc('delete_post_with_actor', {
    p_post_id: id,
    p_actor_key: actorKey
  });
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  await logAdminAudit('delete_post', auditUser, 'post_id:' + id);
  return res.json({ ok: true });
});

// ===================== 评论管理 ======================
app.delete('/admin/comment/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.rpc('delete_comment_v2', {
    p_comment_id: id,
    p_deleted_by: ADMIN_USERNAME
  });
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true, data });
});

// ===================== 举报通知辅助函数 ======================
async function addReportNotification(reportId, action, message) {
  try {
    const { data: post } = await supabase.from('posts').select('content').eq('id', reportId).maybeSingle();
    if (!post) return;
    var c = {};
    try { c = JSON.parse(post.content || '{}'); } catch(e) {}
    if (!Array.isArray(c.notifications)) c.notifications = [];
    c.notifications.push({
      action: action,
      message: message,
      is_read: false,
      created_at: new Date().toISOString()
    });
    await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', reportId);
  } catch(e) { console.warn('[notif] 通知写入失败:', e.message); }
}

// ===================== 举报通知查询 API ======================
app.get('/api/report/notifications', authenticateUser, async (req, res) => {
  const userName = req.userName;
  try {
    const { data, error } = await supabase.from('posts')
      .select('id, content')
      .eq('user_name', userName)
      .eq('media_type', '__report__')
      .order('created_at', { ascending: false })
      .limit(160);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    var unread = 0;
    (data || []).forEach(function(p) {
      try {
        var c = JSON.parse(p.content || '{}');
        if (Array.isArray(c.notifications)) {
          unread += c.notifications.filter(function(n) { return !n.is_read; }).length;
        }
      } catch(e) {}
    });
    return res.json({ unread: unread });
  } catch(e) { return res.status(500).json({ error: '查询失败' }); }
});

app.post('/api/report/notifications/mark-read', authenticateUser, async (req, res) => {
  const userName = req.userName;
  try {
    const { data, error } = await supabase.from('posts')
      .select('id, content')
      .eq('user_name', userName)
      .eq('media_type', '__report__');
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    for (var i = 0; i < (data || []).length; i++) {
      var p = data[i];
      try {
        var c = JSON.parse(p.content || '{}');
        if (Array.isArray(c.notifications) && c.notifications.some(function(n) { return !n.is_read; })) {
          c.notifications.forEach(function(n) { n.is_read = true; });
          await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', p.id);
        }
      } catch(e) {}
    }
    return res.json({ ok: true });
  } catch(e) { return res.status(500).json({ error: '操作失败' }); }
});

// ===================== 照片管理 ======================
app.get('/admin/photos', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('posts')
    .select('id, user_name, content, media_url, actor_key, created_at, views, is_deleted, deleted_at, deleted_by')
    .eq('media_type', '__photo_wall__')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.delete('/admin/photo/:id', verifyToken, async (req, res) => {
  var auditUser = 'unknown';
  try {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    var parts = token.split('.');
    if (parts.length >= 2) {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      auditUser = payload.user || 'unknown';
    }
  } catch(e) {}
  const { id } = req.params;
  const { error } = await supabase.from('posts').update({
    is_deleted: true,
    deleted_at: new Date().toISOString(),
    deleted_by: 'admin'
  }).eq('id', id).eq('media_type', '__photo_wall__');
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  await logAdminAudit('delete_photo', auditUser, 'photo_id:' + id);
  return res.json({ ok: true });
});

app.post('/admin/photo/restore/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('posts').update({
    is_deleted: false,
    deleted_at: null,
    deleted_by: null
  }).eq('id', id).eq('media_type', '__photo_wall__');
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// ===================== 用户照片删除 API（使用 service_role 绕过 RLS） ======================
app.post('/api/photo/delete', authenticateUser, rateLimit(60000, 20), async (req, res) => {
  try {
    const { photoId, admin_pw } = req.body;
    if (!photoId) return res.status(400).json({ error: '缺少照片ID' });

    var isAdminOp = false;
    if (req.userName === ADMIN_USERNAME && admin_pw) {
      const { data: adminAuth } = await supabase.from('posts')
        .select('media_url')
        .eq('user_name', ADMIN_USERNAME)
        .eq('media_type', ADMIN_AUTH_MARKER)
        .maybeSingle();
      if (adminAuth && adminAuth.media_url === admin_pw) isAdminOp = true;
    }

    const { data: photo } = await supabase.from('posts')
      .select('user_name, media_url')
      .eq('id', photoId)
      .maybeSingle();

    if (!photo) return res.status(404).json({ error: '照片不存在' });
    if (!isAdminOp && photo.user_name !== req.userName) return res.status(403).json({ error: '无权删除此照片' });

    var storagePath = null;
    if (photo.media_url) {
      try {
        var parsed = new URL(photo.media_url);
        var match = parsed.pathname.match(/\/object\/public\/uploads\/(.*)$/) || parsed.pathname.match(/\/uploads\/(.*)$/);
        storagePath = match && match[1] ? decodeURIComponent(match[1]) : null;
        if (storagePath && storagePath.indexOf('..') >= 0) storagePath = null;
      } catch(_) {}
    }
    if (storagePath) {
      try { await supabase.storage.from('uploads').remove([storagePath]); } catch(_) {}
    }
    const { error } = await supabase.from('posts').delete().eq('id', photoId);
    if (error) return res.status(400).json({ error: sanitizeError(error) });

    return res.json({ ok: true });
  } catch(e) {
    console.error('[API] 照片删除失败:', e.message);
    return res.status(500).json({ error: '删除失败' });
  }
});

// ===================== P0: 帖子编辑/删除 API (替代前端直接 Supabase UPDATE) =====================
app.post('/api/post/update', authenticateUser, rateLimit(60000, 30), async (req, res) => {
  try {
    var postId = parseInt(req.body && req.body.post_id);
    if (!postId || isNaN(postId)) return res.status(400).json({ error: '缺少 post_id' });
    var { data: post } = await supabase.from('posts').select('user_name').eq('id', postId).maybeSingle();
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    var isAdmin = req.userName === ADMIN_USERNAME;
    if (!isAdmin && post.user_name !== req.userName) return res.status(403).json({ error: '无权修改' });
    var updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'visibility')) {
      var v = String(req.body.visibility);
      if (['public', 'private'].indexOf(v) >= 0) updates.visibility = v;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'is_pinned')) {
      updates.is_pinned = !!req.body.is_pinned;
      updates.pinned_at = req.body.is_pinned ? new Date().toISOString() : null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'content')) {
      updates.content = String(req.body.content).slice(0, 50000);
    }
    // 允许前端传 updated_at（编辑/置顶/公开切私有都需要同步）
    if (Object.prototype.hasOwnProperty.call(req.body, 'updated_at')) {
      var ua = req.body.updated_at;
      try { if (ua && !isNaN(new Date(ua).getTime())) updates.updated_at = ua; else updates.updated_at = new Date().toISOString(); } catch(e) { updates.updated_at = new Date().toISOString(); }
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: '没有要更新的字段' });
    var { data: updatedPost, error } = await supabase.from('posts').update(updates).eq('id', postId).select('*').maybeSingle();
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    if (!updatedPost) return res.status(500).json({ error: '更新失败：未返回数据' });
    return res.json({ ok: true, data: updatedPost });
  } catch (e) { console.error('[API] post update:', e.message); return res.status(500).json({ error: '更新失败' }); }
});

app.post('/api/post/delete', authenticateUser, rateLimit(60000, 20), async (req, res) => {
  try {
    var postId = parseInt(req.body && req.body.post_id);
    if (!postId || isNaN(postId)) return res.status(400).json({ error: '缺少 post_id' });
    var { data: post } = await supabase.from('posts').select('user_name').eq('id', postId).maybeSingle();
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    var isAdmin = req.userName === ADMIN_USERNAME;
    if (!isAdmin && post.user_name !== req.userName) return res.status(403).json({ error: '无权删除' });
    var { error } = await supabase.from('posts').delete().eq('id', postId);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    return res.json({ ok: true });
  } catch (e) { console.error('[API] post delete:', e.message); return res.status(500).json({ error: '删除失败' }); }
});

// ===================== 封禁管理 ======================
app.get('/admin/bans', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('bans').select('*').order('banned_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.post('/admin/ban', verifyToken, rateLimit(60000, 30), async (req, res) => {
  var auditUser = 'unknown';
  try {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    var parts = token.split('.');
    if (parts.length >= 2) {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      auditUser = payload.user || 'unknown';
    }
  } catch(e) {}
  const { user_name, duration_hours, reason } = req.body;
  const durationCheck = validateDurationHours(duration_hours);
  if (durationCheck.error) return res.status(400).json({ error: durationCheck.error });
  const durationHoursVal = durationCheck.value;
  if (!user_name) return res.status(400).json({ error: '缺少用户名' });
  
  const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
  if (userNameVal && userNameVal.error) return res.status(400).json({ error: userNameVal.error });
  if (isProtectedAdminTarget(userNameVal)) return res.status(403).json({ error: 'Operation not allowed for admin user' });
  const reasonVal = validateString(reason, MAX_REASON_LEN, '原因');
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  
  const banType = durationHoursVal === 0 ? 'permanent' : 'temporary';
  let expiresAt = null;
  if (durationHoursVal > 0) {
    expiresAt = new Date(Date.now() + durationHoursVal * 3600000).toISOString();
  }
  
  const { data: existing } = await supabase.from('bans').select('id, is_active').eq('user_name', userNameVal);
  if (existing && existing.length) {
    const activeBan = existing.find(b => b.is_active);
    if (activeBan) return res.status(409).json({ error: '该用户已被拉黑封禁' });
    
    const { error } = await supabase.from('bans').update({
      ban_reason: reasonVal || '违反社区规定',
      ban_duration_hours: durationHoursVal,
      ban_type: banType,
      banned_by: ADMIN_USERNAME,
      expires_at: expiresAt,
      is_active: true,
      banned_at: new Date().toISOString()
    }).eq('id', existing[0].id);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
  } else {
    const { error } = await supabase.from('bans').insert([{
      user_name: userNameVal, ban_type: banType, ban_reason: reasonVal || '违反社区规定',
      ban_duration_hours: durationHoursVal,
      banned_by: ADMIN_USERNAME, expires_at: expiresAt, is_active: true
    }]);
    if (error) {
      if (error.code === '23505') {
        const { error: updErr } = await supabase.from('bans').update({
          ban_reason: reasonVal || '违反社区规定',
          ban_duration_hours: durationHoursVal,
          ban_type: banType,
          banned_by: ADMIN_USERNAME,
          expires_at: expiresAt,
          is_active: true,
          banned_at: new Date().toISOString()
        }).eq('user_name', userNameVal);
        if (updErr) return res.status(400).json({ error: sanitizeError(updErr) });
      } else {
        return res.status(400).json({ error: sanitizeError(error) });
      }
    }
  }
  
  await logAdminAudit('ban_user', auditUser, 'user:' + userNameVal);
  return res.json({ ok: true });
});

app.put('/admin/ban/:id/lift', verifyToken, async (req, res) => {
  var auditUser = 'unknown';
  try {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    var parts = token.split('.');
    if (parts.length >= 2) {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      auditUser = payload.user || 'unknown';
    }
  } catch(e) {}
  const { id } = req.params;
  const { error } = await supabase.from('bans').update({
    is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN_USERNAME
  }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  await logAdminAudit('unban_user', auditUser, 'ban_id:' + id);
  return res.json({ ok: true });
});

// ===================== 禁言管理 ======================
app.get('/admin/mutes', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('mutes').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.post('/admin/mute', verifyToken, rateLimit(60000, 30), async (req, res) => {
  var auditUser = 'unknown';
  try {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    var parts = token.split('.');
    if (parts.length >= 2) {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      auditUser = payload.user || 'unknown';
    }
  } catch(e) {}
  const { user_name, duration_hours, reason } = req.body;
  const durationCheck = validateDurationHours(duration_hours);
  if (durationCheck.error) return res.status(400).json({ error: durationCheck.error });
  const durationHoursVal = durationCheck.value;
  if (!user_name) return res.status(400).json({ error: '缺少用户名' });
  
  const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
  if (userNameVal && userNameVal.error) return res.status(400).json({ error: userNameVal.error });
  const reasonVal = validateString(reason, MAX_REASON_LEN, '原因');
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  if (isProtectedAdminTarget(userNameVal)) return res.status(403).json({ error: 'Operation not allowed for admin user' });
  
  let expiresAt = null;
  if (durationHoursVal > 0) {
    expiresAt = new Date(Date.now() + durationHoursVal * 3600000).toISOString();
  }
  
  const { error } = await supabase.from('mutes').insert([{
    user_name: userNameVal,
    reason: reasonVal || '违反社区规定',
    duration_hours: durationHoursVal,
    muted_by: ADMIN_USERNAME,
    expires_at: expiresAt,
    is_active: true
  }]);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  
  await logAdminAudit('mute_user', auditUser, 'user:' + userNameVal);
  return res.json({ ok: true });
});

app.put('/admin/mute/:id/lift', verifyToken, async (req, res) => {
  var auditUser = 'unknown';
  try {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    var parts = token.split('.');
    if (parts.length >= 2) {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      auditUser = payload.user || 'unknown';
    }
  } catch(e) {}
  const { id } = req.params;
  const { error } = await supabase.from('mutes').update({
    is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN_USERNAME
  }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  await logAdminAudit('unmute_user', auditUser, 'mute_id:' + id);
  return res.json({ ok: true });
});

// ===================== 黑名单管理 ======================
app.get('/admin/blacklist', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('blacklist').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.post('/admin/blacklist', verifyToken, rateLimit(60000, 30), async (req, res) => {
  const { user_name, reason, duration_hours } = req.body;
  const durationCheck = validateDurationHours(duration_hours);
  if (durationCheck.error) return res.status(400).json({ error: durationCheck.error });
  const durationHoursVal = durationCheck.value;
  if (!user_name) return res.status(400).json({ error: '缺少用户名' });
  
  const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
  if (userNameVal && userNameVal.error) return res.status(400).json({ error: userNameVal.error });
  const reasonVal = validateString(reason, MAX_REASON_LEN, '原因');
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  if (isProtectedAdminTarget(userNameVal)) return res.status(403).json({ error: 'Operation not allowed for admin user' });
  
  let expiresAt = null;
  if (durationHoursVal > 0) {
    expiresAt = new Date(Date.now() + durationHoursVal * 3600000).toISOString();
  }
  
  const { data: existing } = await supabase.from('blacklist').select('id, is_active').eq('user_name', userNameVal);
  if (existing && existing.length) {
    const activeEntry = existing.find(e => e.is_active);
    if (activeEntry) return res.status(409).json({ error: '该用户已在黑名单中' });
    
    const { error } = await supabase.from('blacklist').update({
      reason: reasonVal || '违反社区规定',
      duration_hours: durationHoursVal,
      added_by: ADMIN_USERNAME,
      expires_at: expiresAt,
      is_active: true,
      created_at: new Date().toISOString()
    }).eq('id', existing[0].id);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
  } else {
    const { error } = await supabase.from('blacklist').insert([{
      user_name: userNameVal,
      reason: reasonVal || '违反社区规定',
      duration_hours: durationHoursVal,
      added_by: ADMIN_USERNAME,
      expires_at: expiresAt,
      is_active: true
    }]);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
  }
  
  return res.json({ ok: true });
});

app.put('/admin/blacklist/:id/lift', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { data: target } = await supabase.from('blacklist').select('user_name').eq('id', id).maybeSingle();
  const { error } = await supabase.from('blacklist').update({
    is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN_USERNAME
  }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  if (target) await logAdminAudit('unblacklist_user', ADMIN_USERNAME, 'user:' + target.user_name + ' blacklist_id:' + id);
  return res.json({ ok: true });
});

// ===================== 管理员删除用户账号 =====================
app.delete('/admin/user/:userName', verifyToken, rateLimit(60000, 5), async (req, res) => {
  try {
    var userName = String(req.params.userName || '').trim();
    if (!userName || userName.length > MAX_USERNAME_LEN) return res.status(400).json({ error: '用户名无效' });
    if (userName === ADMIN_USERNAME) return res.status(403).json({ error: '不能删除管理员账号' });

    // 检查用户是否在任意表中存在（不仅 AUTH_MARKER）
    var existsChecks = await Promise.all([
      supabase.from('posts').select('id').eq('user_name', userName).limit(1),
      supabase.from('likes').select('id').eq('user_name', userName).limit(1),
      supabase.from('comments').select('id').eq('user_name', userName).limit(1),
      supabase.from('bans').select('id').eq('user_name', userName).limit(1),
      supabase.from('mutes').select('id').eq('user_name', userName).limit(1),
      supabase.from('blacklist').select('id').eq('user_name', userName).limit(1)
    ]);

    var exists = existsChecks.some(function(r) {
      return r && r.data && r.data.length > 0;
    });

    if (!exists) {
      return res.status(404).json({ error: '用户不存在或已被删除' });
    }

    // 先查询该用户发布的帖子 ID，用于级联删除点赞和评论
    var userPostIds = [];
    try {
      var { data: userPosts } = await supabase.from('posts').select('id').eq('user_name', userName);
      if (userPosts && userPosts.length) {
        userPostIds = userPosts.map(function(p) { return p.id; });
      }
    } catch(e) {
      console.warn('[admin] 查询用户帖子ID失败:', e.message);
    }

    // 查询并删除照片墙的 Storage 文件
    var storagePaths = [];
    try {
      var { data: photoRecords } = await supabase.from('posts')
        .select('media_url').eq('user_name', userName).eq('media_type', '__photo_wall__');
      if (photoRecords && photoRecords.length) {
        photoRecords.forEach(function(p) {
          if (p.media_url) {
            var url = p.media_url;
            var pathMatch = url.match(/\/uploads\/(.+?)(?:\?|$)/);
            if (pathMatch) {
              var p = pathMatch[1];
              if (p.indexOf('..') === -1 && p.indexOf('/') === -1) storagePaths.push(p);
            }
          }
        });
      }
    } catch(storageErr) {
      console.warn('[admin] 查询照片路径失败:', storageErr.message);
    }

    // 删除 Storage 文件（失败不影响账号删除）
    var deletedStorage = 0;
    if (storagePaths.length > 0) {
      try {
        var { error: storageError } = await supabase.storage.from('uploads').remove(storagePaths);
        if (storageError) {
          console.warn('[admin] 删除照片文件失败:', storageError.message);
        } else {
          deletedStorage = storagePaths.length;
        }
      } catch(storageErr) {
        console.warn('[admin] 删除照片文件异常:', storageErr.message);
      }
    }

    var deletedPosts = 0, deletedLikes = 0, deletedComments = 0, deletedBans = 0, deletedMutes = 0, deletedBlacklist = 0;

    // 删除帖子的同时，级联删除该帖子下的点赞和评论
    if (userPostIds.length > 0) {
      try {
        var cascadeLikeRes = await supabase.from('likes').delete().in('post_id', userPostIds);
        if (!cascadeLikeRes.error) deletedLikes += (cascadeLikeRes.count || 0);
      } catch(e) { console.warn('[admin] 级联删除 likes 失败:', e.message); }
      try {
        var cascadeCommentRes = await supabase.from('comments').delete().in('post_id', userPostIds);
        if (!cascadeCommentRes.error) deletedComments += (cascadeCommentRes.count || 0);
      } catch(e) { console.warn('[admin] 级联删除 comments 失败:', e.message); }
    }

    // 删除 posts 表（用户发布的帖子）
    var delPostsRes = await supabase.from('posts').delete().eq('user_name', userName);
    if (!delPostsRes.error) deletedPosts = (delPostsRes.count || 0);
    else console.warn('[admin] 删除 posts 失败:', delPostsRes.error.message);

    // 删除 likes 表（该用户自己点的赞）
    try {
      var delLikesRes = await supabase.from('likes').delete().eq('user_name', userName);
      if (!delLikesRes.error) deletedLikes += (delLikesRes.count || 0);
      else console.warn('[admin] 删除 likes 失败:', delLikesRes.error.message);
    } catch(e) { console.warn('[admin] 删除 likes 异常:', e.message); }

    // 删除 comments 表（该用户自己的评论）
    try {
      var delCommentsRes = await supabase.from('comments').delete().eq('user_name', userName);
      if (!delCommentsRes.error) deletedComments += (delCommentsRes.count || 0);
      else console.warn('[admin] 删除 comments 失败:', delCommentsRes.error.message);
    } catch(e) { console.warn('[admin] 删除 comments 异常:', e.message); }

    // 删除 bans 表
    var delBansRes = await supabase.from('bans').delete().eq('user_name', userName);
    if (!delBansRes.error) deletedBans = delBansRes.count || 0;
    else console.warn('[admin] 删除 bans 失败:', delBansRes.error.message);

    // 删除 mutes 表
    var delMutesRes = await supabase.from('mutes').delete().eq('user_name', userName);
    if (!delMutesRes.error) deletedMutes = delMutesRes.count || 0;
    else console.warn('[admin] 删除 mutes 失败:', delMutesRes.error.message);

    // 删除 blacklist 表
    var delBlacklistRes = await supabase.from('blacklist').delete().eq('user_name', userName);
    if (!delBlacklistRes.error) deletedBlacklist = delBlacklistRes.count || 0;
    else console.warn('[admin] 删除 blacklist 失败:', delBlacklistRes.error.message);

    // 写入审计日志
    await logAdminAudit('delete_user', ADMIN_USERNAME,
      'user:' + userName +
      ' posts:' + deletedPosts +
      ' likes:' + deletedLikes +
      ' comments:' + deletedComments +
      ' bans:' + deletedBans +
      ' mutes:' + deletedMutes +
      ' blacklist:' + deletedBlacklist +
      ' storage_files:' + deletedStorage
    );

    return res.json({
      ok: true,
      user_name: userName,
      deleted: {
        posts: deletedPosts,
        likes: deletedLikes,
        comments: deletedComments,
        bans: deletedBans,
        mutes: deletedMutes,
        blacklist: deletedBlacklist,
        storage_files: deletedStorage
      }
    });
  } catch(e) {
    console.error('[admin] 删除用户失败:', e.message || e);
    return res.status(500).json({ error: '删除用户失败' });
  }
});

function firstNonEmptyValue() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function parseReportRecordContent(rawContent) {
  let parsed = {};
  try { parsed = JSON.parse(rawContent || '{}'); } catch(e) {}
  const targetTypeRaw = firstNonEmptyValue(parsed.target_type, parsed.type, parsed.report_type, parsed.targetKind);
  return {
    target_type: targetTypeRaw === 'photo_wall' ? 'photo' : (targetTypeRaw || 'post'),
    target_id: firstNonEmptyValue(parsed.target_id, parsed.post_id, parsed.photo_id, parsed.report_target_id, parsed.target_post_id),
    target_user: firstNonEmptyValue(parsed.target_user, parsed.target_username, parsed.reported_user, parsed.reported_username, parsed.post_user),
    report_category: firstNonEmptyValue(parsed.report_category, parsed.category, parsed.reason_type, parsed.report_type_name),
    report_reason: firstNonEmptyValue(parsed.report_reason, parsed.reason, parsed.detail, parsed.description),
    status: firstNonEmptyValue(parsed.status, parsed.review_status) || 'pending',
    admin_response: firstNonEmptyValue(parsed.admin_response, parsed.response_text) || null,
    reviewed_at: firstNonEmptyValue(parsed.reviewed_at, parsed.handled_at, parsed.updated_at) || null,
    reviewed_by: firstNonEmptyValue(parsed.reviewed_by, parsed.handled_by, parsed.admin_name) || null,
    response_at: firstNonEmptyValue(parsed.response_at, parsed.reply_at) || null
  };
}

function formatAdminReportReason(category, reason) {
  const normalizedCategory = firstNonEmptyValue(category);
  const normalizedReason = firstNonEmptyValue(reason);
  if (!normalizedReason) return normalizedCategory || '-';
  if (!normalizedCategory) return normalizedReason;
  const cleanCategory = normalizedCategory.replace(/[：:]+$/, '');
  const otherLabels = ['其他', 'other', 'others'];
  const isOther = otherLabels.includes(cleanCategory.toLowerCase ? cleanCategory.toLowerCase() : cleanCategory);
  const prefixedReason = normalizedReason
    .replace(/^其他[：:\-\s]*/i, '')
    .replace(/^other[：:\-\s]*/i, '')
    .trim();
  if (isOther) {
    return prefixedReason ? ('其他-' + prefixedReason) : '其他';
  }
  if (normalizedReason === normalizedCategory) return normalizedReason;
  return normalizedReason;
}

// ===================== 举报管理 ======================
app.get('/admin/reports', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('posts').select('*').eq('media_type', REPORT_MARKER).order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });

  const reports = (data || []).map(function(p) {
      const normalized = parseReportRecordContent(p.content);
      return {
          id: p.id,
          created_at: p.created_at,
          reporter_name: firstNonEmptyValue(p.user_name, normalized.reporter_name) || '-',
          target_type: normalized.target_type || 'post',
          target_id: normalized.target_id || '',
          target_user: normalized.target_user || '',
          report_category: normalized.report_category || '-',
          report_reason: formatAdminReportReason(normalized.report_category, normalized.report_reason),
          status: normalized.status || 'pending',
          admin_response: normalized.admin_response,
          reviewed_at: normalized.reviewed_at,
          reviewed_by: normalized.reviewed_by,
          response_at: normalized.response_at
      };
  });

  const missingTargetIds = Array.from(new Set(reports.filter(function(r) {
    return !r.target_user && r.target_id;
  }).map(function(r) {
    return r.target_id;
  })));

  if (missingTargetIds.length) {
    const { data: targetPosts } = await supabase.from('posts').select('id, user_name').in('id', missingTargetIds);
    const targetUserMap = {};
    (targetPosts || []).forEach(function(post) {
      if (post && post.id && post.user_name && !targetUserMap[post.id]) {
        targetUserMap[post.id] = post.user_name;
      }
    });
    reports.forEach(function(report) {
      if (!report.target_user) {
        report.target_user = targetUserMap[report.target_id] || '-';
      }
    });
  }

  reports.forEach(function(report) {
    if (!report.target_user) report.target_user = '-';
    if (!report.report_category) report.report_category = '-';
    report.report_reason = formatAdminReportReason(report.report_category, report.report_reason);
  });

  return res.json({ data: reports });
});

app.put('/admin/report/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowedStatuses = ['pending', 'reviewed', 'actioned', 'dismissed'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: '无效的状态值' });
  }
  // 从 posts 表获取举报数据（存储在 content JSON 中）
  const { data: post, error: fetchErr } = await supabase.from('posts').select('content').eq('id', id).maybeSingle();
  if (fetchErr) return res.status(400).json({ error: sanitizeError(fetchErr) });
  if (!post) return res.status(404).json({ error: '举报不存在' });
  var c = {};
  try { c = JSON.parse(post.content || '{}'); } catch(e) {}
  c.status = status;
  c.reviewed_at = new Date().toISOString();
  c.reviewed_by = ADMIN_USERNAME;
  const { error } = await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  var notifMsg = status === 'actioned' ? '管理员已将你的举报标记为已处理' : (status === 'dismissed' ? '管理员已驳回你的举报' : '管理员已审核你的举报');
  addReportNotification(id, status, notifMsg).catch(function(){});
  return res.json({ ok: true });
});

// 管理员回复举报
app.put('/admin/report/:id/respond', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { response } = req.body;
  if (!response || !String(response).trim()) {
    return res.status(400).json({ error: '回复内容不能为空' });
  }
  const responseVal = validateString(response, MAX_CONTENT_LEN, '回复');
  if (responseVal && responseVal.error) return res.status(400).json({ error: responseVal.error });
  // 从 posts 表获取举报数据（存储在 content JSON 中）
  const { data: post, error: fetchErr } = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
  if (fetchErr) return res.status(400).json({ error: sanitizeError(fetchErr) });
  if (!post) return res.status(404).json({ error: '举报不存在' });
  var c = {};
  try { c = JSON.parse(post.content || '{}'); } catch(e) {}
  c.admin_response = responseVal;
  c.response_at = new Date().toISOString();
  c.status = 'actioned';
  c.reviewed_at = new Date().toISOString();
  c.reviewed_by = ADMIN_USERNAME;
  const { error } = await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  // 向举报人发送 DM 通知
  sendAdminDm(post.user_name, '[举报回复] ' + responseVal);
  addReportNotification(id, 'replied', '管理员已回复你的举报').catch(function(){});
  return res.json({ ok: true });
});

// 管理员处理举报 + 删除帖子
app.post('/admin/report/:id/delete-post', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    // 从 posts 表获取举报数据（存储在 content JSON 中）
    const { data: reportPost } = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
    if (!reportPost) return res.status(404).json({ error: '举报不存在' });
    var c = {};
    try { c = JSON.parse(reportPost.content || '{}'); } catch(e) {}
    const targetType = c.target_type || 'post';
    const targetId = c.target_id || '';
    if (targetType === 'post' || targetType === 'photo') {
      const { data: post, error: fetchPostErr } = await supabase.from('posts').select('actor_key').eq('id', targetId).maybeSingle();
      if (fetchPostErr) return res.status(400).json({ error: sanitizeError(fetchPostErr) });
      const actorKey = (post && post.actor_key) || 'admin_' + Date.now();
      const { error: rpcErr } = await supabase.rpc('delete_post_with_actor', {
        p_post_id: targetId,
        p_actor_key: actorKey
      });
      if (rpcErr) return res.status(400).json({ error: sanitizeError(rpcErr) });
    }
    // 标记举报已处理
    const adminMsg = '被举报的' + (targetType === 'photo' ? '照片' : '帖子') + '已被删除';
    c.status = 'actioned';
    c.reviewed_at = new Date().toISOString();
    c.reviewed_by = ADMIN_USERNAME;
    c.admin_response = adminMsg;
    const { error: updErr } = await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
    if (updErr) return res.status(400).json({ error: sanitizeError(updErr) });
    sendAdminDm(reportPost.user_name, '[举报处理] ' + adminMsg);
    addReportNotification(id, 'content_deleted', '管理员已删除被举报内容').catch(function(){});
    return res.json({ ok: true });
  } catch(e) {
    console.error('[admin] 举报处理删除帖子失败:', e.message || e);
    return res.status(500).json({ error: '处理失败：' + (e.message || '未知错误') });
  }
});

// 管理员处理举报 + 封禁用户
app.post('/admin/report/:id/ban-user', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { duration_hours } = req.body;
    // 从 posts 表获取举报数据（存储在 content JSON 中）
    const { data: reportPost } = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
    if (!reportPost) return res.status(404).json({ error: '举报不存在' });
    var c = {};
    try { c = JSON.parse(reportPost.content || '{}'); } catch(e) {}
    const targetUser = c.target_user;
    const reportReason = c.report_reason || '';
    if (!targetUser) return res.status(400).json({ error: '无法确定被举报用户' });

    const banType = (duration_hours || 0) === 0 ? 'permanent' : 'temporary';
    let expiresAt = null;
    if (duration_hours > 0) {
      expiresAt = new Date(Date.now() + duration_hours * 3600000).toISOString();
    }

    // 检查是否已有封禁记录
    const { data: existing } = await supabase.from('bans').select('id, is_active').eq('user_name', targetUser);
    if (existing && existing.length) {
      const activeBan = existing.find(b => b.is_active);
      if (activeBan) {
        // 已经封禁，只更新举报状态
        c.status = 'actioned';
        c.reviewed_at = new Date().toISOString();
        c.reviewed_by = ADMIN_USERNAME;
        c.admin_response = '该用户已被封禁';
        const { error: updErr1 } = await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
        if (updErr1) return res.status(400).json({ error: sanitizeError(updErr1) });
        sendAdminDm(reportPost.user_name, '[举报处理] 该用户已被封禁');
        addReportNotification(id, 'user_banned', '管理员已将举报用户封禁').catch(function(){});
        return res.json({ ok: true, message: '该用户已被封禁，举报已标记为已处理' });
      }
      const { error: updBanErr } = await supabase.from('bans').update({
        ban_reason: '举报处理：' + (reportReason || '违规内容'),
        ban_duration_hours: duration_hours || 0,
        ban_type: banType,
        banned_by: ADMIN_USERNAME,
        expires_at: expiresAt,
        is_active: true,
        banned_at: new Date().toISOString()
      }).eq('id', existing[0].id);
      if (updBanErr) {
        // 回滚举报状态
        await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
        return res.status(400).json({ error: sanitizeError(updBanErr) });
      }
    } else {
      const { error: insErr } = await supabase.from('bans').insert([{
        user_name: targetUser,
        ban_type: banType,
        ban_reason: '举报处理：' + (reportReason || '违规内容'),
        ban_duration_hours: duration_hours || 0,
        banned_by: ADMIN_USERNAME,
        expires_at: expiresAt,
        is_active: true
      }]);
      if (insErr) return res.status(400).json({ error: sanitizeError(insErr) });
    }

    // 标记举报已处理
    const banMsg = banType === 'permanent' ? '用户已被永久封禁' : `用户已被封禁${duration_hours || 0}小时`;
    c.status = 'actioned';
    c.reviewed_at = new Date().toISOString();
    c.reviewed_by = ADMIN_USERNAME;
    c.admin_response = banMsg;
    const { error: finalUpdErr } = await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
    if (finalUpdErr) return res.status(400).json({ error: sanitizeError(finalUpdErr) });
    sendAdminDm(reportPost.user_name, '[举报处理] ' + banMsg);
    addReportNotification(id, 'user_banned', '管理员已将举报用户封禁').catch(function(){});
    return res.json({ ok: true });
  } catch(e) {
    console.error('[admin] 举报处理封禁用户失败:', e.message || e);
    return res.status(500).json({ error: '处理失败：' + (e.message || '未知错误') });
  }
});

// 用户提交举报
app.post('/api/report', rateLimit(60000, 5), authenticateUser, async (req, res) => {
  const { reporter_name, target_type, target_id, target_user, report_category, report_reason } = req.body;
  const reporterVal = req.userName;
  if (!reporterVal || !target_type || !target_id || !report_category) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  const targetUserVal = validateString(target_user, MAX_USERNAME_LEN, '被举报用户');
  const reasonVal = validateString(report_reason, MAX_REASON_LEN, '举报原因');
  if (targetUserVal && targetUserVal.error) return res.status(400).json({ error: targetUserVal.error });
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  
  const reportContent = JSON.stringify({
    target_type: String(target_type).slice(0, 20),
    target_id: String(target_id).slice(0, 100),
    target_user: String(targetUserVal || '').slice(0, 50),
    report_category: String(report_category).slice(0, 50),
    report_reason: String(reasonVal || '').slice(0, MAX_REASON_LEN),
    status: 'pending'
  });
  const { error } = await supabase.from('posts').insert([{
    user_name: reporterVal,
    content: reportContent,
    media_type: REPORT_MARKER,
    actor_key: REPORT_MARKER
  }]);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// 用户查看自己的举报
app.get('/api/my-reports', rateLimit(60000, 20), authenticateUser, async (req, res) => {
  const userName = req.userName;
  const { data, error } = await supabase.from('posts')
    .select('*')
    .eq('media_type', REPORT_MARKER)
    .eq('user_name', userName)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  const reports = (data || []).map(function(p) {
    var c = {};
    try { c = JSON.parse(p.content || '{}'); } catch(e) {}
    return {
      id: p.id,
      created_at: p.created_at,
      reporter_name: p.user_name,
      target_type: c.target_type || 'post',
      target_id: c.target_id || '',
      target_user: c.target_user || '',
      report_category: c.report_category || '',
      report_reason: c.report_reason || '',
      status: c.status || 'pending',
      admin_response: c.admin_response || null,
      reviewed_at: c.reviewed_at || null,
      reviewed_by: c.reviewed_by || null,
      response_at: c.response_at || null
    };
  });
  return res.json({ data: reports });
});

// ===================== 用户数据（只读） ======================
app.get('/admin/users', verifyToken, async (req, res) => {
  try {
    const [authRows, userInfoRows] = await Promise.all([
      fetchAllPostsByMediaType(AUTH_MARKER, 'user_name, created_at'),
      fetchAllPostsByMediaType(USER_INFO_MARKER, 'user_name, content, created_at')
    ]);
    return res.json({ data: buildAdminUsersPayload(authRows, userInfoRows) });
  } catch (error) {
    return res.status(400).json({ error: sanitizeError(error) });
  }
});

// ===================== 数据统计 API =====================
const MAX_STATS_LIMIT = 20000;

// 汇总统计
app.get('/admin/stats', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const startDate = req.query.start || '';
    const endDate = req.query.end || '';

    // 有日期筛选时不使用缓存
    if (!startDate && !endDate && statsCache.data && (Date.now() - statsCache.ts) < STATS_CACHE_TTL) {
      return res.json(statsCache.data);
    }
    // 简单锁：并发请求等待500ms后重试缓存
    if (!startDate && !endDate && statsCache.pending) {
      // 已有查询进行中，等待缓存更新
      await new Promise(function(r) { setTimeout(r, 500); });
      if (statsCache.data && (Date.now() - statsCache.ts) < STATS_CACHE_TTL) {
        return res.json(statsCache.data);
      }
    }

    // 构建带日期筛选的查询
    // 无日期筛选时也使用合理上限，避免拉取全表
    function buildSummaryQuery(table, selectFields, eqField, eqValue, dateField) {
      var q = supabase.from(table).select(selectFields);
      if (eqField) q = q.eq(eqField, eqValue);
      if (dateField === 'media_url') {
        if (startDate) q = q.gte('media_url', startDate);
        if (endDate) q = q.lte('media_url', endDate);
      } else if (startDate || endDate) {
        if (startDate) q = q.gte('created_at', startDate + 'T00:00:00.000Z');
        if (endDate) q = q.lte('created_at', endDate + 'T23:59:59.999Z');
      }
      q = q.order('created_at', { ascending: false });
      if (!startDate && !endDate) q = q.limit(MAX_STATS_LIMIT);
      return q;
    }

    // 创建 pending promise 防止并发重复查询
    if (!startDate && !endDate) {
      statsCache.pending = true;  // 简单锁标志
    }
    const [postsRes, authRowsRes, visitsRes, attacksRes, likesRes, commentsRes, photosRes] = await Promise.all([
      applyPublicPostExclusions(buildSummaryQuery('posts', 'id, media_type, content, created_at', null, null, 'created_at')),
      buildSummaryQuery('posts', 'user_name, created_at', 'media_type', AUTH_MARKER, 'created_at'),
      buildSummaryQuery('posts', 'id, content, media_url, created_at', 'media_type', VISIT_MARKER, 'media_url'),
      buildSummaryQuery('posts', 'id, content, media_url, created_at', 'media_type', ATTACK_MARKER, 'created_at'),
      supabase.from('likes').select('id'),
      supabase.from('comments').select('id'),
      supabase.from('posts').select('id').eq('media_type', '__photo_wall__'),
    ]);

    const posts = (postsRes.data || []).filter(p => {
      if (p.content) {
        try { var c = JSON.parse(p.content); if (c && c.target_type) return false; } catch(e) {}
      }
      return true;
    });
    const authRows = authRowsRes.data || [];
    const authUserMap = buildAuthUserMap(authRows);
    const visits = visitsRes.data || [];
    const attacks = attacksRes.data || [];
    const likes = likesRes.data || [];
    const comments = commentsRes.data || [];
    const photos = photosRes.data || [];

    // 按日期聚合访问数据
    const dailyVisits = {};
    visits.forEach(v => {
      var d = v.media_url || '';
      if (!d) { try { var c = JSON.parse(v.content || '{}'); d = c.date || ''; } catch(e) {} }
      if (d) dailyVisits[d] = (dailyVisits[d] || 0) + 1;
    });

    // 按日期聚合攻击数据
    const dailyAttacks = {};
    attacks.forEach(a => {
      var d = '';
      try { var c = JSON.parse(a.content || '{}'); d = c.date || a.media_url || ''; } catch(e) { d = a.media_url || ''; }
      if (d) dailyAttacks[d] = (dailyAttacks[d] || 0) + 1;
    });

    // 攻击类型分布
    const attackTypes = {};
    attacks.forEach(a => {
      var t = a.media_url || 'unknown';
      attackTypes[t] = (attackTypes[t] || 0) + 1;
    });

    // API防火墙拦截 = CORS + CSRF（RATE_LIMIT是速率限制，不计入拦截）
    var firewallIntercepts = (attackTypes['CORS'] || 0) + (attackTypes['CSRF'] || 0);

    const result = {
      total_users: Object.keys(authUserMap).length,
      total_posts: posts.length,
      total_comments: comments.length,
      total_likes: likes.length,
      total_photos: photos.length,
      total_visits: visits.length,
      total_attacks: attacks.length,
      firewall_intercepts: firewallIntercepts,
      daily_visits: dailyVisits,
      daily_attacks: dailyAttacks,
      attack_types: attackTypes,
      cached_at: new Date().toISOString()
    };

    if (!startDate && !endDate) {
      statsCache = { data: result, ts: Date.now(), pending: null };
    }
    return res.json(result);
  } catch (e) {
    statsCache.pending = null;
    console.error('[API] 统计加载失败:', e.message);
    return res.status(500).json({ error: '统计加载失败' });
  }
});

// 攻击详情 API（返回完整攻击记录，含 IP、时间、类型、详情）
app.get('/admin/stats/attacks', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const offset = parseInt(req.query.offset) || 0;
    const typeFilter = req.query.type || ''; // 可选，按攻击类型筛选

    var query = supabase.from('posts')
      .select('id, user_name, content, media_url, created_at, actor_key')
      .eq('media_type', ATTACK_MARKER);

    if (typeFilter) {
      query = query.eq('media_url', typeFilter);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return res.status(400).json({ error: sanitizeError(error) });

    const attacks = (data || []).map(function(a) {
      var detail = {};
      try { detail = JSON.parse(a.content || '{}'); } catch(e) {}
      return {
        id: a.id,
        ip: a.user_name,
        type: a.media_url || detail.type || 'unknown',
        detail: detail.detail || '',
        attack_date: detail.date || '',
        created_at: a.created_at,
        actor_key: a.actor_key
      };
    });

    return res.json({ data: attacks, total: attacks.length });
  } catch (e) {
    console.error('[API] 攻击详情加载失败:', e.message);
    return res.status(500).json({ error: '攻击详情加载失败' });
  }
});

// 每日明细统计（支持日期筛选）
app.get('/admin/stats/daily', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const startDate = req.query.start || '';
    const endDate = req.query.end || '';

    // 构建带日期筛选的查询（数据库级别筛选，避免limit截断旧数据）
    function buildQuery(table, selectFields, eqField, eqValue, dateField) {
      var q = supabase.from(table).select(selectFields);
      if (eqField) q = q.eq(eqField, eqValue);
      // visits/attacks 的日期在 media_url 字段，其他用 created_at
      if (dateField === 'media_url') {
        if (startDate) q = q.gte('media_url', startDate);
        if (endDate) q = q.lte('media_url', endDate);
      } else {
        if (startDate) q = q.gte('created_at', startDate + 'T00:00:00.000Z');
        if (endDate) q = q.lte('created_at', endDate + 'T23:59:59.999Z');
      }
      q = q.order('created_at', { ascending: false });
      // 无日期筛选时保留较大limit，有日期筛选时数据库层面已过滤无需limit
      if (!startDate && !endDate) q = q.limit(MAX_STATS_LIMIT);
      return q;
    }

    const [visitsRes, attacksRes, postsRes, commentsRes, likesRes, authRows] = await Promise.all([
      buildQuery('posts', 'id, content, media_url, created_at', 'media_type', VISIT_MARKER, 'media_url'),
      buildQuery('posts', 'id, content, media_url, created_at', 'media_type', ATTACK_MARKER, 'created_at'),
      applyPublicPostExclusions(buildQuery('posts', 'id, created_at', null, null, 'created_at')),
      buildQuery('comments', 'id, created_at', null, null, 'created_at'),
      buildQuery('likes', 'id, created_at', null, null, 'created_at'),
      fetchAllPostsByMediaType(AUTH_MARKER, 'user_name, created_at'),
    ]);

    // 辅助函数：按天聚合
    function aggregateByDate(records, dateField) {
      var map = {};
      (records || []).forEach(r => {
        var d = (r[dateField] || '').slice(0, 10);
        if (d) map[d] = (map[d] || 0) + 1;
      });
      return map;
    }

    // 辅助函数：过滤日期范围
    function filterByDate(map, start, end) {
      var result = {};
      var keys = Object.keys(map).sort();
      keys.forEach(function(k) {
        if ((!start || k >= start) && (!end || k <= end)) {
          result[k] = map[k];
        }
      });
      return result;
    }

    const dailyVisitsAll = {};
    (visitsRes.data || []).forEach(v => {
      var d = v.media_url || '';
      if (!d) { try { var c = JSON.parse(v.content || '{}'); d = c.date || ''; } catch(e) {} }
      if (d) dailyVisitsAll[d] = (dailyVisitsAll[d] || 0) + 1;
    });

    const dailyAttacksAll = {};
    (attacksRes.data || []).forEach(a => {
      var d = '';
      try { var c = JSON.parse(a.content || '{}'); d = c.date || a.media_url || ''; } catch(e) { d = a.media_url || ''; }
      if (d) dailyAttacksAll[d] = (dailyAttacksAll[d] || 0) + 1;
    });

    const dailyPostsMap = aggregateByDate(postsRes.data || [], 'created_at');
    const dailyCommentsMap = aggregateByDate(commentsRes.data || [], 'created_at');
    const dailyLikesMap = aggregateByDate(likesRes.data || [], 'created_at');
    const dailyUsersMap = buildRegisteredUsersByDate(buildAuthUserMap(authRows));

    // 合并所有日期
    var allDates = {};
    [dailyVisitsAll, dailyAttacksAll, dailyPostsMap, dailyCommentsMap, dailyLikesMap, dailyUsersMap].forEach(function(m) {
      Object.keys(m).forEach(function(d) { allDates[d] = true; });
    });

    var dailyArr = Object.keys(allDates).sort().map(function(d) {
      return {
        date: d,
        visits: dailyVisitsAll[d] || 0,
        attacks: dailyAttacksAll[d] || 0,
        posts: dailyPostsMap[d] || 0,
        comments: dailyCommentsMap[d] || 0,
        likes: dailyLikesMap[d] || 0,
        new_users: dailyUsersMap[d] || 0
      };
    });

    // 如果有日期筛选，过滤
    if (startDate || endDate) {
      dailyArr = dailyArr.filter(function(item) {
        return (!startDate || item.date >= startDate) && (!endDate || item.date <= endDate);
      });
    }

    return res.json({
      daily: dailyArr,
      date_range: { start: startDate || 'all', end: endDate || 'all' }
    });
  } catch (e) {
    console.error('[API] 每日统计加载失败:', e.message);
    return res.status(500).json({ error: '每日统计加载失败' });
  }
});

// 清除统计缓存
app.post('/admin/stats/refresh', verifyToken, (req, res) => {
  statsCache = { data: null, ts: 0, pending: null };
  return res.json({ ok: true });
});

// ===================== 用户访问日志（前端调用） =====================
app.post('/api/log-user-visit', rateLimit(60000, 30), authenticateUser, async (req, res) => {
  try {
    const userNameVal = req.userName;

    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    await supabase.from('posts').insert([{
      user_name: userNameVal,
      content: JSON.stringify({ date: today }),
      media_type: USER_VISIT_MARKER,
      media_url: today,
      actor_key: 'uvisit_' + Date.now()
    }]);

    // 更新用户最近登录时间
    const { data: existing } = await supabase.from('posts')
      .select('id, content')
      .eq('user_name', userNameVal)
      .eq('media_type', '__user_info__')
      .maybeSingle();

    if (existing) {
      var info = {};
      try { info = JSON.parse(existing.content || '{}'); } catch(e) {}
      info.last_visit = now;
      await supabase.from('posts').update({ content: JSON.stringify(info) }).eq('id', existing.id);
    }

    return res.json({ ok: true });
  } catch(e) {
    console.error('[API] 用户访问记录失败:', e.message);
    return res.status(500).json({ error: '记录失败' });
  }
});

// ===================== 登录设备/IP 记录（前端调用） =====================
app.post('/api/log-login-event', rateLimit(60000, 30), authenticateUser, async (req, res) => {
  try {
    const { device_id, device_type, os, browser, user_agent, source, device_meta, exact_device_model, browser_fingerprint_hash, canvas_fingerprint_hash, webgl_fingerprint_hash, webgl_meta, webrtc_local_ips } = req.body;

    const VALID_SOURCES = ['login_success', 'page_visit', 'register_success'];
    const srcVal = VALID_SOURCES.includes(source) ? source : 'login_success';

    const userNameVal = req.userName;

    const deviceIdVal = validateString(device_id, 120, '设备ID');
    if (!deviceIdVal) return res.status(400).json({ error: '缺少设备ID' });

    // IP 由后端获取，前端不允许传 ip
    const ip = getClientIp(req);
    const loginAt = new Date().toISOString();
    const random = Math.random().toString(36).slice(2, 10);

    // 解析 IP 地区（多源 fallback，失败有日志）
    var ipLocation = null;
    try { ipLocation = await resolveIpLocation(ip); } catch(e) {}

    // 加载安全设置，按开关决定是否写入
    var securitySettings = { record_device: true, browser_fingerprint: false, canvas_fingerprint: false, webgl_fingerprint: false, webrtc_local_ip: false, advanced_fingerprint: false };
    try {
      var { data: settingsData } = await supabase.from('posts')
        .select('content')
        .eq('media_type', ADMIN_META_MARKER)
        .eq('media_url', 'security_settings')
        .maybeSingle();
      if (settingsData && settingsData.content) {
        var parsed = JSON.parse(settingsData.content);
        if (typeof parsed.record_device === 'boolean') securitySettings.record_device = parsed.record_device;
        if (typeof parsed.browser_fingerprint === 'boolean') securitySettings.browser_fingerprint = parsed.browser_fingerprint;
        if (typeof parsed.canvas_fingerprint === 'boolean') securitySettings.canvas_fingerprint = parsed.canvas_fingerprint;
        if (typeof parsed.webgl_fingerprint === 'boolean') securitySettings.webgl_fingerprint = parsed.webgl_fingerprint;
        if (typeof parsed.webrtc_local_ip === 'boolean') securitySettings.webrtc_local_ip = parsed.webrtc_local_ip;
        if (typeof parsed.advanced_fingerprint === 'boolean') securitySettings.advanced_fingerprint = parsed.advanced_fingerprint;
      }
    } catch(e) {}

    var finalDeviceMeta = securitySettings.record_device ? (device_meta || null) : null;
    var possibleDeviceModel = '';
    if (finalDeviceMeta && typeof finalDeviceMeta === 'object') {
      possibleDeviceModel = getPossibleDeviceModel(Object.assign({}, finalDeviceMeta, { user_agent: user_agent || '' }));
      if (possibleDeviceModel) finalDeviceMeta.possible_device_model = possibleDeviceModel;
    }
    var finalBrowserFp = securitySettings.browser_fingerprint ? (browser_fingerprint_hash || null) : null;
    var finalCanvasFp = securitySettings.canvas_fingerprint ? (canvas_fingerprint_hash || null) : null;
    var finalWebglFp = securitySettings.webgl_fingerprint ? (webgl_fingerprint_hash || null) : null;
    var finalWebglMeta = securitySettings.webgl_fingerprint ? (webgl_meta || null) : null;
    var finalWebrtcIps = securitySettings.webrtc_local_ip ? (webrtc_local_ips || null) : null;

    // HTTP Header 顺序指纹（记录 header 名称的排列顺序）
    var headerOrderHash = null;
    var headerOrderPreview = null;
    try {
      if (req.rawHeaders && req.rawHeaders.length > 0) {
        var headerNames = [];
        for (var hi = 0; hi < req.rawHeaders.length; hi += 2) {
          var headerName = String(req.rawHeaders[hi] || '').toLowerCase().trim();
          if (headerName) headerNames.push(headerName);
        }
        if (headerNames.length > 0) {
          headerOrderHash = crypto.createHash('sha256').update(headerNames.join('|')).digest('hex');
          headerOrderPreview = headerNames.slice(0, 12);
        }
      }
    } catch(e) {}

    // TLS 指纹（尝试获取，云平台可能不可用）
    var tlsInfo = null;
    try {
      var socket = req.socket || req.connection;
      if (socket && socket.getCipher && socket.getCipher()) {
        var cipher = socket.getCipher();
        tlsInfo = {
          name: cipher.name || '',
          version: cipher.version || '',
          protocol: (socket.getProtocol && socket.getProtocol()) || ''
        };
      }
    } catch(e) {}

    // 确定最终 ASN/ISP 信息
    var asnInfo = null;
    if (ipLocation && (ipLocation.asn || ipLocation.isp || ipLocation.is_proxy || ipLocation.is_hosting)) {
      asnInfo = {
        asn: ipLocation.asn || '',
        isp: ipLocation.isp || '',
        org: ipLocation.org || '',
        is_mobile: ipLocation.is_mobile || false,
        is_proxy: ipLocation.is_proxy || false,
        is_hosting: ipLocation.is_hosting || false
      };
    }

    // 写入 posts 表（短期方案，不新建表）
    const { error } = await supabase.from('posts').insert([{
      user_name: userNameVal,
      media_type: LOGIN_EVENT_MARKER,
      media_url: deviceIdVal,
      content: JSON.stringify({
        device_id: deviceIdVal,
        device_type: device_type || 'unknown',
        os: os || 'Unknown',
        browser: browser || 'Unknown',
        user_agent: user_agent || '',
        possible_device_model: possibleDeviceModel,
        ip: ip,
        ip_location: ipLocation,
        login_at: loginAt,
        source: srcVal,
        device_meta: finalDeviceMeta,
        exact_device_model: exact_device_model || null,
        browser_fingerprint_hash: finalBrowserFp,
        canvas_fingerprint_hash: finalCanvasFp,
        webgl_fingerprint_hash: finalWebglFp,
        webgl_meta: finalWebglMeta,
        webrtc_local_ips: finalWebrtcIps,
        asn_info: asnInfo,
        header_order_hash: headerOrderHash,
        header_order_preview: headerOrderPreview,
        tls_info: tlsInfo
      }),
      actor_key: 'login_' + Date.now() + '_' + random
    }]);
    if (error) return res.status(400).json({ error: sanitizeError(error) });

    // 同步更新 user_info（记录最近设备/IP/地区/登录时间）
    try {
      const now = new Date().toISOString();
      const { data: existingInfo } = await supabase.from('posts')
        .select('id, content')
        .eq('user_name', userNameVal)
        .eq('media_type', USER_INFO_MARKER)
        .maybeSingle();

      var info = {};
      if (existingInfo) {
        try { info = JSON.parse(existingInfo.content || '{}'); } catch(e) {}
      }

      if (srcVal === 'login_success' || srcVal === 'register_success') {
        info.last_login = now;
      }
      if (srcVal === 'page_visit') {
        info.last_visit = now;
      }
      // 同时设置 last_visit 作为兜底
      if (!info.last_visit) info.last_visit = now;

      info.last_device = (device_type || 'unknown') + ' · ' + (os || 'Unknown') + ' · ' + (browser || 'Unknown');
      info.last_ip = ip;
      if (ipLocation) info.last_ip_location = ipLocation;

      if (existingInfo) {
        await supabase.from('posts').update({ content: JSON.stringify(info) }).eq('id', existingInfo.id);
      } else {
        await supabase.from('posts').insert([{
          user_name: userNameVal,
          media_type: USER_INFO_MARKER,
          content: JSON.stringify(info),
          actor_key: 'user_info_' + Date.now()
        }]);
      }
    } catch(e) {
      console.warn('[API] 同步 user_info 失败:', e.message || e);
    }

    // 异步执行安全检测（不影响响应速度，错误静默处理）
    runSecurityChecks(userNameVal, deviceIdVal, ip, ipLocation, srcVal, loginAt, browser_fingerprint_hash || null, canvas_fingerprint_hash || null).catch(function(e) {
      console.warn('[Security] 安全检测异常:', e.message || e);
    });

    return res.json({ ok: true });
  } catch(e) {
    console.error('[API] 登录事件记录失败:', e.message);
    return res.status(500).json({ error: '记录失败' });
  }
});

// ===================== 安全设置（前端公开读取） =====================
app.get('/api/security-settings', rateLimit(60000, 60), async (req, res) => {
  try {
    var { data } = await supabase.from('posts')
      .select('content')
      .eq('media_type', ADMIN_META_MARKER)
      .eq('media_url', 'security_settings')
      .maybeSingle();
    var settings = { record_device: true, browser_fingerprint: false, canvas_fingerprint: false, webgl_fingerprint: false, webrtc_local_ip: false, advanced_fingerprint: false, security_alerts: true };
    if (data && data.content) {
      try {
        var parsed = JSON.parse(data.content);
        if (parsed.record_device !== undefined) settings.record_device = parsed.record_device;
        if (parsed.browser_fingerprint !== undefined) settings.browser_fingerprint = parsed.browser_fingerprint;
        if (parsed.canvas_fingerprint !== undefined) settings.canvas_fingerprint = parsed.canvas_fingerprint;
        if (parsed.webgl_fingerprint !== undefined) settings.webgl_fingerprint = parsed.webgl_fingerprint;
        if (parsed.webrtc_local_ip !== undefined) settings.webrtc_local_ip = parsed.webrtc_local_ip;
        if (parsed.advanced_fingerprint !== undefined) settings.advanced_fingerprint = parsed.advanced_fingerprint;
        if (parsed.security_alerts !== undefined) settings.security_alerts = parsed.security_alerts;
      } catch(e) {}
    }
    return res.json({ settings: settings });
  } catch(e) {
    return res.json({ settings: { record_device: true, browser_fingerprint: false, canvas_fingerprint: false, webgl_fingerprint: false, webrtc_local_ip: false, advanced_fingerprint: false, security_alerts: true } });
  }
});

// ===================== 登录事件查询（管理员） =====================
app.get('/admin/login-events', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const { data, error } = await supabase.from('posts')
      .select('id, user_name, content, media_url, created_at')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    return res.json({ data: data || [] });
  } catch(e) {
    console.error('[API] 登录事件查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== 安全提醒查询（管理员） =====================
app.get('/admin/security-alerts', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var limit = parseInt(req.query.limit) || 200;
    if (limit > 500) limit = 500;
    var query = supabase.from('posts')
      .select('id, user_name, content, media_url, created_at')
      .eq('media_type', SECURITY_ALERT_MARKER)
      .order('created_at', { ascending: false })
      .limit(limit);

    // 支持按类型筛选
    if (req.query.type) {
      query = query.eq('media_url', req.query.type);
    }

    var { data, error } = await query;
    if (error) return res.status(400).json({ error: sanitizeError(error) });

    // 解析 content JSON
    var alerts = (data || []).map(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      return {
        id: row.id,
        user_name: row.user_name,
        created_at: row.created_at,
        type: info.type || row.media_url,
        level: info.level || 'warning',
        ip: info.ip || null,
        ip_location_text: info.ip_location_text || null,
        related_users: info.related_users || [],
        reason: info.reason || '',
        is_read: info.is_read || false,
        ignored: info.ignored || false,
        false_positive: info.false_positive || false,
        reviewed_at: info.reviewed_at || null,
        reviewed_by: info.reviewed_by || null
      };
    });

    return res.json({ data: alerts });
  } catch(e) {
    console.error('[API] 安全提醒查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== 标记安全提醒已读 =====================
app.post('/admin/security-alerts/read', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var alertId = req.body.id;
    if (!alertId) return res.status(400).json({ error: '缺少提醒ID' });

    var { data: existing } = await supabase.from('posts')
      .select('content')
      .eq('id', alertId)
      .eq('media_type', SECURITY_ALERT_MARKER)
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: '提醒不存在' });

    var info = {};
    try { info = JSON.parse(existing.content || '{}'); } catch(e) {}
    info.is_read = true;

    var { error } = await supabase.from('posts')
      .update({ content: JSON.stringify(info) })
      .eq('id', alertId);

    if (error) return res.status(400).json({ error: sanitizeError(error) });
    return res.json({ ok: true });
  } catch(e) {
    console.error('[API] 标记安全提醒已读失败:', e.message);
    return res.status(500).json({ error: '操作失败' });
  }
});

// ===================== 安全提醒状态管理 =====================
app.post('/admin/security-alerts/status', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var { id, status } = req.body;
    if (!id || !status) return res.status(400).json({ error: '缺少参数' });
    var VALID_STATUSES = ['read', 'ignored', 'false_positive'];
    if (VALID_STATUSES.indexOf(status) === -1) return res.status(400).json({ error: '无效状态' });

    var { data: existing } = await supabase.from('posts')
      .select('content')
      .eq('id', id)
      .eq('media_type', SECURITY_ALERT_MARKER)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: '提醒不存在' });

    var info = {};
    try { info = JSON.parse(existing.content || '{}'); } catch(e) {}
    info.is_read = true;
    if (status === 'ignored') info.ignored = true;
    if (status === 'false_positive') { info.false_positive = true; info.ignored = true; }
    info.reviewed_at = new Date().toISOString();
    info.reviewed_by = ADMIN_USERNAME;

    var { error } = await supabase.from('posts')
      .update({ content: JSON.stringify(info) })
      .eq('id', id);
    if (error) return res.status(400).json({ error: sanitizeError(error) });

    await logAdminAudit('review_security_alert', ADMIN_USERNAME, 'alert:' + id + ' status:' + status);
    return res.json({ ok: true });
  } catch(e) {
    console.error('[API] 安全提醒状态更新失败:', e.message);
    return res.status(500).json({ error: '操作失败' });
  }
});

// ===================== 安全设置 =====================
app.get('/admin/security-settings', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    var { data } = await supabase.from('posts')
      .select('content')
      .eq('media_type', ADMIN_META_MARKER)
      .eq('media_url', 'security_settings')
      .maybeSingle();
    var settings = { record_device: true, browser_fingerprint: false, canvas_fingerprint: false, webgl_fingerprint: false, webrtc_local_ip: false, advanced_fingerprint: false, security_alerts: true };
    if (data && data.content) {
      try { var parsed = JSON.parse(data.content); Object.assign(settings, parsed); } catch(e) {}
    }
    return res.json({ settings: settings });
  } catch(e) {
    console.error('[API] 安全设置查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

app.post('/admin/security-settings', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var { record_device, browser_fingerprint, canvas_fingerprint, webgl_fingerprint, webrtc_local_ip, advanced_fingerprint, security_alerts } = req.body;
    var settings = {};
    if (typeof record_device === 'boolean') settings.record_device = record_device;
    if (typeof browser_fingerprint === 'boolean') settings.browser_fingerprint = browser_fingerprint;
    if (typeof canvas_fingerprint === 'boolean') settings.canvas_fingerprint = canvas_fingerprint;
    if (typeof webgl_fingerprint === 'boolean') settings.webgl_fingerprint = webgl_fingerprint;
    if (typeof webrtc_local_ip === 'boolean') settings.webrtc_local_ip = webrtc_local_ip;
    if (typeof advanced_fingerprint === 'boolean') settings.advanced_fingerprint = advanced_fingerprint;
    if (typeof security_alerts === 'boolean') settings.security_alerts = security_alerts;

    var { data: existing } = await supabase.from('posts')
      .select('id')
      .eq('media_type', ADMIN_META_MARKER)
      .eq('media_url', 'security_settings')
      .maybeSingle();

    var oldSettings = {};
    if (existing) {
      // Merge with existing
      var { data: oldData } = await supabase.from('posts')
        .select('content')
        .eq('id', existing.id)
        .maybeSingle();
      if (oldData && oldData.content) {
        try { oldSettings = JSON.parse(oldData.content); } catch(e) {}
      }
      Object.assign(oldSettings, settings);
      await supabase.from('posts').update({ content: JSON.stringify(oldSettings) }).eq('id', existing.id);
    } else {
      await supabase.from('posts').insert([{
        user_name: ADMIN_USERNAME,
        media_type: ADMIN_META_MARKER,
        media_url: 'security_settings',
        content: JSON.stringify(settings),
        actor_key: 'sec_settings_' + Date.now()
      }]);
    }

    // Audit log
    await logAdminAudit('update_security_settings', ADMIN_USERNAME, JSON.stringify(settings));

    return res.json({ ok: true, settings: oldSettings });
  } catch(e) {
    console.error('[API] 安全设置更新失败:', e.message);
    return res.status(500).json({ error: '更新失败' });
  }
});

// ===================== 日志清理 =====================
app.post('/admin/cleanup-logs', verifyToken, rateLimit(60000, 3), async (req, res) => {
  try {
    var types = req.body.types || ['login', 'security', 'error'];
    if (typeof types === 'string') types = [types];
    var VALID_TYPES = ['login', 'security', 'error', 'all'];
    var results = {};
    var totalDeleted = 0;

    if (types.indexOf('all') >= 0) types = ['login', 'security', 'error'];

    for (var i = 0; i < types.length; i++) {
      var t = types[i];
      if (VALID_TYPES.indexOf(t) < 0 || t === 'all') continue;
      results[t] = await cleanupOldLogs(t);
      totalDeleted += results[t].deleted || 0;
    }

    await logAdminAudit('cleanup_logs', ADMIN_USERNAME, 'types:' + types.join(',') + ' deleted:' + totalDeleted);
    return res.json({ ok: true, results: results, total_deleted: totalDeleted });
  } catch(e) {
    console.error('[API] 日志清理失败:', e.message);
    return res.status(500).json({ error: '清理失败' });
  }
});

// ===================== 审计日志查询 =====================
app.get('/admin/audit-logs', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var limit = parseInt(req.query.limit) || 200;
    if (limit > 500) limit = 500;
    var { data, error } = await supabase.from('posts')
      .select('id, user_name, content, media_url, created_at')
      .eq('media_type', AUDIT_LOG_MARKER)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    var logs = (data || []).map(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      return {
        id: row.id,
        action: info.action || row.media_url,
        operator: info.operator || row.user_name,
        detail: info.detail || '',
        timestamp: info.timestamp || row.created_at,
        created_at: row.created_at
      };
    });
    return res.json({ data: logs });
  } catch(e) {
    console.error('[API] 审计日志查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== 用户访问统计（管理员） =====================
app.get('/admin/stats/users', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const [authRows, userInfoRows, visitRows] = await Promise.all([
      fetchAllPostsByMediaType(AUTH_MARKER, 'user_name, created_at'),
      fetchAllPostsByMediaType(USER_INFO_MARKER, 'user_name, content, created_at'),
      fetchAllPostsByMediaType(USER_VISIT_MARKER, 'user_name, content, media_url, created_at')
    ]);

    const authMap = buildAuthUserMap(authRows);
    const userInfoMap = buildUserInfoMap(userInfoRows);
    const userVisitMap = buildUserVisitMap(visitRows);
    const allUserNames = new Set([
      ...Object.keys(authMap),
      ...Object.keys(userInfoMap),
      ...Object.keys(userVisitMap)
    ]);

    const result = Array.from(allUserNames).map(userName => {
      const authInfo = authMap[userName] || {};
      const info = userInfoMap[userName] || {};
      const visitInfo = userVisitMap[userName] || { total_visits: 0, daily_visits: {}, last_visit: null };
      const effectiveRegTime = getEffectiveRegTime(authInfo, info);
      return {
        user_name: userName,
        total_visits: visitInfo.total_visits || 0,
        daily_visits: visitInfo.daily_visits || {},
        last_visit: visitInfo.last_visit || info.last_visit || info.last_login || authInfo.auth_created_at || null,
        last_login: info.last_login || null,
        reg_time: effectiveRegTime,
        auth_created_at: authInfo.auth_created_at || null
      };
    });

    result.sort((a, b) => {
      if ((b.total_visits || 0) !== (a.total_visits || 0)) return (b.total_visits || 0) - (a.total_visits || 0);
      const ta = toTimeMs(a.last_visit || a.last_login || a.auth_created_at);
      const tb = toTimeMs(b.last_visit || b.last_login || b.auth_created_at);
      if ((Number.isFinite(tb) ? tb : 0) !== (Number.isFinite(ta) ? ta : 0)) return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      return String(a.user_name || '').localeCompare(String(b.user_name || ''), 'zh-CN');
    });

    return res.json({ users: result, total: result.length });
  } catch(e) {
    console.error('[API] 用户访问统计失败:', e.message);
    return res.status(500).json({ error: '用户访问统计加载失败' });
  }
});

app.get('/admin/users/register-alerts', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    const [metaRecord, authRows] = await Promise.all([
      getAdminMetaRecord('register_alerts'),
      fetchAllPostsByMediaType(AUTH_MARKER, 'user_name, created_at')
    ]);
    const meta = safeJsonParse(metaRecord && metaRecord.content);
    const lastSeenAt = meta.last_seen_register_alert_at || null;
    const fallbackBaselineIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const baselineIso = Number.isFinite(toTimeMs(lastSeenAt)) ? lastSeenAt : fallbackBaselineIso;
    const authMap = buildAuthUserMap(authRows);
    const payload = buildUnreadRegisterAlertPayload(authMap, baselineIso);
    return res.json({
      ok: true,
      unread_count: payload.unread_count,
      last_seen_at: lastSeenAt,
      latest_register_at: payload.latest_register_at,
      users: payload.users
    });
  } catch (e) {
    console.error('[API] 新用户注册提醒加载失败:', e.message);
    return res.status(500).json({ error: '新用户注册提醒加载失败' });
  }
});

app.post('/admin/users/register-alerts/read', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    const nowIso = new Date().toISOString();
    await saveAdminMetaFields({ last_seen_register_alert_at: nowIso }, 'register_alerts');
    return res.json({ ok: true, last_seen_at: nowIso });
  } catch (e) {
    console.error('[API] 新用户注册提醒已读写入失败:', e.message);
    return res.status(500).json({ error: '新用户注册提醒已读写入失败' });
  }
});

// ===================== 管理员邮件通知 API =====================
// 使用 Gmail SMTP 发送，需在 Render 环境变量设置：GMAIL_USER / GMAIL_APP_PASSWORD
// EMAIL_SENT_MARKER / EMAIL_RECIPIENT_MARKER 已在文件前面集中定义（行 135-136）

// 通用：邮箱归一化（trim + lowercase）
function normalizeEmailAddress(email) {
  return String(email || '').trim().toLowerCase();
}

// 通用：邮箱格式校验
function isValidEmailAddress(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

// 通用：归一化收件人 user_name
// 手动外部邮箱的 user_name 经常是邮箱本身，这种情况下应让 user_name == email 以便识别
function normalizeRecipientUserName(recipient, email) {
  var name = String((recipient && recipient.user_name) || '').trim();
  if (!name) return email;
  return name;
}

// 通用：保存收件人到历史邮箱
// recipients: [{ email, user_name? }, ...]
// 失败只 console.warn，不抛错
async function saveEmailRecipientHistory(recipients) {
  if (!Array.isArray(recipients) || !recipients.length) return 0;
  // 1) 本次发送去重 + 校验
  var histMap = {};
  recipients.forEach(function(r) {
    var e = normalizeEmailAddress(r && r.email);
    if (!e || !isValidEmailAddress(e)) return;
    if (histMap[e]) return;
    var name = normalizeRecipientUserName(r, e);
    histMap[e] = { email: e, user_name: name, last_sent_at: new Date().toISOString(), source: (name && name !== e) ? 'send_email' : 'manual' };
  });
  var histList = Object.values(histMap);
  if (!histList.length) return 0;
  // 2) 一次性查已有记录（避免 N+1）
  var existRows = [];
  try {
    var { data } = await supabase.from('posts')
      .select('id, media_url, content')
      .eq('media_type', EMAIL_RECIPIENT_MARKER)
      .eq('user_name', ADMIN_USERNAME);
    existRows = data || [];
  } catch (qe) {
    console.warn('[Email Recipient History] 查询已有记录失败:', qe.message || qe);
  }
  // 3) 索引：email -> { id, user_name }
  var existMap = {};
  existRows.forEach(function(row) {
    try {
      var eiInfo = row.content ? JSON.parse(row.content) : {};
      var eEmail = normalizeEmailAddress(eiInfo.email || row.media_url || '');
      if (eEmail) existMap[eEmail] = { id: row.id, user_name: eiInfo.user_name || '' };
    } catch (pe) {}
  });
  var saved = 0;
  for (var hi = 0; hi < histList.length; hi++) {
    var hInfo = histList[hi];
    var exist = existMap[hInfo.email];
    if (exist) {
      // 已有：保留更好的名字（如果新名字是邮箱且旧有非邮箱名字，则保留旧名字）
      if (hInfo.user_name === hInfo.email && exist.user_name && exist.user_name !== exist.user_name.toLowerCase()) {
        hInfo.user_name = exist.user_name;
      }
      try {
        await supabase.from('posts').update({ content: JSON.stringify(hInfo) }).eq('id', exist.id);
        saved++;
      } catch (ue) {
        console.warn('[Email Recipient History] 更新失败:', ue.message || ue);
      }
    } else {
      // 新增：必须带 actor_key 与 media_url，避免数据库字段限制或后续查询不稳定
      try {
        await supabase.from('posts').insert([{
          user_name: ADMIN_USERNAME,
          media_type: EMAIL_RECIPIENT_MARKER,
          media_url: hInfo.email,
          content: JSON.stringify(hInfo),
          actor_key: 'email_recipient_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
        }]);
        saved++;
      } catch (ie) {
        console.warn('[Email Recipient History] 插入失败:', ie.message || ie);
      }
    }
  }
  return saved;
}

app.get('/admin/users-with-email', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const { data, error } = await supabase.from('posts')
      .select('user_name, content, created_at')
      .eq('media_type', '__user_info__')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    const users = [];
    (data || []).forEach(function(row) {
      try {
        const info = JSON.parse(row.content || '{}');
        if (info.email) {
          users.push({
            user_name: row.user_name,
            email: info.email,
            reg_time: info.reg_time || row.created_at,
            last_login: info.last_login
          });
        }
      } catch(e) {}
    });
    return res.json({ users, total: users.length });
  } catch (e) {
    console.error('[Email API] 获取用户邮箱列表失败:', e.message);
    return res.status(500).json({ error: '获取用户邮箱列表失败' });
  }
});

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || ''; // 优先 const 防止误覆盖
const GMAIL_GAS_URL = process.env.GMAIL_GAS_URL || ''; // Google Apps Script Web App URL（走 HTTPS 443，绕过 Render SMTP 端口封锁）

async function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs || 15000);
  var fetchOptions = Object.assign({}, options || {}, { signal: controller.signal });
  try {
    return await fetch(url, fetchOptions);
  } finally {
    clearTimeout(timer);
  }
}

// SendGrid API 发送（HTTPS 443，不受云平台 SMTP 端口封锁影响）
async function sendViaSendGrid(to, subject, text, html) {
  var resp = await fetchWithTimeout('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + SENDGRID_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: GMAIL_USER, name: 'XTJ 管理员' },
      subject: subject,
      content: [
        { type: 'text/plain', value: text || '' },
        { type: 'text/html', value: html || '' }
      ]
    })
  }, 15000);
  if (!resp.ok) {
    var body = await resp.text().catch(function(){ return ''; });
    throw new Error('SendGrid HTTP ' + resp.status + (body ? ': ' + body.slice(0, 200) : ''));
  }
}

// Google Apps Script 邮件中转（HTTPS 443，绕过 Render SMTP 端口封锁）
// 部署方法：script.google.com 新建项目，粘贴以下代码（修改 from 即可）后部署为 Web App：
//   function doPost(e) {
//     var d = JSON.parse(e.postData.contents);
//     GmailApp.sendEmail(d.to, d.subject, d.text, { htmlBody: d.html, from: '你的Gmail@gmail.com' });
//     return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
//   }
async function sendViaGAS(to, subject, text, html) {
  var resp = await fetchWithTimeout(GMAIL_GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: to, subject: subject, text: text || '', html: html || '' })
  }, 15000);
  if (!resp.ok) {
    var body = await resp.text().catch(function(){ return ''; });
    throw new Error('GAS HTTP ' + resp.status + (body ? ': ' + body.slice(0, 200) : ''));
  }
  return await resp.json().catch(function(){ return { ok: true }; });
}

// 发送邮件（优先 GAS HTTPS > SendGrid HTTPS > Gmail SMTP）
app.post('/admin/send-email', verifyToken, rateLimit(60000, 5), async (req, res) => {
  try {
    const { recipients, subject, content, content_type } = req.body;
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: '请至少选择一个收件人' });
    }
    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: '请输入邮件主题' });
    }
    if (!content || !content.trim()) {
      return res.status(400).json({ error: '请输入邮件内容' });
    }
    const MAX_RECIPIENTS = 100;
    if (recipients.length > MAX_RECIPIENTS) {
      return res.status(400).json({ error: '单次最多发送 ' + MAX_RECIPIENTS + ' 人' });
    }
    const subjectVal = subject.trim().slice(0, 200);
    const isHtml = content_type === 'html';
    const bodyText = isHtml ? content.replace(/<[^>]*>/g, '') : content;
    const bodyHtml = isHtml ? content : content.split('\n').map(function(l) { return '<p>' + l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</p>'; }).join('');
    var transporter = null;
    if (!SENDGRID_API_KEY && !GMAIL_GAS_URL) {
      transporter = getMailTransporter();
      if (!transporter) {
        return res.status(500).json({ error: '邮件服务未配置，请在 Render Dashboard 设置 GMAIL_GAS_URL（推荐）或 GMAIL_USER + GMAIL_APP_PASSWORD' });
      }
    }

    // 先保存收件人到历史（无论发送是否成功，都先存下来，包含名字）
    // 使用统一 helper，失败只 console.warn，不阻断邮件发送
    try {
      await saveEmailRecipientHistory(recipients);
    } catch(e) { console.warn('[Email] 保存收件人历史失败:', e.message || e); }

    var usedPort = mailTransporterPort;
    const sent = [];
    const failed = [];
    for (const r of recipients) {
      try {
        if (GMAIL_GAS_URL) {
          // 优先 Google Apps Script（HTTPS 443，绕过 Render SMTP 端口封锁）
          await sendViaGAS(r.email, subjectVal, bodyText, bodyHtml);
        } else if (SENDGRID_API_KEY) {
          await sendViaSendGrid(r.email, subjectVal, bodyText, bodyHtml);
        } else {
          await transporter.sendMail({
            from: '"XTJ 管理员" <' + GMAIL_USER + '>',
            to: r.email,
            subject: subjectVal,
            text: bodyText,
            html: bodyHtml
          });
        }
        sent.push(r.user_name || r.email);
      } catch (e) {
        var maskedEmail = r.email ? r.email.slice(0, 3) + '***@' + (r.email.split('@')[1] || '') : 'unknown';
        console.error('[Email] 发送给 ' + maskedEmail + ' 失败: ' + (e.code || '') + ' - ' + e.message);
        // GAS 失败 → 回退 SendGrid → 回退 SMTP
        if (GMAIL_GAS_URL && SENDGRID_API_KEY) {
          try {
            console.warn('[Email] GAS 失败，回退到 SendGrid');
            await sendViaSendGrid(r.email, subjectVal, bodyText, bodyHtml);
            sent.push(r.user_name || r.email);
            continue;
          } catch(e2) {
            console.error('[Email] SendGrid 回退也失败: ' + e2.message);
            failed.push({ user: r.user_name || r.email, error: 'GAS失败，SendGrid也失败: ' + e2.message });
            continue;
          }
        }
        if (GMAIL_GAS_URL && !SENDGRID_API_KEY) {
          // GAS 失败且无 SendGrid，回退到 SMTP
          try {
            var gasFallbackT = getMailTransporter();
            if (gasFallbackT) {
              await gasFallbackT.sendMail({
                from: '"XTJ 管理员" <' + GMAIL_USER + '>',
                to: r.email,
                subject: subjectVal,
                text: bodyText,
                html: bodyHtml
              });
              sent.push(r.user_name || r.email);
              continue;
            }
          } catch(e2) {
            console.error('[Email] SMTP 回退也失败: ' + (e2.code || '') + ' - ' + e2.message);
          }
        }
        if (SENDGRID_API_KEY && !GMAIL_GAS_URL) {
          // SendGrid 失败 → 回退到 SMTP（不再重置常量，只走本地逻辑开关）
          var sendgridBroken = true;
          try {
            var sgTransporter = getMailTransporter();
            if (sgTransporter) {
              await sgTransporter.sendMail({
                from: '"XTJ 管理员" <' + GMAIL_USER + '>',
                to: r.email,
                subject: subjectVal,
                text: bodyText,
                html: bodyHtml
              });
              sent.push(r.user_name || r.email);
              continue;
            }
          } catch(e2) {
            console.error('[Email] SMTP 回退也失败: ' + (e2.code || '') + ' - ' + e2.message);
          }
        } else if (!GMAIL_GAS_URL && usedPort === '465' && (e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.message.indexOf('timeout') > -1 || e.message.indexOf('connect') > -1)) {
          try {
            console.warn('[Email] 465 连接失败，回退到 587 STARTTLS');
            var fallbackTransporter = nodemailer.createTransport({
              host: 'smtp.gmail.com',
              port: 587,
              secure: false,
              requireTLS: true,
              auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
              connectionTimeout: 10000,
              greetingTimeout: 10000,
              socketTimeout: 10000
            });
            transporter = fallbackTransporter;
            await transporter.sendMail({
              from: '"XTJ 管理员" <' + GMAIL_USER + '>',
              to: r.email,
              subject: subjectVal,
              text: bodyText,
              html: bodyHtml
            });
            sent.push(r.user_name || r.email);
            continue;
          } catch(e2) {
            console.error('[Email] 587 回退也失败: ' + (e2.code || '') + ' - ' + e2.message);
            failed.push({ user: r.user_name || r.email, error: '465/587 均连接失败: ' + e2.message });
            continue;
          }
        }
        failed.push({ user: r.user_name || r.email, error: (GMAIL_GAS_URL ? 'GAS失败' : SENDGRID_API_KEY ? 'SendGrid失败，SMTP也失败: ' : '发送失败: ') + e.message });
      }
    }
    try {
      // 构建详细的收件人列表（包含名字、邮箱、发送结果）
      var detailList = recipients.map(function(r) {
        var email = String(r.email || '').trim().toLowerCase();
        var name = String(r.user_name || '').trim();
        var isSent = sent.indexOf(r.user_name || r.email) >= 0;
        var failInfo = null;
        if (!isSent) {
          for (var fi = 0; fi < failed.length; fi++) {
            if (failed[fi].user === (r.user_name || r.email)) { failInfo = failed[fi].error; break; }
          }
        }
        return { email: email, user_name: name || email, status: isSent ? 'sent' : 'failed', error: failInfo };
      });
      await supabase.from('posts').insert([{
        user_name: ADMIN_USERNAME,
        media_type: EMAIL_SENT_MARKER,
        content: JSON.stringify({
          from_email: GMAIL_USER,
          subject: subjectVal,
          sent_count: sent.length,
          failed_count: failed.length,
          total_recipients: recipients.length,
          recipients_detail: detailList,
          sent_at: new Date().toISOString()
        }),
        actor_key: 'email_' + Date.now()
      }]);
    } catch(e) {
      console.warn('[Email] 保存发送记录失败:', e.message);
    }
    if (sent.length === 0 && failed.length > 0) {
      var firstErr = failed[0].error || '';
      if (firstErr.indexOf('connect') > -1 || firstErr.indexOf('timeout') > -1 || firstErr.indexOf('ETIMEDOUT') > -1) {
        return res.json({
          ok: false,
          sent_count: 0,
          failed_count: failed.length,
          sent: sent,
          failed: failed,
          hint: 'SMTP 465/587 出站端口被云平台封锁，重启 Render 实例可能换到未封锁的宿主机。或者在 Render Dashboard 手动 Deploy 触发重启。'
        });
      }
    }
    return res.json({
      ok: true,
      sent_count: sent.length,
      failed_count: failed.length,
      sent: sent,
      failed: failed
    });
  } catch (e) {
    console.error('[Email API] 发送邮件失败:', e.message);
    return res.status(500).json({ error: '发送邮件失败' });
  }
});

// 管理员：获取邮件发送历史
app.get('/admin/email-history', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var limit = Math.min(parseInt(req.query.limit || '50'), 200);
    var { data, error } = await supabase.from('posts')
      .select('id, content, created_at')
      .eq('media_type', EMAIL_SENT_MARKER)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    var records = (data || []).map(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      return {
        id: row.id,
        from_email: info.from_email || GMAIL_USER || '',
        subject: info.subject || '',
        sent_count: info.sent_count || 0,
        failed_count: info.failed_count || 0,
        total_recipients: info.total_recipients || 0,
        recipients_detail: Array.isArray(info.recipients_detail) ? info.recipients_detail : [],
        sent_at: info.sent_at || row.created_at
      };
    });
    return res.json({ ok: true, records: records });
  } catch(e) {
    console.error('[Email History] 查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== 管理员邮件收件人历史 API =====================
// EMAIL_RECIPIENT_MARKER 已在前面定义（与 helper 一起放在邮件 API 区块顶部）
// 获取历史收件人
app.get('/admin/email-recipient-history', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var limit = Math.min(parseInt(req.query.limit || '100'), 200);
    var { data, error } = await supabase.from('posts')
      .select('id, content, media_url, created_at')
      .eq('media_type', EMAIL_RECIPIENT_MARKER)
      .eq('user_name', ADMIN_USERNAME)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    var seen = new Set();
    var recipients = [];
    (data || []).forEach(function(row) {
      try {
        var info = row.content ? JSON.parse(row.content) : {};
        // 兼容：info.email / row.media_url / 旧 sent_at
        var email = normalizeEmailAddress(info.email || row.media_url || '');
        if (!email || !isValidEmailAddress(email)) return;
        if (seen.has(email)) return;
        seen.add(email);
        var userName = String(info.user_name || '').trim() || email;
        recipients.push({
          id: row.id,
          email: email,
          user_name: userName,
          last_sent_at: info.last_sent_at || info.sent_at || row.created_at,
          source: info.source || ''
        });
      } catch(e) {}
    });
    return res.json({ ok: true, recipients: recipients });
  } catch(e) {
    console.error('[Email Recipient History] 查询失败:', e.message || e);
    return res.status(500).json({ error: '查询失败' });
  }
});

// 保存收件人到历史（兼容旧 emails 数组与新 recipients 数组）
app.post('/admin/email-recipient-history', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var body = req.body || {};
    var recipients = [];
    if (Array.isArray(body.recipients) && body.recipients.length) {
      // 新格式：[{ email, user_name }]
      recipients = body.recipients.map(function(r) {
        if (typeof r === 'string') return { email: r, user_name: r };
        return { email: r && r.email, user_name: r && r.user_name };
      });
    } else if (Array.isArray(body.emails) && body.emails.length) {
      // 旧格式：["a@qq.com", "b@qq.com"]
      recipients = body.emails.map(function(e) { return { email: e, user_name: e }; });
    } else {
      return res.status(400).json({ error: '缺少 recipients 或 emails' });
    }
    var saved = await saveEmailRecipientHistory(recipients);
    return res.json({ ok: true, saved: saved });
  } catch(e) {
    console.error('[Email Recipient History] 保存失败:', e.message || e);
    return res.status(500).json({ error: '保存失败' });
  }
});

// 删除指定的历史收件人（按 id 精确删除）
app.post('/admin/email-recipient-history/delete', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: '缺少邮箱' });
    var { data, error } = await supabase.from('posts')
      .select('id, content')
      .eq('media_type', EMAIL_RECIPIENT_MARKER)
      .eq('user_name', ADMIN_USERNAME);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    var idsToDelete = [];
    (data || []).forEach(function(row) {
      try {
        var info = JSON.parse(row.content || '{}');
        if ((info.email || '').trim().toLowerCase() === email) {
          idsToDelete.push(row.id);
        }
      } catch(e) {}
    });
    if (idsToDelete.length === 0) {
      return res.json({ ok: true, deleted_count: 0 });
    }
    for (var di = 0; di < idsToDelete.length; di++) {
      await supabase.from('posts').delete().eq('id', idsToDelete[di]).catch(function(){});
    }
    return res.json({ ok: true, deleted_count: idsToDelete.length });
  } catch(e) {
    console.error('[Email Recipient History] 删除失败:', e.message);
    return res.status(500).json({ error: '删除失败' });
  }
});

// 清空所有历史收件人
app.post('/admin/email-recipient-history/clear', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    await supabase.from('posts')
      .delete()
      .eq('media_type', EMAIL_RECIPIENT_MARKER)
      .eq('user_name', ADMIN_USERNAME);
    return res.json({ ok: true });
  } catch(e) {
    console.error('[Email Recipient History] 清空失败:', e.message);
    return res.status(500).json({ error: '清空失败' });
  }
});

// ===================== VIP 会员 API =====================
// VIP_MARKER / VIP_ORDER_MARKER / VIP_PLAN_MARKER 已在文件前面集中定义（行 129-131）

const VIP_PLANS = [
  {
    id: 'pro_monthly',
    name: 'XTJ Pro',
    price: 3,
    currency: 'CNY',
    duration_days: 30,
    features: ['custom_theme', 'pro_chat_bubble', 'pro_post_style']
  }
];

// 获取可用套餐列表
// 2026-06-25：Pro 改为限量/限定/限时活动制，不再开放常驻购买
// 查询VIP状态
app.get('/api/vip/status', authenticateUser, rateLimit(60000, 60), async (req, res) => {
  try {
    const userName = req.userName;
    if (!userName) return res.status(401).json({ error: '请先登录' });

    const { data: vipRecords } = await supabase.from('posts')
      .select('*')
      .eq('user_name', userName)
      .eq('media_type', VIP_MARKER)
      .order('created_at', { ascending: false })
      .limit(5);

    var activeVip = null;
    var allVips = (vipRecords || []).map(function(r) {
      try {
        var c = JSON.parse(r.content || '{}');
        if (c.is_active && c.expire_at && new Date(c.expire_at) > new Date() && !activeVip) {
          activeVip = c;
        }
        return c;
      } catch(e) { return null; }
    }).filter(Boolean);

    return res.json({
      is_vip: !!activeVip,
      active_vip: activeVip,
      history: allVips
    });
  } catch(e) {
    console.error('[VIP] 查询状态失败:', e.message);
    return res.status(500).json({ error: '查询VIP状态失败' });
  }
});

// ===================== Pro 赠送活动管理 =====================
// PRO_GIFT_MARKER / PRO_GIFT_CLAIM_MARKER 已在文件前面集中定义（行 132-133）
const VISUAL_PRO_FEATURES = ['custom_theme', 'pro_chat_bubble', 'pro_post_style'];
const DEFAULT_GIFT_FEATURES = VISUAL_PRO_FEATURES.slice();

function normalizeVisualProFeatures(features) {
  var arr = Array.isArray(features) ? features : [];
  var clean = arr.filter(function(f) {
    return VISUAL_PRO_FEATURES.indexOf(String(f || '')) >= 0;
  });
  return clean.length ? clean : VISUAL_PRO_FEATURES.slice();
}

// 管理员：获取全部 Pro 赠送活动
// 2026-06-25：返回完整字段，包含 claim_limit / allowed_users / exclusive / start_at / end_at
// claimed_count 必须从 __pro_gift_claim__ 实时统计（不信 content 里的 claimed_count）
app.get('/admin/pro-gifts', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const [giftsRes, claimsRes] = await Promise.all([
      supabase.from('posts')
        .select('id, user_name, content, created_at')
        .eq('media_type', PRO_GIFT_MARKER)
        .order('created_at', { ascending: false })
        .limit(200),
      // 实时统计领取数
      supabase.from('posts')
        .select('id, content')
        .eq('media_type', PRO_GIFT_CLAIM_MARKER)
        .limit(2000)
    ]);
    if (giftsRes.error) return res.status(400).json({ error: sanitizeError(giftsRes.error) });

    // 索引：campaign_id -> claimed_count
    var claimedMap = {};
    (claimsRes.data || []).forEach(function(row) {
      try {
        var ci = JSON.parse(row.content || '{}');
        var cid = String(ci.campaign_id || '').trim();
        if (cid) claimedMap[cid] = (claimedMap[cid] || 0) + 1;
      } catch(e) {}
    });

    var gifts = (giftsRes.data || []).map(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      // 兼容字段别名：allowed_users / exclusive_users / target_users
      var allowedArr = Array.isArray(info.allowed_users) ? info.allowed_users
                      : Array.isArray(info.exclusive_users) ? info.exclusive_users
                      : Array.isArray(info.target_users) ? info.target_users
                      : [];
      var limitNum = parseInt(info.claim_limit != null ? info.claim_limit : (info.limit != null ? info.limit : (info.max_claims != null ? info.max_claims : 0)));
      if (!Number.isFinite(limitNum) || limitNum < 0) limitNum = 0;
      // 实时统计 claimed_count（不信任 content 里的 claimed_count）
      var claimedCount = claimedMap[String(row.id)] || 0;
      var remainingCount = limitNum > 0 ? Math.max(0, limitNum - claimedCount) : null;
      return {
        id: row.id,
        created_by: row.user_name,
        created_at: row.created_at,
        title: info.title || '',
        description: info.description || '',
        features: normalizeVisualProFeatures(info.features),
        duration_days: parseInt(info.duration_days) || 30,
        start_at: info.start_at || '',
        end_at: info.end_at || '',
        claim_expire_at: info.claim_expire_at || '',
        claim_limit: limitNum,
        claimed_count: claimedCount,
        remaining_count: remainingCount,
        allowed_users: allowedArr,
        exclusive_users: Array.isArray(info.exclusive_users) ? info.exclusive_users : [],
        target_users: Array.isArray(info.target_users) ? info.target_users : [],
        exclusive: !!info.exclusive,
        is_active: info.is_active !== false,
        is_published: !!info.is_published,
        published_at: info.published_at || '',
        updated_at: info.updated_at || ''
      };
    });
    return res.json({ ok: true, gifts: gifts });
  } catch(e) {
    console.error('[ProGift] 查询失败:', e.message || e);
    return res.status(500).json({ error: '查询失败' });
  }
});

// 管理员：创建/编辑 Pro 赠送活动
app.post('/admin/pro-gifts/save', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    var { id, title, description, features, duration_days, claim_expire_at,
          claim_limit, allowed_users, exclusive, start_at, end_at } = req.body;
    var titleVal = String(title || '').trim().slice(0, 100);
    var descVal = String(description || '').trim().slice(0, 500);
    if (!titleVal) return res.status(400).json({ error: '请输入活动标题' });
    if (!duration_days || duration_days < 1 || duration_days > 3650) return res.status(400).json({ error: '有效期1-3650天' });
    var featuresArr = normalizeVisualProFeatures(features);
    // 解析限定用户（支持字符串 "xxz, abc" 或数组）
    var allowedArr = [];
    if (Array.isArray(allowed_users)) {
      allowedArr = allowed_users.map(function(u) { return String(u || '').trim(); }).filter(Boolean);
    } else if (typeof allowed_users === 'string' && allowed_users.trim()) {
      allowedArr = allowed_users.split(/[,，\n;；\s]+/).map(function(u) { return String(u || '').trim(); }).filter(Boolean);
    }
    var limitNum = parseInt(claim_limit);
    if (!Number.isFinite(limitNum) || limitNum < 0) limitNum = 0;
    var isExclusive = !!exclusive;
    var startAtISO = start_at ? new Date(start_at).toISOString() : '';
    var endAtISO = end_at ? new Date(end_at).toISOString() : '';
    var claimExpireISO = claim_expire_at ? new Date(claim_expire_at).toISOString() : (endAtISO || '');
    var info = {
      title: titleVal,
      description: descVal,
      features: featuresArr,
      duration_days: Math.min(3650, Math.max(1, parseInt(duration_days) || 30)),
      claim_expire_at: claimExpireISO,
      start_at: startAtISO,
      end_at: endAtISO,
      claim_limit: limitNum,
      allowed_users: allowedArr,
      exclusive: isExclusive,
      is_published: false,
      updated_at: new Date().toISOString()
    };
    if (id) {
      // 编辑已有的
      var { data: existing } = await supabase.from('posts')
        .select('content').eq('id', id).eq('media_type', PRO_GIFT_MARKER).maybeSingle();
      if (!existing) return res.status(404).json({ error: '活动不存在' });
      var oldInfo = {};
      try { oldInfo = JSON.parse(existing.content || '{}'); } catch(e) {}
      // 保留原发布状态
      info.is_published = !!oldInfo.is_published;
      info.published_at = oldInfo.published_at || '';
      info.created_at = oldInfo.created_at || new Date().toISOString();
      var { error: updateErr } = await supabase.from('posts')
        .update({ content: JSON.stringify(info) })
        .eq('id', id);
      if (updateErr) return res.status(400).json({ error: sanitizeError(updateErr) });
    } else {
      // 新建
      info.created_at = new Date().toISOString();
      var { error: insertErr } = await supabase.from('posts').insert([{
        user_name: ADMIN_USERNAME,
        media_type: PRO_GIFT_MARKER,
        content: JSON.stringify(info),
        actor_key: 'pro_gift_' + Date.now()
      }]);
      if (insertErr) return res.status(400).json({ error: sanitizeError(insertErr) });
    }
    return res.json({ ok: true });
  } catch(e) {
    console.error('[ProGift] 保存失败:', e.message);
    return res.status(500).json({ error: '保存失败' });
  }
});

// 管理员：发布/取消发布 Pro 赠送活动
app.post('/admin/pro-gifts/toggle-publish', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    var { id, publish } = req.body;
    if (!id) return res.status(400).json({ error: '缺少活动ID' });
    var { data: existing } = await supabase.from('posts')
      .select('content').eq('id', id).eq('media_type', PRO_GIFT_MARKER).maybeSingle();
    if (!existing) return res.status(404).json({ error: '活动不存在' });
    var info = {};
    try { info = JSON.parse(existing.content || '{}'); } catch(e) {}
    info.is_published = !!publish;
    if (publish && !info.published_at) info.published_at = new Date().toISOString();
    info.updated_at = new Date().toISOString();
    var { error: updateErr } = await supabase.from('posts')
      .update({ content: JSON.stringify(info) })
      .eq('id', id);
    if (updateErr) return res.status(400).json({ error: sanitizeError(updateErr) });
    return res.json({ ok: true, is_published: !!publish, published_at: info.published_at });
  } catch(e) {
    console.error('[ProGift] 发布操作失败:', e.message);
    return res.status(500).json({ error: '操作失败' });
  }
});

// 管理员：删除 Pro 赠送活动
app.post('/admin/pro-gifts/delete', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var { id } = req.body;
    if (!id) return res.status(400).json({ error: '缺少活动ID' });
    var { error } = await supabase.from('posts')
      .delete().eq('id', id).eq('media_type', PRO_GIFT_MARKER);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    return res.json({ ok: true });
  } catch(e) {
    console.error('[ProGift] 删除失败:', e.message);
    return res.status(500).json({ error: '删除失败' });
  }
});

// 用户：获取可领取的 Pro 赠送活动（严格按用户身份过滤）
app.get('/api/pro-gifts/available', rateLimit(60000, 30), authenticateUser, async (req, res) => {
  try {
    var userName = String((req.userName || req.query.user_name) || '').trim();
    if (!userName) return res.status(401).json({ error: '请先登录' });
    var now = new Date();
    var nowISO = now.toISOString();
    // 一次性查出所有已发布的活动
    var { data: gifts } = await supabase.from('posts')
      .select('id, content, created_at')
      .eq('media_type', PRO_GIFT_MARKER)
      .order('created_at', { ascending: false })
      .limit(200);
    // 一次性查用户的所有领取记录（用于标记已领取 + 统计每活动总数）
    var { data: userClaims } = await supabase.from('posts')
      .select('media_url, content')
      .eq('media_type', PRO_GIFT_CLAIM_MARKER)
      .eq('user_name', userName)
      .limit(500);
    var userClaimedIds = new Set();
    (userClaims || []).forEach(function(c) {
      if (c.media_url) userClaimedIds.add(String(c.media_url));
    });
    // 查所有领取记录（按 campaign_id 统计总量，用于 claim_limit）
    var claimCountByCampaign = {};
    var { data: allClaims } = await supabase.from('posts')
      .select('media_url')
      .eq('media_type', PRO_GIFT_CLAIM_MARKER)
      .limit(5000);
    (allClaims || []).forEach(function(c) {
      if (c.media_url) claimCountByCampaign[c.media_url] = (claimCountByCampaign[c.media_url] || 0) + 1;
    });

    var available = [];
    (gifts || []).forEach(function(g) {
      var info = {};
      try { info = JSON.parse(g.content || '{}'); } catch(e) {}
      // 1. 必须已发布
      if (!info.is_published && info.status !== 'published') return;
      // 2. 不可禁用
      if (info.is_active === false) return;
      // 3. start_at 未到
      if (info.start_at && new Date(info.start_at) > now) return;
      // 4. end_at 已过
      if (info.end_at && new Date(info.end_at) < now) return;
      // 5. claim_expire_at 已过
      if (info.claim_expire_at && new Date(info.claim_expire_at) < now) return;
      // 6. 限定用户检查（allowed_users / exclusive_users / target_users 任一非空）
      var allowedArr = [];
      if (Array.isArray(info.allowed_users)) allowedArr = allowedArr.concat(info.allowed_users);
      if (Array.isArray(info.exclusive_users)) allowedArr = allowedArr.concat(info.exclusive_users);
      if (Array.isArray(info.target_users)) allowedArr = allowedArr.concat(info.target_users);
      allowedArr = allowedArr.map(function(u) { return String(u || '').trim(); }).filter(Boolean);
      var hasAllowList = info.exclusive === true || allowedArr.length > 0;
      if (hasAllowList && allowedArr.indexOf(userName) === -1) return; // 用户不在白名单，不返回
      // 7. claim_limit 限制
      var claimLimit = parseInt(info.claim_limit || info.limit || info.max_claims) || 0;
      var claimedCount = claimCountByCampaign[g.id] || 0;
      var alreadyClaimed = userClaimedIds.has(String(g.id));
      // 已领取的即使名额满也要返回（用于展示"已领取"）
      if (claimLimit > 0 && claimedCount >= claimLimit && !alreadyClaimed) return; // 名额已满且未领取，不返回
      var remainingCount = claimLimit > 0 ? Math.max(0, claimLimit - claimedCount) : null;

      available.push({
        id: g.id,
        title: info.title || '',
        description: info.description || '',
        features: normalizeVisualProFeatures(info.features),
        duration_days: info.duration_days || 30,
        start_at: info.start_at || '',
        end_at: info.end_at || '',
        claim_expire_at: info.claim_expire_at || '',
        claim_limit: claimLimit,
        claimed_count: claimedCount,
        remaining_count: remainingCount,
        exclusive: !!info.exclusive || (allowedArr.length > 0),
        allowed_users: allowedArr,
        already_claimed: alreadyClaimed,
        published_at: info.published_at || ''
      });
    });
    return res.json({ ok: true, gifts: available });
  } catch(e) {
    console.error('[ProGift] 查询可用活动失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// 用户：领取 Pro 赠送活动（强校验：身份、发布状态、时间、限定用户、名额、重复领取）
var claimLocks = {};
app.post('/api/pro-gifts/claim', rateLimit(60000, 10), authenticateUser, async (req, res) => {
  var lockKey, userNameVal, giftId;
  try {
    var { user_name, gift_id } = req.body;
    userNameVal = String(user_name || req.userName || '').trim();
    // 强制以 req.userName 为准（认证中间件写入），避免 body 传任意 user_name 替别人领
    if (req.userName) userNameVal = String(req.userName).trim();
    giftId = String(gift_id || '').trim();
    if (!userNameVal) return res.status(401).json({ error: '请先登录' });
    if (!giftId) return res.status(400).json({ error: '缺少活动ID' });
    var now = new Date();
    var nowISO = now.toISOString();
    // 1. 活动存在 + media_type 正确
    var { data: gift } = await supabase.from('posts')
      .select('content').eq('id', giftId).eq('media_type', PRO_GIFT_MARKER).maybeSingle();
    if (!gift) return res.status(404).json({ error: '活动不存在' });
    var giftInfo = {};
    try { giftInfo = JSON.parse(gift.content || '{}'); } catch(e) {}
    // 2. 已发布
    if (!giftInfo.is_published) return res.status(400).json({ error: '活动未发布' });
    // 3. 未禁用
    if (giftInfo.is_active === false) return res.status(400).json({ error: '活动已禁用' });
    // 4. 时间窗口
    if (giftInfo.start_at && new Date(giftInfo.start_at) > now) return res.status(400).json({ error: '活动未开始' });
    if (giftInfo.end_at && new Date(giftInfo.end_at) < now) return res.status(400).json({ error: '活动已结束' });
    if (giftInfo.claim_expire_at && new Date(giftInfo.claim_expire_at) < now) return res.status(400).json({ error: '活动已过期' });
    // 5. 限定用户白名单
    var allowedArr = [];
    if (Array.isArray(giftInfo.allowed_users)) allowedArr = allowedArr.concat(giftInfo.allowed_users);
    if (Array.isArray(giftInfo.exclusive_users)) allowedArr = allowedArr.concat(giftInfo.exclusive_users);
    if (Array.isArray(giftInfo.target_users)) allowedArr = allowedArr.concat(giftInfo.target_users);
    allowedArr = allowedArr.map(function(u) { return String(u || '').trim(); }).filter(Boolean);
    var hasAllowList = giftInfo.exclusive === true || allowedArr.length > 0;
    if (hasAllowList && allowedArr.indexOf(userNameVal) === -1) {
      return res.status(403).json({ error: '你不在本次活动领取名单中' });
    }
    // 防并发重复领取（进程内锁 + DB 事后重检，双保险）
    var lockKey = 'claim_' + giftId + '_' + userNameVal;
    if (claimLocks[lockKey]) return res.status(429).json({ error: '领取请求正在处理中' });
    claimLocks[lockKey] = true;

    var claimLimit = parseInt(giftInfo.claim_limit || giftInfo.limit || giftInfo.max_claims) || 0;
    if (claimLimit > 0) {
      var { count: claimCount } = await supabase.from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('media_type', PRO_GIFT_CLAIM_MARKER)
        .eq('media_url', giftId);
      if (claimCount && claimCount >= claimLimit) { delete claimLocks[lockKey]; return res.status(400).json({ error: '活动名额已满' }); }
    }
    var { data: existingClaim } = await supabase.from('posts')
      .select('id').eq('media_type', PRO_GIFT_CLAIM_MARKER)
      .eq('user_name', userNameVal)
      .eq('media_url', giftId)
      .maybeSingle();
    if (existingClaim) { delete claimLocks[lockKey]; return res.status(400).json({ error: '你已经领取过该活动' }); }

    var durationDays = giftInfo.duration_days || 30;
    var expireAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    var features = normalizeVisualProFeatures(giftInfo.features);
    var claimContent = JSON.stringify({
      campaign_id: giftId,
      campaign_title: giftInfo.title || '',
      user_name: userNameVal,
      claimed_at: nowISO,
      vip_expire_at: expireAt,
      features: features,
      duration_days: durationDays
    });
    // 使用固定 actor_key（不加时间戳）作为数据库级去重：同用户+同活动只能 insert 成功一次
    var claimActorKey = 'pro_claim_' + giftId + '_' + userNameVal;
    var { data: claimData, error: claimErr } = await supabase.from('posts').insert([{
      user_name: userNameVal,
      media_type: PRO_GIFT_CLAIM_MARKER,
      media_url: giftId,
      content: claimContent,
      actor_key: claimActorKey
    }]).select('id').maybeSingle();
    // actor_key 有唯一约束，重复会报错
    if (claimErr) {
      delete claimLocks[lockKey];
      if (claimErr.code === '23505') return res.status(400).json({ error: '你已经领取过该活动' });
      return res.status(400).json({ error: sanitizeError(claimErr) });
    }
    // 事后反查：如果并发导致超过 claim_limit，删除本条并返回错误
    if (claimLimit > 0) {
      var { count: postClaimCount } = await supabase.from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('media_type', PRO_GIFT_CLAIM_MARKER)
        .eq('media_url', giftId);
      if (postClaimCount && postClaimCount > claimLimit) {
        await supabase.from('posts').delete().eq('id', claimData.id).maybeSingle();
        delete claimLocks[lockKey];
        return res.status(400).json({ error: '活动名额已满' });
      }
    }
    // 写入 VIP 激活记录
    var vipContent = JSON.stringify({
      plan_id: 'pro_gift_' + giftId,
      plan_name: 'XTJ Pro (' + (giftInfo.title || '赠送') + ')',
      price: 0,
      is_active: true,
      order_no: 'GIFT_' + Date.now(),
      start_at: nowISO,
      expire_at: expireAt,
      features: features,
      activated_at: nowISO,
      source: 'pro_gift'
    });
    var { error: vipErr } = await supabase.from('posts').insert([{
      user_name: userNameVal,
      media_type: VIP_MARKER,
      media_url: 'pro_monthly',
      content: vipContent,
      actor_key: 'vip_' + Date.now()
    }]);
    if (vipErr) {
      // VIP 写入失败时回滚领取记录
      console.warn('[ProGift] VIP记录写入失败，回滚领取记录:', vipErr.message);
      try {
        if (claimData && claimData.id) {
          await supabase.from('posts').delete().eq('id', claimData.id);
        }
      } catch (rollbackErr) {
        console.error('[ProGift] 回滚领取记录失败:', rollbackErr.message);
      }
      return res.status(500).json({ error: 'VIP激活失败，请重试' });
    }
    return res.json({
      ok: true,
      user_name: userNameVal,
      plan_name: 'XTJ Pro (' + (giftInfo.title || '赠送') + ')',
      expire_at: expireAt,
      is_active: true,
      features: features,
      source: 'pro_gift'
    });
  } catch(e) {
    console.error('[ProGift] 领取失败:', e.message);
    return res.status(500).json({ error: '领取失败' });
  } finally {
    delete claimLocks[lockKey];
  }
});

// 管理员：手动赠送 Pro 给指定用户
app.post('/admin/pro-gifts/manual-gift', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var { user_name, duration_days, features, reason } = req.body;
    var userNameVal = String(user_name || '').trim();
    if (!userNameVal) return res.status(400).json({ error: '请输入用户名' });
    var days = Math.min(3650, Math.max(1, parseInt(duration_days) || 30));
    var featuresArr = normalizeVisualProFeatures(features);
    var reasonVal = String(reason || '管理员手动赠送').trim().slice(0, 200);
    var now = new Date();
    var nowISO = now.toISOString();
    var expireAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    // 写入 VIP 激活记录
    var vipContent = JSON.stringify({
      plan_id: 'admin_gift_' + Date.now(),
      plan_name: 'XTJ Pro (管理员赠送)',
      price: 0,
      is_active: true,
      order_no: 'ADMIN_GIFT_' + Date.now(),
      start_at: nowISO,
      expire_at: expireAt,
      features: featuresArr,
      activated_at: nowISO,
      source: 'admin_gift',
      reason: reasonVal
    });
    var { error: vipErr } = await supabase.from('posts').insert([{
      user_name: userNameVal,
      media_type: VIP_MARKER,
      media_url: 'pro_monthly',
      content: vipContent,
      actor_key: 'vip_' + Date.now()
    }]);
    if (vipErr) return res.status(400).json({ error: sanitizeError(vipErr) });
    return res.json({
      ok: true,
      user_name: userNameVal,
      plan_name: 'XTJ Pro (管理员赠送)',
      expire_at: expireAt,
      is_active: true,
      features: featuresArr,
      source: 'admin_gift'
    });
  } catch(e) {
    console.error('[ProGift] 手动赠送失败:', e.message);
    return res.status(500).json({ error: '赠送失败' });
  }
});

// 管理员：获取全部 Pro 激活/领取历史记录
app.get('/admin/pro-gifts/history', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    // 查询所有 VIP 激活记录
    var { data: vipRecords } = await supabase.from('posts')
      .select('user_name, content, media_type, media_url, created_at')
      .eq('media_type', VIP_MARKER)
      .order('created_at', { ascending: false })
      .limit(500);
    // 查询所有 Pro 赠送领取记录
    var { data: claimRecords } = await supabase.from('posts')
      .select('user_name, content, media_type, media_url, created_at')
      .eq('media_type', PRO_GIFT_CLAIM_MARKER)
      .order('created_at', { ascending: false })
      .limit(500);
    // 查询所有订单记录 (paid)
    var { data: orderRecords } = await supabase.from('posts')
      .select('user_name, content, media_type, media_url, created_at')
      .eq('media_type', VIP_ORDER_MARKER)
      .order('created_at', { ascending: false })
      .limit(500);

    var records = [];

    // 处理 VIP 激活记录
    (vipRecords || []).forEach(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      var source = info.source || 'unknown';
      var sourceLabel = '其他';
      if (source === 'pro_gift') sourceLabel = '活动领取';
      else if (source === 'admin_gift') sourceLabel = '管理员赠送';
      else if (source === 'frontend_direct') sourceLabel = '自主开通';
      else if (source === 'paid' || source === 'payment') sourceLabel = '付费购买';
      records.push({
        type: 'vip_activation',
        user_name: row.user_name,
        source: source,
        source_label: sourceLabel,
        activated_at: info.activated_at || info.start_at || row.created_at,
        expire_at: info.expire_at || '',
        plan_name: info.plan_name || 'XTJ Pro',
        price: info.price || 0,
        features: normalizeVisualProFeatures(info.features),
        created_at: row.created_at
      });
    });

    // 处理领取记录
    (claimRecords || []).forEach(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      records.push({
        type: 'gift_claim',
        user_name: row.user_name,
        source: 'pro_gift',
        source_label: '免费赠送',
        gift_id: info.campaign_id || row.media_url,
        gift_title: info.campaign_title || '',
        activated_at: info.claimed_at || row.created_at,
        expire_at: info.vip_expire_at || '',
        duration_days: info.duration_days || 0,
        features: normalizeVisualProFeatures(info.features),
        created_at: row.created_at
      });
    });

    // 处理订单 (支付记录)
    (orderRecords || []).forEach(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      if (info.status === 'paid') {
        records.push({
          type: 'order_paid',
          user_name: row.user_name,
          source: 'paid',
          source_label: '付费购买',
          order_no: info.order_no || row.media_url,
          amount: info.amount || 0,
          paid_at: info.paid_at || row.created_at,
          created_at: row.created_at
        });
      }
    });

    // 按时间倒序排列
    records.sort(function(a, b) {
      var ta = a.activated_at || a.paid_at || a.created_at || '';
      var tb = b.activated_at || b.paid_at || b.created_at || '';
      return tb.localeCompare(ta);
    });

    // 统计每个用户的 Pro 次数和来源
    var userStats = {};
    records.forEach(function(r) {
      var un = r.user_name;
      if (!userStats[un]) userStats[un] = { count: 0, sources: [], first_at: '', last_at: '', last_expire: '' };
      userStats[un].count++;
      if (!userStats[un].sources.includes(r.source_label)) userStats[un].sources.push(r.source_label);
      var t = r.activated_at || r.paid_at || r.created_at || '';
      if (t && (!userStats[un].first_at || t < userStats[un].first_at)) userStats[un].first_at = t;
      if (t && (!userStats[un].last_at || t > userStats[un].last_at)) userStats[un].last_at = t;
      if (r.expire_at && (!userStats[un].last_expire || r.expire_at > userStats[un].last_expire)) userStats[un].last_expire = r.expire_at;
    });

    return res.json({ ok: true, records: records, user_stats: userStats });
  } catch(e) {
    console.error('[ProGift] 查询历史失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== 客户端错误监控 (允许匿名, IP 限流) =====================
app.post('/api/client-error-log', rateLimit(60000, 20), async (req, res) => {
  try {
    var { type, message, stack, url, line, col, user_agent, timestamp } = req.body;
    var errorType = String(type || 'unknown').slice(0, 50);
    var errorMsg = String(message || '').slice(0, 500);
    var errorStack = String(stack || '').slice(0, 1000);
    var pageUrl = String(url || '').slice(0, 500);
    var ua = String(user_agent || '').slice(0, 500);
    // 不保存敏感信息
    if (/token|password|cookie|authorization|secret/i.test(errorMsg)) errorMsg = '[filtered: sensitive]';
    if (/token|password|cookie|authorization|secret/i.test(errorStack)) errorStack = '[filtered: sensitive]';

    await supabase.from('posts').insert([{
      user_name: 'system',
      media_type: CLIENT_ERROR_MARKER,
      media_url: errorType,
      content: JSON.stringify({
        type: errorType,
        message: errorMsg,
        stack: errorStack,
        url: pageUrl,
        line: line || null,
        col: col || null,
        user_agent: ua,
        timestamp: timestamp || new Date().toISOString()
      }),
      actor_key: 'cl_err_' + Date.now()
    }]);
    return res.json({ ok: true });
  } catch(e) {
    return res.status(500).json({ error: '记录失败' });
  }
});

app.get('/admin/error-logs', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var limit = parseInt(req.query.limit) || 200;
    if (limit > 500) limit = 500;
    var query = supabase.from('posts')
      .select('id, content, media_url, created_at')
      .eq('media_type', CLIENT_ERROR_MARKER)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (req.query.type) {
      query = query.eq('media_url', req.query.type);
    }

    var { data, error } = await query;
    if (error) return res.status(400).json({ error: sanitizeError(error) });

    var logs = (data || []).map(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      return {
        id: row.id,
        type: info.type || row.media_url,
        message: info.message || '',
        stack: info.stack || '',
        url: info.url || '',
        line: info.line,
        col: info.col,
        user_agent: info.user_agent || '',
        timestamp: info.timestamp || row.created_at,
        created_at: row.created_at
      };
    });
    return res.json({ data: logs });
  } catch(e) {
    console.error('[API] 错误日志查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== AI 聊天接口（徐旭泽的小猫）=====================
// ★ 所有 AI 路由必须：
// 1. 走 authenticateUser 中间件（验证用户身份）
// 2. 走 checkAiUserRateLimit 限流（防滥用，按 userName）
// 3. 字段严格验证（防注入 + 长度限制）
// 4. 数据存 posts 表 + AI_AGENT_*_MARKER（已加入 applyPublicPostExclusions 过滤）

const AI_CHAT_MESSAGE_MAX_LEN = Math.min(
  Math.max(parseInt(process.env.AI_CHAT_MESSAGE_MAX_LEN || '50000', 10) || 50000, 1000),
  100000
);
// ★ 缓存优化：历史消息保留 20 条 (原 10)，更稳定的前缀，命中率更高
// 同时每条历史消息截断到 4000 字符 (~1500 tokens)，防止单条长消息撑爆请求
const AI_CHAT_HISTORY_LIMIT = 20;
const AI_CHAT_HISTORY_MSG_MAX_CHARS = 4000;
const AI_CHAT_HOURLY_IP_LIMIT = 200;

// 生成简短的 conversation_id
function genConvId() {
  var ts = Date.now().toString(36).toUpperCase();
  var rnd;
  try { rnd = crypto.randomUUID().split('-').slice(0,2).join('').toUpperCase(); } catch(e) { rnd = Math.random().toString(36).slice(2, 8).toUpperCase(); }
  return ts + '-' + rnd;
}

// 解析 media_url 中的元数据：新数据为 JSON {role, convId, usage}，旧数据为纯字符串 role
function parseMsgMeta(r) {
  var raw = r.media_url || '';
  if (raw.indexOf('{') === 0) {
    try { return JSON.parse(raw); } catch(e) { return { role: 'user' }; }
  }
  return { role: raw === 'assistant' ? 'assistant' : 'user' };
}

function getConvIdFromActorKey(actorKey) {
  var ak = String(actorKey || '');
  var prefix = 'ai_msg_conv_';
  if (ak.indexOf(prefix) !== 0) return '';
  var rest = ak.slice(prefix.length);
  var markerUser = '_user_';
  var markerAgent = '_agent_';
  var idxUser = rest.indexOf(markerUser);
  var idxAgent = rest.indexOf(markerAgent);
  var idx = -1;
  if (idxUser >= 0 && idxAgent >= 0) idx = Math.min(idxUser, idxAgent);
  else if (idxUser >= 0) idx = idxUser;
  else if (idxAgent >= 0) idx = idxAgent;
  if (idx < 0) return '';
  return rest.slice(0, idx);
}

function resolveConvId(r) {
  var meta = parseMsgMeta(r);
  if (meta && meta.convId) return String(meta.convId);
  return getConvIdFromActorKey(r.actor_key);
}

function buildMsgMeta(role, convId, usage, reasoning, seq, searchMeta, thinkingElapsedMs, extra) {
  var obj = { role: role, convId: convId };
  if (usage) obj.usage = usage;
  if (reasoning) obj.reasoning = reasoning;
  if (typeof seq === 'number') obj.seq = seq;
  if (typeof thinkingElapsedMs === 'number' && thinkingElapsedMs > 0) obj.thinking_elapsed_ms = thinkingElapsedMs;
  if (searchMeta) {
    if (searchMeta.count) obj.search_count = searchMeta.count;
    if (searchMeta.query) obj.search_query = searchMeta.query;
    if (Array.isArray(searchMeta.queries) && searchMeta.queries.length) obj.search_queries = searchMeta.queries;
    if (Array.isArray(searchMeta.results) && searchMeta.results.length) {
      // ★ P1 关键修复：保存完整搜索结果数组
      //   - 1 天后通过 search_expires_at 判断过期
      //   - 1 天内：完整标题/链接/摘要
      //   - 1 天后：前端只显示"已联网搜索 · N 条"徽章，内容隐藏
      obj.search_results = searchMeta.results;
    }
    if (typeof searchMeta.expires_at === 'number' && searchMeta.expires_at > 0) {
      obj.search_expires_at = searchMeta.expires_at;
    }
  }
  // ★ O 修复 Bug 4: 额外字段 (deep_think / planner / worker_results / thinking_log / think_duration_ms)
  if (extra && typeof extra === 'object') {
    if (extra.deep_think) obj.deep_think = true;
    if (extra.chat_mode) obj.chat_mode = extra.chat_mode;
    if (typeof extra.agent_count === 'number') obj.agent_count = extra.agent_count;
    if (extra.planner) obj.planner = extra.planner;
    if (Array.isArray(extra.worker_results)) obj.worker_results = extra.worker_results;
    if (Array.isArray(extra.thinking_log)) obj.thinking_log = extra.thinking_log;
    if (typeof extra.think_duration_ms === 'number' && extra.think_duration_ms > 0) {
      obj.think_duration_ms = extra.think_duration_ms;
    }
  }
  return JSON.stringify(obj);
}

app.get('/api/agent/profile', authenticateUser, async (req, res) => {
  return res.status(410).json({ error: '已废弃，AI 配置由管理员统一管理' });
});

// GET /api/agent/config - 普通用户获取当前 AI 公共配置（不含 system_prompt）
app.get('/api/agent/config', authenticateUser, async (req, res) => {
  try {
    var config = await getAiConfig();
    return res.json({
      ok: true,
      config: {
        name: config.name || 'XTJ 智能助手',
        avatar: config.avatar || '🤖',
        avatar_url: config.avatar_url || '',
        avatar_type: config.avatar_type || 'emoji',
        avatar_version: config.avatar_version || 0,
        description: config.description || 'XTJ 网站的 AI 助手',
        welcome_message: config.welcome_message || '你好，有什么可以帮你的？',
        allow_web_search: config.allow_web_search === true,
        config_version: config.config_version || config.avatar_version || 0,
        public_style_summary: (function() {
          var p = [];
          if (config.persona) p.push(config.persona.slice(0, 60));
          var rs = config.reply_style || {};
          if (rs.directness === 'direct') p.push('直接回答');
          if (!rs.use_emoji) p.push('少用emoji');
          return p.join('，');
        })(),
        deep_think: {
          enabled: config.deep_think ? config.deep_think.enabled !== false : true,
          default_thinking_mode: (config.deep_think && config.deep_think.default_thinking_mode) || 'max',
          max_workers: (config.deep_think && parseInt(config.deep_think.max_workers)) || 6,
          min_workers: (config.deep_think && parseInt(config.deep_think.min_workers)) || 0
        },
        model: {
          default_thinking_mode: (config.model && config.model.default_thinking_mode) || 'max'
        }
      }
    });
  } catch (e) {
    console.error('[AI-CONFIG] GET /api/agent/config error:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

app.post('/api/agent/profile', authenticateUser, async (req, res) => {
  return res.status(403).json({ error: '该接口已关闭，AI 配置由管理员统一管理' });
});


async function maybeUpdateConversationSummary(userName, convId, messages) {
  if (!userName || !convId) return;
  
  var { data: lastSummary } = await supabase.from('posts')
    .select('id, content')
    .eq('user_name', userName)
    .eq('media_type', AI_AGENT_CONV_SUMMARY_MARKER)
    .eq('media_url', convId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  var lastSummaryObj = lastSummary ? (function() { try { return JSON.parse(lastSummary.content); } catch(e) { return null; } })() : null;
  var now = Date.now();
  
  if (lastSummaryObj) {
    var lastTime = new Date(lastSummaryObj.updated_at || 0).getTime();
    if (now - lastTime < 10 * 60 * 1000) return;
  }
  
  var recentMessages = (messages || []).slice(-20);
  var msgText = recentMessages.map(function(m) {
    var role = m.role === 'user' ? '用户' : 'AI';
    var content = String(m.content || '').slice(0, 200);
    return role + '：' + content;
  }).join('\n');
  
  if (msgText.length < 20) return;
  
  var summaryPrompt = '根据以下对话内容，生成 JSON 格式的会话摘要。只输出 JSON，不要加任何其他文字。\n\n' + msgText.slice(0, 3000) + '\n\n{"title":"精简标题","summary":"摘要（300字以内）","tags":["标签1","标签2"],"important_facts":["重要事实"],"user_preferences_found":["发现的偏好"],"open_tasks":["待办任务"],"importance":1}';
  
  try {
    var summaryResp = await callDeepSeek([{ role: 'user', content: summaryPrompt }], { model: DEEPSEEK_MODEL_REASONER, temperature: 0.2 });
    
    var summaryText = summaryResp.content || '';
    var summaryObj = (function() { try { return JSON.parse(summaryText); } catch(e) { return null; } })();
    if (!summaryObj) return;
    
    summaryObj.conversation_id = convId;
    summaryObj.created_at = new Date().toISOString();
    summaryObj.updated_at = summaryObj.created_at;
    
    var saveContent = JSON.stringify(summaryObj);
    
    if (lastSummary && lastSummary.id) {
      await supabase.from('posts').update({ content: saveContent, created_at: summaryObj.created_at }).eq('id', lastSummary.id);
    } else {
      await supabase.from('posts').insert([{ user_name: userName, content: saveContent, media_type: AI_AGENT_CONV_SUMMARY_MARKER, media_url: convId, actor_key: 'conv_summary_' + userName + '_' + convId + '_' + Date.now() }]);
    }
    
    console.log('[MEMORY] summary updated for', userName, 'conv=', convId.slice(0, 8));
  } catch (e) {
    console.error('[MEMORY] summary error:', e && e.message);
  }
}

// ===================== AI 智能体 chat 接口 =====================
//
// ★ 缓存优化设计（DeepSeek prompt cache）：
//   DeepSeek 按 token 序列前缀匹配缓存。把 system prompt 拆成两段：
//   - 第 1 段（core）：人格 + 规则 → 完全固定，命中缓存概率最高
//   - 第 2 段（dynamic）：用户当前数据 → 独立 token 段，不污染 core 缓存
//   历史 user/assistant 消息按时间顺序追加，结构稳定 → 缓存命中良好。
//
// ★ 完全固定，DeepSeek 缓存命中段
function buildAiCorePrompt(config) {
  var cfg = migrateConfig(config || {});
  var name = String(cfg.name || 'XTJ 智能助手').slice(0, 30);
  var persona = String(cfg.persona || '').slice(0, 300);
  var sysPrompt = String(cfg.system_prompt || '').slice(0, 1000);
  var rs = cfg.reply_style || {};
  var allowWebSearch = cfg.allow_web_search === true || (cfg.search && cfg.search.allow_web_search === true);

  // ★ 缓存优化：紧凑单行 prompt，减少 token 数（命中率不变的情况下降低单次成本）
  var toneMap = { direct: '直接', gentle: '委婉' };
  var detailMap = { brief: '简洁', detailed: '详细' };
  var humorMap = { low: '严肃', medium: '中性幽默', high: '幽默' };
  var sarcasmMap = { low: '温和', medium: '犀利', high: '毒舌' };
  var warmthMap = { low: '冷淡', medium: '中性', high: '温暖' };

  var style = [
    toneMap[rs.directness] || '直接',
    detailMap[rs.detail_level] || '适中',
    humorMap[rs.humor_level] || '中性幽默',
    sarcasmMap[rs.sarcasm_level] || '犀利',
    warmthMap[rs.warmth_level] || '中性',
    rs.use_markdown !== false ? '用 Markdown' : '不用 Markdown',
    rs.use_emoji !== false ? '用 emoji' : '不用 emoji'
  ].join('，');

  var emojiRule = rs.use_emoji === true
    ? '【emoji 规则】偶尔用 emoji 增加语气（每条最多 1 个），且必须是有意义的强调，不是每句话末尾都加！禁止一连串表情如 😏😁😂💀。'
    : '【emoji 规则】不用 emoji。';

  var lines = [
    '你是 ' + name + '。',
    persona ? '人设：' + persona : '',
    sysPrompt ? '指令：' + sysPrompt : '',
    '风格：' + style + '。每条 ≤ ' + (rs.max_reply_chars || 1200) + ' 字。',
    allowWebSearch ? '可用工具：search_web / get_weather / get_current_time。' : '',
    emojiRule,
    '【输出硬性规则】1) 一条回复只表达一个核心观点，不要分点罗列。2) 短句为主，别写长段落。3) 不写"作为一个 AI"开场白。4) 不写括号动作描写（如 "*笑了笑*"）。',
    '只回答对话内容；不编造已执行的操作；拒绝查他人记录。中文回复。'
  ];

  return lines.filter(Boolean).join('\n');
}

// 动态上下文：每次可能变，独立 token 段
function buildAiDynamicContext() { return ''; }

// ===================== 全局 AI 配置读取 =====================
const AI_DEFAULT_CONFIG = {
  version: 2,
  name: 'XTJ 智能助手',
  avatar: '🤖',
  avatar_url: '',
  avatar_type: 'emoji',
  avatar_version: 0,
  description: 'XTJ 网站的 AI 助手',
  persona: '',
  tone: '',
  system_prompt: '',
  welcome_message: '你好，有什么可以帮你的？',
  allow_web_search: false,
  reply_style: {
    directness: 'direct',
    detail_level: 'medium',
    humor_level: 'low',
    sarcasm_level: 'low',
    warmth_level: 'medium',
    use_markdown: true,
    use_emoji: false,
    max_reply_chars: 1200
  },
  roleplay: {
    enabled: false,
    allow_stage_directions: false,
    allow_cat_actions: false,
    forbidden_action_patterns: ['爪子', '尾巴', '猫耳', '甩了甩', '瞪着你', '趴在键盘', '毛茸茸', '舔了舔', '喵', '叹气', '抖了抖']
  },
  output_rules: {
    must: ['直接回答用户问题', '优先给结论', '代码问题要给可执行修复方案', '不确定就说明不确定'],
    avoid: ['不要写括号动作', '不要写心理动作', '不要废话', '不要假装搜索成功', '不要编造事实', '不要用括号描述你的动作神态心理活动'],
    format: ['必要时使用标题和清单', '复杂问题先说结论再给步骤']
  },
  search: { allow_web_search: false, search_provider: 'searxng', max_results: 5, timeout_ms: 4000, use_weather_tool: true },
  // ★ M: default_thinking_mode 从 low 改成 max
  //   用户要求: 普通聊天也用 max 思考程度
  //   管理员可在 /admin/ai-agent/config 切换为 low/medium/high/max
  model: { reasoner_model: '', default_thinking_mode: 'max', allow_user_thinking_switch: false, multi_agent: true },
  // ★ P 新增: 深度思考模式子配置 (与普通聊天分开, 管理员独立切换)
  deep_think: {
    enabled: true,                    // 是否启用深度思考模式 (前端 toggle 可用)
    default_thinking_mode: 'max',     // Planner/Worker/Synthesizer 默认思考程度 (low/medium/high/max)
    max_workers: 6,                   // Planner 最多拆几个 agent
    min_workers: 0,                   // 最小 agent 数 (0 = 允许直接回答)
    force_split_min_length: 24,       // 问题超过此长度且含复杂关键词时强制拆分
    worker_max_tool_rounds: 5,        // 单 worker 内部最多 tool_use 轮数
    low_max_tokens: 4096,             // low 模式最大 token
    medium_max_tokens: 16384,         // medium 模式最大 token
    high_max_tokens: 32768,           // high 模式最大 token
    low_max_tool_rounds: 0,           // low 模式最大工具轮数
    medium_max_tool_rounds: 2,        // medium 模式最大工具轮数
    high_max_tool_rounds: 4,          // high 模式最大工具轮数
    require_history_injection: true   // 是否把 history 注入到 Planner/Worker/Synthesizer
  },
  security: { hide_system_prompt_in_reasoning: true },  // 安全规则：思考过程中禁止复述系统提示词
  admin_debug: { show_effective_prompt: true, show_model_info: true, show_reasoning_length: true },
  updated_at: '',
  updated_by: ''
};

// 将旧版 config 升级到完整 v2 schema
function migrateConfig(config) {
  if (!config || typeof config !== 'object') return JSON.parse(JSON.stringify(AI_DEFAULT_CONFIG));
  if (config.version === 2) return config;
  var merged = JSON.parse(JSON.stringify(AI_DEFAULT_CONFIG));
  Object.keys(config).forEach(function(k) {
    if (k === 'version') return;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
    if (k === 'reply_style' && typeof config.reply_style === 'object') {
      Object.assign(merged.reply_style, config.reply_style);
    } else if (k === 'roleplay' && typeof config.roleplay === 'object') {
      Object.assign(merged.roleplay, config.roleplay);
    } else if (k === 'output_rules' && typeof config.output_rules === 'object') {
      Object.assign(merged.output_rules, config.output_rules);
    } else if (k === 'search' && typeof config.search === 'object') {
      Object.assign(merged.search, config.search);
    } else if (k === 'model' && typeof config.model === 'object') {
      Object.assign(merged.model, config.model);
    } else if (k === 'deep_think' && typeof config.deep_think === 'object') {  // ★ P 新增
      Object.assign(merged.deep_think, config.deep_think);
    } else if (k === 'security' && typeof config.security === 'object') {
      Object.assign(merged.security, config.security);
    } else if (k === 'admin_debug' && typeof config.admin_debug === 'object') {
      Object.assign(merged.admin_debug, config.admin_debug);
    } else {
      merged[k] = config[k];
    }
  });
  merged.version = 2;
  return merged;
}

async function getAiConfig() {
  var now = Date.now();
  if (aiConfigCache && (now - aiConfigFetchedAt) < 30000) return aiConfigCache;
  try {
    var { data: row } = await supabase.from('posts')
      .select('content, media_url, created_at')
      .eq('media_type', AI_AGENT_CONFIG_MARKER)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (row && row.media_url) {
      try {
        var cfg = JSON.parse(row.media_url);
        if (cfg && cfg.name) {
          aiConfigCache = migrateConfig(cfg);
          aiConfigFetchedAt = now;
          return aiConfigCache;
        }
      } catch (e) { /* fall through */ }
    }
  } catch (e) {
    console.error('[AI-CONFIG] getAiConfig error:', e.message);
  }
  // DB 异常时不覆盖已有缓存（保留旧配置继续服务），只有无缓存时才用默认值兜底
  if (!aiConfigCache) {
    aiConfigCache = JSON.parse(JSON.stringify(AI_DEFAULT_CONFIG));
  }
  aiConfigFetchedAt = now;
  return aiConfigCache;
}


async function loadAiContext(userName, convId) {
  var ctx = { history: [] };

  try {
    // 验证 convId 防止 LIKE 注入
    if (convId && !/^[A-Z0-9\-]{6,}$/i.test(convId)) convId = null;
    // 1. 读取最近 AI 消息
    // ★ 关键：先按 created_at desc 取最近的消息（更准确反映"最近聊了什么"），
    //         然后在内存里 reverse 成时间正序给 AI。
    //         修复：之前带 convId 的分支 limit(15) + desc + reverse = 实际只取到最旧 15 条
    var msgRows;
    if (convId) {
      // ★ U3 修复: 避免双查询泄漏 — 用 if/else 而非 query 覆盖
      var r = await supabase.from('posts')
        .select('user_name, content, media_url, created_at')
        .eq('user_name', userName)
        .eq('media_type', AI_AGENT_MESSAGE_MARKER)
        .filter('actor_key', 'like', 'ai_msg_conv_' + convId + '_%')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(AI_CHAT_HISTORY_LIMIT);
      msgRows = r.data;
    } else {
      var r2 = await supabase.from('posts')
        .select('user_name, content, media_url, created_at')
        .eq('user_name', userName)
        .eq('media_type', AI_AGENT_MESSAGE_MARKER)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(AI_CHAT_HISTORY_LIMIT);
      msgRows = r2.data;
    }
    if (Array.isArray(msgRows)) {
      // desc 拿到的是最新在前，reverse 后变正序（旧→新），再 slice 取最近 15 条
      ctx.history = msgRows.slice().reverse().map(function(r) {
        var meta = parseMsgMeta(r);
        var content = String(r.content || '');
        if (meta.role === 'assistant') {
          try {
            var c = JSON.parse(r.content || '{}');
            if (c && typeof c.reply === 'string') content = c.reply;
          } catch(e) {
            try { console.warn('[AI-PARSE] parseMsgMeta error:', e && e.message); } catch(ee) {}
          }
        }
        // ★ 缓存优化：标准化空白字符，确保历史消息在重新加载时字符串完全一致
        // 否则 unicode 空白/换行差异会导致缓存前缀不匹配
        var normalized = content.replace(/\r\n/g, '\n').replace(/[\u00A0\u2003\u2002]/g, ' ').replace(/[ \t]+/g, ' ').slice(0, AI_CHAT_HISTORY_MSG_MAX_CHARS);
        return { role: meta.role || 'user', content: normalized };
      });
    }
  } catch (e) {
    console.error('[AGENT-CHAT] loadAiContext exception:', e.message);
  }
  return ctx;
}

// ★ M: 深度思考模式端点处理 — SSE 长连接 + 多 agent 调度
//   路径: POST /api/agent/chat (deep_think=true 时)
//   流程: 限流 → 验证 → 上下文 → runMultiAgentFlow (Planner→Workers→Synthesizer) → 保存 → done
async function handleDeepThinkChat(req, res) {
  var userName = req.userName;
  var clientReqId = req.body && req.body.client_request_id;
  var startTime = Date.now();
  var aborted = false;
  var _controller, _heartbeatTimer;

  // 取消 token — 用于 /api/agent/chat/cancel
  var cancelToken = { cancelled: false, userName: userName };
  var convId = String(req.body && req.body.conversation_id || '').trim();
  if (!convId) convId = genConvId();
  if (!/^[A-Z0-9\-]{6,}$/i.test(convId)) convId = genConvId();
  activeDeepThinkJobs.set(convId, cancelToken);

  function safeEnd() { if (!res.writableEnded) { try { res.end(); } catch (e) {} } }
  function sseSend(obj) { if (!res.writableEnded) { try { writeSse(res, obj); } catch (e) {} } }

  req.on('close', function() {
    aborted = true;
    cancelToken.cancelled = true;
    try { console.log('[DEEP-THINK] client disconnected, reqId:', clientReqId || '?', 'convId:', convId); } catch (e) {}
    try { clearInterval(_heartbeatTimer); } catch (e) {}
    activeDeepThinkJobs.delete(convId);
  });

  try {
    // 1. 用户级限流
    var rl = checkAiUserRateLimit(userName);
    if (!rl.allowed) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      sseSend({ type: 'error', error: rl.reason === 'hourly_limit' ? 'AI 聊天太频繁了，休息一下' : (rl.reason === 'concurrent' ? '请等待上一个请求完成' : '今日 AI 聊天次数已达上限') });
      activeDeepThinkJobs.delete(convId);
      return safeEnd();
    }

    // 2. 验证输入
    var message = validateString(req.body && req.body.message, AI_CHAT_MESSAGE_MAX_LEN, '消息内容');
    if (message && message.error) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      sseSend({ type: 'error', error: message.error });
      activeDeepThinkJobs.delete(convId);
      return safeEnd();
    }
    if (!message) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      sseSend({ type: 'error', error: '消息内容不能为空' });
      activeDeepThinkJobs.delete(convId);
      return safeEnd();
    }

    // ★ 立即设置 SSE headers 并发送 meta + 启动心跳, 让前端秒级收到响应
    // 之前 Supabase 调用阻塞了 meta 推送, 导致前端要等 5-20 秒才看到"思考中..."
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    if (aborted) { activeDeepThinkJobs.delete(convId); return safeEnd(); }
    sseSend({ type: 'meta', conversation_id: convId, deep_think: true, start_time: startTime });
    _heartbeatTimer = setInterval(function() {
      if (!res.writableEnded) {
        sseSend({ type: 'heartbeat', elapsed_ms: Date.now() - startTime });
      }
    }, 1500);

    // 3. 提取消息中嵌入的文件 (base64 → 文本)
    message = await extractEmbeddedFiles(message);

    // 4. 读取配置和上下文
    var config = await getAiConfig();
    var ctx = await loadAiContext(userName, convId);
    if (aborted) { activeDeepThinkJobs.delete(convId); return safeEnd(); }

    // ★ P 改: 提前计算思考程度 (后面 usage 和 done 事件也要用)
    var clientThinkingMode = (req.body && req.body.thinking_mode) || '';
    var finalThinkingMode = clientThinkingMode ||
      (config && config.deep_think && config.deep_think.default_thinking_mode) ||
      'max';
    if (['low', 'medium', 'high', 'max'].indexOf(finalThinkingMode) < 0) finalThinkingMode = 'max';

    // ★ 缓存检查: exact-match, TTL 5分钟
    var cacheKey = userName + '::' + message + '::' + finalThinkingMode;
    var cachedHit = aiResponseCache.get(cacheKey);
    if (cachedHit && cachedHit.expiresAt > Date.now()) {
      console.log('[AI-CACHE] 缓存命中, 直接返回');
      var nowTs = Date.now();
      var cachedContent = cachedHit.content;
      var cachedUsage = cachedHit.usage || null;
      var cachedAgentCount = cachedHit.agent_count || 1;
      // ★ 缓存命中也要把消息保存到 DB (否则用户重进看不到), 用原始 thinking_log
      try {
        var cacheExtra = {
          deep_think: true,
          agent_count: cachedAgentCount,
          planner: cachedHit.planner || null,
          worker_results: cachedHit.worker_results || [],
          thinking_log: cachedHit.thinking_log || [],
          think_duration_ms: cachedHit.think_duration_ms || 0
        };
        await supabase.from('posts').insert([
          {
            user_name: userName,
            content: message,
            media_type: AI_AGENT_MESSAGE_MARKER,
            media_url: buildMsgMeta('user', convId, null, null, 1),
            actor_key: 'ai_msg_conv_' + convId + '_user_' + userName + '_' + nowTs
          },
          {
            user_name: userName,
            content: cachedContent,
            media_type: AI_AGENT_MESSAGE_MARKER,
            media_url: buildMsgMeta('assistant', convId, cachedUsage, '', 2, null, cacheExtra.think_duration_ms, cacheExtra),
            actor_key: 'ai_msg_conv_' + convId + '_agent_' + userName + '_' + (nowTs + 1)
          }
        ]);
      } catch (e) { try { console.error('[AI-CACHE] save on hit failed:', e && e.message); } catch (_) {} }
      sseSend({
        type: 'done',
        content: cachedContent,
        sanitized_content: cachedContent,
        conversation_id: convId,
        deep_think: true,
        thinking_mode: finalThinkingMode,
        model: DEEPSEEK_MODEL_REASONER,
        usage: cachedUsage,
        agent_count: cachedAgentCount,
        search_count: 0,
        search_expires_at: 0,
        duration_ms: 0,
        remaining: { hour: rl.remainingHour, day: rl.remainingDay }
      });
      activeDeepThinkJobs.delete(convId);
      return safeEnd();
    }

    // 6. 运行多 agent 流程
    var flowResult = null;
    try {

        // ★ P 改: 根据思考程度选择单智能体或多人能体, 并差异化传参 (参数从 config 读取)
        var dt = (config && config.deep_think) || {};
        if (finalThinkingMode === 'max') {
          // max → 多智能体 (Planner→Workers→Synthesizer)
          sseSend({ type: 'deep_think_stage', stage: 'init', message: '深度研究已启动, Planner 分析中...' });
          flowResult = await runMultiAgentFlow({
            res: res, userName: userName, message: message, convId: convId,
            config: config, ctx: ctx, startTime: startTime,
            cancelToken: cancelToken, thinking_mode: finalThinkingMode
          });
        } else {
          // low/medium/high → 单智能体, 差异化参数 (从 config 读取, 可后台自定义)
          var agentOpts = {
            res: res, userName: userName, message: message, convId: convId,
            config: config, ctx: ctx, startTime: startTime,
            cancelToken: cancelToken, thinking_mode: finalThinkingMode
          };
          if (finalThinkingMode === 'low') {
            agentOpts.disableSearch = true;
            agentOpts.max_tool_rounds = parseInt(dt.low_max_tool_rounds) || 0;
            agentOpts.max_tokens = parseInt(dt.low_max_tokens) || 4096;
            agentOpts.answerLengthHint = 'short';
          } else if (finalThinkingMode === 'medium') {
            agentOpts.disableSearch = false;
            agentOpts.max_tool_rounds = parseInt(dt.medium_max_tool_rounds) || 2;
            agentOpts.max_tokens = parseInt(dt.medium_max_tokens) || 16384;
            agentOpts.answerLengthHint = 'normal';
          } else {
            agentOpts.disableSearch = false;
            agentOpts.max_tool_rounds = parseInt(dt.high_max_tool_rounds) || 4;
            agentOpts.max_tokens = parseInt(dt.high_max_tokens) || 32768;
            agentOpts.answerLengthHint = 'long';
          }
          flowResult = await runDeepThinkAgent(agentOpts);
        }
    } catch (e) {
      console.error('[DEEP-THINK] flow exception:', e && e.message);
      // ★ U3: 降级兜底 — 深度思考失败时, 用简化单智能体 (无工具/低思考) 尝试直接回答
      try {
        sseSend({ type: 'deep_think_stage', stage: 'agent', message: '深度研究遇到问题, 降级为快速回复...' });
        var fallbackCorePrompt = buildAiCorePrompt(config);
        var fallbackPrompt = fallbackCorePrompt + '\n\n用户问题: ' + message + '\n\n直接给出有深度的答案。';
        var fallbackResult = await callDeepSeek(
          [{ role: 'system', content: fallbackPrompt + (buildHistoryContext(ctx, message) || '') }],
          { thinking_mode: 'low', max_tokens: 4096 }
        );
        flowResult = {
          cancelled: false,
          finalContent: (fallbackResult.content || '') + '\n\n（深度研究模式暂时不可用, 以上为降级回复）',
          planner: { complexity: 'low', reasoning: '降级回复', agent_count: 1, agents: [{ role: 'AI 智能体', need_search: false }] },
          worker_results: [{ role: 'AI 智能体', status: 'success', elapsed_ms: 0, content: fallbackResult.content || '' }],
          thinking_log: [],
          usage: fallbackResult.usage,
          model: fallbackResult.model || DEEPSEEK_MODEL_REASONER,
          search_count: 0, search_results: [], search_query: '',
          sources: [], queries: [], synth_usage: fallbackResult.usage
        };
      } catch (fallbackErr) {
        console.error('[DEEP-THINK] fallback also failed:', fallbackErr && fallbackErr.message);
        try { clearInterval(_heartbeatTimer); } catch (e2) {}
        sseSend({ type: 'error', error: '深度研究失败: ' + (e && e.message || '未知错误') });
        activeDeepThinkJobs.delete(convId);
        return safeEnd();
      }
    }

    try { clearInterval(_heartbeatTimer); } catch (e) {}
    if (aborted) { activeDeepThinkJobs.delete(convId); return safeEnd(); }

    // 7. 清洗最终内容 (R 架构: 单智能体直接 finalContent; M 架构: synth_content)
    //   兼容: runDeepThinkAgent 返回 finalContent, runMultiAgentFlow 返回 synth_content
    var _rawContent = flowResult.finalContent || flowResult.synth_content || '';
    var finalContent = sanitizeAssistantVisibleText(_rawContent);
    if (!finalContent) finalContent = '（深度研究未生成内容, 请重试）';

    // 8. 构造 searchMeta
    var nowTs = Date.now();
    var searchMetaToStore = null;
    if (flowResult.sources && flowResult.sources.length > 0) {
      searchMetaToStore = {
        count: flowResult.sources.length,
        query: (flowResult.queries && flowResult.queries[0]) || message,
        queries: (flowResult.queries || []).slice(0, 10),
        results: flowResult.sources.slice(0, 50),
        expires_at: nowTs + 86400000
      };
    }

    // 9. 构造 usage
    var synthUsage = flowResult.synth_usage || null;
    var usageToStore = Object.assign({}, synthUsage || {}, {
      thinking_mode: finalThinkingMode,
      model: flowResult.model || DEEPSEEK_MODEL_REASONER,
      deep_think: true,
      agent_count: (flowResult.planner && flowResult.planner.agent_count) || 1
    });

    // 10. 保存到 messages
    if (!aborted) {
      try {
        var totalDurationMs = Date.now() - startTime;  // ★ O 提前到这里
        // ★ O 修复 Bug 4: 构造 extra 给 buildMsgMeta, 让历史消息能恢复 think_duration_ms + thinking_log
        // ★ 合并同角色的连续 thinking_chunk, 避免保存数百个单字条目
        var rawThinkingLog = flowResult.thinking_log || [];
        var mergedThinkingLog = [];
        for (var tli = 0; tli < rawThinkingLog.length; tli++) {
          var rtl = rawThinkingLog[tli];
          var last = mergedThinkingLog[mergedThinkingLog.length - 1];
          if (last && last.agent_role === (rtl.agent_role || 'AI 智能体') && last.round === (rtl.round || 0)) {
            last.chunk = (last.chunk || '') + (rtl.chunk || '');
          } else {
            mergedThinkingLog.push({ agent_role: rtl.agent_role || 'AI 智能体', chunk: rtl.chunk || '', round: rtl.round || 0 });
          }
        }
        var chatMode = (req.body && req.body.chat_mode) || 'normal';
        var deepThinkExtra = {
          deep_think: true,
          chat_mode: chatMode,
          agent_count: (flowResult.planner && flowResult.planner.agent_count) || 1,
          planner: flowResult.planner || null,
          worker_results: (flowResult.worker_results || []).map(function(w) { return { role: w.role, status: w.status, elapsed_ms: w.elapsed_ms || 0 }; }),
          thinking_log: mergedThinkingLog,
          think_duration_ms: totalDurationMs
        };
        await supabase.from('posts').insert([
          {
            user_name: userName,
            content: message,
            media_type: AI_AGENT_MESSAGE_MARKER,
            media_url: buildMsgMeta('user', convId, null, null, 1),
            actor_key: 'ai_msg_conv_' + convId + '_user_' + userName + '_' + nowTs
          },
          {
            user_name: userName,
            content: finalContent,
            media_type: AI_AGENT_MESSAGE_MARKER,
            media_url: buildMsgMeta('assistant', convId, usageToStore, '', 2, searchMetaToStore, totalDurationMs, deepThinkExtra),
            actor_key: 'ai_msg_conv_' + convId + '_agent_' + userName + '_' + (nowTs + 1)
          }
        ]);
      } catch (e) {
        console.error('[DEEP-THINK] save messages failed:', e.message);
      }
    }

    // ★ 写入缓存 (含 thinking_log, 让缓存命中也能保存完整历史)
    if (!aborted && finalContent && !flowResult.cancelled) {
      try {
        var cacheThinkingLog = Array.isArray(flowResult.thinking_log) ? flowResult.thinking_log : [];
        aiResponseCache.set(cacheKey, {
          content: finalContent,
          usage: synthUsage,
          agent_count: (flowResult.planner && flowResult.planner.agent_count) || 1,
          planner: flowResult.planner || null,
          worker_results: Array.isArray(flowResult.worker_results) ? flowResult.worker_results.map(function(w){ return { role: w.role, status: w.status, elapsed_ms: w.elapsed_ms || 0 }; }) : [],
          thinking_log: cacheThinkingLog,
          think_duration_ms: totalDurationMs,
          expiresAt: Date.now() + AI_CACHE_TTL_MS
        });
        limitAiCacheSize();
      } catch (e) {}
    }

    // 11. 推 done 事件
    if (!aborted) {
      sseSend({
        type: 'done',
        content: finalContent,
        sanitized_content: finalContent,
        conversation_id: convId,
        deep_think: true,
        thinking_mode: finalThinkingMode,
        model: flowResult.model || DEEPSEEK_MODEL_REASONER,
        usage: synthUsage,
        agent_count: (flowResult.planner && flowResult.planner.agent_count) || 1,
        planner: flowResult.planner || null,
        worker_results: (flowResult.worker_results || []).map(function(w) { return { role: w.role, status: w.status, elapsed_ms: w.elapsed_ms || 0 }; }),
        // ★ O 修复 Bug 2: 思考过程日志 (前端展示)
        thinking_log: flowResult.thinking_log || [],
        // ★ O 修复 Bug 4: 倒计时 (前端展示已思考 X 秒)
        think_duration_ms: totalDurationMs,
        search_count: flowResult.sources ? flowResult.sources.length : 0,
        search_query: (flowResult.queries && flowResult.queries[0]) || '',
        search_results: flowResult.sources ? flowResult.sources.slice(0, 50) : [],
        search_expires_at: nowTs + 86400000,
        duration_ms: totalDurationMs,
        remaining: { hour: rl.remainingHour, day: rl.remainingDay }
      });
    }
    activeDeepThinkJobs.delete(convId);
    return safeEnd();
  } catch (e) {
    console.error('[DEEP-THINK] handleDeepThinkChat exception:', e && e.message);
    try { clearInterval(_heartbeatTimer); } catch (e2) {}
    try {
      if (!res.writableEnded) {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream');
        }
        sseSend({ type: 'error', error: '深度研究异常: ' + (e && e.message || '请稍后重试') });
      }
    } catch (e3) {}
    activeDeepThinkJobs.delete(convId);
    return safeEnd();
  }
}

// POST /api/agent/chat/cancel - 取消正在进行的深度思考
app.post('/api/agent/chat/cancel', authenticateUser, async (req, res) => {
  try {
    var convId = String(req.body && req.body.conversation_id || '').trim();
    if (!convId) return res.status(400).json({ error: 'conversation_id required' });
    if (!/^[A-Z0-9\-]{6,}$/i.test(convId)) return res.status(400).json({ error: 'conversation_id 格式无效' });
    var job = activeDeepThinkJobs.get(convId);
    if (job) {
      if (job.userName && job.userName !== req.userName) {
        return res.status(403).json({ error: '无权取消其他用户的深度思考' });
      }
      job.cancelled = true;
      return res.json({ ok: true, cancelled: true });
    }
    res.json({ ok: true, cancelled: false, message: 'no active deep think job' });
  } catch (e) {
    res.status(500).json({ error: 'cancel failed' });
  }
});

// POST /api/agent/chat
app.post('/api/agent/chat', authenticateUser, rateLimit(3600000, AI_CHAT_HOURLY_IP_LIMIT), async (req, res) => {
  var aborted = false;
  req.on('close', function() { aborted = true; });

  // ★ M: 深度思考模式分支 — 走 SSE 长连接 + 多 agent 流程
  if (req.body && req.body.deep_think === true) {
    return handleDeepThinkChat(req, res);
  }

  try {
    var userName = req.userName;

    // 1. 用户级限流
    var rl = checkAiUserRateLimit(userName);
    if (!rl.allowed) {
      return res.status(429).json({
        error: rl.reason === 'hourly_limit' ? 'AI 聊天太频繁了，休息一下' : (rl.reason === 'concurrent' ? '请等待上一个请求完成' : '今日 AI 聊天次数已达上限'),
        remainingHour: rl.remainingHour,
        remainingDay: rl.remainingDay
      });
    }

    // 2. 验证输入
    var message = validateString(req.body && req.body.message, AI_CHAT_MESSAGE_MAX_LEN, '消息内容');
    if (message && message.error) return res.status(400).json({ error: message.error });
    if (!message) return res.status(400).json({ error: '消息内容不能为空' });
    message = await extractEmbeddedFiles(message);

    // 3. 会话管理
    var convId = String(req.body && req.body.conversation_id || '').trim();
    if (!convId) convId = genConvId();
    // 校验格式（字母数字 + 短横线）
    if (!/^[A-Z0-9\-]{6,}$/i.test(convId)) convId = genConvId();

    // 4. 读取全局 AI 配置
    var config = await getAiConfig();

    // 5. 读取上下文（按 conversation_id 过滤）
    var ctx = await loadAiContext(userName, convId);

    // 5b. 当前时间
    var _now = new Date();
    var _currentDateISO = _now.toISOString();
    var _currentDateCN = _now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

    // 6. 组装 system prompt
    var corePrompt = buildAiCorePrompt(config);
    var dynamicContext = buildAiDynamicContext(ctx, config);

    // 7. 组装 messages
    var messages = [
      { role: 'system', content: corePrompt },
      { role: 'system', content: dynamicContext },
      { role: 'system', content: '【当前时间】现在是北京时间：' + _currentDateCN + '。ISO 时间：' + _currentDateISO + '。回答"今天、现在、最新、刚刚、当前"等问题时，必须以这个时间为准。不能编造其他日期。如果搜索结果与当前日期不一致，要明确指出可能是旧内容。' }
    ];
    var histSlice = ctx.history.slice(-AI_CHAT_HISTORY_LIMIT);
    for (var h = 0; h < histSlice.length; h++) {
      messages.push({ role: histSlice[h].role, content: histSlice[h].content });
    }
    messages.push({ role: 'user', content: message });

    // 8. 调用 DeepSeek
    //    ★ P0 关键修复：启用 tools（search_web / get_weather / get_current_time）
    //       AI 可以自己决定是否调用搜索
    var reply = '';
    var usage = null;
    // ★ M: fallback 'off' 改成 'max'，让 AI 默认深度思考
    var thinkingMode = (req.body && req.body.thinking_mode) || (config.model && config.model.default_thinking_mode) || 'max';
    if (['off', 'low', 'medium', 'high', 'max'].indexOf(thinkingMode) < 0) thinkingMode = 'max';
    var reasoning = '';
    var toolCallsInfo = [];
    var allowWebSearch = config.allow_web_search === true || (config.search && config.search.allow_web_search === true);
    // 收集 search_web 的真实 results（用于 1 天后徽章 + 结果列表展示）
    var searchResultsCollected = [];
    var searchQueriesCollected = [];
    var deepSeekOptions = { thinking_mode: thinkingMode };
    if (allowWebSearch) {
      deepSeekOptions.tools = AI_TOOLS;
      deepSeekOptions.tool_choice = 'auto';
      deepSeekOptions.max_tool_rounds = 4;
      // ★ wrapper：拦截 search_web 的真实 results 数组
      deepSeekOptions.tool_executor = async function(toolCall) {
        var res = await executeToolCall(toolCall);
        if (res && res.tool_name === 'search_web') {
          if (res.content) {
            try {
              var parsedResults = JSON.parse(res.content);
              if (Array.isArray(parsedResults)) searchResultsCollected = searchResultsCollected.concat(parsedResults);
            } catch (e) {}
          } else if (Array.isArray(res.results)) {
            searchResultsCollected = searchResultsCollected.concat(res.results);
          }
          try {
            var argsStr = toolCall && toolCall.function && toolCall.function.arguments;
            if (argsStr) {
              var parsed = JSON.parse(argsStr);
              if (parsed && parsed.query) searchQueriesCollected.push(String(parsed.query).slice(0, 100));
            }
          } catch (e) {}
        }
        return res;
      };
    }
    try {
      var result = await callDeepSeek(messages, deepSeekOptions);
      if (aborted) return;
      reply = result.content;
      usage = result.usage;
      toolCallsInfo = result.tool_calls_info || [];
      if (thinkingMode !== 'off') reasoning = result.reasoning || '';
    } catch (e) {
      if (aborted) return;
      console.error('[AGENT-CHAT] callDeepSeek failed:', e && e.message);
      return res.status(502).json({
        error: 'AI 调用失败，请稍后再试',
        detail: e && e.message ? String(e.message).slice(0, 200) : ''
      });
    }
    if (typeof reply !== 'string' || !reply) reply = '（AI 没有回复，请稍后再试）';
    if (reply.length > 4000) reply = reply.slice(0, 4000) + '\n…（已截断）';
    reply = sanitizeAssistantVisibleText(reply);

    // 9. 保存消息（含 conversation_id，不物理删除旧数据）
    if (aborted) return;
    var nowIso = new Date().toISOString();
    var nowTs = Date.now();
    // 把 thinking_mode + model 也写进 usage，方便后台按 conv 统计
    var usedModel = (result && result.model) || DEEPSEEK_MODEL_REASONER;
    var usageToStore = Object.assign({}, usage || {}, {
      thinking_mode: thinkingMode,
      model: usedModel
    });
    // ★ P1 关键修复：构造 searchMeta 存到消息 meta
    //   1 天过期策略：search_expires_at = now + 86400000
    //   1 天内：完整 results 数组
    //   1 天后：前端只显示"已联网搜索 · N 条"徽章
    var searchMetaToStore = null;
    if (searchResultsCollected && searchResultsCollected.length > 0) {
      searchMetaToStore = {
        count: searchResultsCollected.length,
        query: searchQueriesCollected.length > 0 ? searchQueriesCollected[0] : '',
        queries: searchQueriesCollected.slice(0, 10),
        results: searchResultsCollected.slice(0, 50),  // 最多 50 条
        expires_at: nowTs + 86400000  // 1 天后过期
      };
      // 把搜索次数也记到 usage（方便后台统计）
      try { usageToStore.search_call_count = (toolCallsInfo || []).filter(function(t) { return t && t.name === 'search_web'; }).length; } catch (e) {}
    }
    try {
      await supabase.from('posts').insert([
        {
          user_name: userName,
          content: message,
          media_type: AI_AGENT_MESSAGE_MARKER,
          media_url: buildMsgMeta('user', convId, null, null, 1),
          actor_key: 'ai_msg_conv_' + convId + '_user_' + userName + '_' + nowTs
        },
        {
          user_name: userName,
          content: reply,
          media_type: AI_AGENT_MESSAGE_MARKER,
          media_url: buildMsgMeta('assistant', convId, usageToStore, reasoning, 2, searchMetaToStore),
          actor_key: 'ai_msg_conv_' + convId + '_agent_' + userName + '_' + (nowTs + 1)
        }
      ]);
    } catch (e) {
      console.error('[AGENT-CHAT] save messages failed:', e.message);
    }

    // 10. 返回
    //     ★ 返回时带 tool_calls_info 和 search_count，前端可以立即渲染徽章（不等下次 loadHistory）
    var respBody = {
      ok: true,
      reply: reply,
      reasoning: reasoning,
      conversation_id: convId,
      usage: usage,
      model: usedModel,
      thinking_mode: thinkingMode,
      tool_calls_info: toolCallsInfo,
      search_count: searchResultsCollected.length,
      search_query: searchQueriesCollected.length > 0 ? searchQueriesCollected[0] : '',
      remaining: { hour: rl.remainingHour, day: rl.remainingDay }
    };
    if (searchResultsCollected.length > 0) {
      // 1 天内返回完整 results 给前端立即渲染
      respBody.search_results = searchResultsCollected.slice(0, 50);
      respBody.search_expires_at = nowTs + 86400000;
    }
    return res.json(respBody);
  } catch (e) {
    console.error('[AGENT-CHAT] exception:', e.message);
    if (e.message && e.message.indexOf('不支持思考模式') >= 0) {
      return res.status(400).json({ error: e.message });
    }
    return res.status(500).json({ error: '聊天失败，请稍后再试' });
  }
});

// POST /api/agent/chat/stream - 流式 SSE 输出
app.post('/api/agent/chat/stream', authenticateUser, rateLimit(3600000, AI_CHAT_HOURLY_IP_LIMIT), async (req, res) => {
  var userName = req.userName;
  var aborted = false;
  var clientReqId = req.body && req.body.client_request_id;
  var streamSeq = 0;
  
  var _controller, _reader, _timer, _fcTimer;
  function safeEnd() { if (!res.writableEnded) res.end(); }
  
  req.on('close', function() {
    aborted = true;
    try { console.log('[AGENT-STREAM] client disconnected, reqId:', clientReqId || '?'); } catch (e) {}
    try { _controller && _controller.abort(); } catch (e) {}
    try { _reader && _reader.cancel(); } catch (e) {}
    try { clearTimeout(_timer); } catch (e) {}
    try { clearTimeout(_fcTimer); } catch (e) {}
  });
  
  try {
    // 限流
    var rl = checkAiUserRateLimit(userName);
    if (!rl.allowed) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      writeSse(res, { type: 'error', error: rl.reason === 'hourly_limit' ? 'AI 聊天太频繁了，休息一下' : '今日 AI 聊天次数已达上限' });
      return safeEnd();
    }
    
    // 验证输入
    var message = validateString(req.body && req.body.message, AI_CHAT_MESSAGE_MAX_LEN, '消息内容');
    if (message && message.error) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      writeSse(res, { type: 'error', error: message.error });
      return safeEnd();
    }
    if (!message) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      writeSse(res, { type: 'error', error: '消息内容不能为空' });
      return safeEnd();
    }
    message = await extractEmbeddedFiles(message);
    if (aborted) return safeEnd();
    
    // 会话管理
    var convId = String(req.body && req.body.conversation_id || '').trim();
    if (!convId) convId = genConvId();
    if (!/^[A-Z0-9\-]{6,}$/i.test(convId)) convId = genConvId();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    if (aborted) return safeEnd();

    writeSse(res, { type: 'meta', conversation_id: convId });
    if (aborted) return safeEnd();
    
    // 立即发送思考开始信号, 让前端显示"思考中..."而非干等
    writeSse(res, { type: 'reasoning_start', message: '正在分析问题...', start_time: Date.now() });
    if (aborted) return safeEnd();
    
    // 读取全局 AI 配置 + 上下文 (并行)
    var configPromise = getAiConfig();
    var ctxPromise = loadAiContext(userName, convId);
    var [config, ctx] = await Promise.all([configPromise, ctxPromise]);
    
    // 当前时间上下文
    var _now = new Date();
    var _currentDateISO = _now.toISOString();
    var _currentDateCN = _now.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });

    // 组装 system prompt — 缓存优化：corePrompt 必须完全固定且放在最前
    var corePrompt = buildAiCorePrompt(config);
    var dynamicContext = buildAiDynamicContext(ctx, config);

    // ★ 缓存优化：消息顺序 = corePrompt(固定) → history(稳定) → user(新) → [time/weather 仅必要时后置]
    // 当前时间从 system 提前位移到末尾，且仅在时间相关查询时注入，避免每分钟破坏缓存前缀
    var messages = [
      { role: 'system', content: corePrompt }
    ];
    if (dynamicContext) messages.push({ role: 'system', content: dynamicContext });

    var histSlice = ctx.history.slice(-AI_CHAT_HISTORY_LIMIT);
    for (var h = 0; h < histSlice.length; h++) {
      messages.push({ role: histSlice[h].role, content: histSlice[h].content });
    }

    // 思考模式
    // ★ M: fallback 'off' 改成 'max'，让 AI 默认深度思考
    var thinkingMode = (req.body && req.body.thinking_mode) || (config.model && config.model.default_thinking_mode) || 'max';
    if (['off', 'low', 'medium', 'high', 'max'].indexOf(thinkingMode) < 0) thinkingMode = 'max';
    var useThinking = thinkingMode !== 'off';
    var allowSearch = !!(config && (config.allow_web_search === true || (config.search && config.search.allow_web_search === true)));

    // ★ P3 修复 bug 3: 提前预加载 useThinking 模式下的搜索结果, 与后续 fetch DeepSeek 完全并行
    //   之前在 line 8560-8595 才 await searchWeb, 阻塞 5-15s, 导致首字延迟 = searchWeb + max 思考 = 15-25s
    //   现在在思考模式决定后立即 fire (不 await), 跟 config/ctx 加载 + 后续 fetch DeepSeek 同时进行
    var _preloadedSearchPromise = null;
    var _preloadedSearchResults = null;
    var _preloadedQuery = '';
    if (useThinking && allowSearch && !aborted) {
      // 简单快速检测搜索意图 (与 line 8537-8556 needsWebSearch 取最常用关键词, 涵盖 90%+ 场景)
      var _quickSearchHint = /搜索|查一下|搜一下|搜搜|最新|今天|现在|当前|实时|新闻|资讯|天气|温度|价格|多少钱|汇率|攻略|旅游|景点|推荐|百科|介绍|区别|对比|vs|排行|教程|方法|怎么办|如何|怎么|政策|公告|电影|电视剧|综艺|纪录片|动漫|动画|番剧|iPhone|iPad|Mac|安卓|苹果|三星|华为|小米|oppo|vivo|荣耀|百度|google|谷歌|查查|查资料/i.test(message);
      if (_quickSearchHint) {
        // 复用 line 8561-8573 的 _psQuery 计算逻辑 (剥前缀)
        var _psQuery = message.slice(0, 80);
        var _psStripped = message.replace(/^(?:搜索|查一下|搜一下|搜搜|百度|google|谷歌|查询|查查|查资料)\s*/i, '').trim().slice(0, 150);
        if (_psStripped.length >= 3) {
          _psQuery = _psStripped;
        }
        _preloadedQuery = _psQuery;
        // fire searchWeb (不 await), 与 fetch DeepSeek 同步进行
        _preloadedSearchPromise = searchWeb(_psQuery, 20).then(function(r) {
          _preloadedSearchResults = r;
          return r;
        }).catch(function(e) {
          try { console.error('[AGENT-STREAM] preload search error:', e && e.message); } catch (_) {}
          return null;
        });
      }
    }

    // 天气查询（Open-Meteo 免费 API）— 结果后置到 user 之后，不破坏缓存
    var isWeatherQuery = /天气|温度|下雨|降雨|刮风|风速|湿度|气温|穿什么/i.test(message);
    var weatherResult = null;
    if (isWeatherQuery && !aborted) {
      weatherResult = await queryWeather(message);
    }

    // ★ 时间敏感词检测：仅当用户问"今天/现在/最新/刚刚/当前"等才注入时间，且放在 user 之后
    var isTimeSensitive = /今天|现在|最新|刚刚|当前|今日|今晚|今早|明天|昨天|本周|本月|今年|几点|什么时候|何时/i.test(message);
    var timeContext = '';
    if (isTimeSensitive || isWeatherQuery) {
      timeContext = '\n\n【当前时间】北京时间：' + _currentDateCN + ' (ISO: ' + _currentDateISO + ')。回答时间相关问题时以此为准，不能编造其他日期。';
    }

    var usedModel = DEEPSEEK_MODEL_REASONER;
    if (aborted) return safeEnd();

    messages.push({ role: 'user', content: message });

    // ★ 缓存优化：动态内容（天气结果、时间）放在 user 之后，破坏的只是尾部一小段缓存
    if (weatherResult) {
      messages.push({ role: 'user', content: weatherResult });
    }
    if (timeContext) {
      messages.push({ role: 'user', content: timeContext });
    }

    // console.log('[AGENT-STREAM] thinking_mode=', thinkingMode, 'useThinking=', useThinking, 'model=', usedModel, 'reasoning_effort=', useThinking ? thinkingMode : 'off', '|| message_len=', message.length, 'history_messages=', messages.length);

    // ===== Function Calling：让 AI 自主决定调用工具 =====
    // 快速检测：只有明显需要搜索的消息才走 FC 非流式调用，普通对话直接秒回
    var needsFcCheck = allowSearch && !useThinking && !aborted;
    // 短消息(<=10字符如"666""你好""哈哈")不可能是搜索意图，跳过FC检查直接流式
    var isShortMsg = message.length <= 10;
    var fcQuickIntent = !isShortMsg && /搜索|查一下|搜一下|天气|温度|降雨|旅游|攻略|新闻|资讯|最新|多少钱|价格|汇率|百科|介绍|路线|营业|开放时间|比赛|比分|iPhone|苹果|发布|地震|台风|公告|政策|区别|对比|vs|VS|哪个好|推荐|最佳|怎么[样做走]|如何/i.test(message);
    var fcWeatherIntent = !weatherResult && /天气|温度|下雨|降雨|刮风|风速|湿度|气温|穿什么/i.test(message);
    needsFcCheck = needsFcCheck && (fcQuickIntent || fcWeatherIntent);
    var hasCalledTools = false;
    var hasFCFallbackContent = false;
    var fcFallbackContent = null;
    var fcFallbackUsage = null;

    if (needsFcCheck && !aborted) {
      var fcBody = {
        model: usedModel,
        messages: messages,
        stream: false,
        tools: AI_TOOLS,
        tool_choice: 'auto'
      };

      var fcController = new AbortController();
      _fcTimer = setTimeout(function() { fcController.abort(); }, 1000);

      try {
        var fcResp = await fetch(DEEPSEEK_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_API_KEY },
          body: JSON.stringify(fcBody),
          signal: fcController.signal
        });
        clearTimeout(_fcTimer);

        if (fcResp.ok) {
          var fcData = await fcResp.json();
          var fcMessage = fcData && fcData.choices && fcData.choices[0] && fcData.choices[0].message;

          if (fcMessage && fcMessage.tool_calls && fcMessage.tool_calls.length > 0) {
            hasCalledTools = true;

            var toolCallsInfo = fcMessage.tool_calls.map(function(tc) {
              var a;
              try { a = JSON.parse(tc.function.arguments); } catch (e) { a = {}; }
              return { id: tc.id, name: tc.function.name, args: a };
            });
            res.write('data: ' + JSON.stringify({ type: 'tool_calls', tools: toolCallsInfo }) + '\n\n');

            messages.push({
              role: 'assistant',
              content: fcMessage.content || null,
              tool_calls: fcMessage.tool_calls
            });

            // 并行执行所有工具调用
            var toolResults = await Promise.all(fcMessage.tool_calls.map(function(tc) {
              return executeToolCall(tc).then(function(tr) {
                return { toolCallId: tc.id, toolResult: tr };
              });
            }));
            // 串行写入结果（SSE 保证顺序）
            for (var tri = 0; tri < toolResults.length; tri++) {
              var item = toolResults[tri];
              messages.push({ role: 'tool', tool_call_id: item.toolCallId, content: JSON.stringify(item.toolResult) });
              var trItems = null;
              try { trItems = JSON.parse(item.toolResult.content || '[]'); } catch(e) {
                try { console.warn('[AI-FC] parse tool result error:', e && e.message); } catch(ee) {}
              }
              res.write('data: ' + JSON.stringify({
                type: 'tool_result',
                tool_name: item.toolResult.tool_name || '',
                success: !item.toolResult.error,
                count: item.toolResult.results_count || 0,
                error: item.toolResult.error || null,
                location: item.toolResult.location || null,
                query: item.toolResult.query || null,
                items: trItems && trItems.length > 0 ? trItems.slice(0, 20) : null
              }) + '\n\n');
            }

            // 自动补全 + 搜索扩展：像多 Agent 并行工作
            if (!aborted) {
              var allResults = [];
              var allQueries = [];
              var firstQuery = '';
              for (var sci = 0; sci < messages.length; sci++) {
                var msgCheck = messages[sci];
                if (msgCheck.role === 'tool') {
                  try {
                    var parsed = JSON.parse(msgCheck.content || '{}');
                    if (parsed.tool_name === 'search_web') {
                      if (parsed.query) allQueries.push(parsed.query);
                      if (!firstQuery && parsed.query) firstQuery = parsed.query;
                      if (Array.isArray(JSON.parse(parsed.content || '[]'))) {
                        var items = JSON.parse(parsed.content || '[]');
                        items.forEach(function(item) { allResults.push(item); });
                      }
                    }
                  } catch(e) {
                    try { console.warn('[AI-SEARCH] search error:', e && e.message); } catch(ee) {}
                  }
                }
              }

              var parallelTasks = [];

              // 任务1：结果不足时自动补全
              if (allResults.length > 0 && allResults.length < 5 && firstQuery) {
                parallelTasks.push(
                  autoSupplementSearch(firstQuery, allResults.slice(), 20).then(function(supplemented) {
                    return supplemented.length > allResults.length ? supplemented.slice(allResults.length) : [];
                  })
                );
              }

              // 任务2：AI 只搜了 1-2 个词时，自动扩展多个方向并行搜索
              if (allQueries.length <= 2) {
                var expandedQueries = generateExpandedQueries(message, allQueries, 3);
                expandedQueries.forEach(function(eq) {
                  parallelTasks.push(
                    searchWeb(eq, 20).then(function(sr) {
                      return (sr && sr.results) || [];
                    })
                  );
                });
              }

              if (parallelTasks.length > 0) {
                var extraArrays = await Promise.all(parallelTasks);
                var existingUrls = {};
                allResults.forEach(function(r) { if (r.url) existingUrls[r.url] = true; });
                var newItems = [];
                extraArrays.forEach(function(arr) {
                  arr.forEach(function(r) {
                    if (r.url && !existingUrls[r.url] && r.title) {
                      existingUrls[r.url] = true;
                      newItems.push(r);
                    }
                  });
                });
                if (newItems.length > 0) {
                  var extraContent = JSON.stringify(newItems);
                  messages.push({ role: 'tool', tool_call_id: 'auto_expand', content: JSON.stringify({ tool_name: 'search_web', query: '多 Agent 并行搜索', results_count: newItems.length, content: extraContent }) });
                  res.write('data: ' + JSON.stringify({
                    type: 'tool_result',
                    tool_name: 'search_web',
                    success: true,
                    count: newItems.length,
                    error: null,
                    location: null,
                    query: '多 Agent 并行搜索',
                    items: newItems.slice(0, 20)
                  }) + '\n\n');
                }
              }
            }
          } else {
            hasFCFallbackContent = true;
            fcFallbackContent = fcMessage ? fcMessage.content || '' : '';
            fcFallbackUsage = fcData.usage || null;
          }
        } else {
          try {
            var fcErrData = await fcResp.json();
            var fcErrMsg = fcErrData && fcErrData.error && fcErrData.error.message ? String(fcErrData.error.message).slice(0, 200) : '';
            console.error('[AGENT-STREAM] FC API error', fcResp.status, fcErrMsg);
          } catch(e) {
            try { console.warn('[AI-FC] FC res text error:', e && e.message); } catch(ee) {}
          }
        }
      } catch (fcErr) {
        clearTimeout(_fcTimer);
        console.error('[AGENT-STREAM] FC error:', fcErr && fcErr.message);
      }
    }

    var _sharedSearchMeta;
    var reasoningStartedAt = 0;

    // FC fallback：AI 直接回答了，模拟流式输出
    if (hasFCFallbackContent && fcFallbackContent && !aborted) {
      var fcFallbackSanitized = sanitizeAssistantVisibleText(fcFallbackContent);
      if (fcFallbackSanitized) {
        var fcChunkSize = 20;
        for (var fcCi = 0; fcCi < fcFallbackSanitized.length; fcCi += fcChunkSize) {
          if (aborted) break;
          res.write('data: ' + JSON.stringify({ type: 'content', text: fcFallbackSanitized.slice(fcCi, fcCi + fcChunkSize) }) + '\n\n');
        }
        var fcModel = fcFallbackUsage && fcFallbackUsage.model ? fcFallbackUsage.model : usedModel;
        await finishStream(res, {
          contentBuffer: fcFallbackSanitized,
          reasoningBuffer: '',
          thinkingMode: 'off',
          useThinking: false,
          usedModel: fcModel,
          finishReason: 'stop',
          userName: userName,
          convId: convId,
          message: message,
          streamSeq: streamSeq,
          ctx: ctx,
          reasoningStartedAt: reasoningStartedAt,
          searchMeta: _sharedSearchMeta || null
        });
      }
      return safeEnd();
    }

    // _sharedSearchMeta 在非思考模式搜索或思考模式搜索中赋值
    var _sharedSearchMeta2;
    var reasoningStartedAt2 = 0;

    // 如果 FC 没启用或没触发 tool_calls，回退旧正则搜索注入
    if (!hasCalledTools && !aborted && allowSearch && !weatherResult && !useThinking) {
      var needsSearch = /最新|今天|现在|当前|刚刚|实时|新闻|资讯|天气|温度|价格|多少钱|汇率|政策|公告|开放时间|营业时间|百度|google|谷歌|iPhone|苹果发布|航班|地震|台风|比赛|比分|搜索|查一下|搜一下|查询|景点|旅游|攻略|推荐|怎么样|好不好|评价|评测|价格表/i.test(message);

      // 构建搜索关键词
      var searchQuery = message;
      var isSearchCmd = /搜索|查一下|搜一下|百度|google|谷歌|查询/i.test(message);
      if (isSearchCmd) {
        // 从当前消息中剥离"搜一下"等命令前缀，提取真实搜索内容
        var stripped = message.replace(/^(?:搜索|查一下|搜一下|百度|google|谷歌|查询)\s*/i, '').trim();
        if (stripped.length >= 3) {
          // 当前消息包含实际搜索内容，用剥离后的文本搜索（如"搜一下济州岛"→"济州岛"）
          searchQuery = stripped.slice(0, 150);
        } else {
          // 纯元指令（如只说"搜一下"）→ 回退到上一条用户消息
          for (var si = messages.length - 1; si >= 0; si--) {
            var pm = messages[si];
            if (pm.role === 'user' && pm.content !== message && pm.content) {
              searchQuery = String(pm.content).slice(0, 150);
              break;
            }
          }
        }
      }
      
      var srObj = null;
      var sResults = null;
      var sDiag = null;
      if (needsSearch && !aborted) {
        try {
          srObj = await searchWeb(searchQuery, 20);
          sResults = srObj && srObj.results ? srObj.results : [];
          sDiag = srObj && srObj.diagnostics ? srObj.diagnostics : null;
          // 结果不足时自动补全
          if (sResults && sResults.length > 0 && sResults.length < 5) {
            sResults = await autoSupplementSearch(searchQuery, sResults, 20);
          }
          sResults = cleanSearchResults(sResults, 20);
        } catch (e) { sResults = []; }
        _sharedSearchMeta = sResults && sResults.length > 0 ? {
          count: sResults.length,
          query: searchQuery,
          // ★ P1 关键修复：保存完整 results 数组，1 天后过期
          //   重新打开对话时仍可展开看标题/链接/摘要
          results: sResults.slice(0, 50),
          expires_at: Date.now() + 86400000
        } : null;
      }
      if (sResults && Array.isArray(sResults) && sResults.length) {
        var sCtx = '【联网搜索结果】\n搜索时间：' + _currentDateCN + '（北京时间）\n用户查询：' + searchQuery + '\n\n' +
          sResults.map(function(sr, si) { return (si + 1) + '. ' + (sr.title || '无标题') + '\n来源：' + (sr.source || 'web') + '\n发布时间：' + (sr.published_at || '未知') + '\n链接：' + (sr.url || '无') + '\n摘要：' + (sr.snippet || '无摘要'); }).join('\n\n') +
          '\n\n要求：必须优先使用以上搜索结果回答。不要在回答中列出来源、链接、网址等参考信息，直接给出答案内容即可。不能编造新闻、价格、天气、日期。';
        messages.push({ role: 'system', content: sCtx });
        res.write('data: ' + JSON.stringify({ type: 'search', count: sResults.length, results: sResults, diagnostics: sDiag || null, query: searchQuery }) + '\n\n');
      } else if (needsSearch) {
        var hasProviderErrors2 = sDiag && sDiag.provider_errors && sDiag.provider_errors.length > 0;
        var hasProviderMissing2 = sDiag && sDiag.missing_env && sDiag.missing_env.length > 0;
        if (hasProviderErrors2) {
          var errSum = sDiag.provider_errors.map(function(pe) { return pe.provider + ':' + pe.error; }).join(' / ');
          if (hasProviderMissing2) errSum += ' / 未配置:' + sDiag.missing_env.join(',');
          messages.push({ role: 'system', content: '【联网搜索】本次联网搜索失败（' + errSum + '）。不能编造实时信息。' });
          res.write('data: ' + JSON.stringify({ type: 'search_error', error: '联网搜索失败: ' + errSum, diagnostics: sDiag }) + '\n\n');
        } else {
          messages.push({ role: 'system', content: '【联网搜索】本次搜索没有返回有效结果。你必须如实告诉用户没有搜到。' });
          res.write('data: ' + JSON.stringify({ type: 'search', count: 0, results: [], diagnostics: sDiag, query: message }) + '\n\n');
        }
      }
    }

    // 共享搜索结果元数据在非思考模式搜索或思考模式搜索中赋值

    // ----- 多 Agent 协作：拆解问题 → 搜索 → 合成 -----
    // 需要管理员在后台开启 multi_agent，思考/非思考模式均可
    var multiAgentEnabled = config && config.model && config.model.multi_agent === true;
    // 思考模式下，先不阻塞stream，让 AI 立即开始思考，搜索并行进行
    if (multiAgentEnabled && allowSearch && !aborted && messages.length > 0 && !useThinking) {
      var daMsg = [
        { role: 'system', content: '你是一个问题分析专家。你的任务是把用户的问题拆解成2-3个最适合联网搜索的关键词短语，每个短语独立、具体、可直接用于搜索引擎。只返回JSON数组，不要多余内容。格式：["关键词1", "关键词2", "关键词3"]' },
        { role: 'user', content: message }
      ];
      try {
        var daCtrl = new AbortController();
        var daTimer = setTimeout(function() { daCtrl.abort(); }, 10000);
        var daResp = await fetch(DEEPSEEK_API_URL, {
          method: 'POST',
          signal: daCtrl.signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_API_KEY },
          body: JSON.stringify({ model: usedModel, messages: daMsg, stream: false, temperature: 0.3, max_tokens: 200 })
        });
        clearTimeout(daTimer);
        if (daResp.ok) {
          var daJson = await daResp.json();
          var daText = (daJson && daJson.choices && daJson.choices[0] && daJson.choices[0].message && daJson.choices[0].message.content) || '';
          var searchQueries = [];
          try { searchQueries = JSON.parse(daText); } catch (e) {
            var m = daText.match(/\[.*?\]/);
            if (m) try { searchQueries = JSON.parse(m[0]); } catch (e2) {}
          }
          if (Array.isArray(searchQueries) && searchQueries.length > 0 && searchQueries.length <= 5) {
            // 并行执行所有搜索
            var allResults = [];
            res.write('data: ' + JSON.stringify({ type: 'multi_agent', action: 'searching', queries: searchQueries }) + '\n\n');
            var searchPromises = searchQueries.map(function(q) {
              return searchWeb(String(q).trim(), 20).then(function(sr) {
                return (sr && Array.isArray(sr.results) ? sr.results : []).slice(0, 20);
              }).catch(function() { return []; });
            });
            var searchResults = await Promise.all(searchPromises);
            for (var si = 0; si < searchResults.length; si++) {
              allResults = allResults.concat(searchResults[si]);
            }
            if (allResults.length > 0) {
              allResults = cleanSearchResults(allResults, 20);
              var maCtx = '【多Agent协作搜索结果】\n搜索时间：' + _currentDateCN + '（北京时间）\n拆解问题：' + message + '\n搜索关键词：' + searchQueries.join('、') + '\n\n' +
                allResults.map(function(sr, idx) { return (idx + 1) + '. ' + (sr.title || '无标题') + '\n来源：' + (sr.source || 'web') + '\n链接：' + (sr.url || '无') + '\n摘要：' + (sr.snippet || '无摘要'); }).join('\n\n') +
                '\n\n要求：基于以上搜索结果回答。不要在回答中列出来源、链接、网址等参考信息，直接给出答案内容即可。';
              messages.push({ role: 'system', content: maCtx });
              _sharedSearchMeta = {
                count: allResults.length,
                query: message,
                results: allResults.slice(0, 50),
                expires_at: Date.now() + 86400000
              };
              res.write('data: ' + JSON.stringify({ type: 'search', count: allResults.length, results: allResults.slice(0, 20), query: message }) + '\n\n');
            }
          }
        }
      } catch (e) {
        console.error('[AGENT-MULTI] decompose error:', e.message);
      }
    }

    var content = '';
    var reasoning = '';
    var usageResult = null;
    var _toolSearchMeta = null;

    // 调用 DeepSeek（流式）
    if (aborted) return safeEnd();

    var MAX_TOOL_ROUNDS = 3;
    var toolRound = 0;
    var roundMessages = messages;
    // 跨轮次保留的推理内容（第一次流产生的，第二次流不会重复）
    var persistentReasoning = '';
    // 判断是否需要联网搜索：只有明确需要实时/网络信息才搜索
    function needsWebSearch(text) {
      var t = text.trim();
      // 太短不搜
      if (t.length <= 2) return false;
      // 纯符号/表情不搜
      if (/^[\s\-+=_*~#@!?.,。，、！…·、]+$/i.test(t)) return false;
      // 纯数字不搜
      if (/^\d+$/.test(t)) return false;
      // 纯问候/感谢/告别/语气（无论长短）
      if (/^(你好|您好|嗨|哈喽|hello|hi|hey|谢谢|感谢|再见|拜拜|晚安|早安|午安|在吗|在不在|嗯|哦|噢|啊|呀|哈哈|嘿嘿|嘻嘻|呵呵|好吧|好的|好的吧|好叭|行吧|可以|知道|明白|懂了|了解|收到|不错|棒|nice|great|good|ok|okay|fine|yes|no|thx|thanks|ty|拜|告辞|走了|溜了|睡了|吃饭|洗澡|忙|先这样|回头聊|回聊)$/i.test(t)) return false;
      
      // ↓↓↓ 白名单：只有包含以下关键词才触发搜索 ↓↓↓
      if (/搜索|查一下|搜一下|搜搜|百度查|谷歌查|查查|查资料/i.test(t)) return true;
      if (/最新|新闻|资讯|今天.*?(天气|温度|新闻)|现在.*?(时间|几点|天气)|当前.*?(汇率|价格|政策)|实时/i.test(t)) return true;
      if (/天气|温度|下雨|降雨|刮风|风速|湿度|气温|穿什么|多少度|台风|地震/i.test(t)) return true;
      if (/价格|多少钱|多少钱一|什么价|报价|售价|行情|房价|股价|汇率|兑换|利率/i.test(t)) return true;
      if (/攻略|旅游|景点|门票|开放时间|营业时间|地址|电话|在哪里|怎么去|怎么走|路线|导航/i.test(t)) return true;
      if (/排行|排名|榜单|排行榜|top\s*\d+|推荐|推荐几个|推荐一下|哪个好|哪个品牌|哪个牌子|什么牌子|什么品牌|十大|品牌/i.test(t)) return true;
      if (/教程|方法|步骤|怎么做|如何做|怎么弄|怎么办|怎么解决/i.test(t)) return true;
      if (/区别|对比|vs|和.*?区别|与.*?不同|区别是什么|哪个更|哪个比较/i.test(t)) return true;
      if (/IPO|上市|发布|发布.*?(了|的)|新款|新品|发布会|公布/i.test(t)) return true;
      if (/比赛|比分|赛程|赛果|赛况|谁赢了|谁输了|结果|成绩|晋级|淘汰|夺冠|冠军|亚军|季军|决赛|半决赛|小组赛|预选赛/i.test(t)) return true;
      if (/政策|公告|通知|法规|法律|条例|新规|调整|变动/i.test(t)) return true;
      if (/百科|介绍|是什么|什么是|谁是|是谁|简介|背景|资料|信息/i.test(t)) return true;
      if (/电影|电视剧|综艺|纪录片|动漫|动画|番剧|剧集|影评|评分|豆瓣/i.test(t)) return true;
      if (/iPhone|iPad|Mac|安卓|鸿蒙|华为|小米|苹果|三星|oppo|vivo|荣耀|小米.*?(手机|平板|电脑)/i.test(t)) return true;
      if (/下载|安装|使用|配置|设置|注册|登录|账号|密码|找回/i.test(t)) return true;
      // 包含明确实体 + 疑问词的长查询
      if (/^(什么|哪个|谁|哪|哪里|怎么|如何|为什么)\s*\S{4,}/i.test(t)) return true;
      if (/\S{4,}.*?(是什么|有哪些|怎么样|好不好|值得吗|靠谱吗|安全吗|好用吗|有效吗|怎么用|有什么用|怎么选|怎么买|在哪里|哪里有|多少钱|什么时候|为什么)/i.test(t)) return true;
      
      return false;
    }

    // 搜索 → 思考 → 回复：先执行搜索（阻塞），再将搜索结果注入上下文，最后开始思考流
    if (useThinking && allowSearch && !aborted && needsWebSearch(message)) {
      var _psQuery = _preloadedQuery || message.slice(0, 80);
      if (!_preloadedSearchPromise) {
        var _psStripped = message.replace(/^(?:搜索|查一下|搜一下|搜搜|百度|google|谷歌|查询|查查|查资料)\s*/i, '').trim().slice(0, 150);
        if (_psStripped.length >= 3) {
          _psQuery = _psStripped;
        } else {
          for (var _psi = messages.length - 1; _psi >= 0; _psi--) {
            var _psm = messages[_psi];
            if (_psm.role === 'user' && _psm.content !== message && _psm.content) {
              _psQuery = String(_psm.content).slice(0, 150);
              break;
            }
          }
        }
      }
      try {
        // ★ P3 修复 bug 3: 8s 超时 + 优先复用 line 8145 预加载的 promise 避免重复 fire searchWeb
        var _psSr = await Promise.race([
          _preloadedSearchPromise || searchWeb(_psQuery, 20),
          new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error('search_timeout_8s')); }, 8000);
          })
        ]).catch(function() { return _preloadedSearchResults || null; });
        var _psResults = _psSr && Array.isArray(_psSr.results) ? cleanSearchResults(_psSr.results, 20) : [];
        if (_psResults.length > 0) {
          var _psCtx = '【联网搜索结果】\n搜索时间：' + _currentDateCN + '（北京时间）\n用户查询：' + _psQuery + '\n\n' +
            _psResults.map(function(sr, si) { return (si + 1) + '. ' + (sr.title || '无标题') + '\n来源：' + (sr.source || 'web') + '\n发布时间：' + (sr.published_at || '未知') + '\n链接：' + (sr.url || '无') + '\n摘要：' + (sr.snippet || '无摘要'); }).join('\n\n') +
            '\n\n要求：必须优先使用以上搜索结果回答。不要在回答中列出来源、链接、网址等参考信息，直接给出答案内容即可。不能编造新闻、价格、天气、日期。';
          roundMessages.push({ role: 'system', content: _psCtx });
          res.write('data: ' + JSON.stringify({ type: 'search', count: _psResults.length, results: _psResults.slice(0, 20), query: _psQuery }) + '\n\n');
          _sharedSearchMeta = {
            count: _psResults.length,
            query: _psQuery,
            results: _psResults.slice(0, 50),
            expires_at: Date.now() + 86400000
          };
        } else {
          res.write('data: ' + JSON.stringify({ type: 'search', count: 0, results: [], query: _psQuery }) + '\n\n');
        }
      } catch (e) {
        console.error('[AGENT-STREAM] thinking mode search error:', e && e.message);
      }
    }

    var apiBody = {
      model: usedModel,
      messages: roundMessages,
      stream: true
    };
    if (useThinking) {
      apiBody.thinking = { type: 'enabled' };
      apiBody.reasoning_effort = thinkingMode;
    }
    // 思考模式下不同时发 tools（DeepSeek reasoning 模型不支持
    // thinking + tools 并存，会返回 400），搜索靠 regex 回退注入
    if (allowSearch && !useThinking) {
      apiBody.tools = AI_TOOLS;
    }
    
    while (toolRound < MAX_TOOL_ROUNDS && !aborted) {

    // 清理上一轮的泄漏（var 提升导致旧 controller/reader 不会被 GC）
    if (typeof _reader !== 'undefined' && _reader) { try { _reader.cancel(); } catch (e) {} }
    if (typeof controller !== 'undefined' && controller) { try { controller.abort(); } catch (e) {} }
    var controller = new AbortController();
    _controller = controller;
    var timer = setTimeout(function() { controller.abort(); }, useThinking ? 120000 : DEEPSEEK_TIMEOUT_MS);
    _timer = timer;
    
    var streamResp;
    try {
      streamResp = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_API_KEY },
        body: JSON.stringify(apiBody),
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(timer);
      if (aborted) return safeEnd();
      res.write('data: ' + JSON.stringify({ type: 'error', error: 'AI 调用失败，请稍后再试' }) + '\n\n');
      return safeEnd();
    }
    clearTimeout(timer);
    
    if (!streamResp.ok) {
      try {
        var errData = await streamResp.json().catch(function(){ return {}; });
        var errMsg = errData && errData.error && errData.error.message ? String(errData.error.message).slice(0, 200) : '';
        console.error('[AGENT-STREAM] API error', streamResp.status, errMsg);
        if (useThinking && (errMsg.indexOf('thinking') >= 0 || errMsg.indexOf('reasoning_effort') >= 0)) {
          res.write('data: ' + JSON.stringify({ type: 'error', error: '当前模型不支持思考模式，请关闭思考模式后重试' }) + '\n\n');
        } else {
          res.write('data: ' + JSON.stringify({ type: 'error', error: 'AI 调用失败（' + streamResp.status + '）' }) + '\n\n');
        }
      } catch (e2) {
        res.write('data: ' + JSON.stringify({ type: 'error', error: 'AI 调用失败' }) + '\n\n');
      }
      return safeEnd();
    }
    
    // 读取流
    var reader = streamResp.body.getReader();
    _reader = reader;
    var decoder = new TextDecoder();
    var buffer = '';
    var usageInStream = null;
    var hasReasoningContent = false;
    var reasoningBuffer = persistentReasoning || '';
    var contentBuffer = '';
    var reasoningSent = false;
    var reasoningStartedAt = 0;
    var pendingToolCalls = {};
    var finishReason = '';
    
    var lastChunkTime = Date.now();
    while (true) {
      if (aborted) {
        controller.abort();
        return safeEnd();
      }
      // idle timeout: 60 秒无 chunk 则中断(深度思考需要更长时间思考, 不应误判)
      var idleElapsed = Date.now() - lastChunkTime;
      if (idleElapsed > 60000) {
        console.log('[AGENT-STREAM] idle timeout 60s, aborting');
        controller.abort();
        if (!aborted) {
          if (contentBuffer && contentBuffer.length > 0) {
            await finishStream(res, {
              contentBuffer: contentBuffer,
              reasoningBuffer: persistentReasoning || reasoningBuffer,
                  thinkingMode: thinkingMode,
                  useThinking: useThinking,
                  usedModel: usedModel,
                  searchMeta: _toolSearchMeta || _sharedSearchMeta,
                  finishReason: 'idle_timeout',
                  userName: userName,
                  convId: convId,
                  message: message,
                  streamSeq: streamSeq,
                  ctx: ctx,
                  reasoningStartedAt: reasoningStartedAt
            });
          } else {
            writeSse(res, { type: 'error', error: 'AI 回复超时（20 秒无响应），请重试' });
          }
        }
        return safeEnd();
      }
      var readResult = await reader.read();
      if (readResult.done) break;
      lastChunkTime = Date.now();
      
      buffer += decoder.decode(readResult.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        if (line === 'data: [DONE]') continue;
        if (!line.startsWith('data: ')) continue;
        
        var jsonStr = line.slice(6);
        var chunk;
        try { chunk = JSON.parse(jsonStr); } catch (e) { continue; }
        if (!chunk || !chunk.choices || !chunk.choices[0]) continue;
        
        var delta = chunk.choices[0].delta || {};
        var finish = chunk.choices[0].finish_reason;
        usageInStream = chunk.usage || usageInStream;
        
        if (delta.reasoning_content) {
          if (!hasReasoningContent) reasoningStartedAt = Date.now();
          hasReasoningContent = true;
          reasoningBuffer += delta.reasoning_content;
          persistentReasoning += delta.reasoning_content;
          if (thinkingMode !== 'off') {
            if (!reasoningSent) {
              res.write('data: ' + JSON.stringify({ type: 'reasoning_start' }) + '\n\n');
              reasoningSent = true;
            }
            res.write('data: ' + JSON.stringify({ type: 'reasoning', text: delta.reasoning_content }) + '\n\n');
          }
        }
        if (delta.content) {
          contentBuffer += delta.content;
          res.write('data: ' + JSON.stringify({ type: 'content', text: delta.content }) + '\n\n');
        }
        
        // 收集 tool calls（思考模式下的搜索请求）
        if (delta.tool_calls) {
          for (var tci = 0; tci < delta.tool_calls.length; tci++) {
            var tc = delta.tool_calls[tci];
            var tIdx = tc.index;
            if (!pendingToolCalls[tIdx]) pendingToolCalls[tIdx] = { id: '', name: '', args: '' };
            if (tc.id) pendingToolCalls[tIdx].id = tc.id;
            if (tc.function) {
              if (tc.function.name) pendingToolCalls[tIdx].name = tc.function.name;
              if (tc.function.arguments) pendingToolCalls[tIdx].args += tc.function.arguments;
            }
          }
        }
        
        if (finish === 'tool_calls') {
          finishReason = 'tool_calls';
          break;
        }
                if (finish === 'stop' || finish === 'length') {
          finishReason = finish;
          // 直接收尾，不重新搜索不重新生成
          if (!aborted) {
            // 搜索结果已在思考前注入，此处直接用 _sharedSearchMeta
            var _searchMeta = _sharedSearchMeta || _toolSearchMeta;
            var finishOpt = {
              contentBuffer: contentBuffer,
              reasoningBuffer: persistentReasoning || reasoningBuffer,
              thinkingMode: thinkingMode,
              useThinking: useThinking,
              usedModel: usageInStream && usageInStream.model ? usageInStream.model : usedModel,
              usage: usageInStream || null,
              searchMeta: _searchMeta,
              finishReason: finish,
              userName: userName,
              convId: convId,
              message: message,
              streamSeq: streamSeq,
              ctx: ctx,
              reasoningStartedAt: reasoningStartedAt
            };
            await finishStream(res, finishOpt);
          }
          return safeEnd();
        }

      }
      if (finishReason === 'tool_calls') break;
    }
    
    // 处理 tool calls
    var toolCallsArr = Object.values(pendingToolCalls).filter(function(t) { return t.id && t.name; });
    if (toolCallsArr.length > 0 && finishReason === 'tool_calls' && !aborted) {
      // 通知前端 AI 正在使用工具
      var toolsInfo = toolCallsArr.map(function(t) {
        var args;
        try { args = JSON.parse(t.args); } catch (e) { args = {}; }
        return { name: t.name, args: args };
      });
      res.write('data: ' + JSON.stringify({ type: 'tool_calls', tools: toolsInfo }) + '\n\n');
      
      // 并行执行所有工具
      var toolResults = await Promise.all(toolCallsArr.map(async function(tc) {
        var tcExec = { function: { name: tc.name, arguments: tc.args } };
        return { result: await executeToolCall(tcExec), id: tc.id, name: tc.name };
      }));
      for (var ti = 0; ti < toolResults.length; ti++) {
        var toolResult = toolResults[ti].result;
        
        // 捕获 search_web 工具的搜索结果元数据
        if (toolResult.tool_name === 'search_web' && !toolResult.error && toolResult.results_count > 0) {
          var _parsedResults = null;
          try { _parsedResults = JSON.parse(toolResult.content || '[]'); } catch (e) {}
          _toolSearchMeta = {
            count: toolResult.results_count,
            query: toolResult.query || toolResults[ti].name,
            results: Array.isArray(_parsedResults) ? _parsedResults.slice(0, 50) : null,
            expires_at: Date.now() + 86400000
          };
        }
        
        res.write('data: ' + JSON.stringify({
          type: 'tool_result',
          tool_name: toolResult.tool_name || '',
          success: !toolResult.error,
          count: toolResult.results_count || 0,
          items: toolResult.content || '',
          query: toolResult.query || '',
          error: toolResult.error || null
        }) + '\n\n');
        
        roundMessages.push({ role: 'tool', content: JSON.stringify(toolResult), tool_call_id: toolResults[ti].id });
      }
      
      // 将包含 tool_calls 的助理消息加入 roundMessages（缺少会导致下一轮上下文丢失）
      roundMessages.push({ role: 'assistant', content: contentBuffer || '', tool_calls: toolCallsArr.map(function(t) { return { id: t.id, type: 'function', function: { name: t.name, arguments: t.args } }; }) });
      toolRound++;
        // 后续轮次不再走思考模式，直接让模型用已有的思考+结果生成回答
       if (useThinking) {
         var freshMsgs = roundMessages.slice();
         apiBody = {
           model: usedModel,
           messages: freshMsgs,
           stream: true
         };
         if (allowSearch) {
           apiBody.tools = AI_TOOLS;
         }
       }
       continue;
    }
    
    // 流意外结束但没收到 finish_reason
    if (!aborted) {
      var contentHasSomething = contentBuffer && contentBuffer.length > 0;
      var reasoningHasSomething = reasoningBuffer && reasoningBuffer.length > 0;
      
      if (!contentHasSomething && !reasoningHasSomething) {
        writeSse(res, { type: 'error', error: 'AI 没有返回内容，请稍后重试' });
      } else if (!contentHasSomething && reasoningHasSomething) {
        writeSse(res, { type: 'error', error: 'AI 只返回了思考过程，正文生成中断，请重试' });
      } else {
        await finishStream(res, {
          contentBuffer: contentBuffer,
          reasoningBuffer: persistentReasoning || reasoningBuffer,
          thinkingMode: thinkingMode,
          useThinking: useThinking,
          usedModel: usedModel,
          searchMeta: _toolSearchMeta || _sharedSearchMeta,
          finishReason: 'upstream_closed',
          userName: userName,
          convId: convId,
          message: message,
          streamSeq: streamSeq,
          ctx: ctx,
          reasoningStartedAt: reasoningStartedAt
        });
      }
    }
    return safeEnd();

    }
    // toolRound 超限兜底
    if (!aborted) {
      writeSse(res, { type: 'error', error: 'AI 工具调用次数过多，请简化后重试' });
    }
    return safeEnd();
    } catch (streamErr) {
      if (aborted) return safeEnd();
      console.error('[AGENT-STREAM] stream read error:', streamErr && streamErr.message);
      // 如果已有 content，尝试保存并标记中断
      if (contentBuffer && contentBuffer.length > 0 && !aborted) {
        await finishStream(res, {
          contentBuffer: contentBuffer,
          reasoningBuffer: persistentReasoning || reasoningBuffer,
          thinkingMode: thinkingMode,
          useThinking: useThinking,
          usedModel: usedModel,
          searchMeta: _toolSearchMeta || _sharedSearchMeta,
          finishReason: 'upstream_read_error',
          userName: userName,
          convId: convId,
          message: message,
          streamSeq: streamSeq,
          ctx: ctx,
          reasoningStartedAt: reasoningStartedAt
        });
      } else if (reasoningBuffer && reasoningBuffer.length > 0 && !aborted) {
        writeSse(res, { type: 'error', error: 'AI 只返回了思考过程，正文生成中断，请重试' });
      } else if (!aborted) {
        writeSse(res, { type: 'error', error: 'AI 流式读取错误，请稍后重试' });
      }
      return safeEnd();
    }
});

// GET /api/agent/chat/conversations - 获取用户会话列表
//   mode=normal → 只返回普通聊天会话（deep_think=false）
//   mode=deep_think → 只返回深度研究会话（deep_think=true）
//   不传 mode → 返回全部
app.get('/api/agent/chat/conversations', authenticateUser, async (req, res) => {
  try {
    var userName = req.userName;
    var limit = Math.min(Math.max(parseInt(req.query.limit) || AI_AGENT_CONVERSATION_LIST_LIMIT, 1), 100);
    var mode = (req.query.mode || '').trim();

    // 取该用户所有 AI 消息，按时间倒序（限制最多 1000 条避免内存膨胀）
    var { data: rows } = await supabase.from('posts')
      .select('actor_key, content, media_url, created_at')
      .eq('user_name', userName)
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .neq('actor_key', '')
      .order('created_at', { ascending: false })
      .limit(1000);
    
    if (!Array.isArray(rows)) {
      return res.json({ ok: true, conversations: [] });
    }
    
    // 按 convId 分组，统计所有消息
    // 用两个 pass：第一遍按时间倒序拿最新一条；第二遍计数 & 找第一条 user 消息
    var convData = {};
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      var meta = parseMsgMeta(r);
      if (meta && meta.deleted) continue; // 用户已删除的跳过
      var convId = resolveConvId(r);
      if (!convId) continue;
      
      // mode 过滤：chat_mode = 'deep_think' 的只出现在深度研究列表
      // 旧消息无 chat_mode 字段，视为 normal
      if (mode === 'normal' && meta.chat_mode === 'deep_think') continue;
      if (mode === 'deep_think' && meta.chat_mode !== 'deep_think') continue;
      
      if (!convData[convId]) {
        convData[convId] = { firstUserMsg: null, lastMsg: null, updated_at: null, msgCount: 0, firstRole: null, title: '' };
      }
      convData[convId].msgCount++;
      
      meta = parseMsgMeta(r);
      var msgContent = String(r.content || '');
      if (meta.role === 'assistant') {
        try {
          var c = JSON.parse(r.content || '{}');
          if (c && typeof c.reply === 'string') msgContent = c.reply;
        } catch(e) {
          try { console.warn('[AI-CONV] parse msg meta error:', e && e.message); } catch(ee) {}
        }
      }
      
      if (meta.role === 'user' && !convData[convId].firstUserMsg) {
        convData[convId].firstUserMsg = msgContent.slice(0, 20);
      }
    }
    
    // 第二遍：按时间倒序拿最新消息的 updated_at 和 lastMsg
    for (var j = 0; j < rows.length; j++) {
      var r2 = rows[j];
      var meta2 = parseMsgMeta(r2);
      if (meta2 && meta2.deleted) continue;
      var convId2 = resolveConvId(r2);
      if (!convId2 || !convData[convId2]) continue;
      
      if (!convData[convId2].updated_at) {
        convData[convId2].updated_at = r2.created_at;
        var msg2 = String(r2.content || '');
        if (meta2.role === 'assistant') {
          try {
            var c2 = JSON.parse(r2.content || '{}');
            if (c2 && typeof c2.reply === 'string') msg2 = c2.reply;
          } catch(e) {
            try { console.warn('[AI-CONV] parse msg meta2 error:', e && e.message); } catch(ee) {}
          }
        }
        convData[convId2].lastMsgString = msg2.slice(0, 100);
      }
    }
    
    var conversations = Object.keys(convData).sort(function(a, b) {
      return (convData[b].updated_at || '') > (convData[a].updated_at || '') ? 1 : -1;
    }).slice(0, limit).map(function(k) {
      var d = convData[k];
      return { conversation_id: k, title: d.firstUserMsg || '新对话', last_message: d.lastMsgString || '', updated_at: d.updated_at, message_count: d.msgCount };
    });
    
    console.log('[AGENT-CONV] rows=', rows.length, 'conversations=', conversations.length);
    if (rows.length > 0 && conversations.length === 0) {
      for (var di = 0; di < Math.min(3, rows.length); di++) {
        console.log('[AGENT-CONV] sample row', di, 'actor_key=', rows[di].actor_key, 'media_url=', rows[di].media_url);
      }
    }
    
    return res.json({ ok: true, conversations: conversations });
  } catch (e) {
    console.error('[AGENT-CONV] list error:', e && e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// GET /api/agent/search-health - 搜索健康检查（验证搜索 Provider 可用性）
app.get('/api/agent/search-health', authenticateUser, async (req, res) => {
  try {
    var q = String(req.query.q || '济州岛最新新闻').trim().slice(0, 100);
    var result = await searchWeb(q, 3);
    var diagnostics = result && result.diagnostics ? result.diagnostics : {};
    return res.json({
      ok: diagnostics.provider_results && diagnostics.provider_results.length > 0,
      query: q,
      used_provider: result && result.used_provider || null,
      results: result && result.results || [],
      diagnostics: {
        enabled_providers: diagnostics.enabled_providers || [],
        missing_env: diagnostics.missing_env || [],
        provider_results: diagnostics.provider_results || [],
        provider_errors: diagnostics.provider_errors || []
      },
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    return res.json({ ok: false, error: e && e.message || '搜索检查失败', results: [], diagnostics: { enabled_providers: [], missing_env: [], provider_results: [], provider_errors: [] } });
  }
});

// POST /api/agent/chat/delete - 删除用户指定的对话（软删除，管理员仍可查看）
app.post('/api/agent/chat/delete', authenticateUser, async (req, res) => {
  try {
    var userName = req.userName;
    var convId = String(req.body && req.body.conversation_id || '').trim();
    if (!convId) return res.status(400).json({ error: '缺少 conversation_id' });
    if (!/^[A-Z0-9\-]{6,}$/i.test(convId)) return res.status(400).json({ error: 'conversation_id 格式无效' });

    // 查该 conv 的所有消息
    var { data: rows } = await supabase.from('posts')
      .select('id, media_url')
      .eq('user_name', userName)
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .filter('actor_key', 'like', 'ai_msg_conv_' + convId + '_%');

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.json({ ok: true, deleted: 0 });
    }

    // 逐条标记 deleted: true
    var updated = 0;
    for (var i = 0; i < rows.length; i++) {
      var meta = parseMsgMeta(rows[i]);
      if (meta.deleted) continue; // 已删除
      meta.deleted = true;
      meta.deleted_at = new Date().toISOString();
      var { error: upErr } = await supabase.from('posts')
        .update({ media_url: JSON.stringify(meta) })
        .eq('id', rows[i].id);
      if (!upErr) updated++;
    }

    console.log('[AGENT-CONV] user=' + userName + ' deleted conv=' + convId + ' messages=' + updated);
    return res.json({ ok: true, deleted: updated });
  } catch (e) {
    console.error('[AGENT-CONV] delete error:', e && e.message);
    return res.status(500).json({ error: '删除失败' });
  }
});
// POST /api/agent/chat/new - 开始新对话（生成新 conversation_id，不删除旧记录）
app.post('/api/agent/chat/new', authenticateUser, async (req, res) => {
  return res.json({ ok: true, conversation_id: genConvId() });
});

function sanitizeEnglishWordState(input) {
  var en = String(input && input.en || '').trim().toLowerCase().slice(0, 60);
  if (!en || !/^[a-zA-Z\s\-']+$/.test(en)) return null;
  return {
    id: String(input && input.id || ('w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8))).slice(0, 80),
    en: en,
    cn: String(input && input.cn || '').trim().slice(0, 80),
    mastery: Math.max(0, Math.min(100, parseInt(input && input.mastery, 10) || 0)),
    seen: Math.max(0, Math.min(9999, parseInt(input && input.seen, 10) || 0)),
    correct: Math.max(0, Math.min(9999, parseInt(input && input.correct, 10) || 0)),
    wrong: Math.max(0, Math.min(9999, parseInt(input && input.wrong, 10) || 0)),
    lastReviewedAt: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(input && input.lastReviewedAt) || 0)),
    addedAt: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(input && input.addedAt) || Date.now())),
    updatedAt: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(input && input.updatedAt) || Date.now()))
  };
}

function sanitizeEnglishLearningState(input) {
  input = input && typeof input === 'object' ? input : {};
  var wordMap = {};
  (Array.isArray(input.words) ? input.words : []).slice(0, 240).forEach(function(item) {
    var w = sanitizeEnglishWordState(item);
    if (!w) return;
    var prev = wordMap[w.en];
    if (!prev || (w.updatedAt || 0) >= (prev.updatedAt || 0)) wordMap[w.en] = w;
  });
  var words = Object.keys(wordMap).map(function(k) { return wordMap[k]; }).slice(0, 200);
  var allowedLevels = { cet4: true, cet6: true, ielts: true };
  var allowedTypes = { article: true, mc: true, cloze: true };
  var cleanTypes = function(arr) {
    return (Array.isArray(arr) ? arr : []).map(String).filter(function(t) { return allowedTypes[t]; }).slice(0, 3);
  };
  var history = (Array.isArray(input.history) ? input.history : []).slice(0, 80).map(function(h) {
    var level = String(h && h.level || 'cet4').toLowerCase();
    if (!allowedLevels[level]) level = 'cet4';
    return {
      id: String(h && h.id || ('h_' + Date.now())).slice(0, 80),
      correct: Math.max(0, Math.min(999, parseInt(h && (h.correct != null ? h.correct : h.score), 10) || 0)),
      score: Math.max(0, Math.min(999, parseInt(h && (h.score != null ? h.score : h.correct), 10) || 0)),
      total: Math.max(0, Math.min(999, parseInt(h && h.total, 10) || 0)),
      pct: Math.max(0, Math.min(100, parseInt(h && h.pct, 10) || 0)),
      level: level,
      types: cleanTypes(h && h.types),
      topic: String(h && h.topic || '').slice(0, 80),
      words: (Array.isArray(h && h.words) ? h.words : []).map(String).slice(0, 40),
      mistakeCount: Math.max(0, Math.min(999, parseInt(h && h.mistakeCount, 10) || 0)),
      time: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(h && h.time) || Date.now()))
    };
  });
  var mistakes = (Array.isArray(input.mistakes) ? input.mistakes : []).slice(0, 120).map(function(m) {
    var level = String(m && m.level || 'cet4').toLowerCase();
    if (!allowedLevels[level]) level = 'cet4';
    return {
      id: String(m && m.id || ('m_' + Date.now())).slice(0, 80),
      questionId: String(m && m.questionId || '').slice(0, 80),
      type: allowedTypes[String(m && m.type || 'mc')] ? String(m.type) : 'mc',
      question: String(m && m.question || '').slice(0, 500),
      context: String(m && m.context || '').slice(0, 2000),
      blankIndex: Math.max(-1, Math.min(20, parseInt(m && m.blankIndex, 10) || -1)),
      userAnswer: String(m && m.userAnswer || '').slice(0, 240),
      correctAnswer: String(m && m.correctAnswer || '').slice(0, 240),
      explain: String(m && m.explain || '').slice(0, 400),
      words: (Array.isArray(m && m.words) ? m.words : []).map(String).slice(0, 20),
      level: level,
      time: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(m && m.time) || Date.now()))
    };
  });
  var settingsIn = input.settings || {};
  var levelDefault = String(settingsIn.defaultLevel || 'cet4').toLowerCase();
  if (!allowedLevels[levelDefault]) levelDefault = 'cet4';
  var len = String(settingsIn.articleLength || 'medium').toLowerCase();
  if (['short', 'medium', 'long'].indexOf(len) < 0) len = 'medium';
  var focus = String(settingsIn.focus || 'weak').toLowerCase();
  if (['all', 'weak', 'selected'].indexOf(focus) < 0) focus = 'weak';
  return {
    version: 1,
    words: words,
    history: history,
    mistakes: mistakes,
    settings: {
      defaultLevel: levelDefault,
      articleLength: len,
      questionCount: Math.max(4, Math.min(10, parseInt(settingsIn.questionCount, 10) || 6)),
      focus: focus,
      topic: String(settingsIn.topic || '').slice(0, 80)
    },
    updatedAt: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(input.updatedAt) || Date.now())),
    server_updated_at: Date.now()
  };
}

async function loadEnglishLearningRow(userName) {
  var { data, error } = await supabase.from('posts')
    .select('id, content, created_at')
    .eq('user_name', userName)
    .eq('media_type', AI_ENGLISH_LEARNING_MARKER)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

app.get('/api/agent/english/state', authenticateUser, rateLimit(60000, 60), async (req, res) => {
  try {
    var row = await loadEnglishLearningRow(req.userName);
    if (!row || !row.content) return res.json({ ok: true, data: sanitizeEnglishLearningState({}) });
    var parsed = safeJsonParse(row.content) || {};
    var state = sanitizeEnglishLearningState(parsed);
    state.revision = parsed.revision || 0;
    return res.json({ ok: true, data: state });
  } catch (e) {
    console.error('[ENGLISH-STATE] load failed:', e && e.message);
    return res.status(500).json({ error: '同步读取失败' });
  }
});

app.post('/api/agent/english/state', authenticateUser, rateLimit(60000, 30), async (req, res) => {
  try {
    var userName = req.userName;
    var baseRevision = req.body && req.body.base_revision;
    var payload = sanitizeEnglishLearningState((req.body && req.body.data) || req.body || {});
    var actorKey = 'english_learning_state:' + userName;
    payload.server_updated_at = Date.now();
    payload.revision = (baseRevision || 0) + 1;
    var content = JSON.stringify(payload);
    var existing = await loadEnglishLearningRow(userName);

    // 版本冲突检测：base_revision 为 0 或 undefined 时跳过检查，否则必须匹配
    if (existing && existing.id && typeof baseRevision !== 'undefined' && baseRevision !== null) {
      var cur = safeJsonParse(existing.content) || {};
      if (cur.revision !== undefined && cur.revision !== baseRevision) {
        var serverState = sanitizeEnglishLearningState(cur);
        serverState.revision = cur.revision || 0;
        return res.status(409).json({ ok: false, error: '版本冲突', server: serverState });
      }
    }

    if (existing && existing.id) {
      var upd = await supabase.from('posts').update({
        content: content,
        media_url: 'state:v1',
        actor_key: actorKey
      }).eq('id', existing.id);
      if (upd.error) throw upd.error;
    } else {
      var ins = await supabase.from('posts').insert([{
        user_name: userName,
        content: content,
        media_type: AI_ENGLISH_LEARNING_MARKER,
        media_url: 'state:v1',
        actor_key: actorKey
      }]);
      if (ins.error) throw ins.error;
    }
    return res.json({
      ok: true,
      saved: true,
      data: {
        revision: payload.revision,
        words_count: payload.words.length,
        history_count: payload.history.length,
        mistakes_count: payload.mistakes.length,
        server_updated_at: payload.server_updated_at
      }
    });
  } catch (e) {
    console.error('[ENGLISH-STATE] save failed:', e && e.message);
    return res.status(500).json({ error: '同步保存失败' });
  }
});

// POST /api/agent/english/generate - 英语学习: 基于单词库生成阅读文章+题目
app.post('/api/agent/english/generate', authenticateUser, rateLimit(60000, 10), async (req, res) => {
  try {
    var words = Array.isArray(req.body && req.body.words) ? req.body.words : [];
    var level = String((req.body && req.body.level) || 'cet4').toLowerCase();
    var types = Array.isArray(req.body && req.body.types) ? req.body.types : ['article', 'mc'];
    var questionCount = Math.max(4, Math.min(10, parseInt(req.body && req.body.question_count, 10) || 6));
    var articleLength = String((req.body && req.body.article_length) || 'medium').toLowerCase();
    var topic = String((req.body && req.body.topic) || '').trim().slice(0, 80);
    var focus = String((req.body && req.body.focus) || 'all').toLowerCase();
    if (['cet4', 'cet6', 'ielts'].indexOf(level) < 0) level = 'cet4';
    if (['short', 'medium', 'long'].indexOf(articleLength) < 0) articleLength = 'medium';
    if (['all', 'weak', 'selected'].indexOf(focus) < 0) focus = 'all';
    if (words.length === 0) return res.status(400).json({ error: '单词库为空' });
    if (words.length > 200) return res.status(400).json({ error: '单词过多 (上限 200)' });

    var sanitized = words.slice(0, 200).map(function(w) {
      return String(w.en || '').slice(0, 60).toLowerCase();
    }).filter(function(s) { return s && /^[a-zA-Z\s\-']+$/.test(s); });
    if (sanitized.length === 0) return res.status(400).json({ error: '无有效单词' });

    var levelDesc = level === 'cet6' ? 'CET-6 (大学英语六级)' : level === 'ielts' ? '雅思 (IELTS)' : 'CET-4 (大学英语四级)';
    var lengthDesc = articleLength === 'short' ? '120-180 词' : articleLength === 'long' ? '350-520 词' : '220-350 词';
    var wantsArticle = types.indexOf('article') >= 0;
    var wantsMC = types.indexOf('mc') >= 0;
    var wantsCloze = types.indexOf('cloze') >= 0;
    if (!wantsArticle && !wantsMC && !wantsCloze) wantsMC = true;

    // 按 en 建立索引，避免 sanitized 过滤后索引错位
    var wordsByEn = {};
    (words || []).forEach(function(w) { if (w && w.en) wordsByEn[String(w.en).toLowerCase()] = w; });
    var wordList = sanitized.map(function(en) {
      var orig = wordsByEn[en];
      var cn = (orig && orig.cn) ? String(orig.cn).slice(0, 80) : '';
      var mastery = orig && orig.mastery != null ? (' mastery=' + Math.max(0, Math.min(100, parseInt(orig.mastery, 10) || 0))) : '';
      return en + (cn ? ' (' + cn + ')' : '') + mastery;
    }).join(', ');

    var mcCount = wantsMC ? Math.max(2, Math.min(8, questionCount - (wantsCloze ? 1 : 0))) : 0;
    var clozeBlankCount = wantsCloze ? Math.max(2, Math.min(5, Math.ceil(questionCount / 3))) : 0;
    var parts = [
      '你是一个专业的英语教学老师。请基于以下用户单词库, 生成 ' + levelDesc + ' 难度的英语练习。',
      '',
      '【用户单词库】',
      wordList,
      '',
      '【要求】',
      '1. 优先使用用户单词库中的单词 (覆盖率 >= 60%), 不够的部分用同难度其他常用词。',
      '2. 生成风格要自然, 不要机械堆砌单词。',
      '3. 文章篇幅: ' + lengthDesc + '。' + (topic ? ('主题: ' + topic + '。') : ''),
      '4. 选词策略: ' + (focus === 'weak' ? '优先照顾 mastery 较低的薄弱词。' : focus === 'selected' ? '尽量只使用用户本次选中的单词。' : '均衡覆盖用户单词。'),
      '5. 严格输出 JSON, 严禁任何额外文字、严禁 markdown 代码块、严禁中文说明。',
      '',
      'JSON 结构:',
      '{',
      '  "article": "完整的阅读文章 (' + lengthDesc + (wantsArticle ? ', 必填' : ', 可省略') + ')",',
      '  "words_used": ["在文章中实际用到的单词 (用户单词库优先)"],',
      '  "questions": ['
    ];
    var qId = 1;
    if (wantsMC) {
      for (var mi = 0; mi < mcCount; mi++) {
        if (mi > 0) parts.push('    ,');
        parts.push('    {');
        parts.push('      "id": ' + qId++ + ',');
        parts.push('      "type": "mc",');
        parts.push('      "question": "题目 (词汇辨析/词义/同义词/语境理解, 围绕用户单词库或文章)",');
        parts.push('      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],');
        parts.push('      "answer": 0,');
        parts.push('      "explain": "中文解析 30-60 字"');
        parts.push('    }');
      }
    }
    if (wantsCloze) {
      if (wantsMC) parts.push('    ,');
      parts.push('    {');
      parts.push('      "id": ' + qId++ + ',');
      parts.push('      "type": "cloze",');
      parts.push('      "question": "完形填空: 一段 100-180 词文章, 挖空 ' + clozeBlankCount + ' 个单词 (用 ___ 标记)",');
      parts.push('      "context": "完整段落 (含 ___ 挖空)",');
      parts.push('      "blanks": [');
      for (var ci = 0; ci < clozeBlankCount; ci++) {
        if (ci > 0) parts.push('        ,');
        parts.push('        {"options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": 0, "explain": "解析 30 字"}');
      }
      parts.push('      ]');
      parts.push('    }');
    }
    parts.push('  ]');
    parts.push('}');
    parts.push('');
    parts.push('注意: answer 是 0-3 的数组下标; 解析必须中文; 仅输出 JSON。');

    var prompt = parts.join('\n');
    var responseFormat = { type: 'json_object' };

    var aiResult;
    try {
      aiResult = await callDeepSeek(
        [
          { role: 'system', content: '你是英语教学 AI, 严格输出 JSON, 不输出任何额外文字。' },
          { role: 'user', content: prompt }
        ],
        { thinking_mode: 'low', max_tokens: 4096, response_format: responseFormat }
      );
    } catch (e) {
      console.error('[ENGLISH-GEN] AI failed:', e && e.message);
      return res.status(500).json({ error: 'AI 调用失败: ' + (e.message || '未知') });
    }

    var text = (aiResult && aiResult.content) || '';
    // 尝试提取 JSON
    var firstBrace = text.indexOf('{');
    var lastBrace = text.lastIndexOf('}');
    var jsonText = (firstBrace >= 0 && lastBrace > firstBrace) ? text.slice(firstBrace, lastBrace + 1) : text;
    var data;
    try {
      data = JSON.parse(jsonText);
    } catch (e) {
      console.error('[ENGLISH-GEN] parse failed:', e && e.message, 'raw:', text.slice(0, 300));
      return res.status(500).json({ error: 'AI 返回格式错误, 请重试' });
    }

    // 校验 + 清理
    var result = {
      article: data.article ? String(data.article).slice(0, 5000) : '',
      words_used: Array.isArray(data.words_used) ? data.words_used.slice(0, 30).map(String) : sanitized.slice(0, 20),
      questions: []
    };
    if (Array.isArray(data.questions)) {
      data.questions.forEach(function(q) {
        if (!q || !q.type) return;
        if (q.type === 'mc') {
          if (!q.question || !Array.isArray(q.options) || q.options.length < 2) return;
          var ans = parseInt(q.answer);
          if (isNaN(ans) || ans < 0 || ans >= q.options.length) ans = 0;
          result.questions.push({
            id: q.id || ('q_' + Math.random().toString(36).slice(2, 6)),
            type: 'mc',
            question: String(q.question).slice(0, 500),
            options: q.options.slice(0, 6).map(function(o) { return String(o).slice(0, 200); }),
            answer: ans,
            explain: String(q.explain || '').slice(0, 300)
          });
        } else if (q.type === 'cloze') {
          if (!q.context || !Array.isArray(q.blanks)) return;
          var blanks = [];
          q.blanks.forEach(function(b) {
            if (!b || !Array.isArray(b.options)) return;
            var a2 = parseInt(b.answer);
            if (isNaN(a2) || a2 < 0 || a2 >= b.options.length) a2 = 0;
            blanks.push({
              options: b.options.slice(0, 6).map(function(o) { return String(o).slice(0, 200); }),
              answer: a2,
              explain: String(b.explain || '').slice(0, 200)
            });
          });
          if (blanks.length > 0) {
            result.questions.push({
              id: q.id || ('q_' + Math.random().toString(36).slice(2, 6)),
              type: 'cloze',
              question: String(q.question || '完形填空').slice(0, 300),
              context: String(q.context).slice(0, 3000),
              blanks: blanks
            });
          }
        }
      });
    }

    if (result.questions.length === 0 && !result.article) {
      return res.status(500).json({ error: 'AI 返回内容为空, 请重试' });
    }

    return res.json({ ok: true, data: result, usage: aiResult.usage || null });
  } catch (e) {
    console.error('[ENGLISH-GEN] exception:', e && e.message);
    try { return res.status(500).json({ error: '服务异常: ' + (e.message || '未知') }); } catch (_) {}
  }
});

// POST /api/agent/english/parse-batch - 英语学习: AI 智能解析批量输入
// 接收任意格式文本 (单词/句子/短语混合), 返回 [{en, cn}] 列表
app.post('/api/agent/english/parse-batch', authenticateUser, rateLimit(60000, 15), async (req, res) => {
  try {
    var text = String((req.body && req.body.text) || '').trim();
    var maxCount = Math.max(1, Math.min(200, parseInt(req.body && req.body.max_count, 10) || 60));
    if (!text) return res.status(400).json({ error: '文本为空' });
    if (text.length > 4000) text = text.slice(0, 4000);

    var prompt = [
      '你是一个英语单词提取助手。从用户输入的文本中提取**值得学习的英语单词或短语**, 并给出简洁的中文释义。',
      '',
      '【输入文本】',
      text,
      '',
      '【要求】',
      '1. 提取用户**想学的**英语单词或短语 (不要提取每个词, 只提取有学习价值的)。',
      '2. 中等及以上难度的常用词优先; 过于简单 (the, a, is) 跳过。',
      '3. 短语 (如 take off, look forward to) 可以保留为整体。',
      '4. 去重; 最多输出 ' + maxCount + ' 条。',
      '5. 严格输出 JSON 数组, 严禁额外文字, 严禁 markdown 代码块。',
      '',
      '输出格式 (严格 JSON):',
      '[{"en": "apple", "cn": "苹果"}, {"en": "take off", "cn": "起飞; 脱下"}]'
    ].join('\n');

    var aiResult;
    try {
      aiResult = await callDeepSeek(
        [
          { role: 'system', content: '你是英语单词提取 AI, 严格输出 JSON 数组, 不输出任何额外文字。' },
          { role: 'user', content: prompt }
        ],
        { thinking_mode: 'low', max_tokens: 2048, response_format: { type: 'json_object' } }
      );
    } catch (e) {
      console.error('[ENGLISH-PARSE] AI failed:', e && e.message);
      return res.status(500).json({ error: 'AI 调用失败: ' + (e.message || '未知') });
    }

    var raw = (aiResult && aiResult.content) || '';
    var firstArr = raw.indexOf('[');
    var lastArr = raw.lastIndexOf(']');
    var jsonText = (firstArr >= 0 && lastArr > firstArr) ? raw.slice(firstArr, lastArr + 1) : raw;
    var arr;
    try {
      arr = JSON.parse(jsonText);
    } catch (e) {
      console.error('[ENGLISH-PARSE] JSON parse failed:', e && e.message, 'raw:', raw.slice(0, 200));
      return res.status(500).json({ error: 'AI 返回格式错误, 请重试' });
    }
    if (!Array.isArray(arr)) {
      // 兼容 AI 把数组包在对象里返回的情况
      if (arr && Array.isArray(arr.words)) arr = arr.words;
      else if (arr && Array.isArray(arr.data)) arr = arr.data;
      else return res.status(500).json({ error: 'AI 返回格式错误, 请重试' });
    }

    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length && out.length < maxCount; i++) {
      var w = arr[i];
      if (!w) continue;
      var en = String(w.en || w.word || w.english || '').trim().toLowerCase();
      var cn = String(w.cn || w.meaning || w.zh || '').trim().slice(0, 80);
      if (!en) continue;
      if (!/^[a-zA-Z\s\-']+$/.test(en)) continue;
      if (en.length > 60) continue;
      if (seen[en]) continue;
      seen[en] = true;
      out.push({ en: en, cn: cn });
    }

    return res.json({ ok: true, data: { words: out }, usage: aiResult.usage || null });
  } catch (e) {
    console.error('[ENGLISH-PARSE] exception:', e && e.message);
    try { return res.status(500).json({ error: '服务异常: ' + (e.message || '未知') }); } catch (_) {}
  }
});

// POST /api/agent/english/explain-word - AI 查询单词释义/例句/同义词
// 接收 en, 返回 {en, cn, examples, synonyms, tip}
app.post('/api/agent/english/explain-word', authenticateUser, rateLimit(60000, 30), async (req, res) => {
  try {
    var en = String((req.body && req.body.en) || '').trim().toLowerCase();
    if (!en) return res.status(400).json({ error: '单词为空' });
    if (!/^[a-zA-Z\s\-']+$/.test(en) || en.length > 60) {
      return res.status(400).json({ error: '单词格式不合法' });
    }
    var context = String((req.body && req.body.context) || '').slice(0, 200);
    var prompt = [
      '请为英语单词/短语 "' + en + '" 提供简洁学习信息。',
      context ? ('用户上下文: ' + context) : '',
      '',
      '【要求】',
      '1. cn: 简洁中文释义 (≤30字, 多个含义用 ; 分隔)。',
      '2. examples: 2 个日常英文例句 (数组, 每个 ≤80 字符)。',
      '3. synonyms: 最多 3 个常用近义词 (数组)。',
      '4. tip: 一句话记忆技巧或易错点 (≤50字)。',
      '5. 严格输出 JSON 对象, 严禁额外文字, 严禁 markdown 代码块。',
      '',
      '输出格式:',
      '{"en":"' + en + '","cn":"","examples":["",""], "synonyms":["","",""], "tip":""}'
    ].filter(Boolean).join('\n');

    var aiResult;
    try {
      aiResult = await callDeepSeek(
        [
          { role: 'system', content: '你是英语单词解释 AI, 严格输出 JSON 对象, 不输出任何额外文字。' },
          { role: 'user', content: prompt }
        ],
        { thinking_mode: 'low', max_tokens: 600, response_format: { type: 'json_object' } }
      );
    } catch (e) {
      console.error('[ENGLISH-EXPLAIN] AI failed:', e && e.message);
      return res.status(500).json({ error: 'AI 调用失败: ' + (e.message || '未知') });
    }

    var raw = (aiResult && aiResult.content) || '';
    var firstObj = raw.indexOf('{');
    var lastObj = raw.lastIndexOf('}');
    var jsonText = (firstObj >= 0 && lastObj > firstObj) ? raw.slice(firstObj, lastObj + 1) : raw;
    var data;
    try {
      data = JSON.parse(jsonText);
    } catch (e) {
      console.error('[ENGLISH-EXPLAIN] JSON parse failed:', e && e.message, 'raw:', raw.slice(0, 200));
      return res.status(500).json({ error: 'AI 返回格式错误, 请重试' });
    }
    if (!data || typeof data !== 'object') return res.status(500).json({ error: 'AI 返回数据异常' });

    var cn = String(data.cn || data.meaning || '').trim().slice(0, 80);
    var examples = Array.isArray(data.examples) ? data.examples.slice(0, 2).map(function(s) { return String(s || '').slice(0, 200); }) : [];
    var synonyms = Array.isArray(data.synonyms) ? data.synonyms.slice(0, 3).map(function(s) { return String(s || '').slice(0, 40); }) : [];
    var tip = String(data.tip || data.memo || '').trim().slice(0, 120);

    return res.json({
      ok: true,
      data: { en: en, cn: cn, examples: examples, synonyms: synonyms, tip: tip },
      usage: aiResult.usage || null
    });
  } catch (e) {
    console.error('[ENGLISH-EXPLAIN] exception:', e && e.message);
    try { return res.status(500).json({ error: '服务异常: ' + (e.message || '未知') }); } catch (_) {}
  }
});

// GET /api/agent/chat/history - 获取当前用户 AI 聊天历史（按 conversation_id 分组）
// 查询策略：
//   - 带 conversation_id：只返回该 conv 的消息
//   - 不带 conversation_id：先查最近一条 AI 消息解析其 convId，再返回这个 conv 的消息
//   - 带 before（ISO 时间）：分页加载比 before 更早的消息（滚动加载更多用）
app.get('/api/agent/chat/history', authenticateUser, async (req, res) => {
  try {
    var userName = req.userName;
    var convId = String(req.query.conversation_id || '').trim();
    if (convId && !/^[A-Z0-9\-]{6,}$/i.test(convId)) return res.status(400).json({ error: 'conversation_id 格式无效' });
    var limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 100);
    var before = String(req.query.before || '').trim();

    // 不带 convId → 先查最近一条 AI 消息的 convId
    if (!convId) {
      var { data: latest } = await supabase.from('posts')
        .select('media_url')
        .eq('user_name', userName)
        .eq('media_type', AI_AGENT_MESSAGE_MARKER)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) {
        var meta = parseMsgMeta(latest);
        if (meta && meta.convId) convId = meta.convId;
      }
      if (!convId) {
        // 用户从未聊过天
        return res.json({ ok: true, conversation_id: null, messages: [] });
      }
    }

    // 查指定 convId 的消息（desc + limit+1 用于 has_more 检测）
    // ★ U3 修复: 多取一条避免 off-by-one
    var query = supabase.from('posts')
      .select('id, user_name, content, media_url, created_at')
      .eq('user_name', userName)
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .filter('actor_key', 'like', 'ai_msg_conv_' + convId + '_%')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    if (before) {
      query = query.lt('created_at', before);
    }

    var { data: rows, error } = await query;
    if (error) {
      console.error('[AGENT-CHAT] history query error:', error.message);
      return res.status(500).json({ error: '查询失败' });
    }

    // 过滤用户已删除的消息
    var filteredRows = (rows || []).filter(function(r2) {
      var meta = parseMsgMeta(r2);
      return !(meta && meta.deleted);
    });

    // 判断是否还有更多（filteredRows 超过 limit 表示有下一页）
    var hasMore = filteredRows.length > limit;
    var pageRows = hasMore ? filteredRows.slice(0, limit) : filteredRows;

    // 内存中稳定排序（created_at > seq > roleWeight）
    function getMsgSortKey(row) {
      var meta = parseMsgMeta(row);
      var created = new Date(row.created_at || 0).getTime() || 0;
      var seq = typeof meta.seq === 'number' ? meta.seq : 0;
      var roleWeight = meta.role === 'user' ? 1 : 2;
      return { created: created, seq: seq, roleWeight: roleWeight };
    }
    var sortedRows = pageRows.slice().sort(function(a, b) {
      var A = getMsgSortKey(a);
      var B = getMsgSortKey(b);
      if (A.created !== B.created) return A.created - B.created;
      if (A.seq !== B.seq) return A.seq - B.seq;
      return A.roleWeight - B.roleWeight;
    });

    return res.json({
      ok: true,
      conversation_id: convId,
      has_more: hasMore,
      oldest: sortedRows.length ? sortedRows[0].created_at : null,
      messages: sortedRows.map(function(r) {
        var m = parseMsgMeta(r);
        var content = r.content || '';
        var reasoning = m.reasoning || '';
        // 兼容旧格式：assistant 消息 content 可能为 JSON { reply, reasoning }
        if (m.role === 'assistant' && !reasoning) {
          try {
            var c = JSON.parse(r.content || '{}');
            if (c && typeof c.reply === 'string') {
              reasoning = c.reasoning || '';
              content = c.reply;
            }
          } catch(e) {
            try { console.warn('[AI-HIST] parse msg meta error:', e && e.message); } catch(ee) {}
          }
        }
        return {
          id: r.id,
          role: m.role || 'user',
          content: content,
          reasoning: reasoning,
          created_at: r.created_at,
          conversation_id: m.convId || convId,
          usage: m.usage || null,
          search_count: m.search_count || 0,
          search_query: m.search_query || '',
          // ★ P1 关键修复：返回完整 search_results + expires_at
          //   前端 1 天内可展开看标题列表
          //   1 天后只显示徽章，内容标记过期
          search_results: Array.isArray(m.search_results) ? m.search_results : [],
          search_expires_at: typeof m.search_expires_at === 'number' ? m.search_expires_at : 0,
          thinking_elapsed_ms: m.thinking_elapsed_ms || 0,
          // ★ 深度思考消息恢复所需字段
          deep_think: m.deep_think === true,
          agent_count: m.agent_count || 0,
          thinking_log: Array.isArray(m.thinking_log) ? m.thinking_log : [],
          worker_results: Array.isArray(m.worker_results) ? m.worker_results : [],
          think_duration_ms: typeof m.think_duration_ms === 'number' ? m.think_duration_ms : 0
        };
      })
    });
  } catch (e) {
    console.error('[AGENT-CHAT] history exception:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});


// ===================== 管理员 AI 管理接口 =====================
// GET /admin/ai-agent/config - 管理员获取 AI 完整配置
app.get('/admin/ai-agent/config', verifyToken, async (req, res) => {
  try {
    var config = await getAiConfig();
    return res.json({ ok: true, config: config });
  } catch (e) {
    console.error('[ADMIN-AI] GET config error:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// GET /admin/ai-agent/effective-prompt — 管理员查看当前生效的系统提示词
app.get('/admin/ai-agent/effective-prompt', verifyToken, async (req, res) => {
  try {
    var config = await getAiConfig();
    var corePrompt = buildAiCorePrompt(config);
    var allowWebSearch = config.allow_web_search === true || (config.search && config.search.allow_web_search === true);
    var rs = config.reply_style || {};
    return res.json({
      ok: true,
      config_version: config.avatar_version || 0,
      config_updated_at: config.updated_at || '',
      core_prompt: corePrompt,
      style_rules: rs,
      roleplay_enabled: config.roleplay && config.roleplay.enabled,
      search_enabled: allowWebSearch,
      model: config.model || {},
      default_thinking_mode: (config.model && config.model.default_thinking_mode) || 'max'
    });
  } catch (e) {
    console.error('[ADMIN-AI] effective-prompt error:', e.message);
    return res.status(500).json({ ok: false, error: '查询失败' });
  }
});

// POST /admin/ai-agent/config - 管理员更新 AI 配置
app.post('/admin/ai-agent/config', verifyToken, async (req, res) => {
  try {
    var body = req.body || {};
    var configPayload = migrateConfig(body);
    var name = String(configPayload.name || 'XTJ 智能助手').trim().slice(0, 30);
    var avatar = String(configPayload.avatar || '🤖').trim().slice(0, 10);
    var description = String(configPayload.description || '').trim().slice(0, 200);
    var persona = String(configPayload.persona || '').trim().slice(0, 500);
    var tone = String(configPayload.tone || '').trim().slice(0, 200);
    var systemPrompt = String(configPayload.system_prompt || '').trim().slice(0, 2000);
    var welcomeMessage = String(configPayload.welcome_message || '').trim().slice(0, 200);

    var nowIso = new Date().toISOString();

    // 读取现有配置，保留 avatar_url/avatar_type/avatar_version
    var existingConfig = await getAiConfig();
    var avatarUrl = existingConfig.avatar_url || '';
    var avatarType = existingConfig.avatar_type || 'emoji';
    var avatarVersion = existingConfig.avatar_version || 0;

    var payload = Object.assign({}, configPayload, {
      name: name, avatar: avatar, description: description, persona: persona,
      tone: tone, system_prompt: systemPrompt, welcome_message: welcomeMessage,
      avatar_url: avatarUrl, avatar_type: avatarType, avatar_version: avatarVersion,
      updated_at: nowIso, updated_by: req.adminName || 'admin'
    });

    var { data: existing } = await supabase.from('posts')
      .select('id')
      .eq('media_type', AI_AGENT_CONFIG_MARKER)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && existing.id) {
      await supabase.from('posts').update({ content: name, media_url: JSON.stringify(payload), created_at: nowIso }).eq('id', existing.id);
    } else {
      await supabase.from('posts').insert([{
        user_name: req.adminName || 'admin', content: name,
        media_type: AI_AGENT_CONFIG_MARKER, media_url: JSON.stringify(payload),
        actor_key: 'ai_config_' + Date.now()
      }]);
    }

    // 清理配置缓存
    aiConfigCache = null;
    aiConfigFetchedAt = 0;

    return res.json({ ok: true, config: payload });
  } catch (e) {
    console.error('[ADMIN-AI] POST config error:', e.message);
    return res.status(500).json({ error: '保存失败' });
  }
});

// POST /api/admin/ai-agent/avatar (旧路径 /admin/ai-agent/avatar 也保留)
// 管理员上传 AI 头像图片 — 使用 JSON base64（不依赖 multipart 解析）
async function handleAvatarUpload(req, res) {
  try {
    var body = req.body || {};
    var imageBase64 = String(body.image || '').trim();
    var ext = String(body.ext || 'png').toLowerCase();

    if (!imageBase64) {
      return res.status(400).json({ error: '缺少图片数据' });
    }
    
    var allowedExts = { png: true, jpg: true, jpeg: true, webp: true, gif: true };
    if (!allowedExts[ext]) {
      return res.status(400).json({ error: '只允许 png/jpg/webp/gif 格式' });
    }
    
    // 去掉 data:image/...;base64, 前缀
    var rawBase64 = imageBase64;
    var commaIdx = imageBase64.indexOf(',');
    if (commaIdx >= 0) rawBase64 = imageBase64.slice(commaIdx + 1);
    
    var imageBuffer;
    try { imageBuffer = Buffer.from(rawBase64, 'base64'); } catch (e) {
      return res.status(400).json({ error: '图片数据格式错误' });
    }
    
    if (!imageBuffer || imageBuffer.length < 20) {
      return res.status(400).json({ error: '图片数据无效' });
    }
    if (imageBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: '图片大小不能超过 5MB' });
    }
    
    // 生成安全文件名
    var safeName = 'ai_avatar_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
    var storagePath = 'avatars/' + safeName;
    
    // 上传到 Supabase Storage
    var contentTypeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
    var { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(storagePath, imageBuffer, {
        contentType: contentTypeMap[ext] || 'image/png',
        upsert: true
      });
    
    if (uploadError) {
      console.error('[ADMIN-AI] avatar upload error:', uploadError.message);
      return res.status(500).json({ error: '上传失败: ' + (uploadError.message || '') });
    }
    
    // 获取 public URL
    var { data: publicUrlData } = supabase.storage.from('uploads').getPublicUrl(storagePath);
    var publicUrl = publicUrlData ? publicUrlData.publicUrl : '';
    if (!publicUrl) {
      return res.status(500).json({ error: '获取图片地址失败' });
    }
    
    // 更新 AI 配置中的头像字段
    var existingConfig = await getAiConfig();
    var newVersion = (existingConfig.avatar_version || 0) + 1;
    var nowIso = new Date().toISOString();
    
    var updatedPayload = JSON.parse(JSON.stringify(existingConfig));
    updatedPayload.avatar_url = publicUrl;
    updatedPayload.avatar_type = 'image';
    updatedPayload.avatar_version = newVersion;
    updatedPayload.updated_at = nowIso;
    updatedPayload.updated_by = req.adminName || 'admin';
    
    // 查找已有配置记录并更新
    var { data: existing } = await supabase.from('posts')
      .select('id')
      .eq('media_type', AI_AGENT_CONFIG_MARKER)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (existing && existing.id) {
      await supabase.from('posts').update({
        media_url: JSON.stringify(updatedPayload),
        created_at: nowIso
      }).eq('id', existing.id);
    } else {
      await supabase.from('posts').insert([{
        user_name: req.adminName || 'admin',
        content: updatedPayload.name || 'AI',
        media_type: AI_AGENT_CONFIG_MARKER,
        media_url: JSON.stringify(updatedPayload),
        actor_key: 'ai_config_' + Date.now()
      }]);
    }
    
    // 清除配置缓存，使新头像立即可见
    aiConfigCache = null;
    aiConfigFetchedAt = 0;
    
    return res.json({
      ok: true,
      avatar_url: publicUrl,
      avatar_version: newVersion,
      message: '头像上传成功'
    });
  } catch (e) {
    console.error('[ADMIN-AI] avatar exception:', e && e.message);
    return res.status(500).json({ error: '上传失败: ' + (e.message || '未知错误') });
  }
}

app.post('/api/admin/ai-agent/avatar', verifyToken, express.json({ limit: '10mb' }), handleAvatarUpload);
app.post('/admin/ai-agent/avatar', verifyToken, express.json({ limit: '10mb' }), handleAvatarUpload);


// GET /admin/ai-agent/usage-summary - 管理员获取统计
// 默认只查最近 30 天数据，避免全表扫描拖死接口。
// 可通过 ?days=30 | 90 | all 切换窗口。
app.get('/admin/ai-agent/usage-summary', verifyToken, async (req, res) => {
  try {
    var daysParam = String(req.query.days || '30').toLowerCase();
    var days;
    var useAll = daysParam === 'all';
    if (useAll) {
      days = null;
    } else {
      days = parseInt(daysParam, 10);
      if (isNaN(days) || days < 1) days = 30;
      if (days > 365) days = 365; // 防止恶意查询过长时间范围
    }

    // 性能优化：assistant 消息通常占少数，limit 默认 10000 条
    // 按 created_at desc 拿最近 N 天 / 全部
    var query = supabase.from('posts')
      .select('user_name, content, media_url, created_at')
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .order('created_at', { ascending: false })
      .limit(10000);
    if (!useAll && days) {
      var since = new Date(Date.now() - days * 86400000).toISOString();
      query = query.gte('created_at', since);
    }

    var { data: allRows, error } = await query;
    if (error) {
      console.error('[ADMIN-AI] usage-summary query error:', error.message);
      return res.status(500).json({ error: '查询失败' });
    }

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayStr = today.toISOString();
    var totalCalls = 0, todayCalls = 0;
    var totalTokens = 0, todayTokens = 0;
    var totalInputTokens = 0, todayInputTokens = 0;
    var totalOutputTokens = 0, todayOutputTokens = 0;
    var totalCacheHit = 0, todayCacheHit = 0;
    var totalCacheMiss = 0, todayCacheMiss = 0;
    var totalCost = 0, todayCost = 0;
    var uniqueUsers = {};

    if (Array.isArray(allRows)) {
      allRows.forEach(function(r) {
        var meta = parseMsgMeta(r);
        if (meta.role === 'assistant') {
          totalCalls++;
          var isToday = r.created_at && r.created_at >= todayStr;
          if (isToday) todayCalls++;
          if (meta.usage) {
            var u = meta.usage;
            totalInputTokens += u.prompt_tokens || 0;
            totalOutputTokens += u.completion_tokens || 0;
            totalTokens += u.total_tokens || 0;
            if (typeof u.prompt_cache_hit_tokens === 'number')  totalCacheHit  += u.prompt_cache_hit_tokens;
            if (typeof u.prompt_cache_miss_tokens === 'number') totalCacheMiss += u.prompt_cache_miss_tokens;
            if (u.cost) totalCost += u.cost;
            if (isToday) {
              todayInputTokens += u.prompt_tokens || 0;
              todayOutputTokens += u.completion_tokens || 0;
              todayTokens += u.total_tokens || 0;
              if (typeof u.prompt_cache_hit_tokens === 'number')  todayCacheHit  += u.prompt_cache_hit_tokens;
              if (typeof u.prompt_cache_miss_tokens === 'number') todayCacheMiss += u.prompt_cache_miss_tokens;
              if (u.cost) todayCost += u.cost;
            }
          }
        }
        if (r.user_name) uniqueUsers[r.user_name] = true;
      });
    }

    // 缓存命中率 = hit / (hit + miss)，避免除 0
    function hitRate(hit, miss) {
      var total = hit + miss;
      if (!total) return 0;
      return Math.round((hit / total) * 10000) / 100; // 保留 2 位小数（百分比）
    }

    return res.json({
      ok: true,
      window_days: useAll ? 'all' : days,
      summary: {
        today_calls: todayCalls,
        today_input_tokens: todayInputTokens,
        today_output_tokens: todayOutputTokens,
        today_total_tokens: todayTokens,
        today_cache_hit_tokens: todayCacheHit,
        today_cache_miss_tokens: todayCacheMiss,
        today_cache_hit_rate: hitRate(todayCacheHit, todayCacheMiss),
        today_cost: Math.round(todayCost * 1000000) / 1000000,
        total_calls: totalCalls,
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        total_tokens: totalTokens,
        total_cache_hit_tokens: totalCacheHit,
        total_cache_miss_tokens: totalCacheMiss,
        total_cache_hit_rate: hitRate(totalCacheHit, totalCacheMiss),
        total_cost: Math.round(totalCost * 1000000) / 1000000,
        total_users: Object.keys(uniqueUsers).length,
        currency: DEEPSEEK_CURRENCY
      }
    });
  } catch (e) {
    console.error('[ADMIN-AI] usage-summary error:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// GET /admin/ai-agent/users - 管理员查看有 AI 聊天记录的用户列表（含 tokens 统计）
app.get('/admin/ai-agent/users', verifyToken, async (req, res) => {
  try {
    var days = parseInt(req.query.days, 10);
    if (isNaN(days) || days < 1) days = 90;
    if (days > 365) days = 365;
    var since = new Date(Date.now() - days * 86400000).toISOString();

    var { data: rows } = await supabase.from('posts')
      .select('user_name, media_url, created_at')
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50000);

    if (!Array.isArray(rows)) return res.json({ ok: true, users: [], window_days: days });

    var userMap = {};
    rows.forEach(function(r) {
      if (!r.user_name) return;
      if (!userMap[r.user_name]) {
        userMap[r.user_name] = {
          message_count: 0, convs: {},
          total_tokens: 0, input_tokens: 0, output_tokens: 0,
          cache_hit_tokens: 0, cache_miss_tokens: 0,
          total_cost: 0, last_at: null
        };
      }
      var u = userMap[r.user_name];
      u.message_count++;
      var meta = parseMsgMeta(r);
      if (meta.convId) u.convs[meta.convId] = (u.convs[meta.convId] || 0) + 1;
      if (meta.role === 'assistant' && meta.usage) {
        var x = meta.usage;
        u.input_tokens += x.prompt_tokens || 0;
        u.output_tokens += x.completion_tokens || 0;
        u.total_tokens += x.total_tokens || 0;
        if (typeof x.prompt_cache_hit_tokens === 'number')  u.cache_hit_tokens  += x.prompt_cache_hit_tokens;
        if (typeof x.prompt_cache_miss_tokens === 'number') u.cache_miss_tokens += x.prompt_cache_miss_tokens;
        if (x.cost) u.total_cost += x.cost;
      }
      if (!u.last_at || (r.created_at && r.created_at > u.last_at)) u.last_at = r.created_at;
    });

    function hitRate(hit, miss) {
      var total = hit + miss;
      if (!total) return 0;
      return Math.round((hit / total) * 10000) / 100;
    }

    var userList = [];
    for (var un in userMap) {
      var u = userMap[un];
      userList.push({
        user_name: un,
        message_count: u.message_count,
        conversation_count: Object.keys(u.convs).length,
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        total_tokens: u.total_tokens,
        cache_hit_tokens: u.cache_hit_tokens,
        cache_miss_tokens: u.cache_miss_tokens,
        cache_hit_rate: hitRate(u.cache_hit_tokens, u.cache_miss_tokens),
        total_cost: Math.round(u.total_cost * 1000000) / 1000000,
        last_at: u.last_at
      });
    }

    userList.sort(function(a, b) { return (b.last_at || '').localeCompare(a.last_at || ''); });

    return res.json({ ok: true, users: userList, window_days: days });
  } catch (e) {
    console.error('[ADMIN-AI] GET users error:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// GET /admin/ai-agent/conversations?user_name=xxx&days=30 - 获取用户对话列表
// 性能：限制最近 30 天，可通过 days 调整
app.get('/admin/ai-agent/conversations', verifyToken, async (req, res) => {
  try {
    var targetUser = String(req.query.user_name || '').trim();
    if (!targetUser) return res.status(400).json({ error: '缺少 user_name 参数' });

    var days = parseInt(req.query.days, 10);
    if (isNaN(days) || days < 1) days = 30;
    if (days > 365) days = 365;
    var since = new Date(Date.now() - days * 86400000).toISOString();

    var { data: rows } = await supabase.from('posts')
      .select('id, user_name, content, media_url, created_at')
      .eq('user_name', targetUser)
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(5000);

    if (!Array.isArray(rows)) return res.json({ ok: true, user_name: targetUser, conversations: [], window_days: days });

    // 按 conversation_id 分组
    var convMap = {};
    rows.forEach(function(r) {
      var meta = parseMsgMeta(r);
      var cid = meta.convId || 'legacy';
      if (!convMap[cid]) {
        convMap[cid] = {
          conversation_id: cid, messages: [],
          input_tokens: 0, output_tokens: 0, total_tokens: 0,
          cache_hit_tokens: 0, cache_miss_tokens: 0,
          total_cost: 0, model: null, last_thinking_mode: null
        };
      }
      var conv = convMap[cid];
      conv.messages.push({
        id: r.id,
        role: meta.role || 'user',
        content: r.content || '',
        reasoning: meta.reasoning || '',
        created_at: r.created_at,
        usage: meta.usage || null,
        conversation_id: meta.convId || null,
        search_count: meta.search_count || 0,
        search_query: meta.search_query || ''
      });
      if (meta.role === 'assistant' && meta.usage) {
        var x = meta.usage;
        conv.input_tokens += x.prompt_tokens || 0;
        conv.output_tokens += x.completion_tokens || 0;
        conv.total_tokens += x.total_tokens || 0;
        if (typeof x.prompt_cache_hit_tokens === 'number')  conv.cache_hit_tokens  += x.prompt_cache_hit_tokens;
        if (typeof x.prompt_cache_miss_tokens === 'number') conv.cache_miss_tokens += x.prompt_cache_miss_tokens;
        if (x.cost) conv.total_cost += x.cost;
        if (x.model) conv.model = x.model;
        if (x.thinking_mode) conv.last_thinking_mode = x.thinking_mode;
      }
    });

    function hitRate(hit, miss) {
      var total = hit + miss;
      if (!total) return 0;
      return Math.round((hit / total) * 10000) / 100;
    }

    var conversations = Object.keys(convMap).map(function(cid) {
      var conv = convMap[cid];
      var msgs = conv.messages;
      return {
        conversation_id: cid,
        message_count: msgs.length,
        created_at: msgs.length > 0 ? msgs[0].created_at : null,
        last_at: msgs.length > 0 ? msgs[msgs.length - 1].created_at : null,
        input_tokens: conv.input_tokens,
        output_tokens: conv.output_tokens,
        total_tokens: conv.total_tokens,
        cache_hit_tokens: conv.cache_hit_tokens,
        cache_miss_tokens: conv.cache_miss_tokens,
        cache_hit_rate: hitRate(conv.cache_hit_tokens, conv.cache_miss_tokens),
        total_cost: Math.round(conv.total_cost * 1000000) / 1000000,
        model: conv.model || DEEPSEEK_MODEL_REASONER,
        last_thinking_mode: conv.last_thinking_mode || 'off'
      };
    });

    conversations.sort(function(a, b) { return (b.last_at || '').localeCompare(a.last_at || ''); });

    return res.json({ ok: true, user_name: targetUser, conversations: conversations, window_days: days });
  } catch (e) {
    console.error('[ADMIN-AI] GET conversations exception:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// GET /admin/ai-agent/conversation?user_name=xxx&conversation_id=xxx - 获取指定对话详情
app.get('/admin/ai-agent/conversation', verifyToken, async (req, res) => {
  try {
    var targetUser = String(req.query.user_name || '').trim();
    var convId = String(req.query.conversation_id || '').trim();
    if (!targetUser || !convId) return res.status(400).json({ error: '缺少参数' });

    var query;
    if (convId === 'legacy') {
      // 旧数据没有 conversation_id，用 actor_key 模式匹配回退到普通查询
      var { data: rows } = await supabase.from('posts')
        .select('id, user_name, content, media_url, created_at')
        .eq('user_name', targetUser)
        .eq('media_type', AI_AGENT_MESSAGE_MARKER)
        .order('created_at', { ascending: true });
      // 按纯字符串 media_url 过滤（旧数据 media_url 是'user'或'assistant'）
      var legacyRows = (rows || []).filter(function(r) {
        var raw = r.media_url || '';
        return raw.indexOf('{') !== 0;
      });
      var msgs = legacyRows.map(function(r) {
        return {
          id: r.id, role: r.media_url === 'assistant' ? 'assistant' : 'user',
          content: r.content || '', created_at: r.created_at, usage: null
        };
      });
      return res.json({ ok: true, user_name: targetUser, conversation_id: 'legacy', messages: msgs });
    }

    var { data: rows } = await supabase.from('posts')
      .select('id, user_name, content, media_url, created_at')
      .eq('user_name', targetUser)
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .filter('actor_key', 'like', 'ai_msg_conv_' + convId + '_%')
      .order('created_at', { ascending: true });

    var msgs = (rows || []).map(function(r) {
      var meta = parseMsgMeta(r);
      return {
        id: r.id,
        role: meta.role || 'user',
        content: r.content || '',
        reasoning: meta.reasoning || '',
        created_at: r.created_at,
        usage: meta.usage || null,
        search_count: meta.search_count || 0,
        search_query: meta.search_query || ''
      };
    });

    return res.json({
      ok: true,
      user_name: targetUser,
      conversation_id: convId,
      messages: msgs
    });
  } catch (e) {
    console.error('[ADMIN-AI] GET conversation exception:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// POST /admin/ai-agent/cleanup — 清理过期的 AI 聊天记录
// older_than_days: 默认 30 天
app.post('/admin/ai-agent/cleanup', verifyToken, async (req, res) => {
  try {
    var olderThanDays = parseInt(req.body && req.body.older_than_days, 10);
    if (isNaN(olderThanDays) || olderThanDays < 7) olderThanDays = 30;
    if (olderThanDays > 365) olderThanDays = 365;
    var cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();

    var { count, error: countErr } = await supabase.from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .lt('created_at', cutoff);
    if (countErr) return res.status(500).json({ error: '计数失败: ' + sanitizeError(countErr) });

    if (!count) return res.json({ ok: true, deleted: 0, message: '没有需要清理的记录' });

    var deleted = 0;
    var batchSize = 500;
    while (deleted < count) {
      var { error: delErr } = await supabase.from('posts')
        .delete()
        .eq('media_type', AI_AGENT_MESSAGE_MARKER)
        .lt('created_at', cutoff)
        .limit(batchSize);
      if (delErr) return res.status(500).json({ error: '删除失败: ' + sanitizeError(delErr), deleted: deleted, total: count });
      deleted += batchSize;
      await new Promise(function(r) { setTimeout(r, 200); });
    }

    console.warn('[ADMIN-CLEANUP] 清理完成: 删除 ' + deleted + ' 条 ' + olderThanDays + ' 天前的 AI 消息');
    return res.json({ ok: true, deleted: deleted, older_than_days: olderThanDays, cutoff: cutoff });
  } catch (e) {
    console.error('[ADMIN-CLEANUP] exception:', e && e.message);
    return res.status(500).json({ error: '清理异常: ' + (e && e.message || '') });
  }
});


// 自动清理旧日志（每24小时执行一次）
setInterval(function() {
  cleanupOldLogs('login').catch(function() {});
  cleanupOldLogs('security').catch(function() {});
  cleanupOldLogs('error').catch(function() {});
}, 24 * 60 * 60 * 1000);

// 自动清理 AI 聊天记录 (每天一次)
var _aiCleanupLock = false;
async function autoCleanupAiMessages() {
  if (_aiCleanupLock) return;
  _aiCleanupLock = true;
  try {
    var cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    var { count, error: countErr } = await supabase.from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .lt('created_at', cutoff);
    if (countErr || !count) { _aiCleanupLock = false; return; }

    // 安全阀：如果待删除占比超过 50%，说明窗口变更过大，跳过本轮避免误删
    var { count: totalAll } = await supabase.from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('media_type', AI_AGENT_MESSAGE_MARKER);
    if (totalAll && count > totalAll * 0.5) {
      console.warn('[AUTO-CLEANUP] 跳过本轮：待删除 ' + count + ' 条/共 ' + totalAll + ' 条，占比过高避免误删');
      _aiCleanupLock = false;
      return;
    }

    var deleted = 0;
    while (deleted < count) {
      var { error: delErr } = await supabase.from('posts').delete().eq('media_type', AI_AGENT_MESSAGE_MARKER).lt('created_at', cutoff).limit(500);
      if (delErr) { console.error('[AUTO-CLEANUP] delete error:', delErr && delErr.message); break; }
      deleted += 500;
      await new Promise(function(r) { setTimeout(r, 300); });
    }
    console.warn('[AUTO-CLEANUP] 已清理 ' + Math.min(deleted, count || 0) + ' 条 7 天前的 AI 消息');
  } catch (e) { console.warn('[AUTO-CLEANUP] cleanup failed:', e && e.message); }
  _aiCleanupLock = false;
}
setInterval(autoCleanupAiMessages, 24 * 60 * 60 * 1000);
// 服务启动 30s 后执行首次清理
setTimeout(function() { autoCleanupAiMessages().catch(function() {}); }, 30000);

// ===================== 全局错误处理 =====================
process.on('uncaughtException', function(err) {
  console.error('[FATAL] uncaughtException:', err && err.message || err);
});
process.on('unhandledRejection', function(reason) {
  console.error('[FATAL] unhandledRejection:', reason && reason.message || reason);
});

// ===================== 启动 =====================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[xtj-admin-api] running on port ${port}`);
  console.log(`[xtj-admin-api] password configured: ${ADMIN_PASSWORD ? 'yes' : 'no'}`);
  console.log(`[xtj-admin-api] supabase key type: ${SUPABASE_SERVICE_KEY ? 'service_role' : (process.env.SUPABASE_ANON_KEY ? 'anon' : 'none')}`);
  console.log(`[xtj-admin-api] allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`[AI-CONFIG] DEEPSEEK_MODEL_REASONER: ${DEEPSEEK_MODEL_REASONER}`);
  console.log(`[AI-CONFIG] API Key: ${DEEPSEEK_API_KEY ? '已配置' : '未配置'}`);
  console.log(`[AI-CONFIG] Rate Limit: 每小时${AI_AGENT_HOURLY_LIMIT}次 / 每天${AI_AGENT_DAILY_LIMIT}次`);
});
