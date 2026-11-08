'use strict';

// Tool definitions are most of the prompt: with ~70 tools they are tens of thousands of characters on every request.
// This keeps EVERY tool visible and callable (a tool the prompt promises but the array lacks makes the model say
// "I don't have that"), and only shrinks the definitions of tools the user's message does not look like it needs:
// the description keeps its first sentence and parameter descriptions are dropped (names, types, enums and
// "required" stay). A matched group, or any long or attachment-bearing message, keeps the full definitions.
const GROUPS = {
  // Always full: the everyday tools and the ones that talk to the user.
  core: ['search_web', 'read_web_page', 'get_current_time', 'calculate', 'task_plan', 'ask_user', 'save_memory', 'list_memories', 'forget_memory',
    'run_code', 'search_document', 'read_document_section', 'deep_research', 'render_card', 'wiki_summary', 'self_check'],
  // Extra search providers: search_web is always full, these only matter when the user is clearly looking something up.
  web: ['tavily_search', 'web_extract'],
  live: ['get_weather', 'get_exchange_rate', 'get_stock_quote', 'convert_units'],
  data: ['process_json', 'convert_data', 'sort_filter', 'batch_calc', 'markdown_table', 'text_stats', 'diff_text', 'regex_test', 'encode_decode', 'date_calc', 'make_file', 'generate_pdf', 'make_chart',
    'read_zip', 'read_document', 'image_info', 'image_process', 'qr_code', 'password_tool', 'url_parse', 'page_meta', 'extract_links'],
  site: ['search_posts', 'search_comments', 'search_photos', 'search_dm_messages', 'search_ai_history', 'search_users', 'search_everything', 'my_activity_summary', 'photo_timeline', 'site_navigate'],
  knowledge: ['search_social', 'search_papers', 'paper_by_doi', 'cite_format', 'github_repo', 'github_issues', 'npm_pypi_lookup', 'vuln_check', 'stackexchange_search', 'hn_search', 'wikidata_facts', 'dictionary',
    'rss_read', 'news_gdelt', 'wayback', 'verify_claims'],
  agent: ['parallel_subtasks', 'workspace_files', 'memory_update']
};
const PATTERNS = {
  web: /搜|查|找|检索|最新|新闻|网页|网站|官网|资料|链接|提取|了解|是什么|是谁|多少|哪里|哪个|怎么|为什么|search|latest|news|find/i,
  live: /天气|气温|温度|下雨|降雨|刮风|预报|汇率|兑换|换算|美元|日元|欧元|英镑|港币|人民币|外汇|股价|股票|行情|涨跌|基金|币价|比特币|单位|英里|公里|英寸|磅|盎司|摄氏|华氏|weather|forecast|exchange|stock|price|convert/i,
  data: /表格|csv|excel|xlsx|xls|json|数据|图表|折线|柱状|饼图|散点|画图|画个|可视化|pdf|导出|文件|下载|二维码|压缩|zip|图片|裁剪|缩放|正则|对比|差异|排序|去重|日期|天数|工作日|密码|编码|解码|base64|链接|网址|页面|标题和描述|元信息|统计|字数|批量|转换|生成|整理|chart|table|file|image|regex|diff|sort/i,
  site: /帖子|评论|私信|照片|相册|照片墙|站内|聊天记录|对话记录|历史对话|用户|动态|我的|我最近|以前聊|之前聊|跳转|打开|带我去|post|photo|comment|dm\b/i,
  knowledge: /论文|文献|引用|参考文献|arxiv|doi|github|仓库|issue|pull request|npm|pypi|依赖|漏洞|cve|stack\s?overflow|报错|hacker\s?news|\bhn\b|词典|单词|英文词|rss|订阅|新闻|快照|wayback|存档|核对|核实|验证|是真的吗|社交|小红书|微博|推特|twitter|reddit|知乎|什么意思|释义|怎么读|英文怎么说|同义词|反义词|以前长什么样|历史版本|旧版|以前的样子|网页变化|人口|出生日期|出生于|成立时间|总部|首都|面积|创始人/i,
  agent: /并行|分头|同时|各自|笔记|草稿|记下来|保存下来|存起来|文件空间|workspace|追加|记错|改成|纠正|更正|不对|更新记忆|修改记忆/i
};
// Real tasks are rarely shorter than this; small talk almost always is. A longer message keeps every definition.
const LONG_MESSAGE = 60;
// Words that mark a real task (plan, research, analysis, report ...): those keep every definition whatever the length.
const HEAVY_TASK = /方案|规划|计划|调研|调查|分析|评估|报告|研究|复盘|策略|清单|时间表|路线图|竞品|可行性|论证|综述|全面|详细对比|一步一步/;

