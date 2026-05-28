(function() {
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
            if (preview) {
                preview.textContent = file
                    ? '已选择文件：' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)'
                    : '';
            }
        }
        if (e.target && e.target.id === 'profileThemeToggle') {
            var themeToggle = document.getElementById('themeToggle');
            if (themeToggle) themeToggle.click();
        }
        if (e.target && e.target.id === 'profileNotifToggle') {
            try { localStorage.setItem('xtj-notif', e.target.checked ? 'on' : 'off'); } catch (e2) {}
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
            } catch (e) {}
        }
    }

    (function() {
        var style = document.createElement('style');
        style.textContent = '#dockBar .dock-tab[data-tab="ai"] .dt-icon svg.dt-svg,#dockBar .dock-tab[data-tab="ai"] .dt-icon svg{width:28px!important;height:28px!important;}';
        document.head.appendChild(style);
    })();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            calcPathLengths();
            initProfileToggles();
        });
    } else {
        calcPathLengths();
        initProfileToggles();
    }
})();
