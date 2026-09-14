'use strict';

// ===================== A 档工具辅助函数（纯计算 / 零第三方付费依赖） =====================
// 设计原则：
//   ① 全部为纯函数或仅依赖已装库（sharp / xlsx / jszip），不引入新的付费服务；
//   ② 所有输入先做长度/规模上限裁剪，防止单次调用打爆内存或事件循环；
//   ③ 输出统一为可序列化的普通对象，由 server.js 包装成 aiSiteCard。

// ---------- 通用 ----------
var MAX_TEXT_LEN = 200000;      // 单段文本上限 20 万字符
var MAX_ROWS = 5000;            // 数据行上限
var MAX_COLS = 80;              // 数据列上限

function clampInt(v, min, max, dflt) {
  var n = parseInt(v, 10);
  if (!isFinite(n)) n = dflt;
  return Math.min(Math.max(n, min), max);
}

function clampText(v, max) {
  var s = v === null || v === undefined ? '' : String(v);
  if (s.length > (max || MAX_TEXT_LEN)) s = s.slice(0, max || MAX_TEXT_LEN);
  return s;
}

function toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = String(v === null || v === undefined ? '' : v).replace(/[,\s￥$¥%]/g, '');
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function escapeXml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ===================== 1. 图表：纯 SVG 生成（再由 sharp 栅格化为 PNG） =====================
// 为什么自己画 SVG：node-canvas 需编译原生依赖，chartjs-node 体积大且要装 canvas；
// 直接用 SVG 字符串 + sharp（已在依赖里，且实测 SVG→PNG 可用），零新增依赖、零成本。
var CHART_PALETTE = ['#4f7cff', '#ff7a45', '#22c55e', '#a855f7', '#eab308', '#06b6d4', '#ec4899', '#64748b'];

function niceCeil(v) {
  if (!isFinite(v) || v <= 0) return 1;
  var mag = Math.pow(10, Math.floor(Math.log10(v)));
  var norm = v / mag;
  var step;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  return step * mag;
}

// 把 series 规范化成 [{name, data:[num]}]，最多 6 个系列
function normalizeSeries(series, maxPoints) {
  var out = [];
  var list = Array.isArray(series) ? series : [];
  for (var i = 0; i < list.length && out.length < 6; i++) {
    var s = list[i];
    if (!s) continue;
    // 兼容两种写法：{name, data:[...]} 或直接 [1,2,3]
    var data = Array.isArray(s) ? s : (Array.isArray(s.data) ? s.data : []);
    var nm = Array.isArray(s) ? ('系列' + (out.length + 1)) : String(s.name || ('系列' + (out.length + 1))).slice(0, 40);
    var nums = [];
    for (var j = 0; j < data.length && nums.length < maxPoints; j++) nums.push(toNum(data[j]));
    if (nums.length) out.push({ name: nm, data: nums });
  }
  return out;
}

