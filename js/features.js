(function() {
            function restoreDockButtonStyles() {
                if (document.getElementById('xtjDockRestoreStyle')) return;
                var style = document.createElement('style');
                style.id = 'xtjDockRestoreStyle';
                style.textContent = `
                    #dockBar.dock-bar {
                        position: fixed !important;
                        left: 0 !important;
                        right: 0 !important;
                        bottom: 0 !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        gap: 4px !important;
                        padding: 10px 12px 14px !important;
                        padding-left: calc(12px + env(safe-area-inset-left, 0px)) !important;
                        padding-right: calc(12px + env(safe-area-inset-right, 0px)) !important;
                        padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px)) !important;
                        background: transparent !important;
                        border: none !important;
                        box-shadow: none !important;
                        backdrop-filter: none !important;
                        -webkit-backdrop-filter: none !important;
                        pointer-events: none !important;
                        z-index: 100 !important;
                    }
                    #dockBar .dock-tab {
                        -webkit-appearance: none !important;
                        appearance: none !important;
                        border: none !important;
                        outline: none !important;
                        background: transparent !important;
                        box-shadow: none !important;
                        margin: 0 !important;
                        width: 74px !important;
                        max-width: 80px !important;
                        height: 58px !important;
                        flex: 0 1 74px !important;
                        padding: 6px 8px !important;
                        border-radius: 24px !important;
                        display: flex !important;
                        flex-direction: column !important;
                        align-items: center !important;
                        justify-content: center !important;
                        gap: 2px !important;
                        color: var(--text-muted) !important;
                        font-family: inherit !important;
                        font-size: 10px !important;
                        line-height: 1 !important;
                        cursor: pointer !important;
                        pointer-events: auto !important;
                        position: relative !important;
                        overflow: visible !important;
                        -webkit-tap-highlight-color: transparent !important;
                        transition: color .26s cubic-bezier(.16,1,.3,1), transform .26s cubic-bezier(.16,1,.3,1) !important;
                    }
                    #dockBar .dock-tab::before {
                        content: '' !important;
                        position: absolute !important;
                        inset: 4px 6px !important;
                        border-radius: 999px !important;
                        opacity: 0 !important;
                        transform: scale(.88) !important;
                        background: rgba(255,255,255,0) !important;
                        border: 1px solid rgba(255,255,255,0) !important;
                        box-shadow: none !important;
                        backdrop-filter: none !important;
                        -webkit-backdrop-filter: none !important;
                        transition: opacity .26s cubic-bezier(.16,1,.3,1), transform .26s cubic-bezier(.16,1,.3,1), background .26s cubic-bezier(.16,1,.3,1), border-color .26s cubic-bezier(.16,1,.3,1) !important;
                        pointer-events: none !important;
                        z-index: 0 !important;
                    }
                    #dockBar .dock-tab.active {
                        color: var(--primary) !important;
                        transform: translateY(-4px) !important;
                        background: transparent !important;
                        border: none !important;
                        box-shadow: none !important;
                    }
                    #dockBar .dock-tab.active::before {
                        opacity: 1 !important;
                        transform: scale(1) !important;
                        background: rgba(255,255,255,.52) !important;
                        border-color: rgba(255,255,255,.72) !important;
                        box-shadow: 0 10px 26px rgba(5,150,105,.14), inset 0 1px 0 rgba(255,255,255,.55) !important;
                        backdrop-filter: blur(18px) saturate(160%) !important;
                        -webkit-backdrop-filter: blur(18px) saturate(160%) !important;
                    }
                    [data-theme="dark"] #dockBar .dock-tab.active::before {
                        background: rgba(30,30,45,.55) !important;
                        border-color: rgba(255,255,255,.14) !important;
                        box-shadow: 0 10px 28px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.08) !important;
                    }
                    #dockBar .dock-tab .dt-icon,
                    #dockBar .dock-tab .dt-label {
                        position: relative !important;
                        z-index: 1 !important;
                    }
                    #dockBar .dock-tab .dt-icon {
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        width: 24px !important;
                        height: 24px !important;
                        font-size: 21px !important;
                        line-height: 1 !important;
                        filter: none !important;
                    }
                    #dockBar .dock-tab.active .dt-icon {
                        filter: drop-shadow(0 4px 8px rgba(5,150,105,.24)) !important;
                    }
                    #dockBar .dock-tab .dt-icon svg.dt-svg,
                    #dockBar .dock-tab .dt-icon svg {
                        width: 22px !important;
                        height: 22px !important;
                        display: block !important;
                    }
                    #dockBar .dock-tab .dt-label {
                        display: block !important;
                        height: auto !important;
                        overflow: visible !important;
                        pointer-events: none !important;
                        font-size: 10px !important;
                        font-weight: 500 !important;
                        letter-spacing: .2px !important;
                        color: currentColor !important;
                    }
                    #dockBar .dock-tab.active .dt-label {
                        font-weight: 700 !important;
                    }
                    #dockBar .dock-tab[data-tab="ai"] .dt-label {
                        display: none !important;
                    }
                    #dockBar .dock-tab .anim-layer {
                        position: absolute !important;
                        left: 50% !important;
                        top: 50% !important;
                        transform: translate(-50%, -50%) !important;
                        width: 82px !important;
                        height: 62px !important;
                        pointer-events: none !important;
                        z-index: 2 !important;
                        background: transparent !important;
                        border: none !important;
                        box-shadow: none !important;
                    }
                    #dockBar .dock-tab:active {
                        transform: scale(.94) !important;
                    }
                    #dockBar .dock-tab.active:active {
                        transform: translateY(-4px) scale(.94) !important;
                    }
                    body.photo-previewing #dockBar {
                        display: none !important;
                    }
                    @media (max-width: 380px) {
                        #dockBar .dock-tab {
                            width: 66px !important;
                            flex-basis: 66px !important;
                            padding-left: 6px !important;
                            padding-right: 6px !important;
                        }
                    }
                `;
                document.head.appendChild(style);
            }
            restoreDockButtonStyles();
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', restoreDockButtonStyles);
            }
        })();

