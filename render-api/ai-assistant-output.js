'use strict';
const {insideFence} = require('./markdown-fences');

const FOLLOWUP_OPEN = '<xtj-followups>';
const FOLLOWUP_CLOSE = '</xtj-followups>';
const FOLLOWUP_INSTRUCTION = '\n回答正文结束后，在单独一行输出 <xtj-followups>["最贴合当前对话的一条下一问"]</xtj-followups>。最多推荐一个用户视角的简短追问，不回答该问题。这一块由界面单独显示。推荐前结合最近几轮对话、用户最新意图与纠正、以及本轮实际回答，选择最有价值且尚未回答的下一问；最新意图优先于历史话题。用户只说“不对”“继续”等短句时，承接最近的具体话题与待核对事项。不要重复或改写用户已经问过的问题，不要推荐本轮已经解答的内容，不要臆造地点、日期、数值、偏好或工具能力。不要仅因回答提到“接口”“数据”“来源”等词就跳转到编程或研究；天气对话应围绕同一地点与时间的天气核对或出行需要。禁止套用与当前任务无关的“最小可运行例子”“边界情况”等通用模板。无法确定相关且有用的下一问时，输出 <xtj-followups>[]</xtj-followups>，不要凑数。工具调用、规划 JSON 和中断时不要输出这一块。';

function normalizeFollowups(value, question) {
  const result = [];
  const comparable = text => String(text || '').replace(/[\s?？!！。．.]/g, '').toLowerCase();
  const currentQuestion = comparable(question);
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== 'string') continue;
    const text = String(item || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
    if (!text || text.length > 100 || /https?:\/\/|<\/?(?:script|xtj-followups)/i.test(text) || (currentQuestion && comparable(text) === currentQuestion)) continue;
    result.push(text);
    break;
  }
  return result;
}

function splitFollowups(value) {
  const text = String(value || '');
  const match = /(?:^|\n)[ \t]*<xtj-followups>([\s\S]{0,8192}?)<\/xtj-followups>[ \t\r\n]*$/.exec(text);
  if (!match || insideFence(text.slice(0, match.index))) return { text, followups: [] };
  let followups = [];
  try { followups = normalizeFollowups(JSON.parse(match[1])); } catch (_) {}
  return { text: text.slice(0, match.index).trimEnd(), followups };
}

function withoutIncompleteFooter(value) {
  const text = String(value || '');
  const marker = /(?:^|\n)[ \t]*(<xtj-followups>[\s\S]*|<[^\n]*)$/.exec(text);
  if(marker && !marker[1].startsWith(FOLLOWUP_OPEN) && !FOLLOWUP_OPEN.startsWith(marker[1]))return text;
  if (!marker || insideFence(text.slice(0, marker.index))) return text;
  return text.slice(0, marker.index).trimEnd();
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
        if((!before||/\n[ \t]*$/.test(before))&&!insideFence(before)){output(pending.slice(0,index));pending='';collecting=true;return;}
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
      const inCode = insideFence(before);
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

module.exports = { FOLLOWUP_OPEN, FOLLOWUP_CLOSE, FOLLOWUP_INSTRUCTION, normalizeFollowups, splitFollowups, contextEstimate, createFollowupStream, createSafeAssistantStream };
