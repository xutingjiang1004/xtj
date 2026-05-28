const { execFileSync } = require('child_process');
const path = require('path');

const gitCmd = 'git';
const args = ['show', 'HEAD:js/core.js'];
const output = execFileSync(gitCmd, args, { encoding: 'utf8', cwd: path.join(__dirname, '..') });

const lines = output.split('\n');
console.log('Lines 1460-1520 from git HEAD:');
for (let i = 1460-1; i <= 1520-1; i++) {
    console.log((i+1) + ':', lines[i]);
}