(function() {
            function calcPathLengths() {
                // Button 1: Post drawing path length
                var pathEl = document.querySelector('.dock-tab[data-tab="posts"] .al-path');
                if (pathEl && typeof pathEl.getTotalLength === 'function') {
                    var len = Math.round(pathEl.getTotalLength());
                    pathEl.style.setProperty('--path-len', len);
                }
            }
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', calcPathLengths);
            } else {
                calcPathLengths();
            }
        })();

(function() {
            // 同步用户信息到我的页面
            window.syncProfileUser = function() {
                var nameEl = document.getElementById('profileName');
                var avatarEl = document.getElementById('profileAvatar');
                var nameSpan = document.getElementById('myName');
                var avatarSpan = document.getElementById('myAvatar');
                if (nameSpan && nameEl) {
                    nameEl.textContent = nameSpan.textContent || '未登录';
                }
                if (avatarSpan && avatarEl) {
                    avatarEl.innerHTML = avatarSpan.innerHTML || '?';
                }
            };

            // 初始化主题开关
            var themeToggle = document.getElementById('profileThemeToggle');
            if (themeToggle) {
                themeToggle.checked = document.documentElement.getAttribute('data-theme') === 'dark';
                themeToggle.addEventListener('change', function() {
                    var isDark = this.checked;
                    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
                    localStorage.setItem('xtj-theme', isDark ? 'dark' : 'light');
                    var topToggle = document.getElementById('themeToggle');
                    if (topToggle) topToggle.textContent = isDark ? '🌙' : '☀️';
                });
            }

            // 初始化通知开关
            var notifToggle = document.getElementById('profileNotifToggle');
            if (notifToggle) {
                notifToggle.checked = localStorage.getItem('xtj-notif') !== 'off';
                notifToggle.addEventListener('change', function() {
                    localStorage.setItem('xtj-notif', this.checked ? 'on' : 'off');
                });
            }
        })();

(function() {
        // ================================================================
        // 模块1：用户管理与内容安全模块
        // ================================================================

        // ---------- 举报功能 ----------
        var reportTarget = null;

        window.openReport = function(targetType, targetId, targetUser) {
            if (!window.currentUser) { window.showToast('请先登录'); return; }
            reportTarget = { targetType: targetType, targetId: targetId, targetUser: targetUser || '' };
            document.getElementById('reportCategory').value = 'spam';
            document.getElementById('reportReason').value = '';
            document.getElementById('reportEvidenceInput').value = '';
            document.getElementById('reportEvidencePreview').textContent = '';
            var modal = document.getElementById('reportModal');
            modal.style.display = '';
            modal.classList.add('active');
        };

        document.getElementById('reportEvidenceInput').addEventListener('change', function(e) {
            var file = e.target.files && e.target.files[0];
            var preview = document.getElementById('reportEvidencePreview');
            if (file) {
                preview.textContent = '已选择: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)';
            } else {
                preview.textContent = '';
            }
        });

        window.submitReport = async function() {
            if (!reportTarget) { window.showToast('举报目标丢失，请重试'); return; }
            if (!window.currentUser) { window.showToast('请先登录'); return; }
            var category = document.getElementById('reportCategory').value;
            var reason = document.getElementById('reportReason').value.trim();
            if (!reason) { window.showToast('请填写举报理由'); return; }

            var evidenceUrl = '';
            var evidenceFile = document.getElementById('reportEvidenceInput').files && document.getElementById('reportEvidenceInput').files[0];
            if (evidenceFile) {
                try {
                    var sb = window.sb;
                    if (sb && sb.storage) {
                        var path = 'reports/' + Date.now() + '_' + evidenceFile.name;
                        var { error: upErr } = await sb.storage.from('uploads').upload(path, evidenceFile);
                        if (!upErr) {
                            evidenceUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
                        }
                    }
                } catch(e) { /* evidence upload optional */ }
            }

            var btn = document.getElementById('reportSubmitBtn');
            btn.disabled = true;
            btn.textContent = '提交中...';
            try {
                var sb = window.sb;
                if (!sb) { window.showToast('系统未就绪'); btn.disabled = false; btn.textContent = '提交举报'; return; }
                var { error } = await sb.from('reports').insert([{
                    reporter_name: window.currentUser,
                    target_type: reportTarget.targetType,
                    target_id: reportTarget.targetId,
                    target_user: reportTarget.targetUser,
                    report_category: category,
                    report_reason: reason,
                    evidence_url: evidenceUrl,
                    status: 'pending'
                }]);
                if (error) { window.showToast('举报提交失败: ' + error.message); btn.disabled = false; btn.textContent = '提交举报'; return; }
                window.showToast('举报已提交，管理员会尽快处理');
                window.closeModal('reportModal');
            } catch(e) { window.showToast('举报提交失败'); }
            btn.disabled = false;
            btn.textContent = '提交举报';
        };

        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.report-btn');
            if (btn) {
                var postId = btn.getAttribute('data-id');
                var userName = btn.getAttribute('data-user');
                if (window.openReport && postId) {
                    window.openReport('post', postId, userName || '');
                }
            }
        });
    })();