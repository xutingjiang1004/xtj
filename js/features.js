(function() {
    function restoreMinimalDockStyles() {
        var old = document.getElementById('xtjDockRestoreStyle');
        if (old) old.remove();
        var style = document.getElementById('xtjDockMinimalStyle');
        if (!style) {
            style = document.createElement('style');
            style.id = 'xtjDockMinimalStyle';
            document.head.appendChild(style);
        }
        style.textContent = `
            #dockBar.dock-bar {
                position: fixed !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 3px !important;
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
            #dockBar .dock-tab,
            #dockBar .dock-tab.active,
            #dockBar .dock-tab:hover,
            #dockBar .dock-tab:focus,
            #dockBar .dock-tab:focus-visible {
                -webkit-appearance: none !important;
                appearance: none !important;
                background: transparent !important;
                border: none !important;
                outline: none !important;
                box-shadow: none !important;
                -webkit-box-shadow: none !important;
            }
            #dockBar .dock-tab {
                margin: 0 !important;
                width: auto !important;
                min-width: 62px !important;
                max-width: 80px !important;
                height: 54px !important;
                flex: 1 1 0 !important;
                padding: 4px 10px !important;
                border-radius: 0 !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 1px !important;
                color: var(--text-muted) !important;
                font-family: inherit !important;
                font-size: 9px !important;
                line-height: 1 !important;
                cursor: pointer !important;
                pointer-events: auto !important;
                position: relative !important;
                overflow: visible !important;
                -webkit-tap-highlight-color: transparent !important;
                transition: color .28s cubic-bezier(.16,1,.3,1), transform .28s cubic-bezier(.16,1,.3,1) !important;
            }
            #dockBar .dock-tab::before,
            #dockBar .dock-tab::after,
            #dockBar .dock-tab.active::before,
            #dockBar .dock-tab.active::after {
                display: none !important;
                content: none !important;
                opacity: 0 !important;
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }
            #dockBar .dock-tab.active {
                color: var(--primary) !important;
                transform: translateY(-4px) !important;
            }
            #dockBar .dock-tab:active {
                transform: scale(.94) !important;
            }
            #dockBar .dock-tab.active:active {
                transform: translateY(-4px) scale(.94) !important;
            }
            #dockBar .dock-tab .dt-icon,
            #dockBar .dock-tab .dt-label {
                position: relative !important;
                z-index: 1 !important;
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
            }
            #dockBar .dock-tab .dt-icon {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 24px !important;
                height: 24px !important;
                font-size: 20px !important;
                line-height: 1 !important;
                filter: none !important;
            }
            #dockBar .dock-tab.active .dt-icon {
                filter: drop-shadow(0 4px 8px rgba(5,150,105,.22)) !important;
            }
            #dockBar .dock-tab .dt-icon svg.dt-svg,
            #dockBar .dock-tab .dt-icon svg {
                width: 21px !important;
                height: 21px !important;
                display: block !important;
            }
            #dockBar .dock-tab .dt-label {
                display: block !important;
                height: auto !important;
                overflow: visible !important;
                pointer-events: none !important;
                font-size: 9px !important;
                font-weight: 500 !important;
                letter-spacing: .25px !important;
                color: currentColor !important;
            }
            #dockBar .dock-tab.active .dt-label {
                font-weight: 700 !important;
            }
            #dockBar .dock-tab[data-tab="ai"] .dt-label {
                display: none !important;
            }
            #dockBar .dock-tab .anim-layer,
            #dockBar .dock-tab .anim-layer * {
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }
            #dockBar .dock-tab .anim-layer {
                position: absolute !important;
                left: 50% !important;
                top: 50% !important;
                transform: translate(-50%, -50%) !important;
                pointer-events: none !important;
                z-index: 2 !important;
            }
            body.photo-previewing #dockBar {
                display: none !important;
            }
        `;
    }

    restoreMinimalDockStyles();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', restoreMinimalDockStyles);
    }

    function syncProfileUser() {
        var profileName = document.getElementById('profileName');
        var profileStatus = document.getElementById('profileStatus');
        var profileAvatar = document.getElementById('profileAvatar');
        if (!profileName) return;
        if (window.currentUser) {
            profileName.textContent = window.currentUser;
            profileStatus.textContent = '查看资料';
            if (profileAvatar) profileAvatar.textContent = window.currentUser[0].toUpperCase();
        } else {
            profileName.textContent = '未登录';
            profileStatus.textContent = '点击登录';
            if (profileAvatar) profileAvatar.innerHTML = '?';
        }
    }
    window.syncProfileUser = syncProfileUser;

    window.openReport = function(targetType, targetId, targetUser) {
        var modal = document.getElementById('reportModal');
        if (!modal) return;
        var overlay = modal.closest('.modal-overlay') || modal;
        overlay.style.display = '';
        overlay.classList.add('active');
        document.getElementById('reportCategory').value = 'spam';
        document.getElementById('reportReason').value = '';
        document.getElementById('reportEvidencePreview').textContent = '';
        document.getElementById('reportEvidenceInput').value = '';
        window._reportTarget = { type: targetType, id: targetId, user: targetUser };
    };

    window.submitReport = async function() {
        var target = window._reportTarget;
        if (!target) { window.showToast('举报目标不存在'); return; }
        var category = document.getElementById('reportCategory').value;
        var reason = document.getElementById('reportReason').value.trim();
        if (!reason) { window.showToast('请填写举报理由'); return; }
        var btn = document.getElementById('reportSubmitBtn');
        btn.disabled = true;
        btn.textContent = '提交中...';
        try {
            var evidenceFile = document.getElementById('reportEvidenceInput').files[0];
            var evidenceUrl = '';
            if (evidenceFile) {
                var path = 'reports/' + Date.now() + '_' + evidenceFile.name;
                await window.sb.storage.from('uploads').upload(path, evidenceFile);
                evidenceUrl = window.sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
            }
            var { error } = await window.sb.from('reports').insert([{
                target_type: target.type,
                target_id: target.id,
                target_user: target.user,
                reporter: window.currentUser || 'anonymous',
                category: category,
                reason: reason,
                evidence_url: evidenceUrl,
                actor_key: window.deviceId || 'unknown'
            }]);
            if (error) throw error;
            window.showToast('举报已提交，感谢你的反馈！');
            window.closeModal('reportModal');
        } catch (e) {
            window.showToast('提交失败: ' + (e.message || '网络错误'));
        } finally {
            btn.disabled = false;
            btn.textContent = '提交举报';
        }
    };

    document.addEventListener('change', function(e) {
        if (e.target && e.target.id === 'reportEvidenceInput') {
            var file = e.target.files[0];
            var preview = document.getElementById('reportEvidencePreview');
            if (preview) {
                preview.textContent = file ? '已选择: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)' : '';
            }
        }
    });

    function calcPathLengths() {
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

    document.addEventListener('change', function(e) {
        if (e.target && e.target.id === 'profileThemeToggle') {
            var themeToggle = document.getElementById('themeToggle');
            if (themeToggle) {
                themeToggle.click();
            }
        }
    });

    document.addEventListener('change', function(e) {
        if (e.target && e.target.id === 'profileNotifToggle') {
            var enabled = e.target.checked;
            try { localStorage.setItem('xtj_notif_enabled', enabled ? '1' : '0'); } catch(e2) {}
        }
    });

    function initProfileToggles() {
        var themeToggle = document.getElementById('profileThemeToggle');
        var notifToggle = document.getElementById('profileNotifToggle');
        if (themeToggle) {
            var isDark = document.body.classList.contains('dark-theme');
            themeToggle.checked = isDark;
        }
        if (notifToggle) {
            try {
                var saved = localStorage.getItem('xtj_notif_enabled');
                if (saved !== null) notifToggle.checked = saved === '1';
            } catch(e) {}
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initProfileToggles);
    } else {
        initProfileToggles();
    }
})();