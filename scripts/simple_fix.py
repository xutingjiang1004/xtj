
import os

def main():
    core_path = os.path.join(os.path.dirname(__file__), '..', 'js', 'core.js')
    
    # Read as binary first
    with open(core_path, 'rb') as f:
        raw = f.read()
    
    # Decode as utf-8
    content = raw.decode('utf-8')
    
    # Make a copy
    new_content = content
    
    # Replace only the specific patterns we see in the user's screenshot
    # Based on the grep results from earlier
    replacements = [
        ('娴忚?', '浏览'),
        ('鐐硅禐', '点赞'),
        ('璇勮?', '评论'),
        ('鍒犻櫎', '删除'),
        ('鏌ョ湅璧勬枡', '查看资料'),
        ('鏈夊鐧诲綍', '未登录'),
        ('鐐瑰嚮鐧诲綍', '点击登录'),
        ('涓炬姤', '举报'),
    ]
    
    for old, new in replacements:
        count = new_content.count(old)
        if count > 0:
            new_content = new_content.replace(old, new)
            print(f"Replaced {count} instances of {repr(old)} with {repr(new)}")
    
    # Write back carefully
    with open(core_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print('File written successfully!')

if __name__ == '__main__':
    main()

