var fs = require('fs');
var path = 'C:\\Users\\Administrator\\Desktop\\最新index\\xtj\\js\\english-learning.js';
var c = fs.readFileSync(path, 'utf8');

var fixes = [
  // Fix garbled strings in buildLocalQuiz
  ['\u6D93\u5B53\u5206\u5217', '以下'],
  ['\u8C29\u5355\u8C29', '该单词'],
  ['\u003F\u003F\u003F\u003F', '错误'],
];

var count = 0;
fixes.forEach(function(f) {
  var r = c.split(f[0]);
  if (r.length > 1) {
    c = r.join(f[1]);
    count++;
    console.log('Fixed: ' + f[1]);
  }
});

fs.writeFileSync(path, c, 'utf8');
console.log('Total fixes: ' + count);
