const fs = require('fs');
const path = require('path');

const corePath = path.join(__dirname, '..', 'js', 'core.js');
let content = fs.readFileSync(corePath, 'utf8');

console.log('开始修复 core.js 关键区域乱码...\n');

let fixesApplied = 0;

function applyFix(oldStr, newStr, description) {
    if (content.includes(oldStr)) {
        const count = (content.match(new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        content = content.split(oldStr).join(newStr);
        fixesApplied += count;
        console.log(`✓ ${description} (${count}处)`);
    }
}

// 统计详情区域
applyFix('const titles = { posts: \'总��╅幀?- 按��ら���分�?, views: \'总浏�?- 浏览记录\', likes: \'点赞和评�?- 记��? };', 
          'const titles = { posts: \'总动态 - 按用户分组\', views: \'总浏览 - 浏览记录\', likes: \'点赞和评论 - 记录\' };',
          '统计详情标题');
applyFix('document.getElementById(\'statModalTitle\').textContent = titles[type] || \'统计�︽儏\';',
          'document.getElementById(\'statModalTitle\').textContent = titles[type] || \'统计详情\';',
          '统计标题回退');
applyFix('<span class="loading-text">加载�?..</span>', 
          '<span class="loading-text">加载中...</span>', 
          '加载中文字');
applyFix('<div class="stat-empty">加载失��Е，请重试</div>',
          '<div class="stat-empty">加载失败，请重试</div>',
          '加载失败提示');
applyFix('document.getElementById(\'postDetailTitle\').textContent = \'帖子�︽儏\';',
          'document.getElementById(\'postDetailTitle\').textContent = \'帖子详情\';',
          '帖子详情标题');
applyFix('<div class="post-detail-stats">浏��?${vc} 璺?点��?${likes.length} 璺?评��?${comments.length}</div>',
          '<div class="post-detail-stats">浏览 ${vc} · 点赞 ${likes.length} · 评论 ${comments.length}</div>',
          '帖子详情统计');
applyFix('<div class="stat-section-title">鉂わ�?点赞��﹀煕閿?{likes.length}閿?/div>',
          '<div class="stat-section-title">❤️ 点赞用户(${likes.length})</div>',
          '点赞标题');
applyFix('<div class="stat-section-title">馃挰 评论列��€�锛?{comments.length}閿?/div>',
          '<div class="stat-section-title">💬 评论列表(${comments.length})</div>',
          '评论列表标题');
applyFix('<div class="stat-empty" style="padding:12px 0;">暂��ら���赞</div>',
          '<div class="stat-empty" style="padding:12px 0;">暂无点赞</div>',
          '暂无点赞');
applyFix('<div class="stat-empty" style="padding:12px 0;">暂��ょ���论</div>',
          '<div class="stat-empty" style="padding:12px 0;">暂无评论</div>',
          '暂无评论');
applyFix('<div class="stat-empty">甯栧瓙涓嶅瓨锟姐劍锟斤拷宸茶被鍒犻櫎</div>',
          '<div class="stat-empty">帖子不存在或已删除</div>',
          '帖子不存在提示');
applyFix('<div class="stat-empty">鏃犳潈锟姐儳锟斤拷杩欐潯甯栧瓙</div>',
          '<div class="stat-empty">无权查看这条帖子</div>',
          '无权查看提示');
applyFix('<div class="stat-empty">暂无�ㄦ€�数�?/div>',
          '<div class="stat-empty">暂无数据</div>',
          '暂无数据');
applyFix('<span class="suh-count">${posts.length} 鏉?/span>',
          '<span class="suh-count">${posts.length} 条</span>',
          '统计条数');
applyFix('<span class="spi-img-tag">馃柤 閸ュ墽澧?/span>',
          '<span class="spi-img-tag">🖼️ 图片</span>',
          '图片标签');
applyFix('<span class="spi-img-tag">馃幀 视��?/span>',
          '<span class="spi-img-tag">🎞️ 视频</span>',
          '视频标签');
applyFix('const display = summary || (hasImg ? \'涓€张图�? : hasVid ? \'涓€个视�? : \'(无内�?\');',
          'const display = summary || (hasImg ? \'一张图片\' : hasVid ? \'一个视频\' : \'(无内容)\');',
          '内容摘要');
applyFix('title="点击�ョ��帖子�︽儏">',
          'title="点击查看帖子详情">',
          '点击查看提示');
applyFix('// 渲染总��З态统�★��按��ら���分组��?',
          '// 渲染总动态统计，按用户分组',
          '分组统计注释');
applyFix('// 閹?user_name 分组统计',
          '// 按 user_name 分组统计',
          '分组统计注释2');
applyFix('// 滚��╅���指定帖�€��并高亮',
          '// 滚动到指定帖子并高亮',
          '滚动注释');
applyFix('// 打开统计�︽儏�Ο℃€�框',
          '// 打开统计详情模态框',
          '统计详情注释');
applyFix('// 婵″����有缓��ɑ��据，立即�〒�染，同时异�ュ埛鏂?',
          '// 如果有缓存数据，立即渲染，同时异步刷新',
          '缓存注释');
applyFix('// 后台静默刷��?',
          '// 后台静默刷新',
          '后台刷新注释');
applyFix('noMore.textContent = "没有更多帖子了";',
          'noMore.textContent = "没有更多帖子了";',
          '没有更多（已有正确版本，检查）');
applyFix('// 格���鍖�х��子内�€��摘要（�?����展�ず�?',
          '// 格式化帖子内容摘要（用于展示',
          '摘要注释');
applyFix('// 閻㈢��垚甯�х��条���的HTML（可点击跳转�?',
          '// 生成帖子条目的HTML（可点击跳转',
          '生成条目注释');

console.log(`\n总共修复了 ${fixesApplied} 处！正在保存...`);

fs.writeFileSync(corePath, content, 'utf8');

console.log('✅ core.js 修复完成！');
