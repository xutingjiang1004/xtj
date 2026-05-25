(function() {
    var currentUser;
    try { currentUser = localStorage.getItem("xtj_user") || ""; } catch(e) { currentUser = ""; }
    window.currentUser = currentUser;

    var deviceId;
    try { deviceId = localStorage.getItem("xtj_device_id"); } catch(e) { deviceId = null; }
    if (!deviceId) {
        try { deviceId = crypto.randomUUID(); } catch(e) { deviceId = 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2,9); }
        localStorage.setItem("xtj_device_id", deviceId);
    }
    window.deviceId = deviceId;

    window.appState = {
        get currentUser() { return window.currentUser; },
        set currentUser(v) { window.currentUser = v; },
        get deviceId() { return window.deviceId; },
        _listeners: {}
    };

    function safeText(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    window.safeText = safeText;

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }
    window.escapeHtml = escapeHtml;

    function showToast(message) {
        var container = document.getElementById('toastContainer');
        if (!container) return;
        var toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(function() {
            toast.style.animation = 'toastFade 0.3s ease-out forwards';
            setTimeout(function() { toast.remove(); }, 300);
        }, 2500);
    }
    window.showToast = showToast;

    function isAdmin() { return window.currentUser === window.ADMIN_NAME; }
    window.isAdmin = isAdmin;

    function formatMsgTime(d) {
        if (!d) return '';
        var date = new Date(d);
        var now = new Date();
        var diff = now - date;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
        if (diff < 172800000) return '昨天 ' + date.getHours().toString().padStart(2,'0') + ':' + date.getMinutes().toString().padStart(2,'0');
        return (date.getMonth()+1)+'/'+date.getDate()+' '+date.getHours().toString().padStart(2,'0')+':'+date.getMinutes().toString().padStart(2,'0');
    }
    window.formatMsgTime = formatMsgTime;

    function formatTime(d) {
        if (!d) return '';
        return new Date(d).toLocaleString();
    }
    window.formatTime = formatTime;

    function openModal(id) {
        document.getElementById(id).classList.add("active");
    }
    window.openModal = openModal;

    function closeModal(id) {
        document.getElementById(id).classList.remove("active");
    }
    window.closeModal = closeModal;

    function getMediaUrl(post) {
        if (!post || !post.media_url) return null;
        return post.media_url;
    }
    window.getMediaUrl = getMediaUrl;

    function isMsgReadByMe(msg) {
        return msg && msg.read_by && msg.read_by.indexOf(window.currentUser || '') >= 0;
    }
    window.isMsgReadByMe = isMsgReadByMe;

    function markMessagesRead(msgs) {
        if (!window.currentUser || !msgs || !msgs.length) return;
        var unread = msgs.filter(function(m) { return m.user_name !== window.currentUser && !isMsgReadByMe(m); });
        if (!unread.length) return;
        var ids = unread.map(function(m) { return m.id; });
        var sb = window.sb;
        if (!sb) return;
        ids.forEach(function(id) {
            sb.from('messages').update({ read_by: [window.currentUser] }).eq('id', id).then(function() {});
        });
    }
    window.markMessagesRead = markMessagesRead;
})();