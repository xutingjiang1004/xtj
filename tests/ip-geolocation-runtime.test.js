'use strict';
// Every address/location pair below is synthetic. No third-party lookup or
// production write is made, and these cases do not measure real-world accuracy.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const geo = require('../render-api/ip-geolocation');
const server = fs.readFileSync('render-api/server.js', 'utf8');
const admin = fs.readFileSync('js/admin/admin.js', 'utf8');
const ip = '8.8.8.8';
function between(source, from, to) { const start = source.indexOf(from), end = source.indexOf(to, start); assert.ok(start >= 0 && end > start); return source.slice(start, end); }
const isPrivate = new Function('require', between(server, 'function isPrivateOrReservedIp(', '// Login enrichment') + ';return isPrivateOrReservedIp;')(require);
const cn = (provider, region, city) => ({provider, country:'中国', region, city});
const response = value => new Response(JSON.stringify(value), {headers:{'content-type':'application/json;charset=utf-8'}});
const baidu = (city = '杭州', region = '浙江') => ({status:'0', data:[{OriginQuery:ip, location:'中国' + region + '省' + (city ? city + '市' : '') + ' 电信'}]});
const pconline = (city = '杭州', region = '浙江') => ({ip, pro:region + '省', city:city ? city + '市' : '', err:''});
const who = (city = 'Hangzhou', region = 'Zhejiang Sheng') => ({ip, success:true, country:'China', country_code:'CN', region, city});
function providerName(url) { const host = new URL(url).hostname; return host === 'opendata.baidu.com' ? 'baidu-opendata' : host === 'whois.pconline.com.cn' ? 'pconline' : host; }
function fixture(values, options = {}) {
  const calls = [];
  const resolver = geo.createIpGeocoder({isPrivateOrReservedIp:isPrivate, ...options, fetch:async (url, init) => {
    const name = providerName(url); calls.push({name, url, init});
    const value = values[name];
    if (typeof value === 'function') return value(url, init);
    return value === undefined ? new Response('', {status:503}) : response(value);
  }});
  return {resolver, calls};
}
function deferred() { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; }
const tick = () => new Promise(resolve => setImmediate(resolve));

test('IP normalization handles mapped hexadecimal IPv6, bracketed ports and canonical cache keys', () => {
  for (const value of ['::ffff:8.8.8.8','0:0:0:0:0:FFFF:0808:0808','[::ffff:808:808]:443','8.8.8.8:1234']) assert.equal(geo.normalizeIpAddress(value), ip);
  assert.equal(geo.normalizeIpAddress('[2001:4860:4860:0:0:0:0:8888]:443'), '2001:4860:4860::8888');
  assert.equal(geo.normalizeIpAddress('fe80::1%eth0'),'fe80::1');
  assert.equal(geo.normalizeIpAddress('[fe80::1%eth0]:443'),'fe80::1');
  for (const value of ['unknown','1.2.3.999','::ffff:999.1.2.3','[bad]:443']) assert.equal(geo.normalizeIpAddress(value), '');
});

test('domestic parsers separate country, autonomous regions, city, district and ISP and verify echoed IP', () => {
  for (const [location,region,city] of [
    ['中国浙江省杭州市余杭区 移动','浙江','杭州'],
    ['广西壮族自治区南宁市 联通','广西','南宁'],
    ['新疆维吾尔自治区伊犁哈萨克自治州电信','新疆','伊犁哈萨克自治州'],
    ['北京市北京市移动','北京',''], ['海南省省直辖县级行政区划 联通','海南','']
  ]) {
    const parsed = geo.parseBaiduGeoPayload({status:'0',data:[{location,OriginQuery:ip}]}, ip);
    assert.deepEqual([parsed.region,parsed.city], [region,city]);
  }
  assert.equal(geo.parseBaiduGeoPayload({status:'0',data:[{location:'浙江省杭州市',origip:'1.1.1.1'}]}, ip), null);
  assert.equal(geo.parsePconlineGeoText(JSON.stringify({...pconline(),ip:'1.1.1.1'}), ip), null);
  assert.equal(geo.parsePconlineGeoText(JSON.stringify({...pconline(),err:'not_found'}), ip), null);
  assert.equal(geo.parsePconlineGeoText(JSON.stringify({...pconline(),city:'省直辖县级行政区划'}), ip).city, '');
  assert.equal(geo.parsePconlineGeoText(JSON.stringify({...pconline(),pro:'美国',city:'洛杉矶'}), ip),null);
  assert.equal(geo.parsePconlineGeoText(JSON.stringify({...pconline(),proCode:'330000',cityCode:'350100'}), ip).city,'');
  assert.equal(geo.normalizeIpGeoName('constructor'),'constructor');
});

