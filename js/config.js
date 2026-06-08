/**
 * XTJ 安全配置
 * 
 * 使用方式：
 * 1. 在 index.html / admin.html 中用 <script src="js/config.js"></script> 引入
 * 2. 在 Render 部署时，直接用环境变量注入逻辑改写 API_BASE
 * 
 * 安全说明：
 * - API_BASE 是后端 Render API 地址，不包含敏感密钥
 * - SUPABASE_URL 和 SUPABASE_ANON_KEY 仅用于前端直连
 * - 所有敏感操作必须走 API_BASE 的后端接口
 */
(function() {
    // 自动检测：如果前端页面和后端 API 在同一个域名，直接用当前域名
    var hostname = window.location.hostname;
    var isRender = hostname.endsWith('.onrender.com') || hostname === 'localhost' || hostname === '127.0.0.1';
    var defaultApiBase = isRender ? window.location.origin : "https://xtj-1.onrender.com";

    window.XTJ_CONFIG = {
        // 后端 API 地址（自动检测同域部署，也可手动覆盖）
        API_BASE: defaultApiBase,
        
        // 以下字段仅用于前端正常功能，不会暴露敏感权限
        SUPABASE_URL: "https://ithowxqignlhkwaykglt.supabase.co",
        SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA"
    };
})();
