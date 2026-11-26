'use strict';
// D-L4 回归：前端 vendor 文件无版本锁定依据。
// 修复前：js/vendor/supabase.min.js 文件名无版本，仓库内看不出它与
//   package.json 的 @supabase/supabase-js 2.106.2 是否一致。
// 修复后：核对——vendor 包内嵌 X-Client-Info 版本戳 supabase-js-*/2.106.2、
//   storage-js/2.106.2、gotrue-js/2.106.2、realtime-js/2.106.2，与
//   package.json 的 2.106.2 一致；在 index.html 的引用处加一行版本注释锁定。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vendor = fs.readFileSync(path.join(__dirname, '..', 'js', 'vendor', 'supabase.min.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('D-L4: vendor 包内嵌版本戳与 package.json 的 2.106.2 一致', () => {
  assert.equal(pkg.dependencies['@supabase/supabase-js'], '2.106.2',
    'package.json 应锁定 @supabase/supabase-js 2.106.2');
  assert.ok(vendor.includes('supabase-js-'), 'vendor 包应含 supabase-js 客户端标识');
  assert.ok(/supabase-js-\$\{tn\}\/2\.106\.2/.test(vendor) || vendor.includes('supabase-js/2.106.2') || /`supabase-js-.*\/2\.106\.2`/.test(vendor),
    'vendor 包内嵌的 supabase-js 版本戳应为 2.106.2');
  assert.ok(vendor.includes('storage-js/2.106.2'), 'storage-js 版本戳应为 2.106.2');
  assert.ok(vendor.includes('realtime-js/2.106.2'), 'realtime-js 版本戳应为 2.106.2');
});

test('D-L4: index.html 引用处有版本注释，锁定 2.106.2', () => {
  const refIdx = html.indexOf('<script defer src="js/vendor/supabase.min.js');
  assert.ok(refIdx >= 0, 'index.html 应以 script 引用 js/vendor/supabase.min.js');
  const before = html.slice(Math.max(0, refIdx - 400), refIdx);
  assert.ok(before.includes('2.106.2'), '引用处附近应有一行注明 2.106.2 的版本注释');
  assert.ok(before.includes('package.json') || before.includes('@supabase/supabase-js'),
    '版本注释应写明与 package.json 的 @supabase/supabase-js 对应');
});