function buildChartSvg(type, title, labels, series, xLabel, yLabel, width, height) {
  var W = clampInt(width, 240, 2400, 720);
  var H = clampInt(height, 180, 1800, 420);
  var PAD_L = 62, PAD_R = 28, PAD_T = title ? 52 : 26, PAD_B = 54;
  var plotW = Math.max(W - PAD_L - PAD_R, 40);
  var plotH = Math.max(H - PAD_T - PAD_B, 40);
  var parts = [];
  var fontStack = 'PingFang SC,Hiragino Sans GB,Microsoft YaHei,Noto Sans CJK SC,sans-serif';

  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">');
  parts.push('<rect width="' + W + '" height="' + H + '" fill="#ffffff"/>');
  if (title) {
    parts.push('<text x="' + (W / 2) + '" y="32" text-anchor="middle" font-family="' + fontStack +
      '" font-size="20" font-weight="600" fill="#1f2937">' + escapeXml(title.slice(0, 60)) + '</text>');
  }

  // ---- 饼图 / 环形图 ----
  if (type === 'pie') {
    var pieData = series.length ? series[0].data : [];
    var pieLabels = Array.isArray(labels) ? labels : [];
    var total = 0;
    for (var pi = 0; pi < pieData.length; pi++) total += Math.max(pieData[pi], 0);
    if (total <= 0) {
      parts.push('<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" font-family="' + fontStack +
        '" font-size="16" fill="#9ca3af">数据全为 0，无法绘制饼图</text></svg>');
      return parts.join('');
    }
    var cx = W / 2, cy = PAD_T + plotH / 2, r = Math.min(plotW, plotH) / 2 - 10;
    var startAngle = -Math.PI / 2;
    for (var k = 0; k < pieData.length; k++) {
      var val = Math.max(pieData[k], 0);
      if (val <= 0) continue;
      var slice = (val / total) * Math.PI * 2;
      var endAngle = startAngle + slice;
      var x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
      var x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
      var largeArc = slice > Math.PI ? 1 : 0;
      var color = CHART_PALETTE[k % CHART_PALETTE.length];
      // 单项占满 100% 时 arc 会退化，改画整圆
      if (pieData.length === 1 || val === total) {
        parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + color + '"/>');
      } else {
        parts.push('<path d="M ' + cx + ' ' + cy + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
          ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z" fill="' + color + '"/>');
      }
      startAngle = endAngle;
    }
    // 图例（右侧竖排，超过 12 项折叠）
    var legendX = W - PAD_R - 150;
    var legendY = PAD_T + 8;
    var legendCount = Math.min(pieLabels.length || pieData.length, 12);
    for (var li = 0; li < legendCount; li++) {
      var ly = legendY + li * 22;
      var lname = String((pieLabels[li] !== undefined ? pieLabels[li] : ('项目' + (li + 1)))).slice(0, 12);
      var pct = ((Math.max(pieData[li], 0) / total) * 100).toFixed(1);
      parts.push('<rect x="' + legendX + '" y="' + (ly - 9) + '" width="11" height="11" rx="2" fill="' +
        CHART_PALETTE[li % CHART_PALETTE.length] + '"/>');
      parts.push('<text x="' + (legendX + 17) + '" y="' + ly + '" font-family="' + fontStack +
        '" font-size="12" fill="#4b5563">' + escapeXml(lname) + ' ' + pct + '%</text>');
    }
    parts.push('</svg>');
    return parts.join('');
  }

  // ---- 直角坐标系图（bar / line / scatter） ----
  var labelArr = Array.isArray(labels) ? labels.slice(0, 200).map(function(l) { return String(l).slice(0, 20); }) : [];
  var maxPoints = 0;
  series.forEach(function(s) { if (s.data.length > maxPoints) maxPoints = s.data.length; });
  while (labelArr.length < maxPoints) labelArr.push(String(labelArr.length + 1));

  // Y 轴范围：非负数据从 0 起，有负值则按最小负值起
  var maxV = -Infinity, minV = Infinity;
  series.forEach(function(s) {
    s.data.forEach(function(v) { if (v > maxV) maxV = v; if (v < minV) minV = v; });
  });
  if (!isFinite(maxV)) { maxV = 1; minV = 0; }
  if (maxV === 0 && minV === 0) { maxV = 1; }
  if (minV > 0) minV = 0;
  if (maxV < 0) maxV = 0;
  var span = niceCeil(maxV - minV) || 1;
  maxV = Math.ceil(maxV / (span / 5)) * (span / 5);
  minV = Math.floor(minV / (span / 5)) * (span / 5);
  if (maxV === minV) maxV = minV + 1;
  var range = maxV - minV;

  function yPos(v) { return PAD_T + plotH - ((v - minV) / range) * plotH; }
  function xPos(i) {
    if (maxPoints <= 1) return PAD_L + plotW / 2;
    return PAD_L + (i / (maxPoints - 1)) * plotW;
  }

  // 横向网格线 + Y 轴刻度
  var gridCount = 5;
  for (var g = 0; g <= gridCount; g++) {
    var gv = minV + (range * g) / gridCount;
    var gy = yPos(gv);
    parts.push('<line x1="' + PAD_L + '" y1="' + gy.toFixed(1) + '" x2="' + (PAD_L + plotW) + '" y2="' + gy.toFixed(1) +
      '" stroke="#e5e7eb" stroke-width="1"/>');
    var gtxt = Math.abs(gv) >= 1000 ? (gv / 1000).toFixed(1) + 'k' : String(Math.round(gv * 100) / 100);
    parts.push('<text x="' + (PAD_L - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-family="' + fontStack +
      '" font-size="11" fill="#9ca3af">' + escapeXml(gtxt) + '</text>');
  }
  // 坐标轴
  parts.push('<line x1="' + PAD_L + '" y1="' + PAD_T + '" x2="' + PAD_L + '" y2="' + (PAD_T + plotH) + '" stroke="#9ca3af" stroke-width="1"/>');
  parts.push('<line x1="' + PAD_L + '" y1="' + (PAD_T + plotH) + '" x2="' + (PAD_L + plotW) + '" y2="' + (PAD_T + plotH) + '" stroke="#9ca3af" stroke-width="1"/>');

  // X 轴标签（点位多时抽稀，最多显示 12 个）
  var stepX = Math.max(1, Math.ceil(maxPoints / 12));
  for (var xi = 0; xi < maxPoints; xi += stepX) {
    var tx = xPos(xi);
    parts.push('<text x="' + tx.toFixed(1) + '" y="' + (PAD_T + plotH + 18) + '" text-anchor="middle" font-family="' + fontStack +
      '" font-size="11" fill="#6b7280">' + escapeXml(labelArr[xi] || '') + '</text>');
  }

  // 轴名
  if (xLabel) {
    parts.push('<text x="' + (PAD_L + plotW / 2) + '" y="' + (H - 12) + '" text-anchor="middle" font-family="' + fontStack +
      '" font-size="12" fill="#6b7280">' + escapeXml(String(xLabel).slice(0, 30)) + '</text>');
  }
  if (yLabel) {
    parts.push('<text x="14" y="' + (PAD_T + plotH / 2) + '" text-anchor="middle" transform="rotate(-90 14 ' + (PAD_T + plotH / 2) +
      ')" font-family="' + fontStack + '" font-size="12" fill="#6b7280">' + escapeXml(String(yLabel).slice(0, 30)) + '</text>');
  }

  // 数据系列
  if (type === 'bar') {
    var groupW = plotW / Math.max(maxPoints, 1);
    var barW = Math.max(3, (groupW * 0.72) / series.length);
    for (var bi = 0; bi < maxPoints; bi++) {
      var baseX = PAD_L + bi * groupW + (groupW - barW * series.length) / 2;
      for (var si = 0; si < series.length; si++) {
        var bv = series[si].data[bi];
        if (bv === undefined) continue;
        var y0 = yPos(0), y1 = yPos(bv);
        var bh = Math.abs(y1 - y0);
        var bx = baseX + si * barW;
        parts.push('<rect x="' + bx.toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) + '" width="' + (barW * 0.88).toFixed(1) +
          '" height="' + Math.max(bh, 1).toFixed(1) + '" rx="2" fill="' + CHART_PALETTE[si % CHART_PALETTE.length] + '"/>');
      }
    }
  } else if (type === 'line') {
    for (var si2 = 0; si2 < series.length; si2++) {
      var s2 = series[si2];
      var pts = [];
      for (var mi = 0; mi < s2.data.length; mi++) pts.push(xPos(mi).toFixed(1) + ',' + yPos(s2.data[mi]).toFixed(1));
      parts.push('<polyline fill="none" stroke="' + CHART_PALETTE[si2 % CHART_PALETTE.length] +
        '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="' + pts.join(' ') + '"/>');
      for (var mi2 = 0; mi2 < s2.data.length; mi2++) {
        parts.push('<circle cx="' + xPos(mi2).toFixed(1) + '" cy="' + yPos(s2.data[mi2]).toFixed(1) +
          '" r="3.5" fill="#ffffff" stroke="' + CHART_PALETTE[si2 % CHART_PALETTE.length] + '" stroke-width="2"/>');
      }
    }
  } else { // scatter：series[i].data 视为 Y 值，X 取索引
    for (var si3 = 0; si3 < series.length; si3++) {
      var s3 = series[si3];
      for (var mi3 = 0; mi3 < s3.data.length; mi3++) {
        parts.push('<circle cx="' + xPos(mi3).toFixed(1) + '" cy="' + yPos(s3.data[mi3]).toFixed(1) +
          '" r="4.5" fill="' + CHART_PALETTE[si3 % CHART_PALETTE.length] + '" opacity="0.85"/>');
      }
    }
  }

  // 图例（顶部横排）
  if (series.length > 1) {
    var lx = PAD_L;
    for (var si4 = 0; si4 < series.length; si4++) {
      var nm4 = series[si4].name.slice(0, 14);
      parts.push('<rect x="' + lx + '" y="' + (PAD_T - 26) + '" width="11" height="11" rx="2" fill="' +
        CHART_PALETTE[si4 % CHART_PALETTE.length] + '"/>');
      parts.push('<text x="' + (lx + 16) + '" y="' + (PAD_T - 17) + '" font-family="' + fontStack +
        '" font-size="12" fill="#4b5563">' + escapeXml(nm4) + '</text>');
      lx += 22 + nm4.length * 12 + 14;
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

// SVG → PNG（sharp 已在依赖中；失败时回退只给 SVG）
async function svgToPngDataUrl(sharpLib, svg) {
  if (!sharpLib) return null;
  try {
    var png = await sharpLib(Buffer.from(svg, 'utf8'), { density: 144 })
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (!png || !png.length) return null;
    return 'data:image/png;base64,' + png.toString('base64');
  } catch (e) {
    return null;
  }
}

// ===================== 2. 结构化的简化 PDF 生成 =====================
// 不引额外库：手写最小 PDF 结构（Helvetica 内置字体）。
// 中文处理：PDF 内置字体不含 CJK 字形，无法直接写字。
//   方案：把 UTF-8 文本按字节解释为 Latin-1 写入（视觉上是乱码），这在"必须纯零依赖"下无解；
//   因此这里改为——检测到非 ASCII 时，明确告知模型该工具仅支持 ASCII，
//   并给出替代路径（make_file 生成 Excel/CSV）。这样不会产出乱码文件骗用户。
function pdfEscapeText(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    .replace(/[\r\n]+/g, ' ');
}

function isPureAscii(s) {
  return /^[\x00-\x7F]*$/.test(String(s === null || s === undefined ? '' : s));
}

// 把 blocks 折成按字符数估宽的文本行（ASCII 场景足够）
function pdfWrapText(text, maxChars) {
  var out = [];
  var paragraphs = String(text || '').split(/\r?\n/);
  for (var p = 0; p < paragraphs.length; p++) {
    var para = paragraphs[p];
    if (para.length <= maxChars) { out.push(para); continue; }
    var buf = '';
    var words = para.split(/\s+/);
    for (var w = 0; w < words.length; w++) {
      var cand = buf ? buf + ' ' + words[w] : words[w];
      if (cand.length > maxChars) {
        if (buf) out.push(buf);
        // 单个超长词硬切
        while (words[w].length > maxChars) { out.push(words[w].slice(0, maxChars)); words[w] = words[w].slice(maxChars); }
        buf = words[w];
      } else { buf = cand; }
    }
    if (buf) out.push(buf);
  }
  return out;
}

function buildPdfBuffer(title, blocks) {
  var PAGE_W = 595.28, PAGE_H = 841.89; // A4 pt
  var MARGIN = 56;
  var CONTENT_W = PAGE_W - MARGIN * 2;
  var fonts = { '/F1': 'Helvetica', '/F2': 'Helvetica-Bold', '/F3': 'Courier' };
  var lines = []; // {text, size, font, spaceBefore, indent}

  if (title) lines.push({ text: String(title).slice(0, 200), size: 20, font: '/F2', spaceBefore: 0, indent: 0 });

  var list = Array.isArray(blocks) ? blocks.slice(0, 200) : [];
  for (var i = 0; i < list.length; i++) {
    var b = list[i];
    if (b === null || b === undefined) continue;
    if (typeof b === 'string') { b = { type: 'p', text: b }; }
    var btype = String(b.type || 'p').toLowerCase();
    var btext = clampText(b.text === undefined ? '' : b.text, 20000);

    if (btype === 'h1') {
      pdfWrapText(btext, 46).forEach(function(l) { lines.push({ text: l, size: 18, font: '/F2', spaceBefore: 14, indent: 0 }); });
    } else if (btype === 'h2') {
      pdfWrapText(btext, 54).forEach(function(l) { lines.push({ text: l, size: 15, font: '/F2', spaceBefore: 11, indent: 0 }); });
    } else if (btype === 'h3') {
      pdfWrapText(btext, 60).forEach(function(l) { lines.push({ text: l, size: 13, font: '/F2', spaceBefore: 9, indent: 0 }); });
    } else if (btype === 'ul' || btype === 'ol') {
      var items = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
      items.forEach(function(it, idx) {
        // 用 ASCII 的 "-" 而非 U+2022：WinAnsiEncoding 里没有圆点字符，
        // 写进去会渲染成乱码（实测输出成双引号）。
        var prefix = btype === 'ol' ? (idx + 1) + '. ' : '-  ';
        var wrapped = pdfWrapText(String(it), 82);
        wrapped.forEach(function(l, li) {
          lines.push({ text: (li === 0 ? prefix : '    ') + l, size: 11, font: '/F1', spaceBefore: li === 0 ? 3 : 0, indent: 14 });
        });
      });
    } else if (btype === 'table') {
      var headers = Array.isArray(b.headers) ? b.headers.slice(0, 8).map(function(h) { return String(h); }) : [];
      var rows = Array.isArray(b.rows) ? b.rows.slice(0, 80) : [];
      var colW = headers.length ? Math.floor(CONTENT_W / headers.length) : CONTENT_W;
      var charPerCol = Math.max(6, Math.floor(colW / 5.6));
      function padCell(v, w) {
        var s = String(v === null || v === undefined ? '' : v);
        if (s.length > w) s = s.slice(0, Math.max(1, w - 3)) + '...';
        while (s.length < w) s += ' ';
        return s;
      }
      if (headers.length) {
        var hline = headers.map(function(h) { return padCell(h, charPerCol); }).join(' | ');
        lines.push({ text: hline, size: 10, font: '/F3', spaceBefore: 10, indent: 0 });
        lines.push({ text: new Array(Math.min(hline.length, 110) + 1).join('-'), size: 10, font: '/F3', spaceBefore: 2, indent: 0 });
      }
      rows.forEach(function(r) {
        var cells = Array.isArray(r) ? r : [r];
        var rline = cells.slice(0, headers.length || 8).map(function(c) { return padCell(c, charPerCol); }).join(' | ');
        lines.push({ text: rline, size: 10, font: '/F3', spaceBefore: 1, indent: 0 });
      });
    } else if (btype === 'hr') {
      lines.push({ text: new Array(92).join('-'), size: 10, font: '/F1', spaceBefore: 10, indent: 0 });
    } else {
      pdfWrapText(btext, 92).forEach(function(l) { lines.push({ text: l, size: 11, font: '/F1', spaceBefore: 6, indent: 0 }); });
    }
  }
  if (!lines.length) lines.push({ text: '(empty document)', size: 11, font: '/F1', spaceBefore: 0, indent: 0 });

  // 分页
  var pages = [];
  var cur = [];
  var y = PAGE_H - MARGIN;
  for (var li2 = 0; li2 < lines.length; li2++) {
    var ln = lines[li2];
    var lh = ln.size * 1.45;
    var need = ln.spaceBefore + lh;
    // 表格行可能很长需硬折（pdfWrapText 已处理），此处按需换页
    if (y - need < MARGIN) { pages.push(cur); cur = []; y = PAGE_H - MARGIN; }
    y -= ln.spaceBefore;
    // 长行硬折（防止超出右边界）
    var maxChars = Math.max(10, Math.floor((CONTENT_W - ln.indent) / (ln.size * 0.5)));
    var textLines = String(ln.text).length > maxChars ? pdfWrapText(ln.text, maxChars) : [ln.text];
    for (var tl = 0; tl < textLines.length; tl++) {
      if (y - lh < MARGIN) { pages.push(cur); cur = []; y = PAGE_H - MARGIN; }
      y -= lh;
      cur.push({ x: MARGIN + ln.indent, y: y + ln.size * 0.28, text: textLines[tl], size: ln.size, font: ln.font });
    }
  }
  pages.push(cur);

  // 组装 PDF 对象
  // 对象编号规划（PDF 是无序对象图，编号只要自洽即可）：
  //   1 = Catalog，2 = Pages，3 = 字体资源组（3 个字体对象：Helvetica / Bold / Courier）
  //   之后每页占 2 个对象：内容流 + 页面对象
  //   ★ 初版把 /Kids 写成内容流的对象号（5/7/9…）而不是页面对象的对象号（6/8/10…），
  //     导致 poppler 报 "Kid object (page 1) is wrong type (stream)"、PDF 打不开。
  var objects = [];
  var pageCount = pages.length;
  var FONT_BASE = 3;                        // 3,4,5 三个字体对象
  var PAGE_BASE = FONT_BASE + 3;            // 6 起放页面：每页 = 内容流（偶）+ 页面对象（奇）
  var kids = [];
  for (var pn = 0; pn < pageCount; pn++) {
    // 页面对象 = 内容流对象号 + 1
    kids.push((PAGE_BASE + pn * 2 + 1) + ' 0 R');
  }

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pageCount + ' >>';
  objects[FONT_BASE] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[FONT_BASE + 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[FONT_BASE + 2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  var fontRefs = {
    '/F1': FONT_BASE + ' 0 R',
    '/F2': (FONT_BASE + 1) + ' 0 R',
    '/F3': (FONT_BASE + 2) + ' 0 R'
  };

  for (var pi2 = 0; pi2 < pageCount; pi2++) {
    var contentObjNum = PAGE_BASE + pi2 * 2;
    var pageObjNum = PAGE_BASE + pi2 * 2 + 1;
    var stream = ['BT'];
    var lastFont = '';
    var lastSize = 0;
    pages[pi2].forEach(function(item) {
      if (item.font !== lastFont || item.size !== lastSize) {
        stream.push(item.font + ' ' + item.size + ' Tf');
        lastFont = item.font; lastSize = item.size;
      }
      stream.push('1 0 0 1 ' + item.x.toFixed(2) + ' ' + item.y.toFixed(2) + ' Tm');
      stream.push('(' + pdfEscapeText(item.text) + ') Tj');
    });
    stream.push('ET');
    var streamStr = stream.join('\n');
    objects[contentObjNum] = '<< /Length ' + Buffer.byteLength(streamStr, 'latin1') + ' >>\nstream\n' + streamStr + '\nendstream';
    objects[pageObjNum] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] ' +
      '/Resources << /Font << /F1 ' + fontRefs['/F1'] + ' /F2 ' + fontRefs['/F2'] + ' /F3 ' + fontRefs['/F3'] + ' >> >> ' +
      '/Contents ' + contentObjNum + ' 0 R >>';
  }

  // 序列化（跳过空洞，重编号）
  var chunks = [];
  var offsets = {};
  var header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  var pos = header.length;
  var maxObj = 0;
  for (var k in objects) { var kk = parseInt(k, 10); if (objects[k] && kk > maxObj) maxObj = kk; }
  var body = '';
  for (var oi = 1; oi <= maxObj; oi++) {
    if (!objects[oi]) continue;
    offsets[oi] = pos + Buffer.byteLength(body, 'latin1');
    body += oi + ' 0 obj\n' + objects[oi] + '\nendobj\n';
  }
  var xrefPos = pos + Buffer.byteLength(body, 'latin1');
  var xref = 'xref\n0 ' + (maxObj + 1) + '\n0000000000 65535 f \n';
  for (var xi = 1; xi <= maxObj; xi++) {
    if (offsets[xi] === undefined) { xref += '0000000000 65535 f \n'; }
    else { xref += String(offsets[xi]).padStart(10, '0') + ' 00000 n \n'; }
  }
  var trailer = 'trailer\n<< /Size ' + (maxObj + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n';

  return Buffer.from(header + body + xref + trailer, 'latin1');
}

// ===================== 3. 文本 diff（行级 LCS） =====================
function diffLines(oldText, newText) {
  var a = String(oldText || '').split(/\r?\n/).slice(0, 3000);
  var b = String(newText || '').split(/\r?\n/).slice(0, 3000);
  var n = a.length, m = b.length;
  // LCS DP：O(n*m) 在 3000x3000 = 9M 单元偏大，超过 600 行改用简化比对
  if (n * m > 400000) return diffLinesFast(a, b);

  var dp = [];
  for (var i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
  for (var ii = n - 1; ii >= 0; ii--) {
    for (var jj = m - 1; jj >= 0; jj--) {
      dp[ii][jj] = a[ii] === b[jj] ? dp[ii + 1][jj + 1] + 1 : Math.max(dp[ii + 1][jj], dp[ii][jj + 1]);
    }
  }
  var result = [];
  var x = 0, y = 0;
  while (x < n && y < m) {
    if (a[x] === b[y]) { result.push({ type: 'same', text: a[x] }); x++; y++; }
    else if (dp[x + 1][y] >= dp[x][y + 1]) { result.push({ type: 'del', text: a[x] }); x++; }
    else { result.push({ type: 'add', text: b[y] }); y++; }
  }
  while (x < n) { result.push({ type: 'del', text: a[x] }); x++; }
  while (y < m) { result.push({ type: 'add', text: b[y] }); y++; }
  return result;
}

// 大文本降级：只做相等行集合比对 + 顺序比对
function diffLinesFast(a, b) {
  var setB = {};
  b.forEach(function(l) { setB[l] = (setB[l] || 0) + 1; });
  var result = [];
  var usedB = {};
  a.forEach(function(l) {
    if (!usedB[l] && setB[l]) { result.push({ type: 'same', text: l }); usedB[l] = 1; }
    else { result.push({ type: 'del', text: l }); }
  });
  var setA = {};
  a.forEach(function(l) { setA[l] = (setA[l] || 0) + 1; });
  var usedA = {};
  b.forEach(function(l) {
    if (!usedA[l] && setA[l]) { usedA[l] = 1; }
    else { result.push({ type: 'add', text: l }); }
  });
  return result;
}

// ===================== 4. CSV / TSV 解析 =====================
function parseDelimited(text, delimiter) {
  var src = String(text || '');
  var d = delimiter || ',';
  var rows = [];
  var row = [];
  var cell = '';
  var inQuotes = false;
  var i = 0;
  while (i < src.length && rows.length < MAX_ROWS) {
    var ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === d) { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(function(r) { return !(r.length === 1 && r[0] === ''); }).slice(0, MAX_ROWS);
}

function buildDelimited(headers, rows, delimiter) {
  var d = delimiter || ',';
  function esc(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (s.indexOf(d) >= 0 || /["\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  var out = [];
  if (Array.isArray(headers) && headers.length) out.push(headers.map(esc).join(d));
  (rows || []).slice(0, MAX_ROWS).forEach(function(r) {
    out.push((Array.isArray(r) ? r : [r]).slice(0, MAX_COLS).map(esc).join(d));
  });
  return out.join('\r\n');
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  var headers = rows[0].map(function(h) { return String(h); });
  return rows.slice(1).map(function(r) {
    var obj = {};
    headers.forEach(function(h, idx) { obj[h] = r[idx] === undefined ? '' : r[idx]; });
    return obj;
  });
}

function objectsToRows(objs) {
  var headers = [];
  objs.forEach(function(o) {
    Object.keys(o || {}).forEach(function(k) { if (headers.indexOf(k) < 0 && headers.length < MAX_COLS) headers.push(k); });
  });
  var rows = objs.map(function(o) { return headers.map(function(h) { return o[h] === undefined ? '' : o[h]; }); });
  return { headers: headers, rows: rows };
}

// ===================== 5. Markdown 表格 =====================
function buildMarkdownTable(headers, rows) {
  var hs = Array.isArray(headers) ? headers.map(function(h) { return String(h); }).slice(0, MAX_COLS) : [];
  var rs = Array.isArray(rows) ? rows : [];
  if (!hs.length) {
    var first = Array.isArray(rs[0]) ? rs[0] : Object.keys(rs[0] || {});
    hs = first.map(function(h, i) { return String(h === undefined ? ('列' + (i + 1)) : h); });
    if (rs.length && !Array.isArray(rs[0])) {
      rs = rs.map(function(o) { return hs.map(function(h) { return o[h]; }); });
    }
  }
  if (!hs.length) return '';
  function cell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  }
  var out = [];
  out.push('| ' + hs.map(cell).join(' | ') + ' |');
  out.push('| ' + hs.map(function() { return '---'; }).join(' | ') + ' |');
  rs.slice(0, 500).forEach(function(r) {
    var arr = Array.isArray(r) ? r : hs.map(function(h) { return r[h]; });
    out.push('| ' + hs.map(function(_, i) { return cell(arr[i]); }).join(' | ') + ' |');
  });
  return out.join('\n');
}

// ===================== 6. 二维码（自实现 QR 编码，零依赖） =====================
// 说明：为守住"零新增依赖"，这里手写最小可用 QR 编码器。
//   支持：字节模式（UTF-8）+ 纠错等级 L + 版本 1-10 + 掩码 0。
//   实现依据 ISO/IEC 18004，模块放置顺序严格按规范：定位/校正/时序图案 → 格式信息区预留
//   → 数据按 Z 字形填充（跳过功能图案）→ 最后写回真实的格式信息位。
//   已用 OpenCV QRCodeDetector 做真机解码验证（见 tests/qr-encode-contract.test.js）。
var QUIET_ZONE_MODULES = 4;

// 版本参数表（纠错等级 L）
//   totalCodewords：数据码字 + 纠错码字总数
//   dataCodewords ：数据码字数量
//   ecPerBlock / group1Blocks / group2Blocks：纠错分块结构（L 级）
var QR_VERSION_INFO = {
  1:  { size: 21, dataCodewords: 19,  ecPerBlock: 7,  group1Blocks: 1, group2Blocks: 0, align: [] },
  2:  { size: 25, dataCodewords: 34,  ecPerBlock: 10, group1Blocks: 1, group2Blocks: 0, align: [6, 18] },
  3:  { size: 29, dataCodewords: 55,  ecPerBlock: 15, group1Blocks: 1, group2Blocks: 0, align: [6, 22] },
  4:  { size: 33, dataCodewords: 80,  ecPerBlock: 20, group1Blocks: 1, group2Blocks: 0, align: [6, 26] },
  5:  { size: 37, dataCodewords: 108, ecPerBlock: 26, group1Blocks: 1, group2Blocks: 0, align: [6, 30] },
  6:  { size: 41, dataCodewords: 136, ecPerBlock: 18, group1Blocks: 2, group2Blocks: 0, align: [6, 34] },
  7:  { size: 45, dataCodewords: 156, ecPerBlock: 20, group1Blocks: 2, group2Blocks: 0, align: [6, 22, 38] },
  8:  { size: 49, dataCodewords: 194, ecPerBlock: 24, group1Blocks: 2, group2Blocks: 0, align: [6, 24, 42] },
  9:  { size: 53, dataCodewords: 232, ecPerBlock: 30, group1Blocks: 2, group2Blocks: 0, align: [6, 26, 46] },
  10: { size: 57, dataCodewords: 274, ecPerBlock: 18, group1Blocks: 2, group2Blocks: 2, align: [6, 28, 50] }
};

// GF(256) 指数/对数表（本原多项式 0x11D）
var GF_EXP = new Array(512);
var GF_LOG = new Array(256);
(function buildGfTables() {
  var x = 1;
  for (var i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
  GF_LOG[0] = -1;
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// 生成 Reed-Solomon 生成多项式（最高次项系数为 1，返回长度为 degree+1 的系数数组）
function rsGeneratorPoly(degree) {
  var poly = [1];
  for (var i = 0; i < degree; i++) {
    var next = new Array(poly.length + 1);
    for (var z = 0; z < next.length; z++) next[z] = 0;
    for (var j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// 计算 degree 个 RS 纠错码字
// ★ 用标准多项式长除法（系统码）：把 data 右移 degree 位后对生成多项式取余。
//   不要试图用"逐字节移位维护余数"的紧凑写法——那是有限窗口近似，
//   首字节尾部残留会算错（本实现初版即踩此坑，导致 44 个码字里后 10 个全错、
//   二维码整体不可解码）。当前写法已用参考库逐字节对齐验证。
function rsEncode(data, degree) {
  var gen = rsGeneratorPoly(degree);              // 长度 degree+1
  var msg = new Array(data.length + degree);
  for (var z = 0; z < data.length; z++) msg[z] = data[z];
  for (var z2 = 0; z2 < degree; z2++) msg[data.length + z2] = 0;
  for (var i = 0; i < data.length; i++) {
    var coef = msg[i];
    if (coef === 0) continue;
    for (var j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], coef);
  }
  return msg.slice(data.length);
}

// 位缓冲
function BitBuffer() { this.bits = []; }
BitBuffer.prototype.put = function(value, length) {
  for (var i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
};

// 编码：选版本 → 数据码字 + 分块纠错 → 交错排列
function encodeQrBytes(bytes) {
  var version = 0;
  var lenBits;
  for (var v = 1; v <= 10; v++) {
    var info = QR_VERSION_INFO[v];
    lenBits = v <= 9 ? 8 : 16;
    if (4 + lenBits + bytes.length * 8 <= info.dataCodewords * 8) { version = v; break; }
  }
  if (!version) return null;
  var info2 = QR_VERSION_INFO[version];
  lenBits = version <= 9 ? 8 : 16;

  var bb = new BitBuffer();
  bb.put(4, 4);                       // 字节模式指示符 0100
  bb.put(bytes.length, lenBits);      // 字符计数
  for (var i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);

  var totalDataBits = info2.dataCodewords * 8;
  // 终止符（最多 4 位）
  for (var t = 0; t < 4 && bb.bits.length < totalDataBits; t++) bb.bits.push(0);
  // 补齐到字节边界
  while (bb.bits.length % 8 !== 0) bb.bits.push(0);
  // 填充字节 0xEC / 0x11 交替
  var padBytes = [0xEC, 0x11];
  var padIdx = 0;
  while (bb.bits.length < totalDataBits) {
    for (var b = 7; b >= 0; b--) bb.bits.push((padBytes[padIdx] >>> b) & 1);
    padIdx = (padIdx + 1) % 2;
  }

  var dataBytes = [];
  for (var bi = 0; bi < bb.bits.length; bi += 8) {
    var byteVal = 0;
    for (var k = 0; k < 8; k++) byteVal = (byteVal << 1) | bb.bits[bi + k];
    dataBytes.push(byteVal);
  }

  // ---- 分块 + 纠错 + 交错 ----
  var g1 = info2.group1Blocks, g2 = info2.group2Blocks;
  var totalBlocks = g1 + g2;
  var totalData = info2.dataCodewords;
  var totalCodewords = totalData + totalBlocks * info2.ecPerBlock;
  // 长块比短块多 1 个数据码字
  var shortBlockLen = Math.floor(totalData / totalBlocks);
  var numLongBlocks = totalData % totalBlocks;
  var shortDataLen = shortBlockLen - (numLongBlocks > 0 ? 1 : 0);
  var longDataLen = shortDataLen + 1;

  var blocks = [];
  var offset = 0;
  for (var bl = 0; bl < totalBlocks; bl++) {
    var isLong = numLongBlocks > 0 && bl >= (totalBlocks - numLongBlocks);
    var dLen = isLong ? longDataLen : shortDataLen;
    var blockData = dataBytes.slice(offset, offset + dLen);
    offset += dLen;
    blocks.push({ data: blockData, ec: rsEncode(blockData, info2.ecPerBlock) });
  }

  var interleaved = [];
  var maxDataLen = longDataLen;
  for (var pos = 0; pos < maxDataLen; pos++) {
    for (var bx = 0; bx < blocks.length; bx++) {
      if (pos < blocks[bx].data.length) interleaved.push(blocks[bx].data[pos]);
    }
  }
  for (var pos2 = 0; pos2 < info2.ecPerBlock; pos2++) {
    for (var bx2 = 0; bx2 < blocks.length; bx2++) {
      interleaved.push(blocks[bx2].ec[pos2]);
    }
  }

  return { version: version, size: info2.size, codewords: interleaved, totalCodewords: totalCodewords };
}

// 格式信息 BCH(15,5) + XOR 0x5412
function fmtBch(data) {
  var d = data << 10;
  for (var i = 4; i >= 0; i--) {
    if (d & (1 << (i + 10))) d ^= 0x537 << i;
  }
  return (((data << 10) | d) ^ 0x5412) & 0x7FFF;
}

// 版本信息 BCH(18,6)，仅版本 >= 7 使用
function versionBch(version) {
  var d = version << 12;
  for (var i = 5; i >= 0; i--) {
    if (d & (1 << (i + 12))) d ^= 0x1F25 << i;
  }
  return ((version << 12) | d) & 0x3FFFF;
}

// 掩码 0：(row + col) % 2 === 0
function maskBitAt(row, col) {
  return ((row + col) % 2 === 0) ? 1 : 0;
}

var QR_MASK_ID = 0;

// 构建最终模块矩阵（0=白，1=黑）
function buildQrMatrix(encoded) {
  var size = encoded.size;
  var matrix = [];
  var isFunction = [];
  for (var i = 0; i < size; i++) {
    var rowM = new Array(size), rowF = new Array(size);
    for (var j = 0; j < size; j++) { rowM[j] = 0; rowF[j] = false; }
    matrix.push(rowM); isFunction.push(rowF);
  }

  function place(r, c, val) {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    matrix[r][c] = val ? 1 : 0;
    isFunction[r][c] = true;
  }

  // ---- 定位图案（含 1 模块宽的分隔符） ----
  function placeFinder(top, left) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = top + r, cc = left + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        var inRing = (r === 0 || r === 6 || c === 0 || c === 6);
        var inCore = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        var inside = (r >= 0 && r <= 6 && c >= 0 && c <= 6);
        place(rr, cc, inside && (inRing || inCore));
      }
    }
  }
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // ---- 校正图案 ----
  var alignPos = QR_VERSION_INFO[encoded.version].align || [];
  for (var ai = 0; ai < alignPos.length; ai++) {
    for (var aj = 0; aj < alignPos.length; aj++) {
      var ar = alignPos[ai], ac = alignPos[aj];
      // 与三个定位图案重叠的位置跳过
      if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
      for (var r2 = -2; r2 <= 2; r2++) {
        for (var c2 = -2; c2 <= 2; c2++) {
          var isBorder2 = Math.abs(r2) === 2 || Math.abs(c2) === 2;
          var isCenter2 = r2 === 0 && c2 === 0;
          place(ar + r2, ac + c2, isBorder2 || isCenter2);
        }
      }
    }
  }

  // ---- 时序图案 ----
  for (var ti = 8; ti < size - 8; ti++) {
    place(6, ti, ti % 2 === 0);
    place(ti, 6, ti % 2 === 0);
  }

  // ---- 固定的暗模块（规格要求） ----
  place(size - 8, 8, true);

  // ---- 预留格式信息区（值稍后写入） ----
  // ★ 坐标严格按 ISO/IEC 18004：
  //   第一组（左上）：row 8 的 col 0-5,7,8（8 格）+ col 8 的 row 7,5,4,3,2,1,0（7 格）= 15 位
  //   第二组（左下+右上）：col 8 的 row (size-1)…(size-7)（7 格）
  //                      + row 8 的 col (size-8)…(size-1)（8 格）= 15 位
  //   注意：暗模块 (size-8, 8) 是固定黑点，不属于格式信息，且不能落在上面 7 格范围内
  //   （size-8 = 13，而 7 格是 size-1..size-7 = 20..14，正好错开）。
  //   初版这里把 bottom 写成 8 格、right 写成从 size-7 起的 7 格，
  //   导致格式位整体错位一格，二维码扫不出来。
  var fmtCellsA = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  var fmtCellsB = [];
  for (var fb2 = 0; fb2 < 7; fb2++) fmtCellsB.push([size - 1 - fb2, 8]);      // 20,19,...,14
  for (var fr3 = 0; fr3 < 8; fr3++) fmtCellsB.push([8, size - 8 + fr3]);      // 13,14,...,20
  fmtCellsA.concat(fmtCellsB).forEach(function(p) { place(p[0], p[1], false); });

  // ---- 预留版本信息区（版本 >= 7） ----
  if (encoded.version >= 7) {
    for (var vr = 0; vr < 6; vr++) {
      for (var vc = 0; vc < 3; vc++) {
        place(vr, size - 11 + vc, false);
        place(size - 11 + vc, vr, false);
      }
    }
  }

  // ---- 数据填充（Z 字形，从右下起，两列一组） ----
  var totalBits = encoded.totalCodewords * 8;
  function getBit(idx) {
    if (idx >= totalBits) return 0;
    return (encoded.codewords[idx >> 3] >>> (7 - (idx & 7))) & 1;
  }
  var bitIdx = 0;
  var upward = true;
  for (var col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;   // 第 6 列是时序图案，跳过
    for (var cnt = 0; cnt < size; cnt++) {
      var row = upward ? (size - 1 - cnt) : cnt;
      for (var cc2 = 0; cc2 < 2; cc2++) {
        var cx = col - cc2;
        if (isFunction[row][cx]) continue;
        matrix[row][cx] = getBit(bitIdx) ^ maskBitAt(row, cx);
        bitIdx++;
      }
    }
    upward = !upward;
  }

  // ---- 写入格式信息（纠错等级 L = 01，掩码 000 → 5 位数据 01000） ----
  // 5 位数据：纠错等级（2 位）+ 掩码编号（3 位）；L = 01
  var fmtData = (0b01 << 3) | QR_MASK_ID;
  var fmtValue = fmtBch(fmtData);
  var fmtBits = [];
  for (var fb = 14; fb >= 0; fb--) fmtBits.push((fmtValue >>> fb) & 1);
  // fmtBits[0] 是最高位（bit14），fmtBits[14] 是最低位（bit0）
  // 两组写的是同一份 15 位串（这是规范要求的冗余，便于纠错与快速定位）
  for (var fi2 = 0; fi2 < 15; fi2++) {
    matrix[fmtCellsA[fi2][0]][fmtCellsA[fi2][1]] = fmtBits[fi2];
    matrix[fmtCellsB[fi2][0]][fmtCellsB[fi2][1]] = fmtBits[fi2];
  }

  // ---- 写入版本信息（版本 >= 7） ----
  if (encoded.version >= 7) {
    var vInfo = versionBch(encoded.version);   // 18 位
    for (var vb = 0; vb < 18; vb++) {
      // 位序：bit0 在最右
      var bitVal = (vInfo >>> vb) & 1;
      var vr2 = Math.floor(vb / 3), vc2 = vb % 3;
      matrix[vr2][size - 11 + vc2] = bitVal;
      matrix[size - 11 + vc2][vr2] = bitVal;
    }
  }

  return matrix;
}

// 生成二维码 SVG（纯矢量，无外部依赖）
function buildQrSvg(text, sizePx, quietModules) {
  var content = String(text === null || text === undefined ? '' : text);
  if (!content) return null;
  var bytes = Buffer.from(content, 'utf8');
  if (bytes.length > 271) return null;  // 版本 10-L 字节模式上限
  var encoded = encodeQrBytes(bytes);
  if (!encoded) return null;
  var matrix = buildQrMatrix(encoded);
  var n = matrix.length;
  var total = clampInt(sizePx, 100, 2000, 300);
  var quiet = quietModules === undefined ? QUIET_ZONE_MODULES : clampInt(quietModules, 0, 16, 4);
  var modules = n + quiet * 2;
  // 用整数倍像素避免栅格化锯齿（每模块至少 1px）
  var cell = Math.max(1, Math.floor(total / modules));
  var finalSize = cell * modules;

  var parts = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + finalSize + '" height="' + finalSize +
    '" viewBox="0 0 ' + finalSize + ' ' + finalSize + '" shape-rendering="crispEdges">');
  parts.push('<rect width="' + finalSize + '" height="' + finalSize + '" fill="#ffffff"/>');
  // 合并同行的连续黑块，减少路径数量
  var path = [];
  for (var r = 0; r < n; r++) {
    var runStart = -1;
    for (var c = 0; c <= n; c++) {
      var on = c < n && matrix[r][c] === 1;
      if (on && runStart < 0) runStart = c;
      if (!on && runStart >= 0) {
        var x = (runStart + quiet) * cell;
        var y = (r + quiet) * cell;
        var wpx = (c - runStart) * cell;
        path.push('M' + x + ' ' + y + 'h' + wpx + 'v' + cell + 'h-' + wpx + 'z');
        runStart = -1;
      }
    }
  }
  parts.push('<path d="' + path.join('') + '" fill="#000000"/>');
  parts.push('</svg>');
  return { svg: parts.join(''), version: encoded.version, modules: n, size: finalSize, bytes: bytes.length };
}

// ===================== 7. 密码强度评估 =====================
function evaluatePasswordStrength(pwd) {
  var p = String(pwd || '');
  var len = p.length;
  var pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/[0-9]/.test(p)) pool += 10;
  if (/[^A-Za-z0-9]/.test(p)) pool += 33;
  var entropy = len > 0 && pool > 0 ? len * Math.log2(pool) : 0;
  var penalty = 0;
  if (/^(.)\1+$/.test(p)) penalty += 40;                         // 全同字符
  if (/^(012|123|234|345|456|567|678|789|890|abc|qwe|asd|zxc)/i.test(p)) penalty += 25; // 键盘/数字序列
  if (/(password|admin|123456|qwerty|letmein|iloveyou|welcome)/i.test(p)) penalty += 40;
  var score = Math.max(0, Math.min(100, Math.round((entropy / 128) * 100) - penalty));
  var level = score >= 80 ? '很强' : score >= 60 ? '强' : score >= 40 ? '中等' : score >= 20 ? '弱' : '很弱';
  var suggestions = [];
  if (len < 12) suggestions.push('长度至少 12 位（当前 ' + len + ' 位）');
  if (!/[A-Z]/.test(p)) suggestions.push('加入大写字母');
  if (!/[a-z]/.test(p)) suggestions.push('加入小写字母');
  if (!/[0-9]/.test(p)) suggestions.push('加入数字');
  if (!/[^A-Za-z0-9]/.test(p)) suggestions.push('加入特殊符号（如 !@#$%）');
  if (penalty > 0) suggestions.push('避免连续/重复或常见弱口令');
  return {
    length: len,
    charset_size: pool,
    entropy_bits: Math.round(entropy * 10) / 10,
    crack_time_estimate: estimateCrackTime(entropy),
    score: score,
    level: level,
    suggestions: suggestions
  };
}

function estimateCrackTime(entropyBits) {
  // 假设离线攻击 1e10 次/秒，平均需要尝试 2^(bits-1) 次
  if (!isFinite(entropyBits) || entropyBits <= 0) return '几乎瞬间';
  var seconds = Math.pow(2, entropyBits - 1) / 1e10;
  var units = [['秒', 1], ['分钟', 60], ['小时', 3600], ['天', 86400], ['年', 31536000], ['世纪', 3153600000]];
  var out = seconds.toFixed(1) + ' 秒';
  for (var i = 0; i < units.length; i++) {
    if (seconds >= units[i][1]) out = (seconds / units[i][1]).toFixed(1) + ' ' + units[i][0];
  }
  if (seconds > 3153600000 * 1000) return '远超宇宙年龄';
  return out;
}

function generatePassword(length, opts) {
  var len = clampInt(length, 6, 128, 16);
  opts = opts || {};
  var lower = 'abcdefghijklmnopqrstuvwxyz';
  var upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var digits = '0123456789';
  var symbols = '!@#$%^&*()-_=+[]{};:,.?';
  var pool = lower + upper + digits;
  if (opts.symbols !== false) pool += symbols;
  var cryptoMod = require('crypto');
  var chars = [];
  // 保证至少各含一类（提升实用性）
  chars.push(lower[cryptoMod.randomInt(0, lower.length)]);
  chars.push(upper[cryptoMod.randomInt(0, upper.length)]);
  chars.push(digits[cryptoMod.randomInt(0, digits.length)]);
  if (opts.symbols !== false) chars.push(symbols[cryptoMod.randomInt(0, symbols.length)]);
  while (chars.length < len) chars.push(pool[cryptoMod.randomInt(0, pool.length)]);
  // 洗牌
  for (var i = chars.length - 1; i > 0; i--) {
    var j = cryptoMod.randomInt(0, i + 1);
    var tmp = chars[i]; chars[i] = chars[j]; chars[j] = tmp;
  }
  return chars.slice(0, len).join('');
}

// ===================== 8. 表达式求值（batch_calc 用） =====================
// 白名单式表达式求值：只允许数字、变量名、运算符、括号、(可选 Math 函数)。
// 用递归下降解析，不 eval —— 与项目既有 safeEvalMath 思路一致。
function evaluateFormula(expr, scope) {
  var src = String(expr || '');
  if (!src.trim()) throw new Error('表达式为空');
  if (src.length > 500) throw new Error('表达式过长');
  var pos = 0;
  var vars = scope || {};
  var MATH_FNS = {
    abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
    sqrt: Math.sqrt, pow: Math.pow, min: Math.min, max: Math.max,
    log: Math.log, log10: Math.log10, exp: Math.exp, sin: Math.sin,
    cos: Math.cos, tan: Math.tan, sign: Math.sign
  };

  function skipWs() { while (pos < src.length && /\s/.test(src[pos])) pos++; }
  function peek() { skipWs(); return src[pos]; }

  function parseExpression() {
    var v = parseTerm();
    for (;;) {
      skipWs();
      var ch = src[pos];
      if (ch === '+') { pos++; v += parseTerm(); }
      else if (ch === '-') { pos++; v -= parseTerm(); }
      else return v;
    }
  }
  function parseTerm() {
    var v = parseUnary();
    for (;;) {
      skipWs();
      var ch = src[pos];
      if (ch === '*') { pos++; v *= parseUnary(); }
      else if (ch === '/') { pos++; var d = parseUnary(); v = d === 0 ? NaN : v / d; }
      else if (ch === '%') { pos++; var m = parseUnary(); v = m === 0 ? NaN : v % m; }
      else if (ch === '^') { pos++; v = Math.pow(v, parseUnary()); }
      else return v;
    }
  }
  function parseUnary() {
    skipWs();
    if (src[pos] === '-') { pos++; return -parseUnary(); }
    if (src[pos] === '+') { pos++; return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary() {
    skipWs();
    var ch = src[pos];
    if (ch === '(') {
      pos++;
      var v = parseExpression();
      skipWs();
      if (src[pos] !== ')') throw new Error('括号不匹配');
      pos++;
      return v;
    }
    if (/[0-9.]/.test(ch)) return parseNumber();
    if (/[A-Za-z_\u4e00-\u9fff]/.test(ch)) return parseIdentifier();
    throw new Error('表达式包含不支持的字符: ' + ch);
  }
  function parseNumber() {
    var start = pos;
    while (pos < src.length && /[0-9.]/.test(src[pos])) pos++;
    var raw = src.slice(start, pos);
    var n = parseFloat(raw);
    if (!isFinite(n)) throw new Error('无效数字: ' + raw);
    return n;
  }
  function parseIdentifier() {
    var start = pos;
    while (pos < src.length && /[A-Za-z0-9_\u4e00-\u9fff]/.test(src[pos])) pos++;
    var word = src.slice(start, pos);
    skipWs();
    if (src[pos] === '(') {
      var fn = MATH_FNS[word];
      if (!fn) throw new Error('不支持的函数: ' + word);
      pos++;
      var args = [];
      skipWs();
      if (src[pos] !== ')') {
        args.push(parseExpression());
        for (;;) {
          skipWs();
          if (src[pos] === ',') { pos++; args.push(parseExpression()); }
          else break;
        }
      }
      skipWs();
      if (src[pos] !== ')') throw new Error('括号不匹配');
      pos++;
      return fn.apply(null, args);
    }
    if (word === 'column') return toNum(vars.column);
    if (word === 'row') return toNum(vars.row);
    if (word === 'pi' || word === 'PI') return Math.PI;
    if (word === 'e' || word === 'E') return Math.E;
    if (Object.prototype.hasOwnProperty.call(vars, word)) return toNum(vars[word]);
    throw new Error('未知字段: ' + word);
  }

  var result = parseExpression();
  skipWs();
  if (pos < src.length) throw new Error('表达式存在多余内容: ' + src.slice(pos, pos + 20));
  return result;
}

// ===================== 9. HTML meta / 链接提取 =====================
function extractMetaFromHtml(html, baseUrl) {
  var src = String(html || '').slice(0, 3000000);
  function decodeEntities(s) {
    return String(s || '')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  }
  function attrOf(tag, attr) {
    var m = tag.match(new RegExp(attr + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
    if (!m) return '';
    return decodeEntities(m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4] || ''));
  }
  var meta = {
    title: '',
    description: '',
    keywords: [],
    canonical: '',
    lang: '',
    charset: '',
    og: {},
    twitter: {},
    favicon: '',
    headings: [],
    images_count: 0,
    links_count: 0,
    json_ld_count: 0
  };

  var titleM = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleM) meta.title = decodeEntities(titleM[1]).trim().slice(0, 300);

  var htmlTagM = src.match(/<html([^>]*)>/i);
  if (htmlTagM) { meta.lang = attrOf(htmlTagM[1], 'lang'); }
  var charsetM = src.match(/<meta[^>]*charset\s*=\s*["']?([\w-]+)/i);
  if (charsetM) meta.charset = charsetM[1];

  var metaRe = /<meta\b[^>]*>/gi;
  var mm;
  while ((mm = metaRe.exec(src)) !== null) {
    var tag = mm[0];
    var nameVal = (attrOf(tag, 'name') || attrOf(tag, 'property') || attrOf(tag, 'itemprop')).toLowerCase();
    var contentVal = attrOf(tag, 'content');
    if (!nameVal || !contentVal) continue;
    if (nameVal === 'description') meta.description = contentVal.slice(0, 500);
    else if (nameVal === 'keywords') meta.keywords = contentVal.split(/[,，]/).map(function(k) { return k.trim(); }).filter(Boolean).slice(0, 30);
    else if (nameVal.indexOf('og:') === 0) meta.og[nameVal.slice(3)] = contentVal.slice(0, 500);
    else if (nameVal.indexOf('twitter:') === 0) meta.twitter[nameVal.slice(8)] = contentVal.slice(0, 500);
  }

  var canonM = src.match(/<link\b[^>]*rel\s*=\s*["']?canonical["']?[^>]*>/i);
  if (canonM) meta.canonical = attrOf(canonM[0], 'href');
  var iconM = src.match(/<link\b[^>]*rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/i);
  if (iconM) meta.favicon = attrOf(iconM[0], 'href');

  var headRe = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  var hm;
  while ((hm = headRe.exec(src)) !== null && meta.headings.length < 40) {
    var htext = decodeEntities(hm[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (htext) meta.headings.push({ level: parseInt(hm[1], 10), text: htext.slice(0, 120) });
  }

  meta.images_count = (src.match(/<img\b/gi) || []).length;
  meta.links_count = (src.match(/<a\b/gi) || []).length;

  var ldRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  var ld;
  var ldItems = [];
  while ((ld = ldRe.exec(src)) !== null) {
    meta.json_ld_count++;
    if (ldItems.length < 5) {
      try {
        var parsed = JSON.parse(ld[1].trim());
        ldItems.push(parsed && parsed['@type'] ? String(parsed['@type']) : 'unknown');
      } catch (e) { ldItems.push('unparseable'); }
    }
  }
  meta.json_ld_types = ldItems;

  // 相对 URL 补全
  if (meta.favicon && baseUrl) { try { meta.favicon = new URL(meta.favicon, baseUrl).toString(); } catch (e) {} }
  if (meta.canonical && baseUrl) { try { meta.canonical = new URL(meta.canonical, baseUrl).toString(); } catch (e) {} }
  return meta;
}

function extractLinksFromHtml(html, baseUrl, scope, keyword) {
  var src = String(html || '').slice(0, 3000000);
  var baseHost = '';
  try { baseHost = new URL(baseUrl).hostname.toLowerCase(); } catch (e) {}
  var kw = String(keyword || '').trim().toLowerCase();
  var seen = {};
  var out = [];
  var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(src)) !== null && out.length < 300) {
    var tag = m[1];
    var hrefM = tag.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefM) continue;
    var raw = (hrefM[2] !== undefined ? hrefM[2] : (hrefM[3] !== undefined ? hrefM[3] : hrefM[4] || '')).trim();
    if (!raw || /^(javascript:|mailto:|tel:|#|data:)/i.test(raw)) continue;
    var abs;
    try { abs = new URL(raw, baseUrl).toString(); } catch (e) { continue; }
    if (!/^https?:\/\//i.test(abs)) continue;
    var host = '';
    try { host = new URL(abs).hostname.toLowerCase(); } catch (e) { continue; }
    var isInternal = host === baseHost || host === 'www.' + baseHost || 'www.' + host === baseHost;
    if (scope === 'internal' && !isInternal) continue;
    if (scope === 'external' && isInternal) continue;
    var linkText = String(m[2]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (kw && abs.toLowerCase().indexOf(kw) < 0 && linkText.toLowerCase().indexOf(kw) < 0) continue;
    if (seen[abs]) continue;
    seen[abs] = true;
    out.push({ text: linkText || '(无文字)', url: abs.slice(0, 2000), internal: isInternal });
  }
  var internalCount = out.filter(function(l) { return l.internal; }).length;
  return { links: out, internal_count: internalCount, external_count: out.length - internalCount };
}

// ===================== 10. read_zip 辅助 =====================
function formatBytes(n) {
  var v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
  if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(2) + ' MB';
  return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// ===================== 10.1 中文文档交付：HTML 构建 =====================
// ★ 2026-09-13 新增（修复"生成 PDF 卡壳"）：
//   问题背景：buildPdfBuffer 使用 PDF 内置的 Helvetica / Courier 字体（WinAnsiEncoding），
//   这些字体**不含 CJK 字形**。写入中文会渲染成乱码，因此旧逻辑对含中文的内容
//   直接抛错拒绝（"PDF 生成仅支持英文/数字内容"）。模型拿到硬错误后往往卡住，
//   用户侧表现为"生成 PDF 卡壳无法使用"。
//
//   为什么不内嵌中文字体：完整 Noto Sans CJK 约 19MB，即便子集化到 GB2312
//   也有 ~3MB，且 CFF/CID 字体的 PDF 嵌入涉及 CIDFontType0 / FontFile3 /
//   ToUnicode CMap，复杂度与出错面都很大，对一个"交付文档"功能不划算。
//
//   采用方案：**HTML 文档交付**。生成一份自包含（字体走系统字体栈）、
//   带打印样式（@media print）的 HTML 文件，用户下载后用浏览器打开，
//   「打印 → 另存为 PDF」即可得到排版完美的中文 PDF。
//   优点：零字体依赖（不挑部署环境）、零额外依赖（不装库）、体积小、绝不会乱码。
//   纯 ASCII 内容仍走真正的 PDF 路径，保持既有能力不回退。
function escapeHtmlText(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtmlBuffer(title, blocks) {
  var list = Array.isArray(blocks) ? blocks.slice(0, 500) : [];
  var body = [];

  if (title) body.push('<h1 class="doc-title">' + escapeHtmlText(title) + '</h1>');

  for (var i = 0; i < list.length; i++) {
    var b = list[i];
    if (b === null || b === undefined) continue;
    if (typeof b === 'string') b = { type: 'p', text: b };
    var btype = String(b.type || 'p').toLowerCase();

    if (btype === 'h1') {
      body.push('<h2>' + escapeHtmlText(clampText(b.text, 20000)) + '</h2>');
    } else if (btype === 'h2') {
      body.push('<h3>' + escapeHtmlText(clampText(b.text, 20000)) + '</h3>');
    } else if (btype === 'h3') {
      body.push('<h4>' + escapeHtmlText(clampText(b.text, 20000)) + '</h4>');
    } else if (btype === 'ul' || btype === 'ol') {
      var items = Array.isArray(b.items) ? b.items.slice(0, 300) : [];
      var tag = btype === 'ol' ? 'ol' : 'ul';
      var liHtml = items.map(function(it) {
        return '<li>' + escapeHtmlText(clampText(it, 20000)) + '</li>';
      }).join('');
      body.push('<' + tag + '>' + liHtml + '</' + tag + '>');
    } else if (btype === 'table') {
      var headers = Array.isArray(b.headers) ? b.headers.slice(0, 12) : [];
      var rows = Array.isArray(b.rows) ? b.rows.slice(0, 300) : [];
      var thtml = ['<table>'];
      if (headers.length) {
        thtml.push('<thead><tr>' + headers.map(function(h) {
          return '<th>' + escapeHtmlText(h) + '</th>';
        }).join('') + '</tr></thead>');
      }
      thtml.push('<tbody>');
      rows.forEach(function(r) {
        var cells = Array.isArray(r) ? r : [r];
        thtml.push('<tr>' + cells.map(function(c) {
          return '<td>' + escapeHtmlText(c === null || c === undefined ? '' : c) + '</td>';
        }).join('') + '</tr>');
      });
      thtml.push('</tbody></table>');
      body.push(thtml.join(''));
    } else if (btype === 'hr') {
      body.push('<hr>');
    } else if (btype === 'quote') {
      body.push('<blockquote>' + escapeHtmlText(clampText(b.text, 20000)) + '</blockquote>');
    } else if (btype === 'code') {
      body.push('<pre><code>' + escapeHtmlText(clampText(b.text, 20000)) + '</code></pre>');
    } else {
      var para = clampText(b.text, 20000);
      // 段落内换行转为 <br>，保留用户排版意图
      body.push('<p>' + escapeHtmlText(para).replace(/\r?\n/g, '<br>') + '</p>');
    }
  }

  if (!body.length) body.push('<p>（空文档）</p>');

  // 自包含 HTML：CSS 内联，字体走系统字体栈（含中文字体优先级），
  // 附打印样式，用户「打印 → 另存为 PDF」即得标准 A4 文档。
  var html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapeHtmlText(title || '文档') + '</title>',
    '<style>',
    '  :root { color-scheme: light; }',
    '  body {',
    '    max-width: 780px; margin: 0 auto; padding: 40px 24px 72px;',
    '    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",',
    '                 "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Zen Hei",',
    '                 "Helvetica Neue", Arial, sans-serif;',
    '    font-size: 16px; line-height: 1.75; color: #1a1a1a; background: #fff;',
    '    -webkit-text-size-adjust: 100%;',
    '  }',
    '  .doc-title { font-size: 28px; font-weight: 700; margin: 0 0 24px; line-height: 1.35; }',
    '  h2 { font-size: 22px; margin: 28px 0 12px; }',
    '  h3 { font-size: 19px; margin: 24px 0 10px; }',
    '  h4 { font-size: 17px; margin: 20px 0 8px; }',
    '  p { margin: 0 0 14px; }',
    '  ul, ol { margin: 0 0 14px; padding-left: 26px; }',
    '  li { margin: 4px 0; }',
    '  hr { border: 0; border-top: 1px solid #d8d8d8; margin: 24px 0; }',
    '  blockquote { margin: 0 0 14px; padding: 8px 16px; border-left: 3px solid #c8c8c8;',
    '               background: #f7f7f7; color: #444; }',
    '  pre { background: #f5f5f5; padding: 12px 14px; border-radius: 6px; overflow-x: auto; }',
    '  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14px; }',
    '  table { width: 100%; border-collapse: collapse; margin: 0 0 18px; font-size: 15px; }',
    '  th, td { border: 1px solid #dcdcdc; padding: 8px 10px; text-align: left; vertical-align: top; }',
    '  th { background: #f2f2f2; font-weight: 600; }',
    '  tbody tr:nth-child(even) { background: #fafafa; }',
    '  @media print {',
    '    @page { size: A4; margin: 18mm 16mm; }',
    '    body { max-width: none; padding: 0; font-size: 12pt; }',
    '    .doc-title { font-size: 20pt; }',
    '    h2 { font-size: 16pt; } h3 { font-size: 14pt; } h4 { font-size: 12.5pt; }',
    '    pre, blockquote, table { page-break-inside: avoid; }',
    '    tr, img { page-break-inside: avoid; }',
    '  }',
    '</style>',
    '</head>',
    '<body>',
    body.join('\n'),
    '</body>',
    '</html>'
  ].join('\n');

  return Buffer.from(html, 'utf8');
}

var ZIP_TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts',
  'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'rb', 'php', 'sh', 'bat', 'sql',
  'yml', 'yaml', 'toml', 'ini', 'conf', 'log', 'env', 'gitignore', 'vue', 'svelte', 'scss', 'less'];

function isZipTextFile(name) {
  var base = String(name || '').split('/').pop();
  var idx = base.lastIndexOf('.');
  if (idx < 0) return true; // 无扩展名按文本尝试
  var ext = base.slice(idx + 1).toLowerCase();
  return ZIP_TEXT_EXT.indexOf(ext) >= 0;
}

module.exports = {
  clampInt: clampInt,
  clampText: clampText,
  toNum: toNum,
  escapeXml: escapeXml,
  normalizeSeries: normalizeSeries,
  buildChartSvg: buildChartSvg,
  svgToPngDataUrl: svgToPngDataUrl,
  isPureAscii: isPureAscii,
  buildPdfBuffer: buildPdfBuffer,
  buildHtmlBuffer: buildHtmlBuffer,
  escapeHtmlText: escapeHtmlText,
  diffLines: diffLines,
  parseDelimited: parseDelimited,
  buildDelimited: buildDelimited,
  rowsToObjects: rowsToObjects,
  objectsToRows: objectsToRows,
  buildMarkdownTable: buildMarkdownTable,
  buildQrSvg: buildQrSvg,
  encodeQrBytes: encodeQrBytes,
  buildQrMatrix: buildQrMatrix,
  evaluatePasswordStrength: evaluatePasswordStrength,
  generatePassword: generatePassword,
  evaluateFormula: evaluateFormula,
  extractMetaFromHtml: extractMetaFromHtml,
  extractLinksFromHtml: extractLinksFromHtml,
  formatBytes: formatBytes,
  isZipTextFile: isZipTextFile,
  CHART_PALETTE: CHART_PALETTE
};
