(function() {
    const ADMIN_NAME = "xxz";

    window.ANN_MARKER = '__ann__';
    const ANN_READ_KEY = 'xtj_ann_read';
    let announcements = [];
    let currentAnnouncement = null;
    window.annRealtime = null;

    window.isAdmin = function() { return window.currentUser === ADMIN_NAME; };

    function getReadAnnouncements() {
        try {
            const data = localStorage.getItem(ANN_READ_KEY);
            return data ? JSON.parse(data) : [];
        } catch(e) {
            return [];
        }
    }
    window.getReadAnnouncements = getReadAnnouncements;

    function saveReadAnnouncements(readIds) {
        localStorage.setItem(ANN_READ_KEY, JSON.stringify(readIds));
    }
    window.saveReadAnnouncements = saveReadAnnouncements;

    function markAnnouncementRead(annId) {
        const readIds = getReadAnnouncements();
        if (!readIds.includes(annId)) {
            readIds.push(annId);
            saveReadAnnouncements(readIds);
            updateAnnouncementBadge();
        }
    }
    window.markAnnouncementRead = markAnnouncementRead;

    function isAnnouncementRead(annId) {
        return getReadAnnouncements().includes(annId);
    }
    window.isAnnouncementRead = isAnnouncementRead;

    function updateAnnouncementBadge() {
        const readIds = getReadAnnouncements();
        const unreadCount = announcements.filter(a => !readIds.includes(a.id)).length;
        const badge = document.getElementById('announcementBadge');
        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }
    window.updateAnnouncementBadge = updateAnnouncementBadge;

    window.openAnnouncementModal = async function() {
        const overlay = document.getElementById('announcementModal');
        overlay.style.opacity = '';
        overlay.style.transition = '';
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        showAnnouncementList();
        await loadAnnouncements();
        renderAnnouncementList();

        if (window.isAdmin()) {
            document.getElementById('announcementAdminArea').style.display = 'block';
        } else {
            document.getElementById('announcementAdminArea').style.display = 'none';
        }
    };

    window.closeAnnouncementModal = function() {
        const overlay = document.getElementById('announcementModal');
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.2s ease';
        setTimeout(() => {
            overlay.classList.remove('active');
            overlay.style.opacity = '';
            overlay.style.transition = '';
            document.body.style.overflow = '';
            currentAnnouncement = null;
        }, 200);
    };

    function showAnnouncementList() {
        document.getElementById('announcementListContainer').style.display = 'block';
        const detail = document.getElementById('announcementDetail');
        detail.classList.remove('active');
        detail.style.display = 'none';
        currentAnnouncement = null;
        if (window.isAdmin()) {
            document.getElementById('announcementAdminArea').style.display = 'block';
        }
    }
    window.showAnnouncementList = showAnnouncementList;

    function showAnnouncementDetail(ann) {
        currentAnnouncement = ann;
        markAnnouncementRead(ann.id);

        document.getElementById('announcementAdminArea').style.display = 'none';
        document.getElementById('announcementListContainer').style.display = 'none';
        const detail = document.getElementById('announcementDetail');
        detail.style.display = 'block';
        detail.classList.add('active');

        var annData = parseAnnData(ann);
        document.getElementById('announcementDetailTitle').textContent = annData.title;
        document.getElementById('announcementDetailTime').textContent = new Date(ann.created_at).toLocaleString('zh-CN');
        document.getElementById('announcementDetailContent').textContent = annData.content;

        const userInfoEl = document.getElementById('announcementDetailUserInfo');
        if (userInfoEl) {
            var avUrl = window.avatarCache[ann.user_name];
            var avatarHtml = avUrl
                ? '<div class="announcement-detail-avatar"><img src="' + avUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>'
                : '<div class="announcement-detail-avatar">' + ann.user_name.charAt(0).toUpperCase() + '</div>';
            userInfoEl.innerHTML = avatarHtml + '<div class="announcement-detail-name">' + window.escapeHtml(ann.user_name) + '</div>';
        }

        const existingDelBtn = detail.querySelector('.announcement-delete-btn');
        if (existingDelBtn) existingDelBtn.remove();
        if (window.isAdmin()) {
            const delBtn = document.createElement('button');
            delBtn.className = 'announcement-delete-btn';
            delBtn.textContent = '删除公告';
            delBtn.onclick = function(e) { e.stopPropagation(); deleteAnnouncement(ann); };
            const header = detail.querySelector('.announcement-detail-header');
            if (header) header.appendChild(delBtn);
        }

        renderAnnouncementList();
    }
    window.showAnnouncementDetail = showAnnouncementDetail;

    async function loadAnnouncements() {
        try {
            const { data, error } = await window.sb.from('posts')
                .select('*')
                .eq('media_type', window.ANN_MARKER)
                .order('created_at', { ascending: false });
            if (error) throw error;
            announcements = data || [];
            updateAnnouncementBadge();
            if (announcements.length > 0) {
                var publishers = new Set();
                announcements.forEach(function(a) { publishers.add(a.user_name); });
                window.loadAvatarsForUsers(Array.from(publishers));
            }
        } catch(e) {
            console.error('加载公告失败:', e);
        }
    }
    window.loadAnnouncements = loadAnnouncements;

    function parseAnnData(ann) {
        var title = '公告', content = ann.content || '';
        if (ann.content) {
            try {
                var parsed = JSON.parse(ann.content);
                if (parsed.title !== undefined) { title = parsed.title || '公告'; content = parsed.content || ''; }
            } catch(e) {}
        }
        return { title: title, content: content };
    }
    window.parseAnnData = parseAnnData;

    function renderAnnouncementList() {
        const listEl = document.getElementById('announcementList');
        if (!listEl) return;

        if (!announcements.length) {
            listEl.innerHTML = '<div class="announcement-empty"><div class="announcement-empty-icon">📭</div><div>暂无公告</div></div>';
            return;
        }

        listEl.innerHTML = '';
        const readIds = getReadAnnouncements();

        announcements.forEach((ann, index) => {
            const isRead = readIds.includes(ann.id);
            const item = document.createElement('div');
            item.className = 'announcement-item' + (isRead ? '' : ' unread');
            item.onclick = function() { showAnnouncementDetail(ann); };

            var annData = parseAnnData(ann);
            const displayTitle = annData.title;
            const previewContent = annData.content ? (annData.content.length > 100 ? annData.content.substring(0, 100) + '...' : annData.content) : '';

            item.innerHTML = `
                <div class="announcement-item-header">
                    <div class="announcement-item-title">
                        ${!isRead ? '<span class="unread-dot"></span>' : ''}
                        ${window.escapeHtml(displayTitle)}
                    </div>
                    <div class="announcement-item-time">${new Date(ann.created_at).toLocaleString('zh-CN')}</div>
                </div>
                ${previewContent ? `<div class="announcement-item-preview">${window.escapeHtml(previewContent)}</div>` : ''}
            `;
            listEl.appendChild(item);

            requestAnimationFrame(() => {
                setTimeout(() => {
                    item.classList.add('visible');
                }, index * 60);
            });
        });
    }
    window.renderAnnouncementList = renderAnnouncementList;

    window.publishAnnouncement = async function() {
        const titleInput = document.getElementById('announcementAdminTitle');
        const contentInput = document.getElementById('announcementAdminInput');
        const title = titleInput.value.trim();
        const content = contentInput.value.trim();

        if (!title && !content) {
            window.showToast('请至少填写标题或内容');
            return;
        }

        try {
            const storeData = JSON.stringify({ title: title, content: content });
            const { error } = await window.sb.from('posts').insert([{
                user_name: ADMIN_NAME,
                content: storeData,
                media_type: window.ANN_MARKER,
                media_url: '',
                actor_key: 'admin_' + Date.now()
            }]);
            if (error) throw error;
            titleInput.value = '';
            contentInput.value = '';
            window.showToast('公告发布成功');
            await loadAnnouncements();
            renderAnnouncementList();
        } catch(e) {
            window.showToast('发布失败: ' + (e.message || '未知错误'));
        }
    };

    window.deleteAnnouncement = async function(ann) {
    window.showConfirm('删除公告', '确定要删除这条公告吗？', '是', async function() {
        try {
            const { error } = await window.sb.rpc('delete_post_with_actor', {
                p_post_id: ann.id,
                p_actor_key: ann.actor_key || 'admin_' + Date.now()
            });
            if (error) throw error;

            const readIds = getReadAnnouncements();
            const filteredReadIds = readIds.filter(id => id !== ann.id);
            saveReadAnnouncements(filteredReadIds);

            window.showToast('公告已删除');
            await loadAnnouncements();
            showAnnouncementList();
            renderAnnouncementList();
        } catch(e) {
            window.showToast('删除失败: ' + (e.message || '未知错误'));
        }
    });
};

    function subscribeToAnnouncements() {
        if (window.annRealtime) return;
        window.annRealtime = window.sb.channel('announcements')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'posts',
                filter: `media_type=eq.${window.ANN_MARKER}`
            }, async function() {
                if (!window.currentUser) return;
                await loadAnnouncements();
                if (document.getElementById('announcementModal').classList.contains('active')) {
                    renderAnnouncementList();
                }
            })
            .subscribe();
    }
    window.subscribeToAnnouncements = subscribeToAnnouncements;

    const CHANGELOG_DATA = [
        {
            version: 'v0.68',
            date: '2026-06-03',
            content: `
                <h4>修复内容</h4>
                <ul>
                    <li>修复置顶/取消置顶后列表与详情不实时刷新的问题</li>
                    <li>修复编辑帖子后公开/私密状态重复显示的问题，统一去重</li>
                    <li>修复双击帖子 Dock 后刷新链路偏慢的问题，提速反馈更直接</li>
                </ul>
                <h4>优化内容</h4>
                <ul>
                    <li>预览/上传 UI 细节修整，交互更顺手、状态更清晰</li>
                </ul>
                <h4>Remade</h4>
                <ul>
                    <li>这次主要把帖子状态切换、刷新反馈和预览上传体验重新捋顺，整体更干净也更跟手</li>
                </ul>
            `
        },
        {
            version: 'v0.0.60',
            date: '2026-05-28',
            content: `
                <h4>修复内容</h4>
                <ul>
                    <li>修复编辑帖子公开/私密不真正生效问题</li>
                    <li>修复统计详情泄露私密帖子互动</li>
                    <li>修复照片预览双击缩小/双指缩放不稳定</li>
                </ul>
                <h4>优化内容</h4>
                <ul>
                    <li>照片墙预览新增双指缩放</li>
                    <li>标记废弃函数避免误修改</li>
                    <li>upload.js select 字段完整性提升</li>
                </ul>
            `
        },
        {
            version: 'v0.0.59',
            date: '2026-05-27',
            content: `
                <h4>修复内容</h4>
                <ul>
                    <li>修复举报按钮点击无响应问题</li>
                    <li>修复举报提交字段名匹配，添加 fallback 机制</li>
                    <li>修复通知开关 localStorage key 不一致</li>
                    <li>修复统计详情泄露私密帖子互动</li>
                    <li>修复帖子详情页无私密权限检查</li>
                    <li>修复发帖文件上传未检查错误</li>
                </ul>
                <h4>优化内容</h4>
                <ul>
                    <li>照片墙缩略图加载速度提升</li>
                    <li>去除 index.html UTF-8 BOM</li>
                </ul>
            `
        },
        {
            version: 'v0.0.51',
            date: '2026-05-25',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li><strong>照片全屏预览双指放大性能优化</strong>
                        <ul>
                            <li>CSS层面启用GPU硬件加速：backface-visibility: hidden + transform: translateZ(0) + will-change: transform</li>
                            <li>手势系统重构：预分配PinchPre对象避免每帧Array.from分配，降低GC压力</li>
                            <li>新增屏幕刷新率自动检测（rAF中值法），自适应120Hz/90Hz/60Hz帧预算</li>
                            <li>viewport中心点预计算缓存，减少每帧布局查询</li>
                        </ul>
                    </li>
                    <li><strong>照片上传自动压缩</strong>
                        <ul>
                            <li>新增compressToMaxSize函数：文件>10MB时自动压缩至~10MB，多级降级策略（2560→2048→1920→1280→800像素）</li>
                            <li>100MB超大型照片也能自动压缩后上传，不再直接拒绝</li>
                            <li>压缩失败时回退策略：≤50MB直接上传原文件，>50MB且压缩失败则跳过</li>
                            <li>压缩前后尺寸均记录（fileSize + originalSize），数据透明可追溯</li>
                            <li>Supabase免费版限制已确认：文件存储1GB，单文件50MB，月带宽5GB</li>
                        </ul>
                    </li>
                </ul>
            `
        },
        {
            version: 'v0.0.50',
            date: '2026-05-25',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li><strong>照片墙功能全面完善</strong>
                        <ul>
                            <li>新增按日期、名称、热度三种条件的筛选排序功能，切换后立即响应</li>
                            <li>修复相册视图显示"暂无照片"的空白问题，点击相册按钮正确加载对应内容</li>
                            <li>导航栏随上下滑动自动隐藏/显示，浏览照片时不再遮挡内容</li>
                        </ul>
                    </li>
                    <li><strong>照片预览交互优化</strong>
                        <ul>
                            <li>修复全屏预览下单点退出与双击放大的冲突问题，两种操作互不干扰</li>
                            <li>删除按钮图标由"x"替换为垃圾桶SVG图标，与关闭按钮清晰区分</li>
                            <li>优化左右滑动预览时的图片加载策略，消除黑屏，采用图片缓存+延迟加载前后图片优先级方案</li>
                            <li>图片加载时显示脉冲动画背景，替代纯黑背景，提升视觉体验</li>
                        </ul>
                    </li>
                </ul>
            `
        },
        {
            version: 'v0.0.40',
            date: '2026-05-24',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li><strong>UI视觉优化</strong>
                        <ul>
                            <li>底部导航栏去框融合：移除背景、边框、阴影，仅保留四个按钮可见，按钮间区域可穿透点击</li>
                            <li>统一面板/页面背景为中性色（浅灰/深灰），移除绿色色调，解决iOS底部绿色透显问题</li>
                        </ul>
                    </li>
                    <li><strong>照片墙功能增强</strong>
                        <ul>
                            <li>新增全屏浏览左右滑动切换图片功能，支持手势拖拽导航</li>
                            <li>首尾边界处理：第一张不能左滑，最后一张不能右滑，带阻力反馈和弹回动画</li>
                            <li>取消过渡闪烁：修复切换图片时的位置跳跃和闪白bug</li>
                            <li>双指缩放优化：移除RAF批处理延迟，直接应用transform实现原生级跟手流畅度</li>
                            <li>整体滑动流畅度优化：will-change、transition精细化控制</li>
                        </ul>
                    </li>
                    <li><strong>响应式适配</strong>
                        <ul>
                            <li>平板（768px+）：容器满宽、更大的间距和字体、文章卡片居中</li>
                            <li>桌面（1024px+）：照片墙3列、文章卡片更宽、字体更大</li>
                            <li>宽屏（1280px+）：照片墙4列、更多留白</li>
                            <li>横屏手机优化：缩小底部导航栏占用空间</li>
                        </ul>
                    </li>
                    <li><strong>代码清理</strong>
                        <ul>
                            <li>删除遗留的i18n翻译代码（translations字典、translatePage函数、语言选择UI）</li>
                            <li>精简syncProfileUser等函数，移除对翻译字典的依赖</li>
                            <li>移除profile-lang-tabs相关CSS样式</li>
                        </ul>
                    </li>
                    <li><strong>Bug修复</strong>
                        <ul>
                            <li>修复管理员发公告时在帖子流中自动创建帖子的bug（feed查询未过滤ANN_MARKER）</li>
                        </ul>
                    </li>
                </ul>
            `
        },
        {
            version: 'v0.0.38',
            date: '2026-05-18',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li><strong>代码清理与精简</strong>
                        <ul>
                            <li>彻底移除雅思单词学习系统全部代码（CSS样式、JS逻辑、HTML结构）</li>
                            <li>删除设置页中的英语/韩语切换选项，仅保留中文</li>
                            <li>清理所有废弃的翻译文本和语言切换相关JS逻辑</li>
                            <li>修复scroll handler中对旧vocab-container的错误引用</li>
                        </ul>
                    </li>
                </ul>
            `
        },
        {
            version: 'v0.0.37',
            date: '2026-05-18',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li><strong>雅思单词版块全面重做为照片墙（相册功能）</strong>
                        <ul>
                            <li>完全替换panelAi面板为照片墙HTML结构，移除所有单词学习界面</li>
                            <li>每位用户可独立上传照片（base64存储至localStorage，单张限制20MB）</li>
                            <li>横排5张网格布局（grid-template-columns: repeat(5, 1fr)），竖排无限滚动排列</li>
                            <li>照片卡片hover时显示发布者名称、发布时间、浏览量</li>
                            <li>点击任意照片进入全屏预览：固定定位遮罩层，原画质居中展示</li>
                            <li>预览页显示发布用户、发布时间、浏览量（点击自动+1计数）</li>
                            <li>照片按上传时间倒序排列（最新在前），支持智能时间格式化</li>
                            <li>完整CSS样式：照片墙容器、5列网格、卡片交互、全屏预览、深色模式适配</li>
                            <li>预览层点击背景区域或关闭按钮均可关闭</li>
                        </ul>
                    </li>
                </ul>
            `
        },
        {
            version: 'v0.0.36',
            date: '2026-05-13',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li><strong>彻底修复所有问题，实现极致的液态玻璃效果</strong>
                        <ul>
                            <li>给单词页面添加复杂渐变纹理背景，让backdrop-filter能真正发挥出玻璃效果</li>
                            <li>把dock-panel的滚动禁用，让单词页面自己管理滚动，解决排版混乱问题</li>
                            <li>卡片、选项、反馈面板都添加极致的玻璃质感：多层边框、内高光、外阴影、高强度blur</li>
                            <li>所有元素加伪元素高光层，增强玻璃的通透和立体感</li>
                            <li>反馈面板移回vocab-scroll里，解决遮挡选项的问题</li>
                            <li>暗色模式同步升级，背景用深色渐变+玻璃元素</li>
                        </ul>
                    </li>
                </ul>
            `
        },
        {
            version: 'v0.0.35',
            date: '2026-05-13',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li><strong>修复对错音效不生效问题</strong>
                        <ul>
                            <li>修复AudioContext被浏览器挂起导致无声（增加resume()唤醒）</li>
                            <li>提高音效音量（gain从0.1提升至0.18），错误音改用triangle波更清晰</li>
                            <li>页面首次点击自动解锁音频上下文</li>
                        </ul>
                    </li>
                    <li><strong>修复继续按钮位置靠上</strong>
                        <ul>
                            <li>容器底部内边距增加至16px，选项区底部间隙增加至20px</li>
                            <li>底部flex间隙从10px提升至16px，按钮行增加上边距</li>
                        </ul>
                    </li>
                    <li><strong>液态玻璃效果大幅增强</strong>
                        <ul>
                            <li>卡片：rgba 0.85 + blur(32px) saturate(220%)，阴影翻倍</li>
                            <li>选项：rgba 0.72 + blur(16px) saturate(180%)</li>
                            <li>反馈面板：rgba 0.82 + blur(30px) saturate(220%)</li>
                            <li>暗色模式同步增强</li>
                        </ul>
                    </li>
                </ul>
            `
        },
        {
            version: 'v0.0.34',
            date: '2026-05-13',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li><strong>雅思单词页面全面重构优化</strong>
                        <ul>
                            <li>修复继续按钮位置靠上问题，反馈面板移至底部紧邻继续按钮</li>
                            <li>对错反馈仿不背单词风格重做：大图标+单词音标+释义+例句独立展示</li>
                            <li>增加对错音效（Web Audio API 生成短促提示音，正确升调/错误降调）</li>
                            <li>替换切换动画为缩放+淡入淡出组合，更加流畅自然</li>
                            <li>增强液态玻璃效果：背景透明度提高至0.78，模糊提升至26px</li>
                            <li>修复单词重复问题：改为随机队列洗牌算法，确保200词全部轮完才重复</li>
                        </ul>
                    </li>
                    <li><strong>TTS语音进一步优化</strong>
                        <ul>
                            <li>优先选择Google在线语音（最自然），其次回退到系统语音</li>
                            <li>Google语音速率0.9/音调1.0，非Google语音速率0.95/音调1.1减少机械感</li>
                            <li>语音选择结果localStorage持久化，避免重复查找</li>
                        </ul>
                    </li>
                </ul>
            `
        },
        {
            version: 'v0.0.33',
            date: '2026-05-13',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li><strong>雅思单词系统全面优化</strong>
                        <ul>
                            <li>排版重新设计，模拟不背单词/百词斩风格，干净白底无悬浮效果</li>
                            <li>TTS语音优化，自动选择最自然英文语音，语速更真实</li>
                            <li>增加对错数量记录（localStorage持久化），正确率进度条显示</li>
                            <li>卡片滑入/滑出过渡动画，提升交互流畅度</li>
                            <li>选项改为2列网格布局，答案正确/错误边框颜色反馈</li>
                        </ul>
                    </li>
                    <li><strong>清理遗留旧代码</strong>
                        <ul>
                            <li>移除旧的 toggleAIChat 无用函数</li>
                            <li>删除所有旧AI模板相关的翻译键（aiWelcome、enterYourQuestion、send）</li>
                            <li>删除旧AI气泡CSS样式（.ai-msg）</li>
                            <li>删除Taylor Swift画廊旧代码（initTSGallery）</li>
                        </ul>
                    </li>
                    <li><strong>修复Git合并冲突导致网站崩溃</strong>
                        <ul>
                            <li>修复4处残留的合并冲突标记（CSS/HTML/JS），页面恢复正常</li>
                        </ul>
                    </li>
                    <li><strong>雅思单词页面液态玻璃风格重做</strong>
                        <ul>
                            <li>发音按钮从emoji改为SVG喇叭图标+声波动画+液态玻璃容器</li>
                            <li>TTS语音优选12种自然语音（Google UK Female/Microsoft Zira等），语速0.85音调1.05</li>
                            <li>去掉例句朗读，只朗读单词本身</li>
                            <li>卡片/选项/反馈面板全部改为液态玻璃效果（backdrop-filter毛玻璃）</li>
                            <li>选项点击水波纹动画+正确弹性弹跳+错误抖动反馈</li>
                            <li>对错反馈标题区分显示（✅正确/❌答案是）</li>
                            <li>分数数字点击弹性放大动画</li>
                        </ul>
                    </li>
                </ul>
            `
        },
        {
            version: 'v0.0.32',
            date: '2026-05-12',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li><strong>雅思词汇库全面升级</strong>
                        <ul>
                            <li>将原有初中水平基础词汇全面替换为雅思高频考点单词</li>
                            <li>词库扩充至200+个真正的雅思核心词汇</li>
                            <li>词汇涵盖 abandon 到 yield 等雅思必备词汇</li>
                            <li>每个单词均包含标准音标、英文例句及中文翻译</li>
                        </ul>
                    </li>
                </ul>
            `
        },
        {
            version: 'v0.0.31',
            date: '2026-05-12',
            content: `
                &lt;h4&gt;更新内容&lt;/h4&gt;
                &lt;ul&gt;
                    &lt;li&gt;&lt;strong&gt;Taylor Swift &amp; Jennie专题画廊替换为雅思单词学习系统&lt;/strong&gt;
                        &lt;ul&gt;
                            &lt;li&gt;删除所有原专题页的CSS样式（.idol-、.ts-开头样式）&lt;/li&gt;
                            &lt;li&gt;新增雅思单词学习系统完整样式（.vocab-命名空间）&lt;/li&gt;
                            &lt;li&gt;替换panelAi面板HTML结构为单词学习界面&lt;/li&gt;
                            &lt;li&gt;新增200个雅思核心词库，包含单词、音标、释义、例句&lt;/li&gt;
                        &lt;/ul&gt;
                    &lt;/li&gt;
                    &lt;li&gt;&lt;strong&gt;雅思单词学习系统功能&lt;/strong&gt;
                        &lt;ul&gt;
                            &lt;li&gt;双模式学习：英译中模式、中译英模式&lt;/li&gt;
                            &lt;li&gt;点击🔊按钮可朗读英文单词&lt;/li&gt;
                            &lt;li&gt;答完题自动朗读单词和英文例句&lt;/li&gt;
                            &lt;li&gt;每次随机生成4个选项供选择&lt;/li&gt;
                            &lt;li&gt;正确答案绿色高亮，错误答案红色抖动&lt;/li&gt;
                            &lt;li&gt;答题后显示详细解析和例句&lt;/li&gt;
                            &lt;li&gt;完全支持深色/浅色主题自动适配&lt;/li&gt;
                        &lt;/ul&gt;
                    &lt;/li&gt;
                &lt;/ul&gt;
            `
        },
        {
            version: 'v0.0.30',
            date: '2026-05-03 16:00',
            content: `
                &lt;h4&gt;更新内容&lt;/h4&gt;
                &lt;ul&gt;
                    &lt;li&gt;&lt;strong&gt;Taylor Swift专题页视觉与架构全面重构&lt;/strong&gt;
                        &lt;ul&gt;
                            &lt;li&gt;删除所有旧的 .ts- 开头CSS样式&lt;/li&gt;
                            &lt;li&gt;新增双人专辑展示墙样式（.idol- 命名空间）&lt;/li&gt;
                            &lt;li&gt;引入Google Fonts Great Vibes手写体&lt;/li&gt;
                            &lt;li&gt;专辑卡片hover时缩放+磨砂玻璃遮罩效果&lt;/li&gt;
                            &lt;li&gt;SVG签名描边动画+实心填充淡入&lt;/li&gt;
                        &lt;/ul&gt;
                    &lt;/li&gt;
                    &lt;li&gt;&lt;strong&gt;代码清理优化&lt;/strong&gt;
                        &lt;ul&gt;
                            &lt;li&gt;删除全部Taylor Swift画廊JavaScript代码&lt;/li&gt;
                            &lt;li&gt;移除二级菜单相关废弃函数调用&lt;/li&gt;
                            &lt;li&gt;替换干净的switchDockTab函数&lt;/li&gt;
                            &lt;li&gt;代码架构更加清晰&lt;/li&gt;
                        &lt;/ul&gt;
                    &lt;/li&gt;
                &lt;/ul&gt;
            `
        },
        {
            version: 'v0.0.29',
            date: '2026-05-03 15:30',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>Taylor Swift专题页交互升级</li>
                    <ul>
                        <li>签名手写动画进入专题页时重新播放，并每隔数秒循环播放</li>
                        <li>12张专辑海报改为按时间倒序展示（最新专辑在前）</li>
                        <li>每张专辑支持点击进入详情页</li>
                        <li>专辑详情页新增专辑封面、时期照片、专辑故事、歌曲列表、背景故事</li>
                        <li>专辑封面和详情照片加入动态漂移动画</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.28',
            date: '2026-05-03 15:00',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>Taylor Swift专题页升级为完整12张录音室专辑海报墙</li>
                    <ul>
                        <li>新增evermore、Midnights、The Tortured Poets Department、The Life of a Showgirl</li>
                        <li>顶部Taylor Swift签名改为模拟真实手写描边动画</li>
                        <li>专辑卡片加入真实封面图、海报式排版、渐入和悬停过渡</li>
                        <li>新增公开现场照片区域，增强专题页视觉层次</li>
                    </ul>
                    <li>更新"我的"页面版本号为v0.0.28</li>
                </ul>
            `
        },
        {
            version: 'v0.0.27',
            date: '2026-05-03 14:00',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>AI聊天全面替换为Taylor Swift专题画廊</li>
                    <ul>
                        <li>移除DeepSeek AI聊天及API密钥</li>
                        <li>新增Taylor Swift签名SVG标题</li>
                        <li>8张专辑卡片画廊（Debut至folklore）</li>
                        <li>每张卡片渐入动画+悬停放大效果</li>
                        <li>专辑专属渐变色+SVG装饰图标</li>
                    </ul>
                    <li>全面代码审计修复9项Bug</li>
                    <li>修复聊天输入框在iOS上位置异常</li>
                    <li>移除所有AI相关代码</li>
                </ul>
            `
        },
        {
            version: 'v0.0.26',
            date: '2026-05-03 12:00',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>修复PC浏览器打开空白页问题</li>
                    <li>修复iOS灵动岛/刘海屏区域视觉适配</li>
                    <li>修复登录时间不更新问题</li>
                    <li>修复注册时间/登录时间显示为"-"的问题</li>
                    <li>iOS Safari浏览器完整适配</li>
                    <li>修复底部导航栏/通知/Toast在iOS刘海屏下位置异常</li>
                </ul>
            `
        },
        {
            version: 'v0.0.25',
            date: '2026-05-03 10:35',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>统一公告列表/详情/更新日志的样式大小（字体/间距都统一跟更新日志一致）</li>
                </ul>
            `
        },
        {
            version: 'v0.0.24',
            date: '2026-05-03 10:20',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>彻底修复头像查询：所有头像查询强制加 actor_key=__avatar__，彻底排除旧数据干扰</li>
                    <li>修复手机底部导航往上飘（position:fixed+适配安全区域）</li>
                </ul>
            `
        },
        {
            version: 'v0.0.23',
            date: '2026-05-03 10:00',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>修复公告发布失败bug（不用title列，JSON存content）</li>
                    <li>修复点击头像/个人资料显示旧头像（maybeSingle→limit(1)+上传先删后插，杜绝重复记录）</li>
                    <li>修复聊天列表加载慢（limit 1000→200，缓存30秒→120秒）</li>
                </ul>
            `
        },
        {
            version: 'v0.0.22',
            date: '2026-05-03 09:50',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>修复其他用户看不到最新头像（loadAvatarsForUsers排序取最新）</li>
                    <li>修复底部导航栏可被滑动问题（touch-action禁止手势）</li>
                    <li>彻底去掉页面右侧竖滑动条（html/body overflow:hidden）</li>
                    <li>修复登录时间不更新bug（每次打开页面刷新登录时间）</li>
                </ul>
            `
        },
        {
            version: 'v0.0.21',
            date: '2026-05-03 09:30',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>修复头像过一会儿自动回退bug（localStorage权威优先，DB不再覆盖）</li>
                    <li>去掉评论头像，只显示名字</li>
                </ul>
            `
        },
        {
            version: 'v0.0.20',
            date: '2026-05-03 09:20',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>修复聊天列表打开空白/加载慢问题</li>
                    <li>聊天列表后台预加载，点开秒出</li>
                    <li>彻底去掉帖子列表右侧竖滑动条</li>
                    <li>修复帖子滑动卡顿/抽搐抖动（仅淡入一次+图片加载优化）</li>
                </ul>
            `
        },
        {
            version: 'v0.0.19',
            date: '2026-05-03 09:10',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>修复刷新网页后头像回退bug</li>
                    <li>头像照片压缩进一步减小（80x80 @0.4）</li>
                    <li>修复更换头像后不更新的bug</li>
                    <li>帖子划入划出动画重设计：淡入+上移、淡出+下移</li>
                    <li>去掉帖子和评论的hover悬浮效果</li>
                </ul>
            `
        },
        {
            version: 'v0.0.18',
            date: '2026-05-03 08:30',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>修复更换头像后不更新的bug（彻底修复）</li>
                    <li>去掉底部导航栏点击时的黑色框（彻底修复）</li>
                    <li>帖子加载动画从滑入改成淡入</li>
                    <li>修复注册时间与登录时间相同的bug（彻底修复）</li>
                    <li>头像上传压缩优化（128x128）</li>
                </ul>
            `
        },
        {
            version: 'v0.0.17',
            date: '2026-05-02 17:00',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>动画效果减半优化</li>
                    <ul>
                        <li>帖子滑入动画速度减半，translateY距离减半</li>
                        <li>所有按钮hover动画幅度减半（底部导航栏除外）</li>
                        <li>包括hover上浮、缩放、旋转等动画均减半</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.16',
            date: '2026-05-02 16:53',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>头像点击行为优化</li>
                    <ul>
                        <li>点击帖子和评论中的头像不再直接跳转聊天</li>
                        <li>新增用户资料卡片弹窗，显示头像、用户名、最近登录时间</li>
                        <li>资料卡片中点击"发消息"按钮才跳转到聊天对话</li>
                    </ul>
                    <li>统计版块加载速度优化</li>
                    <ul>
                        <li>统计数据增加30秒内存缓存，二次打开秒出</li>
                        <li>后台预加载统计数据，首次打开也更快</li>
                    </ul>
                    <li>聊天功能头像显示</li>
                    <ul>
                        <li>用户聊天消息增加双方头像显示</li>
                        <li>聊天列表显示联系人真实头像</li>
                        <li>AI对话中显示用户真实头像</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.15',
            date: '2026-05-02 16:30',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>头像上传压缩优化</li>
                    <ul>
                        <li>头像上传前自动压缩至256x256，JPEG质量0.7</li>
                        <li>大幅减少base64体积，防止存储溢出和加载失败</li>
                        <li>上传大小限制放宽至10MB</li>
                    </ul>
                    <li>用户注册/登录时间彻底修复</li>
                    <ul>
                        <li>重构用户信息存取为统一saveUserInfo函数</li>
                        <li>update失败时自动fallback到delete+insert</li>
                        <li>管理员登录同样正确记录登录时间</li>
                        <li>后台帖子计数排除用户信息记录</li>
                    </ul>
                    <li>数据库RLS策略完善</li>
                    <ul>
                        <li>新增fix_user_info_rls.sql确保UPDATE/DELETE策略存在</li>
                        <li>扩大actor_key和content长度限制</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.14',
            date: '2026-05-02 16:20',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>头像上传导致的连锁问题修复</li>
                    <ul>
                        <li>修复上传头像后帖子页一直显示"加载失败，刷新重试"的严重bug</li>
                        <li>修复头像base64数据撑爆localStorage导致页面崩溃</li>
                        <li>修复"我的页面"头像不显示的问题</li>
                        <li>修复退出登录后旧缓存干扰的问题</li>
                        <li>优化数据查询，排除头像记录减少响应体积</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.13',
            date: '2026-05-02 14:58',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>头像功能修复</li>
                    <ul>
                        <li>修复头像上传后作为帖子显示的问题</li>
                        <li>修复刷新页面后头像消失的问题</li>
                        <li>头像上传成功后自动刷新feed显示新头像</li>
                        <li>更新头像缓存机制，确保头像正确显示</li>
                    </ul>
                    <li>性能优化</li>
                    <ul>
                        <li>优化帖子渲染性能，预构建评论和点赞映射表</li>
                        <li>提升整体流畅度，减少卡顿</li>
                    </ul>
                    <li>公告系统优化</li>
                    <ul>
                        <li>修复公告发布区域固定不动的问题，现在会随内容滚动</li>
                    </ul>
                    <li>后台管理优化</li>
                    <ul>
                        <li>修复用户注册和登录时间保存问题，添加actor_key确保数据正确写入</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.12',
            date: '2026-05-02 01:00',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>新增消息通知功能</li>
                    <ul>
                        <li>收到新消息时顶部弹出液态玻璃风格通知</li>
                        <li>显示发送者头像、用户名和消息内容</li>
                        <li>通知3秒后自动淡出收回</li>
                        <li>点击通知直接跳转到对应聊天对话</li>
                        <li>智能判断：已在聊天时不重复弹出</li>
                    </ul>
                    <li>后台管理功能修复</li>
                    <ul>
                        <li>修复新注册用户（无发帖记录）不显示的问题</li>
                        <li>确保所有注册用户都能在后台正确展示</li>
                    </ul>
                    <li>统计页面优化</li>
                    <ul>
                        <li>修复评论记录时间排序问题</li>
                        <li>最新评论现在显示在最上方</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.11',
            date: '2026-05-02',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>个人资料系统全面升级</li>
                    <ul>
                        <li>新增个人资料详情页（大头像、用户名、用户ID、注册时间）</li>
                        <li>支持自定义头像上传（最大5MB）</li>
                        <li>帖子和评论区域显示用户自定义头像</li>
                        <li>个人资料页新增退出登录按钮</li>
                    </ul>
                    <li>游客模式完善</li>
                    <ul>
                        <li>未登录用户只能查看，不能发布/点赞/评论</li>
                        <li>未登录时发布区域自动隐藏</li>
                        <li>点击操作时自动提示登录</li>
                    </ul>
                    <li>公告系统修复</li>
                    <ul>
                        <li>修复公告详情页面内容不显示的问题</li>
                    </ul>
                    <li>后台管理功能增强</li>
                    <ul>
                        <li>新增用户注册时间和最近登录时间显示</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.10',
            date: '2026-05-02',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>新增「我的」页面</li>
                    <ul>
                        <li>深色/浅色模式切换开关</li>
                        <li>语言切换功能</li>
                        <li>通知设置选项</li>
                        <li>关于应用信息</li>
                        <li>统一白色磨砂风格设计</li>
                    </ul>
                    <li>「我的」按钮动画优化</li>
                    <ul>
                        <li>点击按钮时显示5条彩色光波从小人脑袋上方散射的动画</li>
                    </ul>
                    <li>底部导航栏整体优化</li>
                    <ul>
                        <li>AI花朵按钮点击范围对齐</li>
                        <li>四按钮大小统一规范</li>
                        <li>视觉平衡度提升</li>
                    </ul>
                    <li>AI页面动画升级</li>
                    <ul>
                        <li>花朵动画改为逐瓣飞散效果（与导航栏按钮保持一致）</li>
                        <li>闪电切换按钮改为SVG图标，视觉更精致</li>
                        <li>动画过渡更流畅自然</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.9',
            date: '2026-05-02',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>公告系统功能增强</li>
                    <ul>
                        <li>管理员发布公告时可选择输入标题和内容（不强制，至少填写一项）</li>
                        <li>用户查看公告列表时展示公告标题</li>
                        <li>公告详情页新增发布者信息展示（头像 + 用户名）</li>
                        <li>管理后台公告列表新增标题、发布者列显示</li>
                        <li>管理后台新增标题输入框</li>
                        <li>适配深色/浅色主题</li>
                        <li>保持原有白色磨砂风格统一</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.8',
            date: '2026-05-02',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>公告系统视觉与交互优化</li>
                    <ul>
                        <li>公告模态框改为与总动态总浏览完全一致的白色磨砂风格</li>
                        <li>公告列表项样式统一为白色磨砂效果</li>
                        <li>完全移除公告内容区域的滚动条</li>
                        <li>禁止公告区域横向拖拽滚动</li>
                        <li>公告详情头部优化布局，修复删除按钮位置</li>
                    </ul>
                    <li>聊天与AI区域视觉统一</li>
                    <ul>
                        <li>聊天输入区域背景改为透明，与背景色一致</li>
                        <li>AI容器背景完全透明化</li>
                        <li>AI输入框、模式切换按钮、AI气泡统一为磨砂风格</li>
                        <li>优化AI消息气泡与思考过程卡片样式</li>
                    </ul>
                    <li>深色/浅色主题全面适配</li>
                    <ul>
                        <li>公告系统深色模式完全对齐总动态风格</li>
                        <li>所有元素支持主题自动切换</li>
                    </ul>
                    <li>性能与流畅度优化</li>
                    <ul>
                        <li>优化公告列表动画效果</li>
                        <li>添加will-change属性提升渲染性能</li>
                        <li>优化事件处理逻辑</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.7',
            date: '2026-05-02',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>新增公告通知系统</li>
                    <ul>
                        <li>公告铃铛按钮（登录后可见）</li>
                        <li>未读公告计数提示</li>
                        <li>公告详情查看与列表返回功能</li>
                        <li>公告发布与删除管理权限</li>
                    </ul>
                    <li>新增独立管理后台页面</li>
                    <ul>
                        <li>多维度数据管理面板</li>
                        <li>公告发布管理</li>
                        <li>用户及内容数据查看</li>
                        <li>响应式设计适配</li>
                    </ul>
                    <li>公告数据与主应用完全互通</li>
                    <li>优化交互过渡动画提升流畅度</li>
                </ul>
            `
        },
        {
            version: 'v0.0.6',
            date: '2026-05-01',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>优化顶部导航栏交互</li>
                    <ul>
                        <li>去除重复聊天入口</li>
                        <li>优化底部 Dock 栏点击区域，允许框外区域交互</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.5',
            date: '2026-04-30',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>三大核心功能按钮SVG动画优化</li>
                    <ul>
                        <li>重新设计帖子按钮钢笔绘制动画</li>
                        <li>重新设计聊天按钮气泡动画</li>
                        <li>AI按钮更换为花朵绽放与花瓣归位动画</li>
                        <li>所有动画支持按钮外区域显示</li>
                        <li>严格使用CSS @keyframes实现</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.4',
            date: '2026-04-29',
            content: `
                <h4>更新内容</h4>
                <ul>
                    <li>三大核心功能按钮全新SVG动画实现</li>
                    <ul>
                        <li>帖子按钮钢笔路径绘制（1.5秒）</li>
                        <li>聊天按钮打字点与气泡动画（2秒）</li>
                        <li>AI按钮脉冲发光效果（1.8秒）</li>
                        <li>使用stroke-dasharray/dashoffset技术</li>
                        <li>纯CSS实现，无定时器依赖</li>
                    </ul>
                </ul>
            `
        },
        {
            version: 'v0.0.3',
            date: '2026-04-28',
            content: `
                <h4>初始版本</h4>
                <ul>
                    <li>基础功能框架搭建</li>
                    <li>用户认证系统</li>
                    <li>帖子发布与浏览</li>
                    <li>评论与点赞功能</li>
                    <li>私信聊天系统</li>
                    <li>AI对话功能</li>
                    <li>深色/浅色主题切换</li>
                </ul>
            `
        }
    ];
    window.CHANGELOG_DATA = CHANGELOG_DATA;

    let currentAnnouncementTab = 'announcements';

    function switchAnnouncementTab(tab) {
        currentAnnouncementTab = tab;
        const tabs = document.querySelectorAll('.announcement-tab');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        const listContainer = document.getElementById('announcementListContainer');
        const detailContainer = document.getElementById('announcementDetail');
        const changelogContainer = document.getElementById('changelogContainer');
        const adminArea = document.getElementById('announcementAdminArea');
        if (tab === 'announcements') {
            listContainer.style.display = 'block';
            detailContainer.style.display = 'none';
            changelogContainer.style.display = 'none';
            if (window.isAdmin()) adminArea.style.display = 'block';
        } else {
            listContainer.style.display = 'none';
            detailContainer.style.display = 'none';
            changelogContainer.style.display = 'block';
            adminArea.style.display = 'none';
            renderChangelogList();
        }
    }
    window.switchAnnouncementTab = switchAnnouncementTab;

    function renderChangelogList() {
        const listEl = document.getElementById('changelogList');
        if (!listEl) return;
        listEl.innerHTML = '';
        CHANGELOG_DATA.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'changelog-item';
            div.innerHTML = `
                <div class="changelog-header">
                    <div class="changelog-version">🚀 ${item.version}</div>
                    <div class="changelog-date">${item.date}</div>
                </div>
                <div class="changelog-content">
                    ${item.content}
                </div>
            `;
            listEl.appendChild(div);
            requestAnimationFrame(() => {
                setTimeout(() => {
                    div.style.opacity = '1';
                    div.style.transform = 'translateY(0)';
                }, index * 80);
            });
        });
    }
    window.renderChangelogList = renderChangelogList;

    document.querySelectorAll('.announcement-tab').forEach(btn => {
        btn.addEventListener('click', function() {
            switchAnnouncementTab(this.dataset.tab);
        });
    });

    const originalShowAnnouncementList = window.showAnnouncementList;
    window.showAnnouncementList = function() {
        if (currentAnnouncementTab !== 'announcements') {
            switchAnnouncementTab('announcements');
        }
        originalShowAnnouncementList();
    };

    const annBtn = document.getElementById('announcementBtn');
    if (annBtn) {
        annBtn.addEventListener('click', function() {
            currentAnnouncementTab = 'announcements';
            document.querySelectorAll('.announcement-tab').forEach(t => 
                t.classList.toggle('active', t.dataset.tab === 'announcements')
            );
            document.getElementById('announcementListContainer').style.display = 'block';
            document.getElementById('announcementDetail').style.display = 'none';
            document.getElementById('changelogContainer').style.display = 'none';
            openAnnouncementModal();
        });
    }
})();
