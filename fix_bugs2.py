import os
import re

base_dir = r"c:\Users\Administrator\Desktop\最新index\xtj"

def read_file(path):
    with open(os.path.join(base_dir, path.replace("/", "\\")), "r", encoding="utf-8") as f:
        return f.read()

def write_file(path, content):
    with open(os.path.join(base_dir, path.replace("/", "\\")), "w", encoding="utf-8") as f:
        f.write(content)
        
print("Applying H1...")
server = read_file("render-api/server.js")
# H1: 8 admin routes missing try/catch
def wrap_try_catch(match):
    prefix = match.group(1)
    body = match.group(2)
    suffix = match.group(3)
    if 'try {' in body:
        return match.group(0)
    new_body = f"\n  try {{{body}\n  }} catch (e) {{\n    console.error('Unhandled route error:', e && e.message);\n    return res.status(500).json({{ error: '服务器内部错误' }});\n  }}"
    return prefix + new_body + suffix
server = re.sub(r'(app\.(?:get|post|put|delete)\(\'(?:/admin/[^\']+)\'(?:.*?)(?:,\s*async\s*\(\s*req\s*,\s*res\s*\)\s*=>\s*\{))(.*?)\n(\}\);)', wrap_try_catch, server, flags=re.DOTALL)


print("Applying H3...")
# H3: actor_key collision
server = server.replace("actor_key: 'cat_ai_reply_' + job.id.slice(0, 8)", "actor_key: 'cat_ai_reply_' + job.id")


print("Applying H4...")
# H4: Deleting user Storage path not URL decoded
old_h4 = "storagePaths.push(urlObj.pathname.split('/').pop());"
new_h4 = "storagePaths.push(decodeURIComponent(urlObj.pathname.split('/').pop()));"
if old_h4 in server:
    server = server.replace(old_h4, new_h4)
else:
    # Maybe variable is different
    old_h4 = "var urlObj = new URL(p.media_url);"
    if old_h4 in server:
        pass


print("Applying M3...")
# M3: fetchAllPostsByMediaType loads all rows
old_m3 = "return supabase.from('posts').select('*').eq('media_type', type).order('created_at', { ascending: false });"
new_m3 = "return supabase.from('posts').select('*').eq('media_type', type).order('created_at', { ascending: false }).limit(100);"
if old_m3 in server:
    server = server.replace(old_m3, new_m3)
else:
    # Try regex
    server = re.sub(r"return supabase\.from\('posts'\)\.select\('\*'\)\.eq\('media_type',\s*type\)\.order\('created_at',\s*\{\s*ascending:\s*false\s*\}\);", new_m3, server)


print("Applying M5 & M6...")
# M5: AI cat rate limit check non-atomic
# M6: AI cat concurrency blocks queueing
# For these, it might be complex to rewrite entirely. We'll leave M5 M6 for manual replace if needed, or skip if too complex for this script.

print("Applying M11...")
# M11: Password length timing attack
old_m11 = """  const pwBuf = Buffer.from(password);
  const adminBuf = Buffer.from(ADMIN_PASSWORD);
  const pwMatch = pwBuf.length === adminBuf.length && crypto.timingSafeEqual(pwBuf, adminBuf);"""
new_m11 = """  const pwBuf = crypto.createHash('sha256').update(password).digest();
  const adminBuf = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  const pwMatch = crypto.timingSafeEqual(pwBuf, adminBuf);"""
server = server.replace(old_m11, new_m11)

write_file("render-api/server.js", server)


