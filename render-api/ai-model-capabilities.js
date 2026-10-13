'use strict';
const { assertSafeWebUrl, requestPinnedJson } = require('./web-fetch');
const ENDPOINTS = {
  qwen:'https://dashscope.aliyuncs.com/compatible-mode/v1', doubao:'https://ark.cn-beijing.volces.com/api/v3',
  deepseek:'https://api.deepseek.com', kimi:'https://api.moonshot.cn/v1',
  zhipu:'https://open.bigmodel.cn/api/paas/v4', openai:'https://api.openai.com/v1'
};
const RED_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';
function thinkingParameters(provider, model, effort = 'low', verified = false) {
  if (provider === 'qwen') return { enable_thinking:true, thinking_budget:1024 };
  if (verified || provider === 'openai' && /^(?:o[134](?:-|$)|gpt-5(?:-|$))/i.test(model)) return {reasoning_effort:effort};
  return {};
}
function errorLabel(status, data) {
  const code = String(data && data.error && (data.error.code || data.error.type) || '');
  if (status === 401 || status === 403) return {category:'credentials', detail:'鉴权或权限失败，请检查 Key 与模型权限'};
  if (status === 429) return {category:/quota|credit|balance/i.test(code) ? 'quota' : 'rate_limit', detail:'服务商额度不足或限流，请稍后检查'};
  if (status === 404) return {category:'model_or_endpoint', detail:'模型或接口不存在，请核对名称和地址'};
  if (status === 400 || status === 422) return {category:'request_rejected', detail:'该测试请求被拒绝；可能是能力或参数不兼容'};
  if (status >= 300 && status < 400) return {category:'redirect', detail:'接口要求跳转，请填写最终 HTTPS 接口地址'};
  return {category:'upstream', detail:'服务商暂时无法完成测试'};
}
async function probeCapabilities(config, deps = {}) {
  const safeUrl = deps.safeUrl || assertSafeWebUrl, transport = deps.transport || requestPinnedJson;
  const safe = await safeUrl(String(config.base_url || '').trim() || ENDPOINTS[config.provider]);
  if (safe.parsed.protocol !== 'https:') throw Error('https_required');
  const endpoint = new URL(safe.parsed.href.replace(/\/+$/, '') + '/chat/completions');
  const usage = {prompt_tokens:0,completion_tokens:0,total_tokens:0}, results = [];
  const base = { model:config.model, max_tokens:64, messages:[{role:'user',content:'只回复 OK。'}] };
  async function probe(name, extra, verify) {
    if (deps.signal && deps.signal.aborted) { results.push({name,status:'unconfirmed',detail:'测试已取消，未继续检查'}); return false; }
    try {
      const payload = {...base,...extra};
      if (config.provider === 'openai' && /^(?:o[134](?:-|$)|gpt-5(?:-|$))/i.test(config.model)) { payload.max_completion_tokens = Math.max(512,Number(payload.max_tokens)||64); delete payload.max_tokens; if (!payload.reasoning_effort) payload.reasoning_effort = 'low'; }
      const response = await transport(endpoint, safe.addresses, {method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer ' + config.api_key},
        body:JSON.stringify(payload), maxBytes:128*1024, timeoutMs:15000, signal:deps.signal});
      let data; try { data = JSON.parse(response.text); } catch (_) {}
      if (data && data.usage) {
        usage.prompt_tokens += Math.max(0,Number(data.usage.prompt_tokens || data.usage.input_tokens)||0);
        usage.completion_tokens += Math.max(0,Number(data.usage.completion_tokens || data.usage.output_tokens)||0);
        usage.total_tokens += Math.max(0,Number(data.usage.total_tokens)||0);
      }
      if (response.status < 200 || response.status >= 300) {
        results.push({name,status:'failed',...errorLabel(response.status,data),http_status:response.status}); return false;
      }
      const usageBeforeVerify = usage.total_tokens;
      const status = verify(data, response.text) ? 'passed' : 'unconfirmed';
      results.push({name,status,detail:status === 'passed' ? '本次实测通过' : '接口接受了请求，但未返回足以确认该能力的结果'});
      // Providers without usage still incurred a short request, accounted for conservatively.
      if ((!data || !data.usage) && usage.total_tokens === usageBeforeVerify) { usage.prompt_tokens += 100; usage.completion_tokens += Number(extra.max_tokens || base.max_tokens); usage.total_tokens += 100 + Number(extra.max_tokens || base.max_tokens); }
      return true;
    } catch (_) { results.push({name,status:'failed',category:'network',detail:'连接失败、超时或测试已取消'}); return false; }
  }
  const connected = await probe('chat', {}, data => !!(data && data.choices && data.choices[0] && typeof data.choices[0].message?.content === 'string' && data.choices[0].message.content.trim()));
  if (connected && results[0].status === 'passed') {
    await probe('tools', { tools:[{type:'function',function:{name:'xtj_model_test',description:'连通性测试，不执行任何动作',parameters:{type:'object',properties:{answer:{type:'string',enum:['OK']}},required:['answer'],additionalProperties:false}}}],
      tool_choice:{type:'function',function:{name:'xtj_model_test'}} }, data => {
      const calls = data?.choices?.[0]?.message?.tool_calls;
      return Array.isArray(calls) && calls.some(call => { try { return call.function?.name === 'xtj_model_test' && JSON.parse(call.function.arguments).answer === 'OK'; } catch (_) { return false; } });
    });
    await probe('vision', { messages:[{role:'user',content:[{type:'text',text:'这个纯色图片是什么颜色？只回复颜色。'},{type:'image_url',image_url:{url:RED_IMAGE}}]}] }, data => /红|\bred\b|#ff0000/i.test(String(data?.choices?.[0]?.message?.content || '')));
    const reasonParams = config.provider === 'qwen' ? {enable_thinking:true,thinking_budget:128} : {reasoning_effort:'low'};
    await probe('reasoning', {...reasonParams,max_tokens:512}, data => !!(data?.choices?.[0]?.message?.reasoning_content || data?.choices?.[0]?.message?.reasoning || Number(data?.usage?.completion_tokens_details?.reasoning_tokens) > 0));
    await probe('streaming', {stream:true,stream_options:{include_usage:true}}, (_, body) => {
      const packets = body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => { try { return JSON.parse(line.slice(5)); } catch (_) { return null; } });
      packets.forEach(packet => { if (packet?.usage) { usage.prompt_tokens += Number(packet.usage.prompt_tokens)||0; usage.completion_tokens += Number(packet.usage.completion_tokens)||0; usage.total_tokens += Number(packet.usage.total_tokens)||0; } });
      return packets.some(packet => packet?.choices?.[0]?.delta?.content) && (body.includes('data: [DONE]') || packets.some(packet => packet?.choices?.[0]?.finish_reason));
    });
  } else ['tools','vision','reasoning','streaming'].forEach(name => results.push({name,status:'unconfirmed',detail:'基础对话未通过，未继续发送能力测试'}));
  return { results, usage, tested_at:new Date().toISOString(), model:config.model };
}
function installModelCapabilities(app, deps) {
  app.post('/api/agent/models/check', deps.authenticateUser, deps.rateLimit(60000,2), deps.rateLimit(3600000,20), async (req,res) => {
    const body = req.body || {}, provider = String(body.provider || 'custom');
    if (!body.api_key || typeof body.api_key !== 'string' || body.api_key.length > 4096 || typeof body.model !== 'string' || !body.model.trim() || body.model.length>128 || !ENDPOINTS[provider] && !body.base_url)
      return res.status(400).json({ok:false,error:'请填写有效的模型名称、Key 和接口地址'});
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted',cancel); res.on('close',cancel);
    const timer = setTimeout(() => controller.abort(),65000);
    let report;
    try {
      const gate = await deps.gate(req.userName,{needSearch:false});
      if (!gate.allowed) return res.status(429).json({ok:false,error:'当前 AI 额度或请求次数已达上限'});
      report = await probeCapabilities({provider,model:body.model.trim(),api_key:body.api_key,base_url:String(body.base_url || '').slice(0,2048)},{signal:controller.signal});
      if (!controller.signal.aborted) res.json({ok:true,...report,usage:undefined});
    } catch (_) { if (!controller.signal.aborted) res.status(400).json({ok:false,error:'测试无法完成，请检查 HTTPS 地址、网络和模型配置'}); }
    finally {
      clearTimeout(timer); req.removeListener('aborted',cancel); res.removeListener('close',cancel);
      if (report) await deps.record(req.userName,report.usage,{model:body.model,source:'model_capability_check',message:'模型能力检测',content:'',search_count:0}).catch(() => {});
    }
  });
}
module.exports = { probeCapabilities, installModelCapabilities, thinkingParameters };
