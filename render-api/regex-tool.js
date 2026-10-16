'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const MAX_ACTIVE = 2, TIMEOUT_MS = 750;
let active = 0;
function abortError() { return Object.assign(new Error('正则测试已取消'),{name:'AbortError'}); }

async function runRegex(args, options={}) {
  const pattern=String(args.pattern || ''),text=String(args.text == null ? '' : args.text),signal=options.signal;
  if (!pattern || pattern.length > 1000 || text.length > 100000) throw Error('正则表达式最多 1000 字符，测试文字最多 100000 字符');
  const requested=String(args.flags == null ? 'g' : args.flags);
  if (!/^[gimsuy]*$/.test(requested) || new Set(requested).size !== requested.length) throw Error('正则标记无效或重复');
  const flags=requested.includes('g') ? requested : requested+'g';
  if (signal && signal.aborted) throw abortError();
  if (active >= MAX_ACTIVE) throw Error('正则测试繁忙，请稍后重试');
  active++;
  try {
    return await new Promise((resolve,reject) => {
      const worker=new Worker(path.join(__dirname,'regex-worker.js'),{
        workerData:{pattern,text,flags},resourceLimits:{maxOldGenerationSizeMb:16,maxYoungGenerationSizeMb:4,stackSizeMb:1}
      });
      let done=false;
      const finish=async(error,result) => {
        if (done) return; done=true;clearTimeout(timer);
        if (signal) signal.removeEventListener('abort',cancel);
        // Keep the capacity slot until the worker is actually gone.
        try { await worker.terminate(); } catch (_) {}
        if (error) reject(error); else resolve(result);
      };
      const cancel=()=>finish(abortError());
      const timer=setTimeout(()=>finish(Error('正则匹配超时，请简化表达式或缩短测试文字')),TIMEOUT_MS);
      worker.once('message',result=>finish(result.ok ? null : Error(result.error),result.matches));
      worker.once('error',()=>finish(Error('正则测试无法完成，请简化表达式后重试')));
      worker.once('exit',()=>{if(!done)finish(Error('正则测试已停止'));});
      if (signal) { signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel(); }
    });
  } finally { active--; }
}
module.exports={runRegex};