function groupOf(name) {
  for (const key of Object.keys(GROUPS)) if (GROUPS[key].indexOf(name) >= 0) return key;
  return null;
}

// Which groups keep their full definitions for this request. null = everything stays full.
//   latest: the user's newest message (a long one means a real task, so nothing is shrunk)
//   context: the newest message plus a little recent user text, so a short follow-up like "再来一份" keeps the previous turn's tools
function route(input) {
  const o = input || {};
  const latest = String(o.latest || '');
  if (o.hasAttachments || !latest.trim() || latest.length >= LONG_MESSAGE || /https?:\/\//i.test(latest) || HEAVY_TASK.test(latest)) return null;
  const text = String(o.context || latest);
  const full = new Set(['core']);
  Object.keys(PATTERNS).forEach(key => { if (PATTERNS[key].test(text)) full.add(key); });
  return full;
}

function stripDescriptions(node) {
  if (Array.isArray(node)) return node.map(stripDescriptions);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  Object.keys(node).forEach(key => {
    if (key === 'description') return;
    out[key] = key === 'properties' ? Object.fromEntries(Object.entries(node[key]).map(([name, value]) => [name, stripDescriptions(value)])) : stripDescriptions(node[key]);
  });
  return out;
}
function compact(def) {
  const fn = def && def.function;
  if (!fn) return def;
  const first = String(fn.description || '').split(/[。.\n]/)[0].slice(0, 70);
  return { type: 'function', function: { name: fn.name, description: first, parameters: stripDescriptions(fn.parameters) } };
}

// Applies a route to a tool list. Order and names never change.
function apply(list, full) {
  if (!full) return list;
  return list.map(def => {
    const name = def && def.function && def.function.name;
    const group = groupOf(name);
    return group && !full.has(group) ? compact(def) : def;
  });
}

function routeBody(body) {
  const b = body || {};
  const latest = typeof b.message === 'string' ? b.message : '';
  const parts = [latest];
  ['history', 'messages'].forEach(name => {
    (Array.isArray(b[name]) ? b[name].slice(-4) : []).forEach(item => { if (item && item.role !== 'assistant' && typeof item.content === 'string') parts.push(item.content.slice(0, 300)); });
  });
  const hasAttachments = (Array.isArray(b.attachments) && b.attachments.length > 0) || (Array.isArray(b.vision_urls) && b.vision_urls.length > 0);
  return route({ latest, context: parts.filter(Boolean).join('\n'), hasAttachments });
}

// The route only ever grows inside one conversation. The system prompt and the tool array are the front of every upstream
// request, so changing them from turn to turn would throw away the provider's cached prefix of the whole history; growing
// them (small talk, then a chart request, then everything after a long message) costs one change per step instead.
function createStickyRoutes(options) {
  const o = options || {}, max = o.max || 500, ttl = o.ttl || 2 * 3600 * 1000, now = o.now || Date.now;
  const rows = new Map();
  function prune(at) {
    for (const [key, row] of rows) if (at - row.at > ttl) rows.delete(key);
    while (rows.size > max) rows.delete(rows.keys().next().value);
  }
  return {
    // route: a Set, or null for "everything". Returns the route to use for this request.
    apply(key, route) {
      if (!key) return route;
      const at = now(); prune(at);
      const prev = rows.get(key);
      let next;
      if (route === null || (prev && prev.full)) next = null;
      else next = new Set([...(prev ? prev.groups : []), ...route]);
      rows.delete(key); rows.set(key, { at, full: next === null, groups: next ? new Set(next) : null });
      prune(at); // enforce the size bound after the insert as well
      return next;
    },
    size: () => rows.size
  };
}
const stickyRoutes = createStickyRoutes();

module.exports = { GROUPS, PATTERNS, LONG_MESSAGE, HEAVY_TASK, groupOf, route, routeBody, compact, apply, createStickyRoutes, stickyRoutes };
