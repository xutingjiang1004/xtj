import os
import re

base_dir = r"c:\Users\Administrator\Desktop\最新index\xtj"

def patch_file(path, replacements):
    full_path = os.path.join(base_dir, path.replace("/", "\\"))
    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        original = content
        for target, replacement in replacements:
            if target in content:
                content = content.replace(target, replacement)
            else:
                print(f"Warning: Target not found in {path}:\n{target[:80]}...")

        if content != original:
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Patched {path}")
        else:
            print(f"No changes made to {path}")
    except Exception as e:
        print(f"Error patching {path}: {e}")

# H3
server_replacements = [
    (
        "actor_key: 'cat_ai_reply_' + job.id.slice(0, 8)",
        "actor_key: 'cat_ai_reply_' + job.id"
    )
]
patch_file("render-api/server.js", server_replacements)

# H4
server_replacements2 = [
    (
        "var urlObj = new URL(p.media_url);",
        "var urlObj = new URL(p.media_url);\n          var pathSegment = decodeURIComponent(urlObj.pathname.split('/').pop());"
    ),
    (
        "storagePaths.push(urlObj.pathname.split('/').pop());",
        "storagePaths.push(pathSegment);"
    )
]
patch_file("render-api/server.js", server_replacements2)

# M3
server_replacements3 = [
    (
        "return supabase.from('posts').select('*')",
        "return supabase.from('posts').select('*').limit(100)"
    )
]
patch_file("render-api/server.js", server_replacements3)

# M11
server_replacements4 = [
    (
        "const pwBuf = Buffer.from(password);\n  const adminBuf = Buffer.from(ADMIN_PASSWORD);\n  const pwMatch = pwBuf.length === adminBuf.length && crypto.timingSafeEqual(pwBuf, adminBuf);",
        "const pwBuf = crypto.createHash('sha256').update(password).digest();\n  const adminBuf = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();\n  const pwMatch = crypto.timingSafeEqual(pwBuf, adminBuf);"
    )
]
patch_file("render-api/server.js", server_replacements4)

# H5, M4
desktop_css = [
    (
        "#panelChat .dock-chat-container.desktop-split #dockChatListView.chat-view.hidden,\n  #panelChat .dock-chat-container.desktop-split #dockChatDetailView.chat-view.hidden {\n    display: flex !important;\n  }",
        "#panelChat .dock-chat-container.desktop-split #dockChatListView.chat-view:not(.hidden),\n  #panelChat .dock-chat-container.desktop-split #dockChatDetailView.chat-view:not(.hidden) {\n    display: flex !important;\n  }"
    ),
    (
        "-webkit-line-clamp: 4;",
        "/* -webkit-line-clamp: 4; */"
    )
]
patch_file("css/desktop.css", desktop_css)

# H8
core_js = [
    (
        "if (error) {\n                        // 新头像插入失败——不删旧头像，保证用户至少有一个头像\n                        showToast('上传失败: ' + error.message);\n                        return;\n                    }",
        "if (error) {\n                        supabase.storage.from('photo-wall').remove([newAvatarPath]);\n                        showToast('上传失败: ' + error.message);\n                        return;\n                    }"
    )
]
patch_file("js/core.js", core_js)

# H6
login_device = [
    (
        "var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');\n            if (!debugInfo) return null;",
        "var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');\n            if (!debugInfo) return null;\n\n            var loseContext = gl.getExtension('WEBGL_lose_context');\n            if (loseContext) loseContext.loseContext();\n            canvas.width = 1; canvas.height = 1; canvas = null;"
    )
]
patch_file("js/login-device.js", login_device)

# M12
core_js_2 = [
    (
        "document.getElementById('loginSubmitBtn').addEventListener('click', doLogin);\n            document.getElementById('loginPwInp').addEventListener('keydown', function (e) {\n                if (e.key === 'Enter') doLogin();\n            });\n            document.getElementById('loginNickInp').addEventListener('keydown', function (e) {\n                if (e.key === 'Enter') document.getElementById('loginPwInp').focus();\n            });",
        "var btn = document.getElementById('loginSubmitBtn');\n            if (btn) btn.addEventListener('click', doLogin);\n            var pwInp = document.getElementById('loginPwInp');\n            if (pwInp) pwInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });\n            var nickInp = document.getElementById('loginNickInp');\n            if (nickInp) nickInp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && pwInp) pwInp.focus(); });"
    )
]
patch_file("js/core.js", core_js_2)

print("Initial patching completed.")