test('a fast province-only reply waits for city evidence instead of deciding the result', async () => {
  const slow = deferred();
  const {resolver,calls} = fixture({'baidu-opendata':baidu(''),pconline:() => slow.promise});
  let finished = false;
  const pending = resolver.resolve(ip).then(value => {finished = true; return value;});
  await tick(); assert.equal(finished, false);
  slow.resolve(response(pconline()));
  const result = await pending;
  assert.equal(result.region, '浙江'); assert.equal(result.city, '杭州');
  assert.equal(result.city_confidence, 'single_source'); assert.equal(result.source_ip, ip);
  assert.equal(calls.length, 4);
});

test('two domestic city answers agree without requiring extra overseas requests', async () => {
  const {resolver,calls} = fixture({'baidu-opendata':baidu(),pconline:pconline()});
  const result = await resolver.resolve(ip);
  assert.equal(result.city, '杭州'); assert.equal(result.city_confidence, 'corroborated');
  assert.equal(result.precision, 'approximate_city'); assert.equal(calls.length, 2);
  assert.equal(result.sources.length, 2); assert.equal(result.has_conflict, false);
});

test('conflicting city sources retain the shared province, regardless of response order', async () => {
  for (const slower of ['baidu-opendata','pconline']) {
    const values = {'baidu-opendata':baidu('杭州'),pconline:pconline('宁波'),'ipwho.is':who('Hangzhou'),'ipapi.co':{...who('Ningbo'),country_name:'China'}};
    const original = values[slower]; values[slower] = async () => {await tick(); return response(original);};
    const {resolver} = fixture(values);
    const result = await resolver.resolve(ip);
    assert.equal(result.region, '浙江'); assert.equal(result.city, '');
    assert.equal(result.precision, 'region'); assert.equal(result.city_confidence, 'conflict');
    assert.equal(result.sources.length, 4); assert.doesNotMatch(result.text, /杭州|宁波/);
  }
});

test('additional corroborating evidence can resolve a city tie without inventing district precision', async () => {
  const {resolver} = fixture({'baidu-opendata':baidu(),pconline:pconline('宁波'),'ipwho.is':who()});
  const result = await resolver.resolve(ip);
  assert.equal(result.city, '杭州'); assert.equal(result.city_confidence, 'corroborated');
  assert.equal(result.has_conflict, true); assert.equal(result.precision, 'approximate_city');
});

test('a province tie cannot construct a city belonging to an arbitrarily chosen province', async () => {
  const {resolver} = fixture({'baidu-opendata':baidu(),pconline:pconline('深圳','广东')});
  const result = await resolver.resolve(ip);
  assert.equal(result.country, '中国'); assert.equal(result.region, ''); assert.equal(result.city, '');
  assert.equal(result.precision, 'country'); assert.equal(result.city_confidence, 'conflict');
});

