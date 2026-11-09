'use strict';

// Agent-level tools for the cat AI: site activity and photo timeline (read only), page navigation and
// "start deep research" cards (the user taps), parallel read-only subtasks, claim verification, a durable
// notes workspace and rich result cards. Everything that touches the outside world is injected, so tests
// run with fakes and the server decides quotas, billing and models.
const crypto = require('node:crypto');

const TOOL_NAMES = ['my_activity_summary', 'photo_timeline', 'site_navigate', 'deep_research', 'parallel_subtasks', 'verify_claims', 'self_check', 'workspace_files', 'render_card'];
// Tools that only make sense in the user's own chat: research workers and subtasks never get them.
const META_TOOL_NAMES = ['deep_research', 'parallel_subtasks', 'self_check', 'workspace_files', 'site_navigate', 'render_card', 'memory_update', 'save_memory', 'list_memories', 'forget_memory', 'ask_user'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGES = { home: '首页', photos: '照片墙', chat: '私信', profile: '我的' };

function tool(name, description, properties, required) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required: required || [] } } };
}
const str = (description, extra) => Object.assign({ type: 'string', description }, extra || {});
const int = (description, min, max) => ({ type: 'integer', description, minimum: min, maximum: max });

const TOOL_DEFS = [
  tool('my_activity_summary', '汇总我最近在站里的动态：发帖、评论、点赞、照片数量，以及最近几条内容。只读。', { days: int('统计最近多少天，默认 30', 1, 365) }),
  tool('photo_timeline', '按时间浏览照片墙：按月统计数量并列出代表照片，可用描述关键词（如地名）筛选。只读。', {
    from: str('起始日期 YYYY-MM-DD 或 YYYY-MM'), to: str('结束日期 YYYY-MM-DD 或 YYYY-MM'), keyword: str('描述关键词，如地名'),
    scope: str('范围，默认 mine', { enum: ['mine', 'visible'] }), limit: int('最多列出几张，默认 12', 1, 40)
  }),
  tool('site_navigate', '给用户一个按钮，点一下就跳到站内页面、某个帖子或某个用户。不会自动跳转。', {
    page: str('目标', { enum: ['home', 'photos', 'chat', 'profile', 'post', 'user', 'dm'] }), target: str('post 填帖子编号；user 或 dm 填用户名'), label: str('按钮文字，可空')
  }, ['page']),
  tool('deep_research', '问题复杂、需要多来源长报告时，给用户一个「开始深入研究」按钮（耗时数分钟、消耗额度，由用户点击确认）。调用后只简短说明，不要自己假装做完了。', {
    topic: str('研究主题，写成完整清楚的一句话（至少 6 个字）'), note: str('为什么建议深入研究，一句话')
  }, ['topic']),
  tool('parallel_subtasks', '把一个大任务拆成 2 到 4 个互不依赖的只读子任务并行执行（可搜索、读网页、计算），再由你汇总。只在确实能并行时用，成本较高。', {
    tasks: { type: 'array', minItems: 2, maxItems: 4, description: '子任务列表', items: { type: 'object', properties: { title: str('子任务名，几个字'), instruction: str('完整、自包含的指令，写清要查什么、要什么格式') }, required: ['title', 'instruction'] } }
  }, ['tasks']),
  tool('verify_claims', '核对 1 到 3 条关键事实（数字、日期、人名、政策等）：分别检索并按来源域名归类证据，告诉你有几个独立来源。结论由你根据证据判断。', {
    claims: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' }, description: '要核对的陈述，每条一句话' }
  }, ['claims']),
  tool('self_check', '回答前自查：提交你的回答草稿，审稿员返回未回答的问题、无来源的数字、可能的矛盾。回答里有关键数字日期或问题很多时，发出前调用一次。', {
    question: str('用户的原问题'), draft: str('你准备给用户的完整回答草稿'), evidence: str('你用到的来源和关键事实，可空')
  }, ['question', 'draft']),
  tool('workspace_files', '我的笔记空间：跨对话保存、读取、追加、删除文本笔记（如草稿、清单、资料摘录）。', {
    action: str('操作', { enum: ['list', 'read', 'write', 'append', 'delete'] }), title: str('笔记标题，read/write/append/delete 用'), content: str('正文，write/append 用，最多 20000 字')
  }, ['action']),
  tool('render_card', '把结构化内容渲染成卡片：compare 对比表、timeline 时间线、checklist 清单、stats 数据概览。比长段文字更清楚时用，用完不要再在正文重复。', {
    variant: str('卡片类型', { enum: ['compare', 'timeline', 'checklist', 'stats'] }), title: str('卡片标题'),
    columns: { type: 'array', items: { type: 'string' }, description: 'compare：列名，2 到 6 个' },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'compare：每行与列对应，最多 12 行' },
    items: { type: 'array', description: 'timeline: {time,title,detail}；checklist: {text,done}；stats: {label,value,note}', items: { type: 'object' } }
  }, ['variant', 'title'])
];

