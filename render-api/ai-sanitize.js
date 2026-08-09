/**
 * Clean AI assistant visible text: strip stage-direction / action prose in parentheses.
 * Pure function — no DB or request state.
 */
'use strict';

function sanitizeAssistantVisibleText(text, options) {
  var s = String(text || '');
  if (!s) return s;
  // When roleplay is on, skip action cleanup so backend does not rewrite RP style.
  options = options || {};
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

  // 5. Empty after cleanup → fixed user-facing notice
  if (!s) return '我刚刚生成了不合规的动作描写，已自动删除。请重新问一次。';

  return s;
}

module.exports = {
  sanitizeAssistantVisibleText: sanitizeAssistantVisibleText
};
