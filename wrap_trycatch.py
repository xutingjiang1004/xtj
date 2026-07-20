import os
import re

content = open('render-api/server.js', 'r', encoding='utf-8').read()

def wrap_try_catch(match):
    prefix = match.group(1)
    body = match.group(2)
    suffix = match.group(3)
    
    if 'try {' in body:
        return match.group(0)
    
    new_body = f"\n  try {{{body}\n  }} catch (e) {{\n    console.error('Unhandled route error:', e.message);\n    return res.status(500).json({{ error: '服务器内部错误' }});\n  }}"
    return prefix + new_body + suffix

new_content = re.sub(r'(app\.(?:get|post|put|delete)\(\'(?:[^\']+)\'(?:.*?)(?:,\s*async\s*\(\s*req\s*,\s*res\s*\)\s*=>\s*\{))(.*?)\n(\}\);)', wrap_try_catch, content, flags=re.DOTALL)

with open('render-api/server.js', 'w', encoding='utf-8') as f:
    f.write(new_content)
    
print("Try/catch wrapping applied.")
