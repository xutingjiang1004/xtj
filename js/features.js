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
            #dockBar .dock-tab:active { transform: scale(.94) !important; }
            #dockBar .dock-tab.active:active { transform: translateY(-4px) scale(.94) !important; }
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
            #dockBar .dock-tab.active .dt-icon { filter: drop-shadow(0 4px 8px rgba(5,150,105,.22)) !important; }
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
            #dockBar .dock-tab.active .dt-label { font-weight: 700 !important; }
            #dockBar .dock-tab[data-tab="ai"] .dt-label { display: none !important; }
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
            body.photo-previewing #dockBar { display: none !important; }
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
            if (profileStatus) profileStatus.textContent = '鏌ョ湅璧勬枡';
            if (profileAvatar) profileAvatar.textContent = window.currentUser[0].toUpperCase();
        } else {
            profileName.textContent = '鏈櫥褰';
            if (profileStatus) profileStatus.textContent = '鐐瑰嚮鐧诲綍';
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
        if (!target) { window.showToast && window.showToast('涓炬姤鐩爣涓嶅瓨鍦?'); return; }
        var categoryEl = document.getElementById('reportCategory');
        var reasonEl = document.getElementById('reportReason');
        var category = categoryEl ? categoryEl.value : 'other';
        var reason = reasonEl ? reasonEl.value.trim() : '';
        if (!reason) { window.showToast && window.showToast('璇峰～鍐欎妇鎶ョ悊鐢?'); return; }
        var btn = document.getElementById('reportSubmitBtn');
        if (btn) { btn.disabled = true; btn.textContent = '鎻愪氦涓?..'; }
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
                console.warn('[report] 涓诲瓧娈垫彃鍏ュけ璐ワ紝灏濊瘯澶囩敤瀛楁:', res.error.message);
                var res2 = await window.sb.from('reports').insert([fallbackPayload]);
                if (res2.error) throw res2.error;
            }
            window.showToast && window.showToast('涓炬姤宸叉彁浜わ紝鎰熻阿浣犵殑鍙嶉');
            window.closeModal && window.closeModal('reportModal');
        } catch (e) {
            window.showToast && window.showToast('鎻愪氦澶辫触: ' + (e.message || '缃戠粶閿欒'));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '鎻愪氦涓炬姤'; }
        }
    };

    document.addEventListener('change', function(e) {
        if (e.target && e.target.id === 'reportEvidenceInput') {
            var file = e.target.files && e.target.files[0];
            var preview = document.getElementById('reportEvidencePreview');
            if (preview) preview.textContent = file ? '宸查€夋嫨: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)' : '';
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { calcPathLengths(); initProfileToggles(); });
    } else {
        calcPathLengths();
        initProfileToggles();
    }
})();

