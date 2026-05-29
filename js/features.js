(function() {
    function injectPhotoPreviewControlFix() {
        var old = document.getElementById('xtjPhotoPreviewControlFix');
        if (old) old.remove();

        var style = document.createElement('style');
        style.id = 'xtjPhotoPreviewControlFix';
        style.textContent = `
            /*
             * Hotfix: the shared non-Dock button system sets preview buttons to
             * position: relative / inline-flex. Fullscreen preview controls must stay
             * absolutely anchored to the overlay, otherwise they fly around or vanish.
             */
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

    injectPhotoPreviewControlFix();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            injectPhotoPreviewControlFix();
            calcPathLengths();
            initProfileToggles();
        });
    } else {
        injectPhotoPreviewControlFix();
        calcPathLengths();
        initProfileToggles();
    }
})();