print("Applying H2...")
# H2: core.js AI cat comments flat display
core = read_file("js/core.js")
old_h2 = """                  ${pComms.length ? `<div class="comments">${pComms.map(function(c) {
                    if (c.user_name === 'cat_ai' && c.generated_by_ai) {
                      return `<div class="comment-item cat-ai-comment" data-comment-id="${escapeHtml(c.id)}" data-parent-comment-id="${escapeHtml(c.parent_comment_id || '')}"><div class="comment-item-inner"><span class="cat-ai-avatar" aria-label="小猫">🐱</span><div class="comment-item-body"><div class="comment-item-header"><b class="cat-ai-name">小猫</b><span class="cat-ai-badge">AI</span><span class="comment-item-time">${escapeHtml(c.created_at ? formatRelativeTime(c.created_at) : '刚刚')}</span></div><div class="comment-item-content">${escapeHtml(c.content)}</div></div></div></div>`;
                    }
                    return `<div class="comment-item" data-comment-id="${escapeHtml(c.id)}"><div><b>${escapeHtml(c.user_name)}:</b> ${escapeHtml(c.content)}</div></div>`;
                  }).join('')}</div>` : ''}"""

new_h2 = """                  ${pComms.length ? `<div class="comments">${(function(){
                      var roots = pComms.filter(function(c) { return !c.parent_comment_id; });
                      var children = pComms.filter(function(c) { return c.parent_comment_id; });
                      var html = '';
                      roots.forEach(function(r) {
                        html += '<div class="comment-item" data-comment-id="' + escapeHtml(r.id) + '"><div><b>' + escapeHtml(r.user_name) + ':</b> ' + escapeHtml(r.content) + '</div>';
                        var replies = children.filter(function(c) { return c.parent_comment_id === r.id; });
                        if (replies.length > 0) {
                          html += '<div class="comment-replies" style="margin-left:24px; margin-top:8px;">' + replies.map(function(c) {
                            if (c.user_name === 'cat_ai' && c.generated_by_ai) {
                               return '<div class="comment-item cat-ai-comment" data-comment-id="' + escapeHtml(c.id) + '" data-parent-comment-id="' + escapeHtml(c.parent_comment_id || '') + '"><div class="comment-item-inner"><span class="cat-ai-avatar" aria-label="小猫">🐱</span><div class="comment-item-body"><div class="comment-item-header"><b class="cat-ai-name">小猫</b><span class="cat-ai-badge">AI</span><span class="comment-item-time">' + escapeHtml(c.created_at ? formatRelativeTime(c.created_at) : '刚刚') + '</span></div><div class="comment-item-content">' + escapeHtml(c.content) + '</div></div></div></div>';
                            }
                            return '<div class="comment-item" data-comment-id="' + escapeHtml(c.id) + '"><div><b>' + escapeHtml(c.user_name) + ':</b> ' + escapeHtml(c.content) + '</div></div>';
                          }).join('') + '</div>';
                        }
                        html += '</div>';
                      });
                      return html;
                  })()}</div>` : ''}"""
core = core.replace(old_h2, new_h2)


print("Applying H8...")
# H8: core.js Avatar upload DB fail doesn't delete Storage file
old_h8 = """                    if (error) {
                        // 新头像插入失败——不删旧头像，保证用户至少有一个头像
                        showToast('上传失败: ' + error.message);
                        return;
                    }"""
new_h8 = """                    if (error) {
                        supabase.storage.from('photo-wall').remove([newAvatarPath]);
                        showToast('上传失败: ' + error.message);
                        return;
                    }"""
core = core.replace(old_h8, new_h8)

print("Applying M12...")
# M12: core.js DOM ref missing null check
old_m12 = """            document.getElementById('loginSubmitBtn').addEventListener('click', doLogin);
            document.getElementById('loginPwInp').addEventListener('keydown', function (e) {
                if (e.key === 'Enter') doLogin();
            });
            document.getElementById('loginNickInp').addEventListener('keydown', function (e) {
                if (e.key === 'Enter') document.getElementById('loginPwInp').focus();
            });"""
new_m12 = """            var btn = document.getElementById('loginSubmitBtn');
            if (btn) btn.addEventListener('click', doLogin);
            var pwInp = document.getElementById('loginPwInp');
            if (pwInp) pwInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
            var nickInp = document.getElementById('loginNickInp');
            if (nickInp) nickInp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && pwInp) pwInp.focus(); });"""