function clip(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, Math.max(0, max - 1)) + '…' : text;
}
function fail(name, message) { return { tool_name: name, error: message }; }
function hostOf(url) { try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch (_) { return ''; } }
function dateBound(value, end) {
  const text = String(value || '').trim();
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (end ? 1 : 0))); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  m = text.match(/^(\d{4})-(\d{2})$/);
  if (m) { const d = new Date(Date.UTC(+m[1], +m[2] - 1 + (end ? 1 : 0), 1)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  return null;
}

function createAgentTools(deps) {
  const d = deps || {};
  const makeCard = d.makeCard || ((type, title, data) => ({ protocol: 'xtj.ai.ui.v1', id: 'card_' + crypto.randomUUID(), type, title, data: data || {}, actions: [] }));
  const siteText = d.siteText || (v => String(v == null ? '' : v));
  const user = ctx => String(ctx && ctx.userName || '').trim();
  const loggedIn = ctx => !!user(ctx) && !(ctx && ctx.guest);

  // ---- read-only site data ----
  async function my_activity_summary(args, ctx) {
    if (!loggedIn(ctx)) return fail('my_activity_summary', '需要登录后才能查看自己的动态');
    const days = Number.isInteger(args.days) ? Math.min(365, Math.max(1, args.days)) : 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const me = user(ctx), db = d.supabase;
    const posts = d.normalPostAllowlist(db.from('posts').select('id,content,created_at,visibility', { count: 'exact' }).eq('user_name', me).gte('created_at', since)).order('created_at', { ascending: false }).limit(6);
    const comments = db.from('comments').select('id,post_id,content,created_at', { count: 'exact' }).eq('user_name', me).gte('created_at', since).order('created_at', { ascending: false }).limit(4);
    const likes = db.from('likes').select('id', { count: 'exact', head: true }).eq('user_name', me).gte('created_at', since);
    const photos = db.from('posts').select('id,content,created_at', { count: 'exact' }).eq('user_name', me).eq('media_type', '__photo_wall__').or('is_deleted.is.null,is_deleted.eq.false').gte('created_at', since).order('created_at', { ascending: false }).limit(4);
    const [p, c, l, ph] = await Promise.allSettled([posts, comments, likes, photos]);
    const ok = r => r.status === 'fulfilled' && r.value && !r.value.error;
    const num = r => ok(r) ? (Number.isFinite(r.value.count) ? r.value.count : (r.value.data || []).length) : null;
    const lines = ['最近 ' + days + ' 天（' + me + '）：'];
    lines.push('发帖 ' + (num(p) == null ? '暂时读不到' : num(p) + ' 条') + '｜评论 ' + (num(c) == null ? '暂时读不到' : num(c) + ' 条') + '｜点赞 ' + (num(l) == null ? '暂时读不到' : num(l) + ' 次') + '｜照片 ' + (num(ph) == null ? '暂时读不到' : num(ph) + ' 张'));
    const results = [];
    if (ok(p)) (p.value.data || []).filter(row => d.isNormalPost ? d.isNormalPost(row) : true).slice(0, 4).forEach(row => {
      const snippet = clip(siteText(row.content, 400), 120);
      lines.push('· 帖子 ' + String(row.created_at || '').slice(0, 10) + '：' + (snippet || '（无文字）'));
      results.push(d.siteResult('posts', row.id, '我的帖子', snippet, row.created_at, { type: 'post', post_id: row.id }));
    });
    if (ok(c)) (c.value.data || []).slice(0, 3).forEach(row => lines.push('· 评论 ' + String(row.created_at || '').slice(0, 10) + '：' + clip(siteText(row.content, 300), 100)));
    if (ok(ph)) (ph.value.data || []).slice(0, 3).forEach(row => {
      const snippet = clip(siteText(row.content, 300), 100);
      lines.push('· 照片 ' + String(row.created_at || '').slice(0, 10) + '：' + (snippet || '（无描述）'));
      if (d.photoUrl) results.push(d.siteResult('photos', row.id, '我的照片', snippet, row.created_at, { type: 'photo', post_id: row.id, image_url: d.photoUrl(row.id), user_name: me }));
    });
    const out = { tool_name: 'my_activity_summary', results_count: results.length, content: lines.join('\n') };
    if (results.length) out.cards = [makeCard('search_results', '我最近的动态', { results })];
    return out;
  }

  async function photo_timeline(args, ctx) {
    if (!loggedIn(ctx)) return fail('photo_timeline', '需要登录后才能浏览照片墙');
    const from = args.from ? dateBound(args.from, false) : null, to = args.to ? dateBound(args.to, true) : null;
    if ((args.from && !from) || (args.to && !to)) return fail('photo_timeline', '日期格式应为 YYYY-MM-DD 或 YYYY-MM');
    const keyword = clip(args.keyword, 40), limit = Number.isInteger(args.limit) ? Math.min(40, Math.max(1, args.limit)) : 12;
    const me = user(ctx), mine = args.scope !== 'visible';
    let q = d.supabase.from('posts').select('id,user_name,content,created_at,visibility').eq('media_type', '__photo_wall__').or('is_deleted.is.null,is_deleted.eq.false');
    if (mine) q = q.eq('user_name', me);
    if (from) q = q.gte('created_at', from);
    if (to) q = q.lt('created_at', to);
    const res = await q.order('created_at', { ascending: false }).limit(400);
    if (res.error) return fail('photo_timeline', '照片墙暂时读不到，请稍后再试');
    let rows = (res.data || []).filter(r => r.visibility !== 'private' || r.user_name === me);
    if (keyword) rows = rows.filter(r => siteText(r.content, 500).toLowerCase().includes(keyword.toLowerCase()) || String(r.user_name || '').toLowerCase().includes(keyword.toLowerCase()));
    if (!rows.length) return { tool_name: 'photo_timeline', results_count: 0, content: '这段时间没有符合条件的照片。' };
    const byMonth = new Map();
    rows.forEach(r => { const key = String(r.created_at || '').slice(0, 7); if (!byMonth.has(key)) byMonth.set(key, []); byMonth.get(key).push(r); });
    const lines = ['共 ' + rows.length + ' 张' + (rows.length >= 400 ? '（只统计最近 400 张）' : '') + '，按月份：'];
    Array.from(byMonth.keys()).sort().reverse().slice(0, 18).forEach(month => {
      const list = byMonth.get(month);
      const samples = list.slice(0, 2).map(r => clip(siteText(r.content, 200), 30)).filter(Boolean);
      lines.push(month + '：' + list.length + ' 张' + (samples.length ? '（' + samples.join('、') + '）' : ''));
    });
    const results = rows.slice(0, limit).map(r => d.siteResult('photos', r.id, (r.user_name === me ? '我' : r.user_name) + ' 的照片', clip(siteText(r.content, 300), 100), r.created_at, { type: 'photo', post_id: r.id, image_url: d.photoUrl ? d.photoUrl(r.id) : '', user_name: r.user_name }));
    return { tool_name: 'photo_timeline', results_count: rows.length, content: lines.join('\n'), cards: [makeCard('search_results', '照片时间线 · ' + rows.length + ' 张', { results })] };
  }

  // ---- cards the user taps ----
  async function site_navigate(args, ctx) {
    const page = String(args.page || '');
    const label = clip(args.label, 24);
    if (Object.prototype.hasOwnProperty.call(PAGES, page)) {
      return { tool_name: 'site_navigate', content: '已给用户一个「' + (label || '打开' + PAGES[page]) + '」按钮，点一下才会跳转。', cards: [makeCard('navigate', '站内跳转', { page, label: label || '打开' + PAGES[page] })] };
    }
    const target = String(args.target || '').trim();
    if (page === 'post') {
      if (!UUID.test(target)) return fail('site_navigate', '帖子编号无效，请先用 search_posts 找到帖子');
      if (d.supabase) {
        const found = await d.supabase.from('posts').select('id,user_name,visibility,media_type').eq('id', target).maybeSingle();
        const row = found && found.data;
        if (!row || (d.isNormalPost && !d.isNormalPost(row)) || (row.visibility === 'private' && row.user_name !== user(ctx))) return fail('site_navigate', '没有找到这个帖子，或你没有权限查看');
      }
      return { tool_name: 'site_navigate', content: '已给用户一个打开帖子的按钮。', cards: [makeCard('navigate', '站内跳转', { page, target: target.toLowerCase(), label: label || '打开帖子' })] };
    }
    if (page === 'user' || page === 'dm') {
      if (!target || target.length > 40 || /[\u0000-\u001f\u007f/\\<>]/.test(target)) return fail('site_navigate', '用户名无效');
      return { tool_name: 'site_navigate', content: '已给用户一个' + (page === 'dm' ? '打开私信' : '打开主页') + '的按钮。', cards: [makeCard('navigate', '站内跳转', { page, target, label: label || (page === 'dm' ? '私信 ' + target : '查看 ' + target) })] };
    }
    return fail('site_navigate', '不支持的目标页面');
  }

  async function deep_research(args, ctx) {
    if (!loggedIn(ctx)) return fail('deep_research', '深入研究需要登录后使用');
    const topic = clip(args.topic, 300);
    if (topic.length < 6) return fail('deep_research', '研究主题太短，请写成完整清楚的一句话');
    const note = clip(args.note, 120);
    return {
      tool_name: 'deep_research',
      content: '已向用户展示「开始深入研究」按钮（主题：' + topic + '）。研究要几分钟、会消耗额度，由用户点按钮决定。现在只用一两句话说明为什么建议深入研究，并先给出你已经能确定的要点，不要声称研究已经开始或完成。',
      cards: [makeCard('research_offer', '建议深入研究', { topic, note })]
    };
  }

  // ---- parallel read-only subtasks ----
  async function parallel_subtasks(args, ctx) {
    if (!loggedIn(ctx)) return fail('parallel_subtasks', '需要登录后使用');
    const raw = Array.isArray(args.tasks) ? args.tasks : [];
    const tasks = raw.map(t => ({ title: clip(t && t.title, 30), instruction: clip(t && t.instruction, 700) })).filter(t => t.title && t.instruction.length >= 6).slice(0, 4);
    if (tasks.length < 2) return fail('parallel_subtasks', '至少需要 2 个有效的子任务（标题和完整指令）；只有一件事就直接做，不必并行');
    if (!d.runSubtask) return fail('parallel_subtasks', '并行子任务暂不可用');
    ctx.__subtaskRuns = (ctx.__subtaskRuns || 0) + 1;
    if (ctx.__subtaskRuns > 2) return fail('parallel_subtasks', '这一轮对话已经用过两次并行子任务，请基于已有结果直接汇总');
    const settled = await Promise.allSettled(tasks.map(t => d.runSubtask(t, ctx)));
    const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, reasoning_tokens: 0 };
    let model = '';
    const done = settled.map((r, i) => {
      if (r.status !== 'fulfilled' || !r.value) return { title: tasks[i].title, ok: false, text: '', error: clip(r.reason && r.reason.message || '执行失败', 80) };
      const u = r.value.usage || {};
      usage.prompt_tokens += Number(u.prompt_tokens || u.input_tokens) || 0; usage.completion_tokens += Number(u.completion_tokens || u.output_tokens) || 0;
      usage.total_tokens += Number(u.total_tokens) || 0; usage.reasoning_tokens += Number(u.reasoning_tokens) || 0;
      model = model || r.value.model || '';
      const text = String(r.value.text || '').trim();
      return text ? { title: tasks[i].title, ok: true, text: text.slice(0, 2500) } : { title: tasks[i].title, ok: false, text: '', error: '没有产出结果' };
    });
    // The subtasks ran extra model calls; bill them to the user's account like any other turn.
    if (d.recordUsage && usage.total_tokens > 0) { try { await d.recordUsage(user(ctx), Object.assign({ model }, usage), { source: 'parallel_subtasks', model, conversationId: ctx.conversationId || null }); } catch (_) { /* billing failures are logged by the recorder */ } }
    if (!done.some(t => t.ok)) return fail('parallel_subtasks', '所有子任务都没有产出结果，请直接用常规方式完成，或稍后再试');
    const content = '并行执行了 ' + tasks.length + ' 个子任务，成功 ' + done.filter(t => t.ok).length + ' 个。请你汇总，指出子任务之间的矛盾，不要把下面的内部格式念给用户：\n\n' +
      done.map((t, i) => '【子任务 ' + (i + 1) + '：' + t.title + '】' + (t.ok ? '\n' + t.text : '（失败：' + t.error + '）')).join('\n\n');
    return { tool_name: 'parallel_subtasks', results_count: done.length, content, cards: [makeCard('info_card', '并行子任务', { subtitle: '完成 ' + done.filter(t => t.ok).length + ' / ' + done.length, text: done.map(t => (t.ok ? '✓ ' : '✗ ') + t.title).join('\n'), facts: [] })] };
  }

  // ---- claim verification ----
  async function verify_claims(args, ctx) {
    const claims = (Array.isArray(args.claims) ? args.claims : []).map(c => clip(c, 200)).filter(c => c.length >= 4).slice(0, 3);
    if (!claims.length) return fail('verify_claims', '请提供要核对的陈述（1 到 3 条，每条一句话）');
    if (!d.executeToolCall) return fail('verify_claims', '核对功能暂不可用');
    const searched = await Promise.all(claims.map(async claim => {
      const res = await d.executeToolCall({ id: 'verify_' + crypto.randomUUID(), type: 'function', function: { name: 'search_web', arguments: JSON.stringify({ query: claim, max_results: 8 }) } }, ctx);
      return { claim, res: res || {} };
    }));
    const blocks = [];
    const summary = [];
    searched.forEach(({ claim, res }, index) => {
      if (res.error) { blocks.push('【' + (index + 1) + '】' + claim + '\n无法检索：' + res.error); summary.push('✗ ' + claim); return; }
      // search_web hands its results to the model as a JSON string in `content`; its own card is not forwarded here.
      let parsed = [];
      try { parsed = typeof res.content === 'string' ? JSON.parse(res.content) : (Array.isArray(res.content) ? res.content : []); } catch (_) { parsed = []; }
      const items = (Array.isArray(parsed) && parsed.length ? parsed : (res.results || [])).filter(r => r && r.url);
      const byHost = new Map();
      items.forEach(r => { const host = hostOf(r.url); if (!host) return; if (!byHost.has(host)) byHost.set(host, r); });
      const sources = Array.from(byHost.values()).slice(0, 5);
      const level = byHost.size >= 2 ? '有 ' + byHost.size + ' 个不同域名的来源' : byHost.size === 1 ? '只有 1 个来源域名，证据偏薄' : '没有检索到相关来源';
      blocks.push('【' + (index + 1) + '】' + claim + '\n' + level + '：\n' + (sources.length ? sources.map(r => '- ' + hostOf(r.url) + '｜' + clip(r.title, 80) + '｜' + clip(r.snippet || r.summary, 160) + '｜' + r.url).join('\n') : '（无）'));
      summary.push((byHost.size >= 2 ? '✓ ' : '? ') + claim);
    });
    const content = '核对结果（只是证据整理，是否成立由你判断；关键数字请再用 read_web_page 读原始出处，互相矛盾要如实指出，来源太少就明说“仅一个来源”）：\n\n' + blocks.join('\n\n');
    return { tool_name: 'verify_claims', results_count: claims.length, content, cards: [makeCard('info_card', '事实核对', { subtitle: claims.length + ' 条', text: summary.join('\n'), facts: [] })] };
  }

  // ---- answer self-check: a fast model plays the strict reviewer, before the answer is streamed ----
  async function self_check(args, ctx) {
    if (!loggedIn(ctx)) return fail('self_check', '需要登录后使用');
    const question = clip(args.question, 600);
    const draft = String(args.draft == null ? '' : args.draft).replace(/\u0000/g, '').trim().slice(0, 6000);
    const evidence = clip(args.evidence, 1500);
    if (!question) return fail('self_check', '请提供用户的原问题');
    if (draft.length < 20) return fail('self_check', '回答草稿太短，没有自查的必要，直接回答即可');
    if (!d.runCritic) return fail('self_check', '回答自查暂不可用，直接回答即可');
    ctx.__selfChecks = (ctx.__selfChecks || 0) + 1;
    if (ctx.__selfChecks > 2) return fail('self_check', '这一轮已经自查过两次，请直接给出最终回答');
    let result;
    try { result = await d.runCritic({ question, draft, evidence }, ctx); }
    catch (error) { return fail('self_check', '自查暂时不可用，直接回答即可（' + clip(error && error.message, 60) + '）'); }
    const usage = result && result.usage || {};
    const total = Number(usage.total_tokens) || ((Number(usage.prompt_tokens || usage.input_tokens) || 0) + (Number(usage.completion_tokens || usage.output_tokens) || 0));
    if (d.recordUsage && total > 0) { try { await d.recordUsage(user(ctx), Object.assign({ model: result.model || '' }, usage, { total_tokens: total }), { source: 'self_check', model: result.model || '', conversationId: ctx.conversationId || null }); } catch (_) { /* logged by the recorder */ } }
    const text = String(result && result.text || '').trim().slice(0, 1500);
    if (!text) return fail('self_check', '审稿员没有给出意见，直接回答即可');
    if (/未发现明显问题/.test(text) && text.length < 40) return { tool_name: 'self_check', content: '自查：未发现明显问题，可以直接回答。' };
    return { tool_name: 'self_check', content: '自查意见（供你修改回答；成立的就改，不成立的忽略；不要把这段原样念给用户）：\n' + text };
  }

  // ---- durable notes workspace (stored as workbench "note" assets, no new table) ----
  async function workspace_files(args, ctx) {
    if (!loggedIn(ctx) || !ctx.accountId) return fail('workspace_files', '需要登录后才能使用笔记空间');
    if (!d.assets) return fail('workspace_files', '笔记空间暂不可用');
    const owner = { userName: user(ctx), accountId: String(ctx.accountId) };
    const action = String(args.action || '');
    const title = clip(args.title, 120);
    const content = String(args.content == null ? '' : args.content).replace(/\u0000/g, '').slice(0, 20000);
    const storageFailure = error => {
      const code = error && error.code;
      if (code === 'asset_limit') return fail('workspace_files', '笔记空间已满，请先删除一些笔记');
      if (code === 'asset_conflict') return fail('workspace_files', '这篇笔记刚刚被修改过，请先 read 再改');
      return fail('workspace_files', '笔记空间暂时不可用，请稍后再试');
    };
    try {
      const all = (await d.assets.list(owner)).filter(r => r && r.kind === 'note');
      const find = () => all.find(r => r.title === title) || all.find(r => r.title && r.title.toLowerCase() === title.toLowerCase());
      if (action === 'list') {
        if (!all.length) return { tool_name: 'workspace_files', content: '笔记空间是空的。', results_count: 0 };
        return { tool_name: 'workspace_files', results_count: all.length, content: '共 ' + all.length + ' 篇笔记：\n' + all.slice(0, 40).map(r => '- ' + r.title + '（更新 ' + String(r.updated_at || '').slice(0, 10) + '）').join('\n') };
      }
      if (!title) return fail('workspace_files', '请提供笔记标题');
      if (action === 'read') {
        const hit = find(); if (!hit) return fail('workspace_files', '没有找到标题为「' + title + '」的笔记');
        const full = await d.assets.get(owner, hit.id);
        const data = full && full.data || {};
        return { tool_name: 'workspace_files', title: hit.title, content: '《' + hit.title + '》\n' + String(data.text != null ? data.text : data.summary || '') };
      }
      if (action === 'delete') {
        const hit = find(); if (!hit) return fail('workspace_files', '没有找到标题为「' + title + '」的笔记');
        await d.assets.remove(owner, hit.id);
        return { tool_name: 'workspace_files', content: '已删除笔记《' + hit.title + '》。' };
      }
      if (action === 'write' || action === 'append') {
        if (!content.trim()) return fail('workspace_files', '正文为空');
        const hit = find();
        let text = content;
        if (action === 'append' && hit) {
          const full = await d.assets.get(owner, hit.id);
          const old = String(full && full.data && (full.data.text != null ? full.data.text : full.data.summary) || '');
          text = (old ? old + '\n' : '') + content;
          if (text.length > 20000) return fail('workspace_files', '追加后超过 20000 字，请拆成新笔记');
        }
        const today = new Date().toISOString().slice(0, 10);
        const saved = await d.assets.save(owner, { id: hit && hit.id, updated_at: hit && hit.updated_at, kind: 'note', title: hit ? hit.title : title, data: { title: hit ? hit.title : title, summary: clip(text, 300), text, date: today } });
        return { tool_name: 'workspace_files', title: saved && saved.title || title, content: (hit ? (action === 'append' ? '已追加到' : '已更新') : '已创建') + '笔记《' + (hit ? hit.title : title) + '》（' + text.length + ' 字）。用户可在工作台的成果里看到它。',
          cards: [makeCard('info_card', '笔记已保存', { subtitle: hit ? hit.title : title, text: clip(text, 300), facts: [['字数', String(text.length)]] })] };
      }
      return fail('workspace_files', '不支持的操作');
    } catch (error) { return storageFailure(error); }
  }

  // ---- rich result cards ----
  async function render_card(args) {
    const variant = String(args.variant || '');
    const title = clip(args.title, 80);
    if (!title) return fail('render_card', '请提供卡片标题');
    const items = Array.isArray(args.items) ? args.items.slice(0, 20) : [];
    let data;
    if (variant === 'compare') {
      const columns = (Array.isArray(args.columns) ? args.columns : []).map(c => clip(c, 30)).filter(Boolean).slice(0, 6);
      if (columns.length < 2) return fail('render_card', 'compare 需要 2 到 6 个列名');
      const rows = (Array.isArray(args.rows) ? args.rows : []).slice(0, 12).map(r => (Array.isArray(r) ? r : []).slice(0, columns.length).map(cell => clip(cell, 80)));
      if (!rows.length) return fail('render_card', 'compare 需要至少一行数据');
      rows.forEach(r => { while (r.length < columns.length) r.push(''); });
      data = { variant, columns, rows };
    } else if (variant === 'timeline') {
      const list = items.map(i => ({ time: clip(i && i.time, 30), title: clip(i && i.title, 80), detail: clip(i && i.detail, 160) })).filter(i => i.title);
      if (!list.length) return fail('render_card', 'timeline 需要 items：{time,title,detail}');
      data = { variant, items: list };
    } else if (variant === 'checklist') {
      const list = items.map(i => ({ text: clip(typeof i === 'string' ? i : i && i.text, 120), done: !!(i && typeof i === 'object' && i.done === true) })).filter(i => i.text);
      if (!list.length) return fail('render_card', 'checklist 需要 items：{text,done}');
      data = { variant, items: list };
    } else if (variant === 'stats') {
      const list = items.map(i => ({ label: clip(i && i.label, 30), value: clip(i && i.value, 40), note: clip(i && i.note, 60) })).filter(i => i.label && i.value);
      if (!list.length) return fail('render_card', 'stats 需要 items：{label,value,note}');
      data = { variant, items: list.slice(0, 8) };
    } else return fail('render_card', '不支持的卡片类型');
    return { tool_name: 'render_card', content: '卡片「' + title + '」已展示给用户。正文里不要再重复卡片里的内容，只补充结论或建议。', cards: [makeCard('rich_card', title, data)] };
  }

  const handlers = { my_activity_summary, photo_timeline, site_navigate, deep_research, parallel_subtasks, verify_claims, self_check, workspace_files, render_card };
  return {
    has: name => Object.prototype.hasOwnProperty.call(handlers, name),
    async execute(name, args, context) {
      if (!this.has(name)) return fail(name, '未知工具');
      try { return await handlers[name](args && typeof args === 'object' ? args : {}, context && typeof context === 'object' ? context : {}); }
      catch (error) { return fail(name, '工具执行失败：' + clip(error && error.message, 100)); }
    }
  };
}

module.exports = { createAgentTools, TOOL_DEFS, TOOL_NAMES, META_TOOL_NAMES, dateBound };