test('ambiguous city romanizations are resolved by province, rather than majority mistranslation', () => {
  for (const [region, english, chinese] of [
    ['安徽','Suzhou','宿州'],['江苏','Suzhou','苏州'],['江西','Fuzhou','抚州'],['福建','Fuzhou','福州'],
    ['浙江','Taizhou','台州'],['江苏','Taizhou','泰州'],['江西','Yichun','宜春'],['黑龙江','Yichun','伊春'],
    ['广西','Yulin','玉林'],['陕西','Yulin','榆林']
  ]) {
    const value = geo.selectIpLocation([cn('a',region,chinese),cn('b',region,english),cn('c',region,english)],ip);
    assert.equal(value.city,chinese); assert.equal(value.city_confidence,'corroborated'); assert.equal(value.has_conflict,false);
  }
  const missingProvince = geo.selectIpLocation([cn('a','','Suzhou'),cn('b','','Suzhou')],ip);
  assert.equal(missingProvince.city,'');
  for (const region of ['constructor','__proto__','toString']) {
    assert.equal(geo.selectIpLocation([cn('a',region,'Suzhou'),cn('b',region,'Suzhou')],ip).city,'');
  }
});

test('known incompatible province/city pairs and generic placeholders cannot become corroborated cities', () => {
  for (const [region,city] of [['安徽','苏州'],['江西','福州'],['广西','榆林'],['新疆','自治区直辖县级行政区划']]) {
    const value = geo.selectIpLocation([cn('a',region,city),cn('b',region,city)],ip);
    assert.equal(value.city,''); assert.equal(value.precision,'region');
  }
});

test('Jilin province and Jilin city remain distinct facts, while municipalities do not duplicate', () => {
  const value = geo.selectIpLocation([cn('a','吉林省','吉林市'),cn('b','Jilin Sheng','Jilin Shi')],ip);
  assert.equal(value.region,'吉林'); assert.equal(value.city,'吉林'); assert.equal(value.city_confidence,'corroborated');
  assert.equal(value.text,'中国 · 吉林 · 吉林市');
  assert.equal(geo.parseBaiduGeoPayload({status:'0',data:[{location:'吉林省吉林市 电信'}]},ip).city,'吉林');
  const municipal = geo.selectIpLocation([cn('a','北京','北京市'),cn('b','Beijing','Beijing')],ip);
  assert.equal(municipal.city,''); assert.equal(municipal.text,'中国 · 北京');
});

test('province-less city votes cannot bypass an unresolved province conflict', () => {
  const value = geo.selectIpLocation([cn('a','浙江','杭州'),cn('b','广东','深圳'),cn('c','','Hangzhou'),cn('d','','Hangzhou')],ip);
  assert.equal(value.region,''); assert.equal(value.city,''); assert.equal(value.city_confidence,'conflict'); assert.equal(value.precision,'country');
});

test('province-only evidence is not marked as city precision, and overseas fallback is normalized', async () => {
  const province = fixture({'baidu-opendata':baidu(''),pconline:pconline('')});
  const result = await province.resolver.resolve(ip);
  assert.equal(result.precision, 'region'); assert.equal(result.city, '');
  const overseas = fixture({'ipwho.is':who(),'ipapi.co':{...who(),country_name:'China'}});
  const city = await overseas.resolver.resolve(ip);
  assert.equal(city.region, '浙江'); assert.equal(city.city, '杭州'); assert.equal(city.city_confidence, 'corroborated');
});

test('mismatched or unsuccessful provider responses cannot geolocate the server egress by mistake', async () => {
  const {resolver} = fixture({'baidu-opendata':{status:'0',data:[{location:'浙江省杭州市',origip:'1.1.1.1'}]},pconline:{...pconline(),ip:'1.1.1.1'},'ipwho.is':{...who(),ip:'1.1.1.1'},'ipapi.co':{...who(),country_name:'China',ip:'1.1.1.1'}});
  assert.equal(await resolver.resolve(ip), null);
  assert.ok(resolver.getDiagnostics(ip).every(row => row.error_code === 'invalid_payload'));
});

test('private, reserved, invalid and mapped private addresses never leave the server', async () => {
  const {resolver,calls} = fixture({});
  for (const value of ['127.0.0.1','10.1.2.3','100.64.1.2','203.0.113.10','::ffff:c0a8:101','0:0:0:0:0:0:0:1','fe80::1%eth0','fd12::1','unknown']) assert.equal(await resolver.resolve(value), null);
  assert.equal(calls.length, 0);
});

