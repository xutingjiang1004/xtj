'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const helpers=require('../render-api/tool-helpers'),sharp=require('sharp');
const src=fs.readFileSync('render-api/server.js','utf8');
const start=src.indexOf("    case 'make_chart': {")+"    case 'make_chart': ".length,end=src.indexOf("    case 'generate_pdf':",start);
function chart(args){const context={args,name:'make_chart',toolHelpers:helpers,sharp,Buffer,console,aiSiteCard:(type,title,data)=>({type,title,data})};vm.createContext(context);return vm.runInContext('(async()=>'+src.slice(start,end).trim()+')()',context);}
for(const type of [undefined,'bar','line','pie','scatter','bad'])test('real chart tool renders '+String(type)+' with Chinese labels',async()=>{
 const result=await chart({type,title:'福州游客对比',labels:['福州','烟台山'],series:[{name:'客流量',data:[35,80]}],x_label:'景区',y_label:'万人'});
 assert.equal(result.error,undefined);assert.equal(result.chart_type,['line','pie','scatter'].includes(type)?type:'bar');assert.match(result.cards[0].data.image,/^data:image\/png;base64,/);assert.doesNotMatch(result.cards[0].title,/undefined/);
 const meta=await sharp(Buffer.from(result.cards[0].data.image.split(',')[1],'base64')).metadata();assert.ok(meta.width>=720);assert.match(result.cards[0].data.svg,/福州/);
});
test('unknown and invalid chart data return a repairable error instead of fabricated zeros',async()=>{for(const value of [null,'未知','',false,{},Infinity]){const result=await chart({series:[{data:[value]}]});assert.match(result.error,/有效数字/);}assert.deepEqual(helpers.normalizeSeries([{data:['1,200','35%','-2.5']}],200)[0].data,[1200,35,-2.5]);});
test('bar categories align with groups rather than line-chart endpoints',()=>{const svg=helpers.buildChartSvg('bar','对比',['甲','乙'],[{name:'系列',data:[1,2]}],'','',720,420);const coords=[...svg.matchAll(/<text x="([\d.]+)"[^>]*>甲<\/text>|<text x="([\d.]+)"[^>]*>乙<\/text>/g)].map(m=>Number(m[1]||m[2]));assert.deepEqual(coords,[219.5,534.5]);});
test('bundled font renders different Chinese glyphs on a host with no installed fonts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xtj-font-test-'));try{fs.mkdirSync(path.join(dir,'fonts'));fs.mkdirSync(path.join(dir,'cache'));const config=path.join(dir,'fonts.conf');fs.writeFileSync(config,`<fontconfig><dir>${dir}/fonts</dir><cachedir>${dir}/cache</cachedir></fontconfig>`);
 const code=`const h=require(${JSON.stringify(path.resolve('render-api/tool-helpers'))}),s=require(${JSON.stringify(require.resolve('sharp'))});(async()=>{const render=async text=>{const png=await h.svgToPngDataUrl(s,'<svg xmlns="http://www.w3.org/2000/svg" width="150" height="80"><text x="10" y="60" font-size="48" font-family="WenQuanYi Micro Hei">'+text+'</text></svg>');if(!png)throw Error('no PNG');return s(Buffer.from(png.split(',')[1],'base64')).raw().toBuffer()};if((await render('福州')).equals(await render('增长')))throw Error('missing glyphs');})().catch(e=>{console.error(e);process.exitCode=1});`;
 execFileSync(process.execPath,['-e',code],{env:{...process.env,FONTCONFIG_FILE:config},timeout:10000});}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
