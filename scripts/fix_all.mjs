import { readFileSync, writeFileSync } from 'fs';

let html = readFileSync('C:/Users/Administrator/.openclaw/workspace/xtj/index.html', 'utf-8');

// 1. Fix like button emojis
html = html.replace(/const emojis = \["\?\?","\?\?","\?\?","\?","\?\?","\?\?"\]/g, 
    'const emojis = ["❤️","🫶","💕","💖","💗","❤️‍🔥"]');
html = html.replace(/btn\.textContent = isLiked \? "点赞" : "\?\?"/g,
    'btn.textContent = isLiked ? "点赞" : "❤️"');
html = html.replace(/\$\{isLiked\?'\?\?':'点赞'\}/g,
    '${isLiked?\'❤️\':\'点赞\'}');
html = html.replace(/"\?\? 发消息"/g, '"✉️ 发消息"');
html = html.replace(/>\?\? 发消息<\/button>/g, '>✉️ 发消息</button>');
html = html.replace(/>\?\? 公告</g, '>📢 公告<');
html = html.replace(/>\?\? 更新日志</g, '>📋 更新日志<');
html = html.replace(/"\?\? 发布新公告"/g, '"📝 发布新公告"');

// 2. Fix Jennie SVG signature paths - replace all 6 occurrences
const oldPath1 = 'M 60 40 C 90 20, 110 40, 90 60 C 70 80, 50 130, 70 140 C 90 150, 100 110, 110 90 C 120 110, 130 110, 140 90 C 150 110, 160 110, 170 90 C 180 110, 190 110, 200 90 C 210 110, 220 110, 230 90 C 240 100, 250 90, 260 80';
const newPath1 = 'M 50 85 C 45 35, 60 25, 75 35 C 90 45, 80 75, 65 95 C 50 115, 40 130, 35 120 C 28 108, 45 100, 60 100 C 75 100, 90 95, 95 85 C 98 78, 95 70, 85 68 C 75 66, 65 72, 70 82 C 75 92, 90 95, 105 88 C 115 82, 120 70, 120 65';
html = html.replaceAll(oldPath1, newPath1);

const oldPath2 = 'M 280 90 C 280 50, 320 50, 320 70 C 320 90, 280 90, 300 110 C 310 120, 320 110, 330 90 C 340 110, 350 110, 360 90 C 370 110, 380 80, 370 130 C 360 150, 340 140, 360 110 C 380 90, 400 110, 410 90';
const newPath2 = 'M 150 70 C 155 45, 170 38, 180 48 C 190 58, 180 88, 165 98 C 155 105, 150 103, 155 93 C 163 75, 180 68, 190 68 C 200 68, 210 58, 215 45 C 220 32, 220 72, 215 82 C 210 94, 200 100, 193 102 C 187 104, 185 97, 190 90 C 197 80, 210 74, 220 74 C 230 74, 240 68, 245 58';
html = html.replaceAll(oldPath2, newPath2);

const oldPath3 = 'M 430 60 C 420 50, 440 40, 450 60 C 460 40, 480 50, 470 60 C 480 80, 460 90, 450 70 C 440 90, 420 80, 430 60 Z';
const newPath3 = 'M 265 58 C 270 43, 285 33, 295 43 C 305 53, 290 83, 278 91 C 270 97, 265 101, 270 108 C 275 115, 285 111, 295 103 C 305 95, 315 83, 320 75 C 325 67, 330 68, 330 73';
html = html.replaceAll(oldPath3, newPath3);

// Verify
const checks = {
    '深色模式': html.includes('深色模式'),
    '❤️': html.includes('❤️'),
    'M 50 85': html.includes('M 50 85'),
    'M 150 70': html.includes('M 150 70'),
    'M 265 58': html.includes('M 265 58'),
    'NO old paths': !html.includes('M 60 40 C 90 20'),
};
console.log('Checks:', JSON.stringify(checks, null, 2));

writeFileSync('C:/Users/Administrator/.openclaw/workspace/xtj/index.html', html, 'utf-8');
console.log('Written OK');