test('canonical address deduplication shares one cache and force refresh fetches fresh evidence', async () => {
  const {resolver,calls} = fixture({'baidu-opendata':baidu(),pconline:pconline()});
  const [a,b] = await Promise.all([resolver.resolve(ip),resolver.resolve('::ffff:0808:0808')]);
  assert.deepEqual(a,b); assert.equal(calls.length, 2);
  await resolver.resolve(ip); assert.equal(calls.length, 2);
  await Promise.all([resolver.resolve(ip,{forceRefresh:true}),resolver.resolve(ip,{forceRefresh:true})]);
  assert.equal(calls.length, 4);
});

test('a forced query is not joined to an older lookup and late old results cannot poison its cache', async () => {
  const oldB = deferred(), oldP = deferred(); let count = 0;
  const {resolver,calls} = fixture({
    'baidu-opendata':() => (++count <= 2 ? oldB.promise : Promise.resolve(response(baidu('宁波')))),
    pconline:() => (++count <= 2 ? oldP.promise : Promise.resolve(response(pconline('宁波'))))
  });
  const original = resolver.resolve(ip); await tick();
  const fresh = await resolver.resolve(ip,{forceRefresh:true}); assert.equal(fresh.city, '宁波');
  oldB.resolve(response(baidu())); oldP.resolve(response(pconline()));
  assert.equal((await original).city, '杭州');
  assert.equal((await resolver.resolve(ip)).city, '宁波'); assert.equal(calls.length, 4);
});

test('conflicts expire quickly and normal lookups recheck them after their own TTL', async () => {
  let time = Date.now();
  const {resolver,calls} = fixture({'baidu-opendata':baidu(),pconline:pconline('宁波')},{now:() => time});
  await resolver.resolve(ip); assert.equal(calls.length, 4);
  time += geo.locationCacheTtl({has_conflict:true}) - 1;
  await resolver.resolve(ip); assert.equal(calls.length, 4);
  time += 2; await resolver.resolve(ip); assert.equal(calls.length, 8);
});

test('deadlines include body reads and settle even if fetch ignores abort', async () => {
  const never = new Promise(() => {}), signals = [];
  const {resolver} = fixture(Object.fromEntries(['baidu-opendata','pconline','ipwho.is','ipapi.co'].map(name => [name, async (_url, init) => {
    signals.push(init.signal); return name === 'pconline' ? never : {ok:true,status:200,headers:new Headers(),arrayBuffer:() => never};
  }])),{domesticTimeoutMs:15,overseasTimeoutMs:15});
  assert.equal(await resolver.resolve(ip), null);
  assert.equal(signals.length, 4); assert.ok(signals.every(signal => signal.aborted));
  assert.ok(resolver.getDiagnostics(ip).every(row => row.error_code === 'timeout'));
});

test('oversized response streams fail and retained diagnostic keys are bounded', async () => {
  const values = Object.fromEntries(['baidu-opendata','pconline','ipwho.is','ipapi.co'].map(name => [name, () => new Response('x'.repeat(70_000))]));
  const {resolver} = fixture(values, {cacheMax:2});
  for (const value of ['8.8.8.8','1.1.1.1','9.9.9.9']) assert.equal(await resolver.resolve(value), null);
  assert.deepEqual(resolver.getDiagnostics(ip), []);
  assert.ok(resolver.getDiagnostics('9.9.9.9').every(row => row.error_code === 'payload_too_large'));
});

