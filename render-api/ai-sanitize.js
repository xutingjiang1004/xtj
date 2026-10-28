/**
 * Clean AI assistant visible text: strip stage-direction / action prose in parentheses.
 * Pure function — no DB or request state.
 *
 * 审计 🟡 XSS 职责声明：AI 输出是不可信数据（且受提示词注入影响）。本函数在第 0 步
 * 剥离危险标签/属性/协议（script、style、iframe、object、embed、on* 事件、
 * javascript:/data:text/html），这是主防线；前端 AI 回复经 renderMarkdown 后以
 * innerHTML 渲染，第 0 步剥离保证注入不落地。HTML 实体转义（&<>"'）以
 * options.escapeHtml=true 显式开启，供需要直接按纯文本（非 markdown）innerHTML
 * 渲染的消费方使用——实体转义会破坏 markdown 语法，故默认关闭。
 * **本函数不承担完整的 XSS 防护职责**——最终安全取决于渲染层与 markdown 渲染器。
 */
'use strict';

function sanitizeAssistantVisibleText(text, options) {
  var s = String(text || '');
  if (!s) return s;
  options = options || {};

  // 0. Strip dangerous HTML payloads (prompt-injection -> stored-XSS guard).
  //    These tags/attributes are never legitimate markdown, so removing them
  //    (including their inner content) cannot corrupt normal rendering.
  //    Decode numeric entities first so `&#106;avascript:` / `&#x6a;avascript:`
  //    are normalised before the scheme checks below.
  s = s.replace(/&#(x[0-9a-f]+|\d+);?/gi, function (m, code) {
    var n = code.charAt(0).toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
  s = s.replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*(script|style|iframe|object|embed)\s*>/gi, '');
  s = s.replace(/<\s*(script|style|iframe|object|embed)\b[^>]*\/?\s*>/gi, '');
  // Remove event-handler attributes (onclick/onerror/...).
  // 审计 🟡 属性分隔符放宽：旧 `\s+on...` 要求 "on" 前有空白，`<img/onerror=...>`（无空白
  // 分隔符）绕过；`\S*on...` 覆盖 `/`、引号、括号等紧邻分隔形式。代价是可能误伤形如
  // "phone=" 的词（"on" 前有字母），由前端渲染层最终兜底，此处主防线优先保证剥离。
  // ★ 修复：`\S{0,64}` 在无空白超长正文上仍会退化成 O(n²) 回溯（每个起点把
  //   剩余文本吃进量词再逐字符回退找 "on"）。改为固定边界的前缀 + 有界属性值，
  //   单次匹配代价为常数级；用捕获组保留分隔符，避免误删前面的 `/` 或引号。
  s = s.replace(/(^|[^\w-])on[a-z]{1,20}\s*=\s*(?:"[^"]{0,512}"|'[^']{0,512}'|[^\s>]{1,512})/gi, '$1 ');
  // Neutralize dangerous URL protocols that survive markdown rendering.
  // ① 实体编码 scheme 绕过（javascript&#58; / javascript&#x3a;）：markdown 链接
  // `[x](javascript&#58;alert(1))` 渲染后浏览器解码属性值为 javascript: 即恢复执行。
  // 先把危险 scheme 后的冒号数字实体（&#58;/&#x3a;）归一化为字面冒号供下方正则命中。
  s = s.replace(/(javascript|vbscript|data)\s*(?:&#(?:0*58|x0*3a);?)/gi, '$1:');
  s = s.replace(/\b(?:java|vb)[\s\u0000-\u0020]*script[\s\u0000-\u0020]*:/gi, ' ');
  // ③ 补充 vbscript:（IE 时代脚本协议）与可内嵌脚本的 data:image/svg+xml 中和
  s = s.replace(/\bvbscript\s*:/gi, ' ');
  s = s.replace(/\bdata[\s\u0000-\u0020]*:\s*(?:text\/html|image\/svg\+xml)\b/gi, ' ');

  // When roleplay is on, skip action cleanup so backend does not rewrite RP style.
  if (options.skipActionCleanup) return s;

  // 1. Drop standalone parenthetical lines (full/half width / square brackets, ≥3 chars).
  //    Whitelist lines that look like API notes, prices, versions, links, etc.
  s = s.split(/\r?\n/).map(function(line) {
    var m = line.match(/^\s*[（(【][^）)】]{3,200}[）)】]\s*$/);
    if (!m) return line;
    var inner = m[0].replace(/[（(【）)】\s]/g, '');
    if (/^(?:api|v\d|http|https|www|价格|元|美元|欧元|港元|台币|万|亿|GB|MB|KB|版|号|年|月|日|周)/i.test(inner) || /[0-9]/.test(inner)) return line;
    return '';
  }).join('\n');

  // 2-3. Split action regexes to avoid a single catastrophic pattern (ReDoS).
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

  // 4. Collapse excess blank lines
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  // 5. 上下文感知的 HTML 实体转义（审计 🟡）：仅当消费方显式启用时才转义 <>&"'，
  //    因实体转义会破坏 markdown 语法；前端 AI 回复走 renderMarkdown，默认不开启。
  if (options.escapeHtml === true) {
    s = s.replace(/&/g, '&amp;')
         .replace(/</g, '&lt;')
         .replace(/>/g, '&gt;')
         .replace(/"/g, '&quot;')
         .replace(/'/g, '&#39;');
  }

  // 6. Empty after cleanup → fixed user-facing notice
  if (!s) return '我刚刚生成了不合规的动作描写，已自动删除。请重新问一次。';

  return s;
}

module.exports = {
  sanitizeAssistantVisibleText: sanitizeAssistantVisibleText
};