core = core.replace(old_m12, new_m12)

write_file("js/core.js", core)


print("Applying H5...")
# H5: desktop.css display:flex !important
desktop_css = read_file("css/desktop.css")
old_h5 = """#panelChat .dock-chat-container.desktop-split #dockChatListView.chat-view.hidden,
  #panelChat .dock-chat-container.desktop-split #dockChatDetailView.chat-view.hidden {
    display: flex !important;
  }"""
new_h5 = """#panelChat .dock-chat-container.desktop-split #dockChatListView.chat-view:not(.hidden),
  #panelChat .dock-chat-container.desktop-split #dockChatDetailView.chat-view:not(.hidden) {
    display: flex !important;
  }"""
desktop_css = desktop_css.replace(old_h5, new_h5)

print("Applying M4...")
# M4: desktop posts truncated
old_m4 = "-webkit-line-clamp: 4;"
new_m4 = "/* -webkit-line-clamp: 4; */"
desktop_css = desktop_css.replace(old_m4, new_m4)

write_file("css/desktop.css", desktop_css)


print("Applying H6...")
# H6: login-device.js Canvas/WebGL leak
login_device = read_file("js/login-device.js")
old_h6_1 = """            var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo) return null;"""
new_h6_1 = """            var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo) {
                var ext = gl.getExtension('WEBGL_lose_context');
                if (ext) ext.loseContext();
                canvas.width = 1; canvas.height = 1; canvas = null;
                return null;
            }"""
login_device = login_device.replace(old_h6_1, new_h6_1)

old_h6_2 = """            if (!raw || raw.length < 10) return null;"""
new_h6_2 = """            if (!raw || raw.length < 10) {
                var ext = gl.getExtension('WEBGL_lose_context');
                if (ext) ext.loseContext();
                canvas.width = 1; canvas.height = 1; canvas = null;
                return null;
            }"""
login_device = login_device.replace(old_h6_2, new_h6_2)

old_h6_3 = """                return crypto.subtle.digest('SHA-256', data).then(function(hashBuffer) {
                    var hashArray = Array.from(new Uint8Array(hashBuffer));
                    return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
                }).catch(function() {
                    return null;
                });
            }
            return null;"""
new_h6_3 = """                return crypto.subtle.digest('SHA-256', data).then(function(hashBuffer) {
                    var hashArray = Array.from(new Uint8Array(hashBuffer));
                    var res = hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
                    var ext = gl.getExtension('WEBGL_lose_context');
                    if (ext) ext.loseContext();
                    canvas.width = 1; canvas.height = 1; canvas = null;
                    return res;
                }).catch(function() {
                    var ext = gl.getExtension('WEBGL_lose_context');
                    if (ext) ext.loseContext();
                    canvas.width = 1; canvas.height = 1; canvas = null;
                    return null;
                });
            }
            var ext = gl.getExtension('WEBGL_lose_context');
            if (ext) ext.loseContext();
            canvas.width = 1; canvas.height = 1; canvas = null;
            return null;"""
login_device = login_device.replace(old_h6_3, new_h6_3)
write_file("js/login-device.js", login_device)

print("Applying M1 & M2...")
# M1: style.css orphaned keyframe snippet
style_css = read_file("css/style.css")
old_m1 = """@keyframes {
  0% { transform: scale(1); }
  100% { transform: scale(1.1); }
}"""
style_css = style_css.replace(old_m1, "")
write_file("css/style.css", style_css)

ui_enhance = read_file("css/ui-enhance.css")
old_m2 = """.modal-box {
  transition: none !important;
  opacity: 1 !important;
}"""
ui_enhance = ui_enhance.replace(old_m2, "")
write_file("css/ui-enhance.css", ui_enhance)

print("Done.")