test('trusted proxy extraction skips Cloudflare hops but ignores forged provider headers on a direct connection', () => {
  const scope = new Function('require','isPrivateOrReservedIp',between(server,'function normalizeClientIpValue(', '// AI site tools')+';return {getClientIp};')(name => name === '../js/ip-location' ? require('../js/ip-location') : name.startsWith('./') ? require('../render-api/'+name.slice(2)) : require(name),isPrivate);
  const proxied = {ip:'173.245.48.1',socket:{remoteAddress:'173.245.48.1'},headers:{'x-forwarded-for':'6.6.6.6, 8.8.8.8, 173.245.48.1','cf-connecting-ip':'1.1.1.1'}};
  assert.equal(scope.getClientIp(proxied), ip); assert.equal(proxied._clientIpSource, 'xff_chain_public');
  assert.equal(scope.getClientIp({ip:'173.245.48.1',socket:{remoteAddress:'173.245.48.1'},headers:{}}), 'unknown');
  assert.equal(scope.getClientIp({ip:'1.1.1.1',socket:{remoteAddress:'1.1.1.1'},headers:{'x-forwarded-for':'6.6.6.6','cf-connecting-ip':ip}}), '1.1.1.1');
  for (const chain of ['8.8.8.8, bad-hop','8.8.8.8, , 10.0.0.2','8.8.8.8, unknown, 173.245.48.1']) {
    assert.equal(scope.getClientIp({ip:'bad-hop',socket:{remoteAddress:'10.0.0.1'},headers:{'x-forwarded-for':chain}}),'unknown');
  }
});

test('real Express proxy parsing cannot skip malformed or reserved hops to accept a forged IP', async () => {
  const express = require('express'), request = require('supertest');
  const proxies = require('../render-api/trusted-proxies');
  const {getClientIp} = new Function('require','isPrivateOrReservedIp',between(server,'function normalizeClientIpValue(', '// AI site tools')+';return {getClientIp};')(name => name === '../js/ip-location' ? require('../js/ip-location') : name.startsWith('./') ? require('../render-api/'+name.slice(2)) : require(name),isPrivate);
  const app = express();
  app.set('trust proxy',address=>proxies.isCloudflareProxy(address) || proxies.isTrustedInternalProxy(address));
  app.get('/',(req,res)=>res.json({ip:getClientIp(req)}));
  assert.equal((await request(app).get('/').set('x-forwarded-for','6.6.6.6, 8.8.8.8, 10.1.2.3')).body.ip,ip);
  assert.equal((await request(app).get('/').set('x-forwarded-for','bad-hop, , 8.8.8.8, 10.1.2.3')).body.ip,ip);
  for (const hop of ['bad-hop','','192.0.2.1','2001:db8::1','198.18.0.1']) {
    const value = (await request(app).get('/').set('x-forwarded-for','8.8.8.8, '+hop+', 10.1.2.3')).body.ip;
    assert.notEqual(value,ip,hop); assert.ok(value === 'unknown' || isPrivate(value),hop);
  }
});

test('post snapshots use the requesting IP, the same resolver and no separate day-long cache', async () => {
  const requests = [];
  const resolve = new Function('resolveIpLocation',between(server,'async function resolveIpRegion(', '// IP retry jobs')+';return resolveIpRegion;')(async value => {
    requests.push(value); return value === ip ? {region:'浙江',city:'杭州',city_confidence:'corroborated'} : {region:'广东',city:'深圳',city_confidence:'corroborated'};
  });
  assert.deepEqual(await resolve(ip), {province:'浙江',city:'杭州',text:'浙江 杭州',status:'resolved'});
  assert.deepEqual(await resolve('1.1.1.1'), {province:'广东',city:'深圳',text:'广东 深圳',status:'resolved'});
  assert.deepEqual(requests,[ip,'1.1.1.1']);
  assert.doesNotMatch(server,/var IP_REGION_CACHE_TTL_MS = 24/);
});

test('post city snapshots cannot promote a single-source guess into an unqualified city', async () => {
  const resolve = new Function('resolveIpLocation',between(server,'async function resolveIpRegion(', '// IP retry jobs')+';return resolveIpRegion;')(async()=>({country:'中国',region:'浙江',city:'杭州',city_confidence:'single_source'}));
  assert.deepEqual(await resolve(ip),{province:'浙江',city:'',text:'浙江',status:'resolved'});
});

