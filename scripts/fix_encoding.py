import os
import sys

def fix_encoding():
    core_path = os.path.join(os.path.dirname(__file__), '..', 'js', 'core.js')
    
    # Read the file
    with open(core_path, 'rb') as f:
        data = f.read()
    
    # Try to decode
    content = data.decode('utf-8', errors='replace')
    
    # Create a mapping from known bad to good
    replacements = {
        '鐐硅禐': '点赞',
        '璇勮?' : '评论',
        '娴忚?' : '浏览',
        '鍒犻櫎': '删除',
        '鏌ョ湅璧勬枡': '查看资料',
        '鏈夊鐧诲綍': '未登录',
        '鐐瑰嚮鐧诲綍': '点击登录',
        '涓炬姤': '举报',
        '鎬诲姩鎬?': '总动态',
        '鎸夌敤鎴峰垎缁': '按用户分组',
        '鎬绘祻瑙?': '总浏览',
        '璁板綍': '记录',
        '鐐硅禐鍜岃瘎璁?': '点赞和评论',
        '鏆傛棤': '暂无',
        '濉厖': '填充',
        '淇℃伅': '信息',
        '缂撳瓨': '缓存',
        '浣跨敤': '使用',
        '娓叉煋': '绘制',
    }
    
    # Apply replacements
    for bad, good in replacements.items():
        content = content.replace(bad, good)
    
    # Write back
    with open(core_path, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print('Fixed core.js!')

if __name__ == '__main__':
    fix_encoding()
