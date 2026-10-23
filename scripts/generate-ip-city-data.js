'use strict';
// Offline maintenance tool. Runtime does not depend on npm or this converter.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pinyin}=require('pinyin-pro');
if(require('pinyin-pro/package.json').version!=='3.29.5')throw Error('Use pinned pinyin-pro 3.29.5');
const source=process.argv[2];
if(!source)throw Error('Usage: node scripts/generate-ip-city-data.js <directory containing province.json and city.json>');
function read(name,digest){const bytes=fs.readFileSync(path.join(source,name+'.json'));if(crypto.createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('Unexpected province-city-china 9.0.0 '+name);return JSON.parse(bytes);}
const provinces=read('province','7d7ee447e058bec7e2918ee78241be1341c4471ac8483e6b34eecfd2e154796e');
const cities=read('city','450f63fd503878c5a5fee36aa539dce0916a91e48200aa49034320eb4ff9185e');
const normalize=value=>value.replace(/(?:特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/,'');
const regions=new Map(provinces.map(row=>[row.province,normalize(row.name)]));
const ascii=value=>pinyin(value,{toneType:'none',type:'array'}).join('').toLowerCase();
const special={拉萨:['lhasa'],日喀则:['shigatse'],林芝:['nyingchi'],昌都:['qamdo'],那曲:['nagqu'],山南:['lhoka'],阿里:['ngari'],
  呼和浩特:['hohhot'],鄂尔多斯:['ordos','erdos'],呼伦贝尔:['hulunbuir'],巴彦淖尔:['bayannur'],乌兰察布:['ulanqab'],
  阿拉善:['alxa'],锡林郭勒:['xilingol'],乌鲁木齐:['urumqi'],克拉玛依:['karamay'],吐鲁番:['turpan'],
  克孜勒苏:['kizilsu'],巴音郭楞:['bayingolin'],博尔塔拉:['bortala'],齐齐哈尔:['qiqihar'],阿勒泰:['altay'],伊犁:['ili']};
const rows=[];
for(const row of cities){
  if(/直辖县级行政区划|市辖区/.test(row.name))continue;
  const city=normalize(row.name);
  const base=city.replace(/(?:自治州|地区|盟)$/,'').replace(/(?:白族|藏族|回族|蒙古族?|苗族|壮族|彝族|哈尼族|傣族|景颇族|布依族|侗族|朝鲜族|土家族|哈萨克|柯尔克孜|黎族).*/,'');
  rows.push([regions.get(row.province),city,[...new Set([ascii(city),ascii(base),...(special[base]||[]),city,base])],row.code]);
}
const header="'use strict';\n// province-city-china 9.0.0 (MIT), commit 0c4934fe; see docs/ip-location-data.md.\n// Offline names/aliases only: this is not an IP range database or device location.\n(function(root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.XtjIpCityData = data;\n})(globalThis, ";
fs.writeFileSync(path.join(__dirname,'../js/ip-city-data.js'),header+JSON.stringify(rows)+');\n');
console.log('Generated '+rows.length+' prefectures; '+rows.reduce((n,row)=>n+row[2].length,0)+' aliases');
