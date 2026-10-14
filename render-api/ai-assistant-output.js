'use strict';

const FOLLOWUP_OPEN = '<xtj-followups>';
const FOLLOWUP_CLOSE = '</xtj-followups>';
const FOLLOWUP_INSTRUCTION = '\n回答正文结束后，在单独一行输出 <xtj-followups>["结合本轮内容的下一问1","下一问2","下一问3"]</xtj-followups>。只推荐用户可能继续提出的三个短问题，不回答这些问题；不要重复本轮提问，不编造事实。这一块由界面单独显示。工具调用、规划 JSON 和中断时不要输出这一块。';

function normalizeFollowups(value) {
  const result = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== 'string') continue;
    const text = String(item || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
    if (!text || text.length > 100 || /https?:\/\/|<\/?(?:script|xtj-followups)/i.test(text) || result.includes(text)) continue;
    result.push(text);
    if (result.length === 3) break;
  }
  return result;
}

function splitFollowups(value) {
  const text = String(value || '');
  const match = /(?:^|\n)[ \t]*<xtj-followups>([\s\S]{0,8192}?)<\/xtj-followups>[ \t\r\n]*$/.exec(text);
  if (!match || (text.slice(0, match.index).match(/^\s*```/gm) || []).length % 2) return { text, followups: [] };
  let followups = [];
  try { followups = normalizeFollowups(JSON.parse(match[1])); } catch (_) {}
  return { text: text.slice(0, match.index).trimEnd(), followups };
}

function withoutIncompleteFooter(value) {
  const text = String(value || '');
  const marker = /(?:^|\n)[ \t]*(<xtj-followups>[\s\S]*|<[^\n]*)$/.exec(text);
  if(marker && !marker[1].startsWith(FOLLOWUP_OPEN) && !FOLLOWUP_OPEN.startsWith(marker[1]))return text;
  if (!marker || (text.slice(0, marker.index).match(/^\s*```/gm) || []).length % 2) return text;
  return text.slice(0, marker.index).trimEnd();
}

function contextualFollowups(question, answer) {
  const sample = String(question || '').slice(0, 1000) + '\n' + String(answer || '').slice(0, 3000);
  if (/你是什么模型|你是.*模型|模型.*能力|模型.*区别/.test(sample)) return ['你更擅长处理哪些任务？', '使用这个模型有哪些限制？', '怎样提问能得到更好的回答？'];
  if (/对比|比较|区别|选购|选型/.test(sample)) return ['可以用表格列出关键差异吗？', '结合我的使用场景应该怎样选择？', '还有哪些容易忽略的限制？'];
  if (/研究|来源|证据|报告|资料/.test(sample)) return ['哪些结论有直接证据支持？', '有哪些相反观点或不确定的地方？', '可以把关键发现整理成行动建议吗？'];
  if (/代码|程序|报错|接口|函数|部署/.test(sample)) return ['可以给出一个最小可运行的例子吗？', '应该怎样验证这一步是否正确？', '有哪些边界情况需要处理？'];
  if (/学习|课程|考试|知识|概念/.test(sample)) return ['可以用一个具体例子解释吗？', '初学者最容易误解哪些地方？', '可以给我一道练习题吗？'];
  if (/旅行|旅游|行程|酒店|景点/.test(sample)) return ['可以按天整理具体行程吗？', '这份方案的预算应该怎样安排？', '有哪些需要提前准备的事项？'];
  const heading = String(answer || '').match(/^#{1,3}\s+([^\n]{2,35})/m);
  return heading ? ['可以进一步解释“' + heading[1].replace(/[*`]/g, '') + '”吗？', '能给一个贴近实际的例子吗？', '接下来我应该怎样做？'] : ['能给一个贴近实际的例子吗？', '还有哪些条件或限制需要考虑？', '接下来我应该怎样做？'];
}

function contextEstimate(messages, details={}) {
  let text='',images=0;
  for(const message of Array.isArray(messages)?messages:[]) {
    if(typeof message.content==='string')text+=message.content+'\n';
    else for(const part of Array.isArray(message.content)?message.content:[]){if(part.type==='text')text+=String(part.text||'');else if(part.type==='image_url')images++;}
  }
  const cjk=(text.match(/[\u3400-\u9fff]/g)||[]).length;
  return {estimated_tokens:Math.ceil(cjk*1.5+(text.length-cjk)/4),text_characters:text.length,image_count:images,
    history_retained:Number(details.retained)||0,history_omitted:Math.max(0,(Number(details.supplied)||0)-(Number(details.retained)||0)),
    exact_window:null,includes_system_prompt:true,additional_tool_context:true};
}

function createFollowupStream(emit) {
  let raw='',pending='',published='',collecting=false;
  function output(text){if(text){published+=text;emit(text);}}
  return {
    push(piece){
      piece=String(piece||'');raw+=piece;if(raw.length>600000)throw Error('assistant_output_too_large');
      if(collecting)return;
      pending+=piece;
      const index=pending.indexOf(FOLLOWUP_OPEN);
      if(index>=0){
        const before=published+pending.slice(0,index);
        if((!before||/\n[ \t]*$/.test(before))&&(before.match(/^\s*```/gm)||[]).length%2===0){output(pending.slice(0,index));pending='';collecting=true;return;}
      }
      let keep=0;
      for(let length=1;length<FOLLOWUP_OPEN.length;length++)if(pending.endsWith(FOLLOWUP_OPEN.slice(0,length)))keep=length;
      output(pending.slice(0,pending.length-keep));pending=keep?pending.slice(-keep):'';
    },
    finish(value){
      const result=splitFollowups(value===undefined?raw:value);
      if(!result.followups.length)result.followups=splitFollowups(raw).followups;
      const text=withoutIncompleteFooter(result.text).trimEnd();
      if(text.startsWith(published))output(text.slice(published.length));
      return {text,followups:result.followups};
    },
    get raw(){return raw;}
  };
}

