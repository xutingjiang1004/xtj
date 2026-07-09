// 检查emoji乱码对应的原始字符
const samples = [
  { mojibake: '暂无释义', expected: '暂无释义' },
  { mojibake: '选择', expected: '选择' },
  { mojibake: '删除', expected: '删除' },
  { mojibake: '🐾', expected: 'emoji?' },
  { mojibake: '🔍', expected: '🔍?' },
  { mojibake: '📄', expected: '📎?' },
  { mojibake: '登录', expected: '登录' },
  { mojibake: '生成练习', expected: '生成练习' },
  { mojibake: '请先登录后再生成练习', expected: '请先登录后再生成练习' },
  { mojibake: '暂时没有回应', expected: '暂时没有回应' },
  { mojibake: '暂无聊天记录', expected: '暂无聊天记录' },
];

for (const s of samples) {
  const bytes = Buffer.from(s.mojibake, 'utf-8');
  console.log(`\n=== ${s.mojibake} (期望: ${s.expected}) ===`);
  console.log(`bytes (${bytes.length}): ${bytes.toString('hex')}`);
  // 尝试不同解码路径
  // 路径A: 字节直接当GBK解码
  try { console.log('as GBK:', bytes.toString('gbk')); } catch(e) { console.log('as GBK: ERR'); }
  // 路径B: 字节当latin1 -> 再UTF-8（双重utf-8）
  try {
    const latin1 = bytes.toString('latin1');
    const reEncoded = Buffer.from(latin1, 'utf-8');
    console.log('latin1->utf8:', reEncoded.toString('utf-8'));
  } catch(e) { console.log('latin1->utf8: ERR'); }
}

// 反过来：把期望的中文编码为UTF-8，看字节是什么
console.log('\n\n=== 反过来：正确中文 -> 字节 -> 当GBK读 ===');
for (const s of samples) {
  if (s.expected.includes('?')) continue;
  const b = Buffer.from(s.expected, 'utf-8');
  console.log(`${s.expected} -> UTF8 hex: ${b.toString('hex')}, as GBK: ${b.toString('gbk')}`);
}
