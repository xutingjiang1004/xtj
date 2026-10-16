'use strict';
const { parentPort, workerData } = require('node:worker_threads');

// Fixed worker code: the pattern is data, never executable JavaScript source.
try {
  const expression = new RegExp(workerData.pattern, workerData.flags);
  const text = workerData.text, matches = [];
  let match;
  while (matches.length < 200 && (match = expression.exec(text)) !== null) {
    matches.push({ match:match[0].slice(0,200), index:match.index,
      groups:match.slice(1,11).map(value => value === undefined ? null : value.slice(0,200)) });
    if (match[0] === '') {
      const index = expression.lastIndex, first = text.charCodeAt(index), second = text.charCodeAt(index+1);
      expression.lastIndex += expression.unicode && first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff ? 2 : 1;
    }
  }
  parentPort.postMessage({ok:true,matches});
} catch (error) {
  parentPort.postMessage({ok:false,error:'正则表达式语法错误：'+String(error.message || '无法编译').slice(0,200)});
}
