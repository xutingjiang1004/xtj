'use strict';
const fs = require('fs');
const s = fs.readFileSync('js/ai-agent.js', 'utf8');
const i = s.indexOf('inputBar.appendChild(plusBtn)');
console.log('append idx', i);
console.log(JSON.stringify(s.slice(i, i + 160)));
const j = s.indexOf('// 创建 + 号按钮');
console.log('marker', j);
const k = s.indexOf("var inputBar = el('div', { class: 'ai-chat-input-bar' });");
console.log('inputBar', k);
// also try CRLF variants around append
const m = s.match(/inputBar\.appendChild\(plusBtn\);[\s\S]{0,80}/);
console.log('match', m && JSON.stringify(m[0]));
