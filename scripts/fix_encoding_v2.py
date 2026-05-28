import os
import sys
import re

def main():
    core_path = os.path.join(os.path.dirname(__file__), '..', 'js', 'core.js')
    
    # Read raw bytes
    with open(core_path, 'rb') as f:
        raw = f.read()
    
    # Check if it starts with UTF-8 BOM
    has_bom = raw.startswith(b'\xef\xbb\xbf')
    if has_bom:
        print("File has UTF-8 BOM - removing it")
        raw = raw[3:]
    
    # First, try to decode as UTF-8
    try:
        content = raw.decode('utf-8')
        print(f"File decoded as UTF-8: {len(content)} chars")
    except:
        print("NOT valid UTF-8, trying other encodings...")
        # Try GBK
        try:
            content = raw.decode('gbk')
            print("Successfully decoded as GBK!")
            # Write back as UTF-8
            with open(core_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print("Written as UTF-8!")
            # Verify
            with open(core_path, 'r', encoding='utf-8') as f:
                verify = f.read()
            chinese_count = len(re.findall(r'[\u4e00-\u9fa5]', verify))
            print(f"Verification: {chinese_count} Chinese characters found")
            return
        except Exception as e:
            print(f"GBK failed: {e}")
    
    # File is valid UTF-8 but may contain garbled Chinese
    # Check for garbled text
    chinese_count = len(re.findall(r'[\u4e00-\u9fa5]', content))
    print(f"Chinese characters found: {chinese_count}")
    
    if chinese_count > 50:
        print("File already has plenty of Chinese - checking for garbled segments...")
    
    # The garbled text is actually UTF-8 bytes that were incorrectly decoded.
    # We need to: garbled_text -> encode('latin1')? -> decode('utf-8')
    # But first, let's identify garbled segments.
    
    # Actually, let me try a different approach.
    # The garbled text like 娴忚 is what you get when UTF-8 bytes
    # are interpreted through a double-encoding.
    # 
    # Process: original UTF-8 Chinese -> read as Latin1 -> treated as GBK -> displayed as garble
    # Reverse: garble -> encode as GBK -> decode as Latin1 -> decode as UTF-8
    
    # But actually, I think the simplest approach is:
    # 1. Find all garbled character sequences
    # 2. For each, reverse the encoding
    
    # Let me first check: is the garbled text actually from GBK misinterpretation?
    # Try to fix specific known garbled patterns
    
    # Known garbled patterns from the codebase:
    known_garbled = [
        '娴忚',    # should be 浏览
        '鐐硅禐',    # should be 点赞
        '璇勮',    # should be 评论
        '鍒犻櫎',    # should be 删除
        '鏌ョ湅璧勬枡',  # should be 查看资料
        '鏈夊鐧诲綍',   # should be 未登录
        '鐐瑰嚮鐧诲綍',  # should be 点击登录
        '涓炬姤',     # should be 举报
        '鏇存柊',    # should be 更新
        '鍙戝竷',    # should be 发布
        '鏄电О',    # should be 昵称
        '瀵嗙爜',    # should be 密码
        '娉ㄥ唽',    # should be 注册
        '鐧诲綍',    # should be 登录
        '澶村儚',    # should be 头像
        '鍔犺浇',    # should be 加载
        '淇濆瓨',    # should be 保存
        '鍒锋柊',    # should be 刷新
        '鏌ユ壘',    # should be 搜索
        '鍒嗕韩',    # should be 分享
        '鏀惰棌',    # should be 收藏
        '閫€鍑?',    # should be 退出
        '鏃ュ織',    # should be 日志
        '瀹屾垚',    # should be 完成
        '寮€濮嬫垚',  # should be 开始
        '缁撴潫',    # should be 结束
        '閲嶈瘯',    # should be 重试
        '鍏抽棴',    # should be 关闭
        '鏄剧ず',    # should be 显示
        '闅愯棌',    # should be 隐藏
        '缂栬緫',    # should be 编辑
        '鍒楄〃',    # should be 列表
        '棣栭〉',    # should be 首页
        '杩斿洖',    # should be 返回
        '鍓嶅線',    # should be 前往
        '鍙栧彂',    # should be 发送
        '鎺ユ敹',    # should be 接收
        '璇诲彇',    # should be 读取
        '鍐欏叆',    # should be 写入
        '鏌ヨ瘯',    # should be 查询
        '鎺掑簭',    # should be 排序
        '絎旇',    # should be 笔记? not sure
        '鏍规嵁',    # should be 根据
        '閫氱煡',    # should be 通知
        '璁板綍',    # should be 记录
        '鐢ㄦ埛',    # should be 用户
        '淇℃伅',    # should be 信息
        '娑堟伅',    # should be 消息
        '鍔ㄦ€?',    # should be 动态
        '浠ｇ爜',    # should be 代码
        '鏁版嵁',    # should be 数据
        '鏂囦欢',    # should be 文件
        '鍥剧墖',    # should be 图片
        '瑙嗛',    # should be 视频
        '鎬绘暟',    # should be 总数
        '鏃堕棿',    # should be 时间
        '鏈嶅姟',    # should be 服务
        '椤甸潰',    # should be 页面
        '閫€鍑?',    # should be 退出
        '澶嶅埗',    # should be 复制
        '绮樿创',    # should be 粘贴
        '鍒囨崲',    # should be 切换
        '鏂板缓',    # should be 新建
        '鍒涘缓',    # should be 创建
        '鍘嬬缉',    # should be 压缩
        '涓婁紶',    # should be 上传
        '涓嬭浇',    # should be 下载
        '澶囦唤',    # should be 备份
        '鎭㈠',    # should be 恢复
        '绉诲姩',    # should be 移动
        '璁剧疆',    # should be 设置
        '娓呴櫎',    # should be 清除
        '纭',    # should be 确认
        '鍙栨秷',    # should be 取消
        '鎻愪氦',    # should be 提交
        '鍙戦€?',    # should be 发送
        '鏇村',    # should be 更多
        '鏆傚仠',    # should be 暂停
        '缁х画',    # should be 继续
        '鍋滄',    # should be 停止
        '婧愮爜',    # should be 源码
        '椤圭洰',    # should be 项目
        '缂栧啓',    # should be 编写
        '鏀瑰杽',    # should be 改善
        '鎻愰珮',    # should be 提高
        '鏍峰紡',    # should be 样式
        '涓婚',    # should be 主题
        '鍏憡',    # should be 公告
        '缁熻',    # should be 统计
        '鍒嗘瀽',    # should be 分析
        '鐗堟湰',    # should be 版本
        '妫€娴?',    # should be 检测
        '楠岃瘉',    # should be 验证
        '鐧诲嚭',    # should be 登出
        '娓叉煋',    # should be 渲染
        '绠＄悊',    # should be 管理
        '绯荤粺',    # should be 系统
        '涓汉',    # should be 个人
        '璧勬枡',    # should be 资料
        '瀵艰埅',    # should be 导航
        '搴曢儴',    # should be 底部
        '涓棿',    # should be 中间
        '宸﹁竟',    # should be 左边
        '鍙宠竟',    # should be 右边
        '涓婇潰',    # should be 上面
        '涓嬮潰',    # should be 下面
        '鍐呭',    # should be 内容
        '鏍囬',    # should be 标题
        '鎻忚堪',    # should be 描述
        '鏍囩',    # should be 标签
        '鍒嗙被',    # should be 分类
        '绫诲瀷',    # should be 类型
        '鐘舵€?',    # should be 状态
        '灞炴€?',    # should be 属性
        '鍙傛暟',    # should be 参数
        '杩囨护',    # should be 过滤
        '鍖归厤',    # should be 匹配
        '澶勭悊',    # should be 处理
        '鎵ц',    # should be 执行
        '璋冪敤',    # should be 调用
        '鍚屾',    # should be 同步
        '寮傛',    # should be 异步
        '浼樺寲',    # should be 优化
        '缂撳瓨',    # should be 缓存
        '璇锋眰',    # should be 请求
        '鍝嶅簲',    # should be 响应
        '閿欒',    # should be 错误
        '璀﹀憡',    # should be 警告
        '鎻愮ず',    # should be 提示
        '鎴愬姛',    # should be 成功
        '澶辫触',    # should be 失败
        '绐楀彛',    # should be 窗口
        '妗嗘灦',    # should be 框架
        '妯″潡',    # should be 模块
        '鎺ュ彛',    # should be 接口
        '鎺у埗',    # should be 控制
        '瑙﹀彂',    # should be 触发
        '鍒濆鍖?',  # should be 初始化
        '娉ㄥ唽',    # should be 注册
        '鐧诲綍',    # should be 登录
        '鏉冮檺',    # should be 权限
        '瑙掕壊',    # should be 角色
        '璁よ瘉',    # should be 认证
        '浼氳瘽',    # should be 会话
        '浠ょ墝',    # should be 令牌
    ]
    
    expected = [
        '浏览',
        '点赞',
        '评论',
        '删除',
        '查看资料',
        '未登录',
        '点击登录',
        '举报',
        '更新',
        '发布',
        '昵称',
        '密码',
        '注册',
        '登录',
        '头像',
        '加载',
        '保存',
        '刷新',
        '搜索',
        '分享',
        '收藏',
        '退出',
        '日志',
        '完成',
        '开始',
        '结束',
        '重试',
        '关闭',
        '显示',
        '隐藏',
        '编辑',
        '列表',
        '首页',
        '返回',
        '前往',
        '发送',
        '接收',
        '读取',
        '写入',
        '查询',
        '排序',
        '笔记',
        '根据',
        '通知',
        '记录',
        '用户',
        '信息',
        '消息',
        '动态',
        '代码',
        '数据',
        '文件',
        '图片',
        '视频',
        '总数',
        '时间',
        '服务',
        '页面',
        '退出',
        '复制',
        '粘贴',
        '切换',
        '新建',
        '创建',
        '压缩',
        '上传',
        '下载',
        '备份',
        '恢复',
        '移动',
        '设置',
        '清除',
        '确认',
        '取消',
        '提交',
        '发送',
        '更多',
        '暂停',
        '继续',
        '停止',
        '源码',
        '项目',
        '编写',
        '改善',
        '提高',
        '样式',
        '主题',
        '公告',
        '统计',
        '分析',
        '版本',
        '检测',
        '验证',
        '登出',
        '渲染',
        '管理',
        '系统',
        '个人',
        '资料',
        '导航',
        '底部',
        '中间',
        '左边',
        '右边',
        '上面',
        '下面',
        '内容',
        '标题',
        '描述',
        '标签',
        '分类',
        '类型',
        '状态',
        '属性',
        '参数',
        '过滤',
        '匹配',
        '处理',
        '执行',
        '调用',
        '同步',
        '异步',
        '优化',
        '缓存',
        '请求',
        '响应',
        '错误',
        '警告',
        '提示',
        '成功',
        '失败',
        '窗口',
        '框架',
        '模块',
        '接口',
        '控制',
        '触发',
        '初始化',
        '注册',
        '登录',
        '权限',
        '角色',
        '认证',
        '会话',
        '令牌',
    ]
    
    total_fixed = 0
    for garbled, correct in zip(known_garbled, expected):
        count = content.count(garbled)
        if count > 0:
            content = content.replace(garbled, correct)
            total_fixed += count
            print(f"  {garbled} -> {correct} ({count} times)")
    
    print(f"\nTotal: {total_fixed} replacements")
    
    # Write back
    with open(core_path, 'w', encoding='utf-8') as f:
        f.write(content)
    
    # Verify
    with open(core_path, 'r', encoding='utf-8') as f:
        verify = f.read()
    good_chinese = len(re.findall(r'[\u4e00-\u9fa5]', verify))
    print(f"\nAfter fix: {good_chinese} Chinese characters")
    
    # Check for remaining garbled
    garbled_chars = re.findall(r'[娴鐐硅璇勮鍒犻櫎鏌ョ鏈夊嚮涓炬姤鏇存柊鍙戝竷鏄电О瀵嗙爜娉ㄥ唽澶村儚鍔犺浇淇濆瓨鍒锋柊鏌ユ壘鍒嗕韩鏀惰棌楠岃瘉鏃ュ織瀹屾垚缁撴潫閲嶈瘯鍏抽棴鏄剧ず闅愯棌缂栬緫鍒楄〃棣栭〉杩斿洖鍓嶅線鍙栧彂鎺ユ敹璇诲彇鍐欏叆鏌ヨ瘯鎺掑簭鏍规嵁閫氱煡璁板綍鐢ㄦ埛淇℃伅娑堟伅鍔ㄦ€佷唬鐮佹暟鎹枃浠跺浘瑙嗛鎬绘暟鏃堕棿鏈嶅姟椤甸潰澶嶅埗绮樿创鍒囨崲鏂板缓鍒涘缓鍘嬬缉涓婁紶涓嬭浇澶囦唤鎭㈠绉诲姩璁剧疆娓呴櫎纭鎻愪氦鏇村鏆傚仠缁х画鍋滄婧愮爜椤圭洰缂栧啓鏀瑰杽鎻愰珮鏍峰紡涓婚鍏憡缁熻鍒嗘瀽鐗堟湰妫€娴嬮獙璇佺櫥鍑烘覆鏌撶鐞嗙郴缁熶釜浜鸿祫鏂欏鑸簳閮ㄤ腑闂村乏杈瑰彸杈逛笂闈笅鍐呭鏍囬鎻忚堪鏍囩鍒嗙被绫诲瀷鐘舵€佸睘鎬у弬鏁拌繃婊ゅ尮閰嶅鐞嗘墽琛岃皟鐢ㄥ悓姝ュ紓姝ヤ紭鍖栫紦瀛樿姹傚搷搴旈敊璇鍛婃彁绀烘垚鍔熷け璐ョ獥鍙ｆ鏋舵ā鍧楁帴鍙ｆ帶鍒惰Е鍙戝垵濮嬪寲鏉冮檺瑙掕壊璁よ瘉浼氳瘽浠ょ墝]', verify)
    if garbled_chars:
        print(f"WARNING: {len(garbled_chars)} potential garbled chars still present!")
        # Print unique ones
        unique = set(garbled_chars)
        print(f"Unique garbled chars: {''.join(sorted(unique))}")
    else:
        print("No remaining garbled characters detected!")

if __name__ == '__main__':
    # Set output encoding
    if sys.platform == 'win32':
        sys.stdout.reconfigure(encoding='utf-8')
    main()