test('actual post creation ignores submitted IP/city and keeps optional GPS separate when lookup fails', async () => {
  let handler, payload, unavailable = false;
  const lookedUp = [], queued = [];
  const scope = vm.createContext({
    app:{post(_path,...handlers){handler=handlers.at(-1);}},authenticateUser(){},rateLimit:()=>()=>{},userBanError:()=>null,
    SUPABASE_URL:'https://db.invalid',validatePostAttachments:()=>[],parsePostMediaUrl:()=>null,isLocalUploadUrl:()=>false,
    getClientIp:req=>req.ip,isPrivateOrReservedIp:isPrivate,
    resolveIpRegion:async value=>{lookedUp.push(value);return unavailable?{province:'',city:'',text:'',status:'failed'}:{province:'浙江',city:'杭州',text:'浙江 杭州',status:'resolved'};},
    supabase:{from:()=>({insert(rows){payload=rows[0];return{select:()=>({single:async()=>({data:{id:'saved-post',...payload},error:null})})};}})},
    queuePersistentIpRegionRetry:async(...args)=>{queued.push(args);return true;},console:{log(){},warn(){},error(){}},sanitizeError:String
  });
  vm.runInContext(between(server,"app.post('/api/post/create'",'// POST /api/location/reverse'),scope);
  const req={ip,userName:'alice',headers:{},body:{content:'synthetic test',visibility:'public',user_name:'bob',ip:'1.1.1.1',ip_city:'伪造城市',ip_region_text:'伪造属地',location:{name:'主动选择的地点',city:'GPS 城市'}}};
  const makeResponse=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
  const first=makeResponse();await handler(req,first);
  assert.equal(first.statusCode,201);assert.equal(payload.user_name,'alice');assert.equal(payload.ip_city,'杭州');assert.equal(payload.location_city,'GPS 城市');
  unavailable=true;const second=makeResponse();await handler(req,second);await tick();
  assert.equal(second.statusCode,201);assert.equal(payload.ip_region_status,'pending');assert.equal(payload.ip_city,'');assert.equal(payload.ip_region_text,null);
  assert.equal(payload.location_city,'GPS 城市');assert.deepEqual(lookedUp,[ip,ip]);assert.equal(queued[0][1],ip);
});

test('idempotent image and video retries from a different IP cannot requeue historical post geography', async () => {
  for (const album of [false,true]) {
    let handler, duplicate = true; const queued = [];
    const original = {id:'original-post',ip_region_status:'pending',ip_lookup_started_at:'2026-10-01T00:00:00Z'};
    const db = {rpc:async()=>({data:{ok:true,post:original,attachments:[],duplicate}})};
    const scope = vm.createContext({
      app:{post(_path,...handlers){handler=handlers.at(-1);}},authenticateUser(){},rateLimit:()=>()=>{},userBanError:()=>null,
      SUPABASE_URL:'https://db.invalid',validatePostAttachments:()=>album?[{media_url:'https://db.invalid/media.jpg'}]:[],parsePostMediaUrl:()=>'posts/original.mp4',isLocalUploadUrl:()=>true,
      getClientIp:req=>req.ip,isPrivateOrReservedIp:isPrivate,resolveIpRegion:async()=>({province:'',city:'',status:'failed'}),
      createPostWithAttachments:require('../render-api/post-attachments').createPostWithAttachments,
      createPostWithMedia:require('../render-api/post-media').createPostWithMedia,supabase:db,
      queuePersistentIpRegionRetry:async(...args)=>{queued.push(args);return true;},console:{log(){},warn(){},error(){}},sanitizeError:String
    });
    vm.runInContext(between(server,"app.post('/api/post/create'",'// POST /api/location/reverse'),scope);
    const req={ip:'1.1.1.1',userName:'alice',headers:{},body:{content:'retry from another network',visibility:'public',media_url:'https://db.invalid/media.mp4',media_type:album?'image':'video',media_storage_path:'posts/original.mp4',media_upload_id:'upload-original'}};
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
    await handler(req,res); await tick(); assert.equal(res.statusCode,201); assert.equal(res.body.data.id,original.id); assert.equal(queued.length,0);
    duplicate=false; await handler(req,res); await tick(); assert.equal(queued.length,1); assert.equal(queued[0][1],req.ip);
  }
});

