'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../../render-api/server.js'),source=fs.readFileSync(filename,'utf8');
const context={Buffer,console,Date,Intl,require:createRequire(filename),toolHelpers:require('../../render-api/tool-helpers'),
  AI_SITE_TOOL_REGISTRY:{},sharp:require('sharp'),getXlsxParser:()=>require('xlsx'),
  aiSiteCard:(type,title,data)=>({protocol:'xtj.ai.ui.v1',id:'test-'+type,type,title,data})};
vm.createContext(context);
const definitionStart=source.indexOf('const AI_TOOLS = ['),definitionEnd=source.indexOf('\n];',definitionStart)+3;
vm.runInContext(source.slice(definitionStart,definitionEnd)+';this.definitions=AI_TOOLS;',context);
vm.runInContext(source.slice(source.indexOf('function safeEvalMath('),source.indexOf('function normalizeMarketSymbol(')),context);
const start=source.indexOf('async function executeToolCall('),end=source.indexOf('// 搜索结果自动补全',start);
vm.runInContext(source.slice(start,end)+';this.execute=executeToolCall;',context);
async function execute(name,args,options={}) {
  const result=await context.execute({function:{name,arguments:JSON.stringify(args)}},{userName:'alice',accountId:'isolated-account',...options});
  return JSON.parse(JSON.stringify(result));
}
module.exports={execute,definitions:JSON.parse(JSON.stringify(context.definitions))};
