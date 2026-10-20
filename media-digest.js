(function (root) {
  'use strict';
  // Storage's single-part ETag uses MD5. This only checks local bytes against
  // a freshly authorized server response; it never authenticates an account.
  function md5(buffer) {
    var input = new Uint8Array(buffer), size = Math.ceil((input.length + 9) / 64) * 64;
    var data = new Uint8Array(size); data.set(input); data[input.length] = 128;
    var view = new DataView(data.buffer), bits = input.length * 8;
    view.setUint32(size - 8, bits >>> 0, true); view.setUint32(size - 4, Math.floor(bits / 4294967296), true);
    var shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21], constants = [];
    for (var k = 0; k < 64; k++) constants[k] = (Math.abs(Math.sin(k + 1)) * 4294967296) | 0;
    var state = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476];
    for (var offset = 0; offset < size; offset += 64) {
      var a = state[0], b = state[1], c = state[2], d = state[3];
      for (var i = 0; i < 64; i++) {
        var round = i >>> 4, f, word;
        if (round === 0) { f = (b & c) | (~b & d); word = i; }
        else if (round === 1) { f = (d & b) | (~d & c); word = (5 * i + 1) % 16; }
        else if (round === 2) { f = b ^ c ^ d; word = (3 * i + 5) % 16; }
        else { f = c ^ (b | ~d); word = (7 * i) % 16; }
        var value = (a + f + constants[i] + view.getInt32(offset + word * 4, true)) | 0, shift = shifts[round * 4 + i % 4];
        a = d; d = c; c = b; b = (b + ((value << shift) | (value >>> (32 - shift)))) | 0;
      }
      state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0;
      state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
    }
    return state.map(function (n) { var hex = ''; for (var j = 0; j < 4; j++) hex += ((n >>> (j * 8)) & 255).toString(16).padStart(2, '0'); return hex; }).join('');
  }
  async function matches(blob, etag) {
    var expected = String(etag || '').replace(/^W\//, '').replace(/^"|"$/g, '').toLowerCase();
    var multipart = expected.match(/^([a-f0-9]{32})-([1-9]\d?)$/);
    if (multipart) {
      // S3 multipart ETags hash the concatenated part digests, not the whole
      // file. Try bounded conventional part sizes; an unknown layout safely
      // declines seeding instead of trusting the caller's file.
      var count = Number(multipart[2]);
      var sizes = [5,6,8,10,16,32].map(function (n) { return n * 1024 * 1024; }).concat([5000000,8000000,10000000,16000000]);
      for (var size of sizes) {
        if (Math.ceil(blob.size / size) !== count) continue;
        var digests = new Uint8Array(count * 16);
        for (var part = 0; part < count; part++) {
          var hex = md5(await blob.slice(part * size, Math.min(blob.size, (part + 1) * size)).arrayBuffer());
          for (var j = 0; j < 16; j++) digests[part * 16 + j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
        }
        if (md5(digests.buffer) === multipart[1]) return true;
      }
      return false;
    }
    if (!/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(expected)) return false;
    var buffer = await blob.arrayBuffer();
    if (expected.length === 32) return md5(buffer) === expected;
    if (!root.crypto || !root.crypto.subtle) return false;
    var hash = await root.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash)).map(function (v) { return v.toString(16).padStart(2, '0'); }).join('') === expected;
  }
  root.XtjMediaDigest = { md5: md5, matches: matches };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.XtjMediaDigest;
})(typeof self === 'undefined' ? globalThis : self);