test('administrator IP geography never falls back to GPS or a different event address and explains uncertainty', () => {
  const scope = vm.createContext({URL,window:{XtjIpLocation:require('../js/ip-location')}});
  vm.runInContext(between(admin,'function adminGetIpLocation(', '// 登录设备详情展示'),scope);
  const location = {source_ip:ip,text:'中国 · 浙江',region:'浙江',city_confidence:'conflict'};
  assert.equal(scope.adminGetIpLocation({last_ip:ip,last_location:{address:'GPS 杭州市'}},{ip:'1.1.1.1',ip_location:{text:'旧地区'}},ip), null);
  assert.equal(scope.adminGetIpLocation({last_ip:ip,last_ip_location_ip:'1.1.1.1',last_ip_location:{text:'旧地区'}},null,ip), null);
  assert.equal(scope.adminGetIpLocation({last_ip:ip,last_ip_location:location},null,ip),location);
  assert.equal(scope.adminGetIpLocation({last_ip:ip,last_ip_location:{...location,source:'gps'},last_ip_location_ip:ip},null,ip),null);
  assert.equal(scope.adminGetIpLocation({}, {ip,ip_location:{...location,precision:'precise'}},ip),null);
  assert.match(scope.adminFormatLocation(location),/城市待核实/);
  assert.doesNotMatch(scope.adminFormatLocation(location),/杭州/);
  assert.equal(scope.adminGetIpLocation({last_ip:'::ffff:808:808',last_ip_location:location},null),location);
  assert.equal(scope.adminGetIpLocation({}, {ip:'0:0:0:0:0:ffff:808:808',ip_location:location},ip),location);
  const ipv6 = {...location,source_ip:'2001:4860:4860::8888'};
  assert.equal(scope.adminGetIpLocation({last_ip:'2001:4860:4860:0:0:0:0:8888',last_ip_location:ipv6},null),ipv6);
  assert.equal(scope.adminGetIpLocation({last_ip:'unknown',last_ip_location_ip:'unknown',last_ip_location:location},null),null);
  assert.equal(scope.adminFormatLocation({text:'China · Anhui · Suzhou'}),'安徽宿州');
  assert.equal(scope.adminFormatLocation({text:'China · Jiangxi · Fuzhou'}),'江西抚州');
  assert.equal(scope.adminFormatLocation({text:'China · Jilin · Jilin'}),'吉林省吉林市');
  assert.equal(scope.adminFormatLocation({text:'China · constructor · Suzhou'}),'constructor');
});

test('public post IP labels preserve the existing province-only choice even when a city is available', () => {
  const posts=fs.readFileSync('js/core-parts/04-posts-interactions.js','utf8');
  const scope=vm.createContext({normalizePostRecord:value=>value,escapeHtml:String,window:{XtjIpLocation:require('../js/ip-location')}});
  vm.runInContext(between(posts,'function buildPostLocationHtml(normalized) {','// 供 core-parts/06'),scope);
  const html=scope.buildPostLocationHtml({ip_province:'浙江',ip_city:'杭州',ip_region_text:'浙江 杭州',ip_region_status:'resolved'});
  assert.match(html,/IP属地：浙江/);assert.doesNotMatch(html,/杭州/);
});


test('pconline GBK bytes are decoded before province and city agreement', async () => {
  const {resolver} = fixture({'baidu-opendata':baidu(),pconline:() => new Response(Buffer.from('7b226970223a22382e382e382e38222c2270726f223a22d5e3bdadcaa1222c2263697479223a22babcd6ddcad0222c22657272223a22227d','hex'),{headers:{'content-type':'text/html;charset=gbk'}})});
  const result = await resolver.resolve(ip);
  assert.equal(result.city,'杭州'); assert.equal(result.city_confidence,'corroborated');
});
