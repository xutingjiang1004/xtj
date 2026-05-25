(function() {
    var SUPABASE_URL = "https://ithowxqignlhkwaykglt.supabase.co";
    var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA";

    if (typeof window.supabase === 'undefined') {
        var feedEl = document.getElementById('feed');
        if (feedEl) feedEl.innerHTML = '<div class="loading" style="color:#ff3b60;">服务加载失败，请刷新页面重试</div>';
        return;
    }
    var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.sb = sb;

    window.SUPABASE_URL = SUPABASE_URL;
    window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

    var ADMIN_NAME = "xxz";
    var AVATAR_CACHE_KEY = "xtj_avatars";
    var AUTH_MARKER = '__auth__';
    var DM_MARKER = '__dm__';
    var ANN_MARKER = '__ann__';
    var PHOTO_WALL_MARKER = '__photo_wall__';

    window.ADMIN_NAME = ADMIN_NAME;
    window.AVATAR_CACHE_KEY = AVATAR_CACHE_KEY;
    window.AUTH_MARKER = AUTH_MARKER;
    window.DM_MARKER = DM_MARKER;
    window.ANN_MARKER = ANN_MARKER;
    window.PHOTO_WALL_MARKER = PHOTO_WALL_MARKER;
})();