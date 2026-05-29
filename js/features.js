(function () {
    'use strict';

    if (window.__xtjSafeFeatureFixInstalled) return;
    window.__xtjSafeFeatureFixInstalled = true;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function repairText(value) {
        var s = String(value == null ? '' : value);
        var pairs = [
            ['加载涓?..', '加载中...'],
            ['加载娑?..', '加载中...'],
            ['鍔犺浇涓?..', '加载中...'],
            ['姝ｅ湪刷新鐓х墖澧?..', '正在刷新照片墙...'],
            ['姝ｅ湪刷新...', '正在刷新...'],
            ['刷新瀹屾垚', '已刷新'],
            ['鍒锋柊瀹屾垚', '已刷新'],
            ['鏆傛棤娑堟伅', '暂无消息'],
            ['鍦ㄥ笘瀛愰〉闈㈢偣鍑诲ご鍍忓紑濮嬭亰澶?', '在帖子页面点击头像开始聊天'],
            ['鍙戦€佺涓€鏉℃秷鎭惂', '发送第一条消息吧'],
            ['娑堟伅', '消息'],
            ['请先鐧诲綍', '请先登录'],
            ['鈴?/div><div>', ''],
            ['鈴?', '🔔'],
            ['鈴', '🔔'],
            ['馃挰', '💬'],
            ['鈿狅笍', '⚠️'],
            ['鉂わ笍', '❤️'],
            ['宸茶', '已读'],
            ['鏈', '未读'],
            ['纭删除', '确认删除'],
            ['纭', '确认'],
            ['缂栬緫', '编辑'],
            ['鍒犻櫎', '删除'],
            ['鐐硅禐', '点赞'],
            ['璇勮', '评论'],
            ['娴忚', '浏览'],
            ['鏆傛棤', '暂无'],
            ['鏃犳潈', '无权'],
            ['甯栧瓙', '帖子'],
            ['鐧诲綍', '登录'],
            ['鍔犺浇', '加载'],
            ['涓?..', '中...'],
            ['锛岃', '，请'],
            ['閲嶈瘯', '重试'],
            ['鍙栨秷', '取消'],
            ['鎻愪氦', '提交'],
            ['澶辫触', '失败'],
            ['鏈煡閿欒', '未知错误']
        ];
        pairs.forEach(function (pair) {
            s = s.split(pair[0]).join(pair[1]);
        });
        return s;
    }

    function hasBadText(value) {
        return /(加载涓|加载娑|鍔犺浇|鈴|馃|鈿|鉂|刷新瀹|姝ｅ湪刷新|鏆傛棤娑|鍙戦€|娑堟伅|鐧诲綍|缂栬緫|鐐硅禐|璇勮|鍒犻櫎|纭)/.test(String(value || ''));
    }

    function injectSafeStyle() {
        var old = document.getElementById('xtjSafeFeatureFixStyle');
        if (old) old.remove();
        var style = document.createElement('style');
        style.id = 'xtjSafeFeatureFixStyle';
        style.textContent = `
            .toast-container {
                z-index: 12000 !important;
                gap: 10px !important;
                max-width: min(92vw, 520px) !important;
            }
            .toast {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                min-width: 78px !important;
                min-height: 38px !important;
                max-width: min(88vw, 420px) !important;
                padding: 10px 18px !important;
                border-radius: 999px !important;
                background: rgba(18, 24, 32, 0.88) !important;
                color: rgba(255, 255, 255, 0.97) !important;
                border: 1px solid rgba(255, 255, 255, 0.15) !important;
                box-shadow: 0 14px 40px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.16) !important;
                backdrop-filter: blur(18px) saturate(160%) !important;
                -webkit-backdrop-filter: blur(18px) saturate(160%) !important;
                font-size: 14px !important;
                font-weight: 650 !important;
                line-height: 1.35 !important;
                text-align: center !important;
                white-space: normal !important;
                word-break: break-word !important;
            }
            .toast:empty { display: none !important; }
            .xtj-chat-loader,
            .xtj-chat-empty {
                min-height: 52vh;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                text-align: center;
                padding: 32px 18px;
                position: relative;
            }
            .xtj-chat-loader-orb {
                position: relative;
                width: 86px;
                height: 86px;
                border-radius: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: radial-gradient(circle at 32% 22%, rgba(255,255,255,.80), rgba(255,255,255,.22) 44%, rgba(255,255,255,.07));
                border: 1px solid rgba(255,255,255,.70);
                box-shadow: 0 24px 60px rgba(5,150,105,.14), inset 0 1px 0 rgba(255,255,255,.75);
                backdrop-filter: blur(22px) saturate(180%);
                -webkit-backdrop-filter: blur(22px) saturate(180%);
                animation: xtjChatFloat 2.8s ease-in-out infinite;
            }
            .xtj-chat-bell {
                font-size: 31px;
                filter: drop-shadow(0 8px 16px rgba(0,0,0,.15));
                animation: xtjBellSwing 1.35s ease-in-out infinite;
                transform-origin: 50% 10%;
            }
            .xtj-chat-ring {
                position: absolute;
                inset: -8px;
                border-radius: 32px;
                border: 1px solid rgba(5,150,105,.22);
                opacity: 0;
                animation: xtjRing 1.8s ease-out infinite;
            }
            .xtj-chat-ring.ring-b { animation-delay: .55s; }
            .xtj-chat-loader-title {
                margin-top: 20px;
                font-size: 22px;
                font-weight: 750;
                color: rgba(31,41,55,.32);
                letter-spacing: .02em;
            }
            .xtj-chat-loader-dots {
                display: flex;
                gap: 7px;
                margin-top: 13px;
            }
            .xtj-chat-loader-dots span {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: rgba(5,150,105,.46);
                animation: xtjDot 1.15s ease-in-out infinite;
            }
            .xtj-chat-loader-dots span:nth-child(2) { animation-delay: .16s; }
            .xtj-chat-loader-dots span:nth-child(3) { animation-delay: .32s; }
            .xtj-chat-empty-icon {
                width: 72px;
                height: 72px;
                border-radius: 26px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 31px;
                background: rgba(255,255,255,.34);
                border: 1px solid rgba(255,255,255,.62);
                box-shadow: 0 18px 46px rgba(5,150,105,.10);
                backdrop-filter: blur(18px);
                -webkit-backdrop-filter: blur(18px);
            }
            .xtj-chat-empty-title {
                margin-top: 16px;
                font-size: 20px;
                font-weight: 760;
                color: rgba(31,41,55,.44);
            }
            .xtj-chat-empty-sub {
                margin-top: 7px;
                font-size: 13px;
                color: rgba(31,41,55,.34);
            }
            [data-theme="dark"] .xtj-chat-loader-title,
            [data-theme="dark"] .xtj-chat-empty-title { color: rgba(255,255,255,.42); }
            [data-theme="dark"] .xtj-chat-empty-sub { color: rgba(255,255,255,.30); }
            [data-theme="dark"] .xtj-chat-loader-orb,
            [data-theme="dark"] .xtj-chat-empty-icon {
                background: rgba(20,24,34,.50);
                border-color: rgba(255,255,255,.12);
                box-shadow: 0 24px 60px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.08);
            }
            @keyframes xtjChatFloat { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-8px) scale(1.025); } }
            @keyframes xtjBellSwing { 0%,100% { transform: rotate(-7deg); } 50% { transform: rotate(7deg); } }
            @keyframes xtjRing { 0% { transform: scale(.72); opacity: .5; } 75%,100% { transform: scale(1.24); opacity: 0; } }
            @keyframes xtjDot { 0%,100% { transform: translateY(0); opacity: .45; } 50% { transform: translateY(-6px); opacity: 1; } }
            @media (prefers-reduced-motion: reduce) {
                .xtj-chat-loader-orb,
                .xtj-chat-bell,
                .xtj-chat-ring,
                .xtj-chat-loader-dots span { animation: none !important; }
            }
        `;
        document.head.appendChild(style);
    }

    function chatLoaderHtml(text) {
        return '' +
            '<div class="xtj-chat-loader" role="status" aria-live="polite">' +
                '<div class="xtj-chat-loader-orb">' +
                    '<span class="xtj-chat-bell">🔔</span>' +
                    '<span class="xtj-chat-ring ring-a"></span>' +
                    '<span class="xtj-chat-ring ring-b"></span>' +
                '</div>' +
                '<div class="xtj-chat-loader-title">' + escapeHtml(text || '加载中...') + '</div>' +
                '<div class="xtj-chat-loader-dots"><span></span><span></span><span></span></div>' +
            '</div>';
    }

    function chatEmptyHtml(kind) {
        var sub = kind === 'detail' ? '发送第一条消息吧' : '在帖子页面点击头像开始聊天';
        return '' +
            '<div class="xtj-chat-empty">' +
                '<div class="xtj-chat-empty-icon">💬</div>' +
                '<div class="xtj-chat-empty-title">暂无消息</div>' +
                '<div class="xtj-chat-empty-sub">' + sub + '</div>' +
            '</div>';
    }

    function repairChatContainer(el) {
        if (!el) return;
        if (el.querySelector('.chat-list-item, .chat-msg, .xtj-chat-loader, .xtj-chat-empty')) return;
        var raw = el.innerHTML || '';
        var text = repairText(el.textContent || '').trim();
        if (/加载中|正在刷新/.test(text) || /加载涓|加载娑|鍔犺浇|鈴|馃挰|ce-icon/.test(raw)) {
            el.innerHTML = chatLoaderHtml('加载中...');
            return;
        }
        if (/暂无消息|发送第一条消息吧|在帖子页面点击头像/.test(text) || /鏆傛棤娑堟伅|鍙戦€佺/.test(raw)) {
            el.innerHTML = chatEmptyHtml(el.id === 'dockChatMessages' ? 'detail' : 'list');
            return;
        }
        if (hasBadText(raw)) el.innerHTML = repairText(raw);
    }

    function repairChatUi() {
        repairChatContainer(document.getElementById('dockChatList'));
        repairChatContainer(document.getElementById('dockChatMessages'));
        var title = document.getElementById('dockChatTitle');
        if (title && hasBadText(title.textContent)) title.textContent = repairText(title.textContent || '消息');
    }

    function repairToasts() {
        var box = document.getElementById('toastContainer');
        if (!box) return;
        Array.prototype.slice.call(box.querySelectorAll('.toast')).forEach(function (toast) {
            var text = repairText(toast.textContent || '').trim();
            if (!text) {
                toast.remove();
                return;
            }
            if (toast.textContent !== text) toast.textContent = text;
        });
    }

    function installToastFix() {
        if (window.__xtjToastFixInstalled) return;
        window.__xtjToastFixInstalled = true;
        if (typeof window.showToast !== 'function') return;
        var nativeShowToast = window.showToast;
        window.showToast = function (message) {
            message = repairText(message == null ? '' : String(message)).trim();
            if (!message) message = '操作完成';
            var ret = nativeShowToast.call(this, message);
            setTimeout(repairToasts, 0);
            setTimeout(repairToasts, 160);
            return ret;
        };
    }

    function installChatFix() {
        if (window.__xtjChatFixInstalled) return;
        window.__xtjChatFixInstalled = true;

        if (typeof window.openChat === 'function') {
            var nativeOpenChat = window.openChat;
            window.openChat = function () {
                var ret = nativeOpenChat.apply(this, arguments);
                setTimeout(repairChatUi, 0);
                setTimeout(repairChatUi, 160);
                setTimeout(repairChatUi, 600);
                return ret;
            };
        }

        if (typeof window.switchDockTab === 'function') {
            var nativeSwitchDockTab = window.switchDockTab;
            window.switchDockTab = function (tab, skipReturn) {
                var ret = nativeSwitchDockTab.apply(this, arguments);
                if (tab === 'chat') {
                    setTimeout(repairChatUi, 0);
                    setTimeout(repairChatUi, 160);
                    setTimeout(repairChatUi, 600);
                }
                setTimeout(repairToasts, 0);
                setTimeout(repairToasts, 160);
                return ret;
            };
        }

        var chatList = document.getElementById('dockChatList');
        var chatMsgs = document.getElementById('dockChatMessages');
        var observer = new MutationObserver(function () {
            clearTimeout(observer._t);
            observer._t = setTimeout(function () {
                repairChatUi();
                repairToasts();
            }, 30);
        });
        if (chatList) observer.observe(chatList, { childList: true, subtree: true, characterData: true });
        if (chatMsgs) observer.observe(chatMsgs, { childList: true, subtree: true, characterData: true });
        var toastBox = document.getElementById('toastContainer');
        if (toastBox) observer.observe(toastBox, { childList: true, subtree: true, characterData: true });
    }

    function injectPhotoPreviewControlFix() {
        var old = document.getElementById('xtjPhotoPreviewControlFix');
        if (old) old.remove();
        var style = document.createElement('style');
        style.id = 'xtjPhotoPreviewControlFix';
        style.textContent = `
            #photoPreviewOverlay.photo-preview-overlay { position: fixed !important; inset: 0 !important; z-index: 10000 !important; overflow: hidden !important; }
            #photoPreviewOverlay .photo-preview-image-wrapper,
            #photoPreviewOverlay #ppImageWrapper { position: absolute !important; inset: 0 !important; z-index: 1 !important; overflow: hidden !important; }
            #photoPreviewOverlay .pp-dots { position: absolute !important; top: calc(14px + env(safe-area-inset-top, 0px)) !important; left: 50% !important; right: auto !important; bottom: auto !important; transform: translateX(-50%) !important; z-index: 30 !important; pointer-events: none !important; }
            #photoPreviewOverlay .photo-preview-close,
            #photoPreviewOverlay .pp-nav-arrow,
            #photoPreviewOverlay .pp-info-btn,
            #photoPreviewOverlay .pp-share-btn,
            #photoPreviewOverlay .pp-rotate-btn,
            #photoPreviewOverlay .pp-delete-btn { position: absolute !important; width: 42px !important; height: 42px !important; min-width: 42px !important; min-height: 42px !important; padding: 0 !important; margin: 0 !important; border-radius: 999px !important; display: flex !important; align-items: center !important; justify-content: center !important; box-sizing: border-box !important; overflow: hidden !important; isolation: isolate !important; pointer-events: auto !important; background: rgba(12, 18, 28, 0.82) !important; color: rgba(255, 255, 255, 0.95) !important; border: 1px solid rgba(255, 255, 255, 0.12) !important; box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22) !important; backdrop-filter: blur(16px) saturate(150%) !important; -webkit-backdrop-filter: blur(16px) saturate(150%) !important; transition: transform .18s ease, background .18s ease, opacity .18s ease, border-color .18s ease !important; }
            #photoPreviewOverlay .photo-preview-close { top: calc(16px + env(safe-area-inset-top, 0px)) !important; right: calc(12px + env(safe-area-inset-right, 0px)) !important; left: auto !important; bottom: auto !important; transform: none !important; z-index: 40 !important; }
            #photoPreviewOverlay .pp-nav-arrow { top: 50% !important; bottom: auto !important; transform: translateY(-50%) !important; z-index: 35 !important; }
            #photoPreviewOverlay .pp-nav-prev { left: calc(12px + env(safe-area-inset-left, 0px)) !important; right: auto !important; }
            #photoPreviewOverlay .pp-nav-next { right: calc(12px + env(safe-area-inset-right, 0px)) !important; left: auto !important; }
            #photoPreviewOverlay .pp-nav-arrow.pp-nav-hidden { opacity: 0 !important; pointer-events: none !important; }
            #photoPreviewOverlay .pp-info-btn,
            #photoPreviewOverlay .pp-share-btn,
            #photoPreviewOverlay .pp-rotate-btn,
            #photoPreviewOverlay .pp-delete-btn { top: auto !important; bottom: calc(24px + env(safe-area-inset-bottom, 0px)) !important; z-index: 40 !important; }
            #photoPreviewOverlay .pp-delete-btn { left: calc(16px + env(safe-area-inset-left, 0px)) !important; right: auto !important; transform: none !important; color: #fecaca !important; border-color: rgba(239, 68, 68, 0.30) !important; background: rgba(127, 29, 29, 0.58) !important; }
            #photoPreviewOverlay .pp-info-btn { left: 50% !important; right: auto !important; transform: translateX(-50%) !important; }
            #photoPreviewOverlay .pp-rotate-btn { right: calc(68px + env(safe-area-inset-right, 0px)) !important; left: auto !important; transform: none !important; }
            #photoPreviewOverlay .pp-share-btn { right: calc(16px + env(safe-area-inset-right, 0px)) !important; left: auto !important; transform: none !important; }
            #photoPreviewOverlay .photo-preview-info { position: absolute !important; left: 50% !important; right: auto !important; top: auto !important; bottom: calc(92px + env(safe-area-inset-bottom, 0px)) !important; transform: translate(-50%, 0) !important; z-index: 25 !important; pointer-events: none !important; }
            #photoPreviewOverlay .pp-info-modal { position: absolute !important; inset: 0 !important; z-index: 38 !important; display: none; align-items: center !important; justify-content: center !important; padding: 24px !important; background: transparent !important; pointer-events: none !important; opacity: 0; }
            #photoPreviewOverlay .pp-info-modal-content { pointer-events: auto !important; transform-origin: center bottom !important; will-change: transform, opacity, filter !important; }
        `;
        document.head.appendChild(style);
    }

    function sanitizeBasicText(root) {
        root = root || document.body;
        if (!root) return;
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                var parent = node.parentElement;
                if (!parent || /^(SCRIPT|STYLE|TEXTAREA|PRE|CODE)$/.test(parent.tagName)) return NodeFilter.FILTER_REJECT;
                return hasBadText(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
        });
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(function (node) { node.nodeValue = repairText(node.nodeValue); });
    }

    function installBasicTextGuard() {
        sanitizeBasicText(document.body);
        var timer = null;
        var observer = new MutationObserver(function () {
            clearTimeout(timer);
            timer = setTimeout(function () { sanitizeBasicText(document.body); }, 60);
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    function installPhotoInfoAnimationFix() {
        if (window.__xtjPhotoInfoAnimationFixInstalled || typeof window.showPhotoInfo !== 'function') return;
        window.__xtjPhotoInfoAnimationFixInstalled = true;
        var nativeShowPhotoInfo = window.showPhotoInfo;

        function modal() { return document.getElementById('ppInfoModal'); }
        function content(m) { return m ? m.querySelector('.pp-info-modal-content') : null; }
        function visible(m) { return !!(m && m.style.display !== 'none' && (m.classList.contains('active') || m.style.display === 'flex') && !m.classList.contains('xtj-info-closing')); }

        function openAnim(m) {
            var c = content(m);
            if (!m || !c) return;
            if (m._xtjCloseTimer) clearTimeout(m._xtjCloseTimer);
            m.classList.remove('xtj-info-closing');
            m.classList.add('active', 'xtj-info-visible');
            m.style.display = 'flex';
            m.style.pointerEvents = 'none';
            m.style.opacity = '0';
            m.style.transition = 'opacity 220ms ease-out';
            c.style.pointerEvents = 'auto';
            c.style.transition = 'none';
            c.style.transformOrigin = 'center bottom';
            c.style.transform = 'translate3d(0,18px,0) scale(.92)';
            c.style.opacity = '0';
            c.style.filter = 'blur(8px)';
            void c.offsetHeight;
            requestAnimationFrame(function () {
                m.style.opacity = '1';
                c.style.transition = 'transform 360ms cubic-bezier(.16,1,.3,1), opacity 240ms ease-out, filter 320ms ease-out';
                c.style.transform = 'translate3d(0,0,0) scale(1)';
                c.style.opacity = '1';
                c.style.filter = 'blur(0)';
            });
        }

        function closeAnim(m) {
            m = m || modal();
            var c = content(m);
            if (!m) return;
            if (m._xtjCloseTimer) clearTimeout(m._xtjCloseTimer);
            m.classList.remove('active');
            m.classList.add('xtj-info-closing');
            m.style.display = 'flex';
            m.style.pointerEvents = 'none';
            m.style.transition = 'opacity 220ms ease-in';
            m.style.opacity = '1';
            if (c) {
                c.style.transition = 'none';
                c.style.transform = 'translate3d(0,0,0) scale(1)';
                c.style.opacity = '1';
                c.style.filter = 'blur(0)';
                void c.offsetHeight;
                c.style.transition = 'transform 260ms cubic-bezier(.55,0,1,.45), opacity 180ms ease-in, filter 220ms ease-in';
                c.style.transform = 'translate3d(0,14px,0) scale(.94)';
                c.style.opacity = '0';
                c.style.filter = 'blur(6px)';
            }
            requestAnimationFrame(function () { m.style.opacity = '0'; });
            m._xtjCloseTimer = setTimeout(function () {
                m.style.display = 'none';
                m.style.opacity = '';
                m.style.transition = '';
                m.classList.remove('xtj-info-closing', 'xtj-info-visible');
                if (c) {
                    c.style.transition = '';
                    c.style.transform = '';
                    c.style.opacity = '';
                    c.style.filter = '';
                    c.style.transformOrigin = '';
                }
                m._xtjCloseTimer = null;
            }, 280);
        }

        window.showPhotoInfo = function () {
            var m = modal();
            if (visible(m)) {
                closeAnim(m);
                return;
            }
            nativeShowPhotoInfo.apply(this, arguments);
            setTimeout(function () {
                sanitizeBasicText(modal() || document.body);
                openAnim(modal());
            }, 0);
        };
        window.closePhotoInfo = function () { closeAnim(modal()); };
    }

    function installReportTools() {
        window.syncProfileUser = function () {
            var profileName = document.getElementById('profileName');
            var profileStatus = document.getElementById('profileStatus');
            var profileAvatar = document.getElementById('profileAvatar');
            if (!profileName) return;
            if (window.currentUser) {
                profileName.textContent = window.currentUser;
                if (profileStatus) profileStatus.textContent = '查看资料';
                if (profileAvatar) profileAvatar.textContent = window.currentUser[0].toUpperCase();
            } else {
                profileName.textContent = '未登录';
                if (profileStatus) profileStatus.textContent = '点击登录';
                if (profileAvatar) profileAvatar.innerHTML = '?';
            }
        };

        document.addEventListener('click', function (e) {
            var btn = e.target.closest('.report-btn');
            if (!btn) return;
            window.openReport('post', btn.getAttribute('data-id'), btn.getAttribute('data-user') || '');
        });

        window.openReport = function (targetType, targetId, targetUser) {
            var modal = document.getElementById('reportModal');
            if (!modal) return;
            modal.style.display = '';
            modal.classList.add('active');
            var category = document.getElementById('reportCategory');
            var reason = document.getElementById('reportReason');
            var preview = document.getElementById('reportEvidencePreview');
            var input = document.getElementById('reportEvidenceInput');
            if (category) category.value = 'spam';
            if (reason) reason.value = '';
            if (preview) preview.textContent = '';
            if (input) input.value = '';
            window._reportTarget = { type: targetType, id: targetId, user: targetUser };
        };

        window.submitReport = async function () {
            var target = window._reportTarget;
            if (!target) { window.showToast && window.showToast('举报目标不存在'); return; }
            var categoryEl = document.getElementById('reportCategory');
            var reasonEl = document.getElementById('reportReason');
            var category = categoryEl ? categoryEl.value : 'other';
            var reason = reasonEl ? reasonEl.value.trim() : '';
            if (!reason) { window.showToast && window.showToast('请填写举报理由'); return; }
            var btn = document.getElementById('reportSubmitBtn');
            if (btn) { btn.disabled = true; btn.textContent = '提交中...'; }
            try {
                var fileInput = document.getElementById('reportEvidenceInput');
                var evidenceFile = fileInput && fileInput.files ? fileInput.files[0] : null;
                var evidenceUrl = '';
                if (evidenceFile && window.sb && window.sb.storage) {
                    var path = 'reports/' + Date.now() + '_' + evidenceFile.name;
                    var uploadRes = await window.sb.storage.from('uploads').upload(path, evidenceFile);
                    if (uploadRes.error) throw uploadRes.error;
                    evidenceUrl = window.sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
                }
                var payload = {
                    reporter_name: window.currentUser || 'anonymous',
                    target_type: target.type,
                    target_id: target.id,
                    target_user: target.user || '',
                    report_category: category,
                    report_reason: reason,
                    evidence_url: evidenceUrl,
                    status: 'pending'
                };
                var res = await window.sb.from('reports').insert([payload]);
                if (res.error) {
                    var fallbackPayload = {
                        reporter: window.currentUser || 'anonymous',
                        target_type: target.type,
                        target_id: target.id,
                        target_user: target.user || '',
                        category: category,
                        reason: reason,
                        evidence_url: evidenceUrl,
                        actor_key: window.deviceId || 'unknown'
                    };
                    var res2 = await window.sb.from('reports').insert([fallbackPayload]);
                    if (res2.error) throw res2.error;
                }
                window.showToast && window.showToast('举报已提交');
                window.closeModal && window.closeModal('reportModal');
            } catch (err) {
                window.showToast && window.showToast('提交失败: ' + (err.message || '未知错误'));
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = '提交举报'; }
            }
        };
    }

    function initProfileToggles() {
        var themeToggle = document.getElementById('profileThemeToggle');
        var notifToggle = document.getElementById('profileNotifToggle');
        if (themeToggle) themeToggle.checked = document.body.classList.contains('dark-theme');
        if (notifToggle) {
            try {
                var saved = localStorage.getItem('xtj-notif');
                if (saved !== null) notifToggle.checked = saved !== 'off';
            } catch (e) {}
        }
        document.addEventListener('change', function (e) {
            if (e.target && e.target.id === 'profileThemeToggle') {
                var mainThemeToggle = document.getElementById('themeToggle');
                if (mainThemeToggle) mainThemeToggle.click();
            }
            if (e.target && e.target.id === 'profileNotifToggle') {
                try { localStorage.setItem('xtj-notif', e.target.checked ? 'on' : 'off'); } catch (e2) {}
            }
            if (e.target && e.target.id === 'reportEvidenceInput') {
                var file = e.target.files && e.target.files[0];
                var preview = document.getElementById('reportEvidencePreview');
                if (preview) preview.textContent = file ? '已选择: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)' : '';
            }
        });
    }

    function initSmallDockPolish() {
        var style = document.createElement('style');
        style.textContent = '#dockBar .dock-tab[data-tab="ai"] .dt-icon svg.dt-svg,#dockBar .dock-tab[data-tab="ai"] .dt-icon svg{width:28px!important;height:28px!important;}';
        document.head.appendChild(style);
        var pathEl = document.querySelector('.dock-tab[data-tab="posts"] .al-path');
        if (pathEl && typeof pathEl.getTotalLength === 'function') {
            pathEl.style.setProperty('--path-len', Math.round(pathEl.getTotalLength()));
        }
    }

    function boot() {
        injectSafeStyle();
        injectPhotoPreviewControlFix();
        installBasicTextGuard();
        installToastFix();
        installChatFix();
        installPhotoInfoAnimationFix();
        installReportTools();
        initProfileToggles();
        initSmallDockPolish();
        repairChatUi();
        repairToasts();
        setTimeout(function () { repairChatUi(); repairToasts(); sanitizeBasicText(document.body); installPhotoInfoAnimationFix(); }, 180);
        setTimeout(function () { repairChatUi(); repairToasts(); sanitizeBasicText(document.body); }, 700);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
