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
    window.XTJ_CONFIG = {
        // 后端 API 地址：始终优先使用当前页面的 origin，支持任何自定义域名
        API_BASE: window.location.origin,
        SUPABASE_URL: "https://ithowxqignlhkwaykglt.supabase.co",
        SUPABASE_ANON_KEY: "eyJhbG...yDDA"
    };
    // 全局 API_BASE 兼容（部分旧模块直接引用 window.API_BASE）
    window.API_BASE = window.XTJ_CONFIG.API_BASE;
})();
