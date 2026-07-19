import re
import sys

def patch_file(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()

    # If already patched, skip
    if 'window.safeStorage = ' in content and filename.endswith('core.js'):
        return

    # In core.js, add window.safeStorage
    if filename.endswith('core.js'):
        safe_storage_code = """
window.safeStorage = {
    set: function(key, value) {
        try { localStorage.setItem(key, value); } catch(e) { console.warn('Storage set failed', e); }
    },
    get: function(key) {
        try { return localStorage.getItem(key); } catch(e) { return null; }
    },
    remove: function(key) {
        try { localStorage.removeItem(key); } catch(e) { console.warn('Storage remove failed', e); }
    }
};
"""
        # Inject at the top
        content = safe_storage_code + "\n" + content

    content = re.sub(r'try\s*\{\s*localStorage\.setItem\((.*?)\);\s*\}\s*catch\s*\(e\)\s*\{\}', r'window.safeStorage.set(\1);', content)
    content = re.sub(r'localStorage\.setItem\((.*?)\);', r'window.safeStorage.set(\1);', content)
    content = re.sub(r'localStorage\.getItem\((.*?)\)', r'window.safeStorage.get(\1)', content)
    content = re.sub(r'localStorage\.removeItem\((.*?)\);', r'window.safeStorage.remove(\1);', content)

    with open(filename, 'w', encoding='utf-8') as f:
        f.write(content)

patch_file('js/core.js')
patch_file('js/photo-wall/data.js')
patch_file('js/login-device.js')
print("Storage patch applied")