// Releases clear prose immediately. JSON envelopes and incomplete protocol
// prefixes remain private until the round has been classified. Once a protocol
// starts, its remaining arguments can never become public text.
function createSafeAssistantStream(options = {}) {
  let raw = '', pending = '', published = '', blocked = false, opaque = false;
  const emit = text => { if (text) { published += text; if (options.emit) options.emit(text); } };
  function possibleTag(text) {
    const heads = ['<dsml', '</dsml', '<tool_call', '</tool_call', '<function_call', '</function_call', '<invoke', '</invoke', '<parameter', '</parameter', '<plugin_info', '</plugin_info', '<xtj-followups'];
    for (let index = text.indexOf('<'); index >= 0; index = text.indexOf('<', index + 1)) {
      const suffix = text.slice(index).toLowerCase().replace(/[\s|｜]/g, '');
      const before = published + text.slice(0, index);
      const inCode = (before.match(/^\s*```/gm) || []).length % 2;
      if (inCode && (FOLLOWUP_OPEN.startsWith(suffix) || FOLLOWUP_CLOSE.startsWith(suffix) || suffix.startsWith('<xtj-followups') || suffix.startsWith('</xtj-followups'))) continue;
      if (suffix === '<' || suffix === '</' || heads.some(head => head.startsWith(suffix) || suffix.startsWith(head))) return index;
    }
    return -1;
  }
  return {
    push(piece) {
      piece = String(piece || ''); raw += piece;
      if (raw.length > 600000) throw Error('assistant_output_too_large');
      if (blocked) return;
      pending += piece;
      if (!published.trim()) {
        const initial=raw.trimStart();
        // A split opening fence or leading whitespace cannot establish prose.
        // Keep it private until its language/body can be classified.
        if (!initial || initial==='`' || initial==='``' || '```json'.startsWith(initial.toLowerCase())) return;
        if (/^[\[{]/.test(initial) || /^```(?:json)?\s/i.test(initial)) opaque = true;
      }
      if (opaque) return;
      const index = possibleTag(pending);
      if (index >= 0) {
        emit(pending.slice(0, index)); pending = pending.slice(index);
        if (/^<[\s|｜/]*(?:DSML|tool_calls?|function_calls?|invoke|parameter|plugin_info)\b/i.test(pending) || pending.startsWith(FOLLOWUP_OPEN)) blocked = true;
        return;
      }
      if (options.containsProtocol && options.containsProtocol(raw)) { blocked = true; return; }
      emit(pending); pending = '';
    },
    markToolCall() { blocked = true; pending = ''; },
    finish(value) {
      const result = splitFollowups(value === undefined ? raw : value);
      const unsafe = options.containsProtocol && options.containsProtocol(result.text) || options.looksLikeArgs && options.looksLikeArgs(result.text);
      if (!unsafe) {
        // Keep an unfinished footer private on premature EOF too.
        const text = withoutIncompleteFooter(result.text).trimEnd();
        if (text.startsWith(published)) emit(text.slice(published.length));
        return { text, followups: result.followups, published };
      }
      return { text: '', followups: [], published };
    },
    get raw() { return raw; }, get published() { return published; }
  };
}

module.exports = { FOLLOWUP_OPEN, FOLLOWUP_CLOSE, FOLLOWUP_INSTRUCTION, normalizeFollowups, splitFollowups, contextualFollowups, contextEstimate, createFollowupStream, createSafeAssistantStream };
