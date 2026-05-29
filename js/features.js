(function() {
    function injectPhotoPreviewControlFix() {
        var old = document.getElementById('xtjPhotoPreviewControlFix');
        if (old) old.remove();

        var style = document.createElement('style');
        style.id = 'xtjPhotoPreviewControlFix';
        style.textContent = `
            /* Hotfix: preview controls are floating controls, not normal inline buttons. */
            #photoPreviewOverlay.photo-preview-overlay {
                position: fixed !important;
                inset: 0 !important;
                z-index: 10000 !important;
                overflow: hidden !important;
            }

            #photoPreviewOverlay .photo-preview-image-wrapper,
            #photoPreviewOverlay #ppImageWrapper {
                position: absolute !important;
                inset: 0 !important;
                z-index: 1 !important;
                overflow: hidden !important;
            }

            #photoPreviewOverlay .pp-dots {
                position: absolute !important;
                top: calc(14px + env(safe-area-inset-top, 0px)) !important;
                left: 50% !important;
                right: auto !important;
                bottom: auto !important;
                transform: translateX(-50%) !important;
                z-index: 30 !important;
                pointer-events: none !important;
            }

            #photoPreviewOverlay .photo-preview-close,
            #photoPreviewOverlay .pp-nav-arrow,
            #photoPreviewOverlay .pp-info-btn,
            #photoPreviewOverlay .pp-share-btn,
            #photoPreviewOverlay .pp-rotate-btn,
            #photoPreviewOverlay .pp-delete-btn {
                position: absolute !important;
                width: 42px !important;
                height: 42px !important;
                min-width: 42px !important;
                min-height: 42px !important;
                padding: 0 !important;
                margin: 0 !important;
                border-radius: 999px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                box-sizing: border-box !important;
                overflow: hidden !important;
                isolation: isolate !important;
                pointer-events: auto !important;
                background: rgba(12, 18, 28, 0.82) !important;
                color: rgba(255, 255, 255, 0.95) !important;
                border: 1px solid rgba(255, 255, 255, 0.12) !important;
                box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22) !important;
                backdrop-filter: blur(16px) saturate(150%) !important;
                -webkit-backdrop-filter: blur(16px) saturate(150%) !important;
                transition: transform .18s ease, background .18s ease, opacity .18s ease, border-color .18s ease !important;
            }

            #photoPreviewOverlay .photo-preview-close {
                top: calc(16px + env(safe-area-inset-top, 0px)) !important;
                right: calc(12px + env(safe-area-inset-right, 0px)) !important;
                left: auto !important;
                bottom: auto !important;
                transform: none !important;
                z-index: 40 !important;
            }

            #photoPreviewOverlay .pp-nav-arrow {
                top: 50% !important;
                bottom: auto !important;
                transform: translateY(-50%) !important;
                z-index: 35 !important;
            }
            #photoPreviewOverlay .pp-nav-prev {
                left: calc(12px + env(safe-area-inset-left, 0px)) !important;
                right: auto !important;
            }
            #photoPreviewOverlay .pp-nav-next {
                right: calc(12px + env(safe-area-inset-right, 0px)) !important;
                left: auto !important;
            }
            #photoPreviewOverlay .pp-nav-arrow.pp-nav-hidden {
                opacity: 0 !important;
                pointer-events: none !important;
            }

            #photoPreviewOverlay .pp-info-btn,
            #photoPreviewOverlay .pp-share-btn,
            #photoPreviewOverlay .pp-rotate-btn,
            #photoPreviewOverlay .pp-delete-btn {
                top: auto !important;
                bottom: calc(24px + env(safe-area-inset-bottom, 0px)) !important;
                z-index: 40 !important;
            }
            #photoPreviewOverlay .pp-delete-btn {
                left: calc(16px + env(safe-area-inset-left, 0px)) !important;
                right: auto !important;
                transform: none !important;
                color: #fecaca !important;
                border-color: rgba(239, 68, 68, 0.30) !important;
                background: rgba(127, 29, 29, 0.58) !important;
            }
            #photoPreviewOverlay .pp-info-btn {
                left: 50% !important;
                right: auto !important;
                transform: translateX(-50%) !important;
            }
            #photoPreviewOverlay .pp-rotate-btn {
                right: calc(68px + env(safe-area-inset-right, 0px)) !important;
                left: auto !important;
                transform: none !important;
            }
            #photoPreviewOverlay .pp-share-btn {
                right: calc(16px + env(safe-area-inset-right, 0px)) !important;
                left: auto !important;
                transform: none !important;
            }

            #photoPreviewOverlay .photo-preview-close:hover,
            #photoPreviewOverlay .pp-share-btn:hover,
            #photoPreviewOverlay .pp-rotate-btn:hover,
            #photoPreviewOverlay .pp-delete-btn:hover {
                transform: translateY(-1px) scale(1.04) !important;
                background: rgba(20, 26, 38, 0.95) !important;
                border-color: rgba(255, 255, 255, 0.18) !important;
            }
            #photoPreviewOverlay .pp-info-btn:hover {
                transform: translateX(-50%) translateY(-1px) scale(1.04) !important;
                background: rgba(20, 26, 38, 0.95) !important;
                border-color: rgba(255, 255, 255, 0.18) !important;
            }
            #photoPreviewOverlay .pp-nav-arrow:hover {
                transform: translateY(calc(-50% - 1px)) scale(1.04) !important;
                background: rgba(20, 26, 38, 0.95) !important;
                border-color: rgba(255, 255, 255, 0.18) !important;
            }

            #photoPreviewOverlay .photo-preview-close:active,
            #photoPreviewOverlay .pp-share-btn:active,
            #photoPreviewOverlay .pp-rotate-btn:active,
            #photoPreviewOverlay .pp-delete-btn:active {
                transform: scale(.94) !important;
            }
            #photoPreviewOverlay .pp-info-btn:active {
                transform: translateX(-50%) scale(.94) !important;
            }
            #photoPreviewOverlay .pp-nav-arrow:active {
                transform: translateY(-50%) scale(.94) !important;
            }

            #photoPreviewOverlay .photo-preview-close .ui-icon,
            #photoPreviewOverlay .pp-info-btn .ui-icon,
            #photoPreviewOverlay .pp-share-btn .ui-icon,
            #photoPreviewOverlay .pp-rotate-btn .ui-icon,
            #photoPreviewOverlay .pp-delete-btn .ui-icon {
                width: 18px !important;
                height: 18px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                flex: 0 0 auto !important;
            }
            #photoPreviewOverlay .photo-preview-close svg,
            #photoPreviewOverlay .pp-nav-arrow svg,
            #photoPreviewOverlay .pp-info-btn svg,
            #photoPreviewOverlay .pp-share-btn svg,
            #photoPreviewOverlay .pp-rotate-btn svg,
            #photoPreviewOverlay .pp-delete-btn svg {
                width: 18px !important;
                height: 18px !important;
                display: block !important;
            }

            #photoPreviewOverlay .photo-preview-info {
                position: absolute !important;
                left: 50% !important;
                right: auto !important;
                top: auto !important;
                bottom: calc(92px + env(safe-area-inset-bottom, 0px)) !important;
                transform: translate(-50%, 0) !important;
                z-index: 25 !important;
                pointer-events: none !important;
            }

            /* Info modal: keep the background click-through so the i button can toggle close again. */
            #photoPreviewOverlay .pp-info-modal {
                position: absolute !important;
                inset: 0 !important;
                z-index: 38 !important;
                display: none;
                align-items: center !important;
                justify-content: center !important;
                padding: 24px !important;
                background: transparent !important;
                pointer-events: none !important;
                opacity: 0;
            }
            #photoPreviewOverlay .pp-info-modal-content {
                pointer-events: auto !important;
                transform-origin: center bottom !important;
                will-change: transform, opacity, filter !important;
            }

            @media (max-width: 480px) {
                #photoPreviewOverlay .photo-preview-close,
                #photoPreviewOverlay .pp-nav-arrow,
                #photoPreviewOverlay .pp-info-btn,
                #photoPreviewOverlay .pp-share-btn,
                #photoPreviewOverlay .pp-rotate-btn,
                #photoPreviewOverlay .pp-delete-btn {
                    width: 38px !important;
                    height: 38px !important;
                    min-width: 38px !important;
                    min-height: 38px !important;
                }
                #photoPreviewOverlay .pp-rotate-btn {
                    right: calc(62px + env(safe-area-inset-right, 0px)) !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function hasMojibakeText(str) {
        return typeof str === 'string' && /(鐐|硅|禐|璇|勮|鍒|犻|櫎|缂|栬|緫|纭||鏃|犳|潈|甯|栧|瓙|涓|锛|浣|鏆|傛|棤|淇|濆|鐧|诲|綍|鍔|ㄦ|€|漠|砘|壇|�|€)/.test(str);
    }

    function fixMojibakeString(input) {
        if (typeof input !== 'string' || !input) return input;
        var s = input;
        var fixes = [
            ['鏃犳潈编辑杩欐潯甯栧瓙', '无权编辑这条帖子'],
            ['鏃犳潈置顶杩欐潯甯栧瓙', '无权置顶这条帖子'],
            ['请输入ュ笘瀛愬唴瀹?', '请输入帖子内容'],
            ['请输入ュ笘瀛愬唴瀹', '请输入帖子内容'],
            ['请输入ュ唴瀹', '请输入内容'],
            ['内容涓嶈兘瓒呰繃2000瀛', '内容不能超过2000字'],
            ['淇濆瓨涓?..', '保存中...'],
            ['淇濆瓨淇敼', '保存修改'],
            ['淇濆瓨失败', '保存失败'],
            ['宸叉敼涓虹瀵?', '已改为私密'],
            ['宸叉敼涓哄叕寮€', '已改为公开'],
            ['置顶鎿嶄綔失败', '置顶操作失败'],
            ['请先鐧诲綍', '请先登录'],
            ['发布涓?..', '发布中...'],
            ['发布鍔ㄦ€', '发布动态'],
            ['加载涓?..', '加载中...'],
            ['加载失败锛岃刷新閲嶈瘯', '加载失败，请刷新重试'],
            ['娌℃湁鏇村浜', '没有更多了'],
            ['删除涓?..', '删除中...'],
            ['甯栧瓙宸插垹闄', '帖子已删除'],
            ['删除甯栧瓙失败', '删除帖子失败'],
            ['纭删除', '确认删除'],
            ['纭', '确认'],
            ['缂栬緫', '编辑'],
            ['鍒犻櫎', '删除'],
            ['鐐硅禐', '点赞'],
            ['璇勮', '评论'],
            ['娴忚', '浏览'],
            ['鏆傛棤', '暂无'],
            ['鏃犳潈', '无权'],
            ['杩欐潯', '这条'],
            ['甯栧瓙', '帖子'],
            ['鐧诲綍', '登录'],
            ['鍔犺浇', '加载'],
            ['涓?..', '中...'],
            ['锛岃', '，请'],
            ['閲嶈瘯', '重试'],
            ['缃戠粶', '网络'],
            ['鍙栨秷', '取消'],
            ['涓炬姤', '举报'],
            ['提交涓炬姤', '提交举报'],
            ['鎻愪氦', '提交'],
            ['澶辫触', '失败'],
            ['鏈煡閿欒', '未知错误']
        ];
        for (var i = 0; i < fixes.length; i++) {
            s = s.split(fixes[i][0]).join(fixes[i][1]);
        }
        return s;
    }

    function fixKnownUiLabels() {
        var delTitle = document.querySelector('#delModal h3');
        var delMsg = document.querySelector('#delModal p');
        var delBtn = document.getElementById('delBtn');
        var editTitle = document.querySelector('#editPostModal h3');
        var editNote = document.querySelector('#editPostModal .post-edit-note');
        var saveBtn = document.getElementById('saveEditPostBtn');
        var pubBtn = document.getElementById('pubBtn');
        if (delTitle && hasMojibakeText(delTitle.textContent)) delTitle.textContent = '确认删除帖子？';
        if (delMsg && hasMojibakeText(delMsg.textContent)) delMsg.textContent = '删除后无法恢复';
        if (delBtn && hasMojibakeText(delBtn.textContent)) delBtn.textContent = delBtn.disabled ? '删除中...' : '确认删除';
        if (editTitle && hasMojibakeText(editTitle.textContent)) editTitle.textContent = '编辑帖子';
        if (editNote && hasMojibakeText(editNote.textContent)) editNote.textContent = '媒体文件会保留，本次只编辑正文和可见范围。';
        if (saveBtn && hasMojibakeText(saveBtn.textContent)) saveBtn.textContent = saveBtn.disabled ? '保存中...' : '保存修改';
        if (pubBtn && hasMojibakeText(pubBtn.textContent)) pubBtn.textContent = pubBtn.disabled ? '发布中...' : '发布动态';
    }

    function sanitizeMojibakeInDom(root) {
        root = root || document.body;
        if (!root) return;
        var skip = { SCRIPT: true, STYLE: true, TEXTAREA: true, CODE: true, PRE: true };
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
                var p = node.parentElement;
                if (!p || skip[p.tagName]) return NodeFilter.FILTER_REJECT;
                return hasMojibakeText(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
        });
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(function(node) {
            node.nodeValue = fixMojibakeString(node.nodeValue);
        });
        var els = root.querySelectorAll ? root.querySelectorAll('[title], [placeholder], [aria-label], input[type="button"], input[type="submit"]') : [];
        els.forEach(function(el) {
            ['title', 'placeholder', 'aria-label', 'value'].forEach(function(attr) {
                var val = attr === 'value' ? el.value : el.getAttribute(attr);
                if (hasMojibakeText(val)) {
                    if (attr === 'value') el.value = fixMojibakeString(val);
                    else el.setAttribute(attr, fixMojibakeString(val));
                }
            });
        });
        fixKnownUiLabels();
    }

    function installMojibakeGuard() {
        if (window.__xtjMojibakeGuardInstalled) return;
        window.__xtjMojibakeGuardInstalled = true;

        if (typeof window.showToast === 'function') {
            var nativeShowToast = window.showToast;
            window.showToast = function(message) {
                if (typeof message === 'string') message = fixMojibakeString(message);
                return nativeShowToast.apply(this, arguments.length ? [message].concat(Array.prototype.slice.call(arguments, 1)) : arguments);
            };
        }

        if (typeof window.openModal === 'function') {
            var nativeOpenModal = window.openModal;
            window.openModal = function() {
                var ret = nativeOpenModal.apply(this, arguments);
                setTimeout(function() { sanitizeMojibakeInDom(document.body); }, 0);
                return ret;
            };
        }

        sanitizeMojibakeInDom(document.body);
        var timer = null;
        var observer = new MutationObserver(function() {
            clearTimeout(timer);
            timer = setTimeout(function() { sanitizeMojibakeInDom(document.body); }, 30);
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label', 'value'] });
    }

    function installPhotoInfoAnimationFix() {
        if (window.__xtjPhotoInfoAnimationFixInstalled) return;
        if (typeof window.showPhotoInfo !== 'function') return;
        window.__xtjPhotoInfoAnimationFixInstalled = true;

        var nativeShowPhotoInfo = window.showPhotoInfo;

        function getModal() {
            return document.getElementById('ppInfoModal');
        }
        function getContent(modal) {
            return modal ? modal.querySelector('.pp-info-modal-content') : null;
        }
        function isVisible(modal) {
            if (!modal) return false;
            return modal.style.display !== 'none' && (modal.classList.contains('active') || modal.style.display === 'flex') && !modal.classList.contains('xtj-info-closing');
        }
        function animateOpen(modal) {
            var content = getContent(modal);
            if (!modal || !content) return;
            if (modal._xtjCloseTimer) clearTimeout(modal._xtjCloseTimer);
            modal.classList.remove('xtj-info-closing');
            modal.classList.add('active', 'xtj-info-visible');
            modal.style.display = 'flex';
            modal.style.pointerEvents = 'none';
            modal.style.opacity = '0';
            modal.style.transition = 'opacity 220ms ease-out';
            content.style.pointerEvents = 'auto';
            content.style.transition = 'none';
            content.style.transformOrigin = 'center bottom';
            content.style.transform = 'translate3d(0, 18px, 0) scale(0.92)';
            content.style.opacity = '0';
            content.style.filter = 'blur(8px)';
            void content.offsetHeight;
            requestAnimationFrame(function() {
                modal.style.opacity = '1';
                content.style.transition = 'transform 360ms cubic-bezier(0.16, 1, 0.3, 1), opacity 240ms ease-out, filter 320ms ease-out';
                content.style.transform = 'translate3d(0, 0, 0) scale(1)';
                content.style.opacity = '1';
                content.style.filter = 'blur(0)';
            });
        }
        function animateClose(modal) {
            modal = modal || getModal();
            var content = getContent(modal);
            if (!modal) return;
            if (modal._xtjCloseTimer) clearTimeout(modal._xtjCloseTimer);
            modal.classList.remove('active');
            modal.classList.add('xtj-info-closing');
            modal.style.display = 'flex';
            modal.style.pointerEvents = 'none';
            modal.style.transition = 'opacity 220ms ease-in';
            modal.style.opacity = '1';
            if (content) {
                content.style.pointerEvents = 'auto';
                content.style.transition = 'none';
                content.style.transformOrigin = 'center bottom';
                content.style.transform = 'translate3d(0, 0, 0) scale(1)';
                content.style.opacity = '1';
                content.style.filter = 'blur(0)';
                void content.offsetHeight;
                content.style.transition = 'transform 260ms cubic-bezier(0.55, 0, 1, 0.45), opacity 180ms ease-in, filter 220ms ease-in';
                content.style.transform = 'translate3d(0, 14px, 0) scale(0.94)';
                content.style.opacity = '0';
                content.style.filter = 'blur(6px)';
            }
            requestAnimationFrame(function() { modal.style.opacity = '0'; });
            modal._xtjCloseTimer = setTimeout(function() {
                modal.style.display = 'none';
                modal.style.opacity = '';
                modal.style.transition = '';
                modal.classList.remove('xtj-info-closing', 'xtj-info-visible');
                if (content) {
                    content.style.transition = '';
                    content.style.transform = '';
                    content.style.opacity = '';
                    content.style.filter = '';
                    content.style.transformOrigin = '';
                }
                modal._xtjCloseTimer = null;
            }, 280);
        }

        window.showPhotoInfo = function() {
            var modal = getModal();
            if (isVisible(modal)) {
                animateClose(modal);
                return;
            }
            nativeShowPhotoInfo.apply(this, arguments);
            setTimeout(function() {
                modal = getModal();
                sanitizeMojibakeInDom(modal || document.body);
                animateOpen(modal);
            }, 0);
        };

        window.closePhotoInfo = function() {
            animateClose(getModal());
        };
    }

    function restoreMinimalDockStyles() {}

    function syncProfileUser() {
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
    }
    window.syncProfileUser = syncProfileUser;

    document.addEventListener('click', function(e) {
        var btn = e.target.closest('.report-btn');
        if (!btn) return;
        var postId = btn.getAttribute('data-id');
        var userName = btn.getAttribute('data-user') || '';
        window.openReport('post', postId, userName);
    });

    window.openReport = function(targetType, targetId, targetUser) {
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

    window.submitReport = async function() {
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
                console.warn('[report] report insert failed, using fallback payload', res.error.message);
                var res2 = await window.sb.from('reports').insert([fallbackPayload]);
                if (res2.error) throw res2.error;
            }

            window.showToast && window.showToast('举报已提交');
            window.closeModal && window.closeModal('reportModal');
        } catch (e) {
            window.showToast && window.showToast('提交失败: ' + (e.message || '未知错误'));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '提交举报'; }
        }
    };

    document.addEventListener('change', function(e) {
        if (e.target && e.target.id === 'reportEvidenceInput') {
            var file = e.target.files && e.target.files[0];
            var preview = document.getElementById('reportEvidencePreview');
            if (preview) preview.textContent = file ? '已选择: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)' : '';
        }
        if (e.target && e.target.id === 'profileThemeToggle') {
            var themeToggle = document.getElementById('themeToggle');
            if (themeToggle) themeToggle.click();
        }
        if (e.target && e.target.id === 'profileNotifToggle') {
            try { localStorage.setItem('xtj-notif', e.target.checked ? 'on' : 'off'); } catch(e2) {}
        }
    });

    function calcPathLengths() {
        var pathEl = document.querySelector('.dock-tab[data-tab="posts"] .al-path');
        if (pathEl && typeof pathEl.getTotalLength === 'function') {
            pathEl.style.setProperty('--path-len', Math.round(pathEl.getTotalLength()));
        }
    }

    function initProfileToggles() {
        var themeToggle = document.getElementById('profileThemeToggle');
        var notifToggle = document.getElementById('profileNotifToggle');
        if (themeToggle) themeToggle.checked = document.body.classList.contains('dark-theme');
        if (notifToggle) {
            try {
                var saved = localStorage.getItem('xtj-notif');
                if (saved !== null) notifToggle.checked = saved !== 'off';
            } catch(e) {}
        }
    }

    (function() {
        var style = document.createElement('style');
        style.textContent = '#dockBar .dock-tab[data-tab="ai"] .dt-icon svg.dt-svg,#dockBar .dock-tab[data-tab="ai"] .dt-icon svg{width:28px!important;height:28px!important;}';
        document.head.appendChild(style);
    })();

    function bootFeatureFixes() {
        injectPhotoPreviewControlFix();
        installMojibakeGuard();
        installPhotoInfoAnimationFix();
        calcPathLengths();
        initProfileToggles();
        setTimeout(function() {
            installPhotoInfoAnimationFix();
            sanitizeMojibakeInDom(document.body);
        }, 300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootFeatureFixes);
    } else {
        bootFeatureFixes();
    }
})();
