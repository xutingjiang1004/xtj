'use strict';
// Official list prices, checked 2026-10-19. Estimates are separate from the
// provider's invoice. Old stored messages retain their original price metadata.
const PRICE_VERSION = 'deepseek-2026-10-19';
const RATES = {
  CNY: { flash: [1, .02, 4], pro: [4.5, .15, 13.5] },
  USD: { flash: [.15, .003, .6], pro: [.66, .022, 1.98] }
};
// 国办发明电〔2025〕7号; weekends always use off-peak provider pricing.
const HOLIDAYS_2026 = [['01-01','01-03'],['02-15','02-23'],['04-04','04-06'],['05-01','05-05'],['06-19','06-21'],['09-25','09-27'],['10-01','10-07']];
function pricing(model, at = new Date(), env = process.env) {
  const date = new Date(new Date(at).getTime() + 8 * 3600000);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid price timestamp');
  const day = date.toISOString().slice(0,10), md = day.slice(5), minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const knownCalendar = date.getUTCFullYear() === 2026;
  const overrides = String(env.DEEPSEEK_OFF_PEAK_DATES || '').split(',').map(value => value.trim());
  const holiday = overrides.includes(day) || (knownCalendar && HOLIDAYS_2026.some(([first,last]) => md >= first && md <= last));
  const peak = date.getUTCDay() >= 1 && date.getUTCDay() <= 5 && !holiday && ((minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080));
  const family = /pro/i.test(String(model)) ? 'pro' : 'flash';
  const currency = String(env.DEEPSEEK_CURRENCY || 'CNY').toUpperCase();
  let rates = RATES[currency]?.[family]?.map(value => value * (peak ? 2 : 1));
  const suffixes = ['INPUT','CACHE_HIT','OUTPUT']; let customized = false;
  rates = suffixes.map((suffix,index) => {
    const value = env['DEEPSEEK_' + family.toUpperCase() + '_' + suffix + '_PRICE_PER_1M'] ?? env['DEEPSEEK_' + suffix + '_PRICE_PER_1M'];
    if (value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0) { customized = true; return Number(value); }
    return rates?.[index] ?? null;
  });
  return { price_version:PRICE_VERSION, model_family:family, band:peak?'peak':'off_peak', currency, input:rates[0], cache_hit:rates[1], output:rates[2], customized, calendar_confirmed:knownCalendar, priced_at:new Date(at).toISOString(), estimated:true };
}
function estimate(usage, model, at, env) {
  if (!usage) return usage;
  const price = pricing(model, at, env), prompt = Math.max(0,Number(usage.prompt_tokens ?? usage.input_tokens)||0);
  const hit = Math.min(prompt,Math.max(0,Number(usage.prompt_cache_hit_tokens ?? usage.input_tokens_details?.cached_tokens)||0));
  const miss = prompt - hit, output = Math.max(0,Number(usage.completion_tokens ?? usage.output_tokens)||0);
  const cost = [price.input,price.cache_hit,price.output].some(value => value === null) ? null : Math.round((miss*price.input+hit*price.cache_hit+output*price.output));
  return { ...usage, prompt_cache_hit_tokens:hit, prompt_cache_miss_tokens:miss, cost:cost===null?null:cost/1e6, currency:price.currency, cost_estimated:true, pricing:price };
}
// Token aggregation remains with the caller; preserve each completed request's
// own model/time estimate rather than reprice a mixed research flow at its end.
function accumulate(target, usage) {
  if (!usage || typeof usage !== 'object') return;
  const prompt=Math.max(0,Number(usage.prompt_tokens ?? usage.input_tokens)||0);
  const hit=Math.min(prompt,Math.max(0,Number(usage.prompt_cache_hit_tokens ?? usage.input_tokens_details?.cached_tokens)||0));
  target.prompt_cache_hit_tokens=(target.prompt_cache_hit_tokens||0)+hit;
  target.prompt_cache_miss_tokens=(target.prompt_cache_miss_tokens||0)+prompt-hit;
  if(typeof usage.cost!=='number' || !Number.isFinite(usage.cost)){target.cost_incomplete=true;return;}
  const currency=usage.currency||'CNY';
  const sums=target.costs_by_currency ||= {};
  sums[currency]=Math.round(((sums[currency]||0)+usage.cost)*1e6)/1e6;
  target.currency=Object.keys(sums).length===1?currency:'mixed';
  target.cost=target.currency==='mixed'?null:sums[currency];
  target.cost_estimated=true;
  target.cost_incomplete=!!target.cost_incomplete||!!usage.cost_incomplete;
  const metadata=target.pricing ||= {price_version:PRICE_VERSION,aggregated:true,requests:0,parts:[]};
  metadata.requests++;if(metadata.parts.length<64)metadata.parts.push(usage.pricing||{currency,cost:usage.cost,estimated:!!usage.cost_estimated});
}
module.exports = { pricing, estimate, accumulate, PRICE_VERSION };
