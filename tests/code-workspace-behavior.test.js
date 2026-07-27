const fs = require('fs');
const assert = require('assert');

// Read code-workspace.js to analyze its functions via string matching (since it's meant for browser)
const codeWorkspace = fs.readFileSync(__dirname + '/../js/code-workspace.js', 'utf8');

test('code-workspace buildOpenFilesContext uses extracted text for documents', () => {
  assert.match(codeWorkspace, /typeof tab\._extractedText === 'string'/);
});

test('code-workspace renderProjectStatus shows document status and permissions', () => {
  assert.match(codeWorkspace, /文档已就绪/);
  assert.match(codeWorkspace, /文档解析失败/);
  assert.match(codeWorkspace, /文档正在解析/);
  assert.match(codeWorkspace, /文件系统权限：/);
  assert.match(codeWorkspace, /AI 文档能力：/);
  assert.match(codeWorkspace, /只读/);
  assert.match(codeWorkspace, /可写/);
  assert.match(codeWorkspace, /仅支持读取和分析/);
  assert.match(codeWorkspace, /支持读取和单元格修改/);
});

test('code-workspace showError catches PROVIDER_ errors with details element', () => {
  assert.match(codeWorkspace, /code\.indexOf\('PROVIDER_'\) === 0/);
  assert.match(codeWorkspace, /AI 服务暂时无法处理该请求/);
  assert.match(codeWorkspace, /<details/);
  assert.match(codeWorkspace, /查看错误详情/);
});

test('code-workspace non-stream error handler restores message on HTTP 400', () => {
  assert.match(codeWorkspace, /PROVIDER_HTTP_400/);
  assert.match(codeWorkspace, /PROVIDER_INVALID_REQUEST/);
  assert.match(codeWorkspace, /VALIDATION_FAILED/);
});

test('code-workspace shows INDEX_REBUILD_REQUIRED friendly message', () => {
  assert.match(codeWorkspace, /INDEX_REBUILD_REQUIRED/);
  assert.match(codeWorkspace, /当前项目内容尚未准备完成/);
});

function test(name, fn) {
  try {
    fn();
    console.log('✓ ' + name);
  } catch (err) {
    console.error('✗ ' + name);
    console.error(err);
    process.exit(1);
  }
}