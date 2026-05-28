const fs = require('fs');

const corePath = 'js/core.js';
let lines = fs.readFileSync(corePath, 'utf8').split('\n');

const fixes = [
    [1124, "                    showToast('请选择图片文件');"],
    [1129, "                    showToast('图片大小不能超过10MB');"],
    [1133, "                showToast('正在压缩并上传头像...');"],
    [1198, "                    showToast('上传失败，请重试');"],
    [2506, "                showToast(nextPinned ? '帖子已置顶' : '已取消置顶');"],
    [3280, "                if (tab === 'chat' && !currentUser) { showToast('请先登录'); return; }"],
    [3297, "                            window.showToast('正在刷新帖子...');"],
    [3304, "                                    window.showToast('刷新完成');"],
    [3313, "                            window.showToast('正在刷新...');"],
    [3325, "                            window.showToast('刷新完成');"],
    [3328, "                            window.showToast('正在刷新...');"],
    [3332, "                            window.showToast('刷新完成');"],
    [3335, "                            window.showToast('正在刷新...');"],
    [3339, "                            window.showToast('刷新完成');"],
    [3446, "                if (!currentUser) { showToast('请先登录'); return; }"],
    [3679, "                } catch(e) { showToast('发送失败: ' + (e?.message || e)); inp.value = content; }"],
    [4005, "                    showToast('请至少填写标题或内容');"],
    [4022, "                    showToast('公告已发布');"],
    [4026, "                    showToast('发布失败: ' + (e.message || '未知错误'));"],
    [4043, "                        showToast('公告已删除');"],
    [4048, "                        showToast('删除失败: ' + (e.message || '未知错误'));"],
];

let fixed = 0;
for (const [lineNum, newContent] of fixes) {
    const idx = lineNum - 1;
    if (idx >= 0 && idx < lines.length && lines[idx] !== newContent) {
        lines[idx] = newContent;
        fixed++;
    }
}

console.log('Fixed ' + fixed + ' lines');
fs.writeFileSync(corePath, lines.join('\n'), 'utf8');