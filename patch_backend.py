import re

with open('render-api/server.js', 'r', encoding='utf-8') as f:
    server = f.read()

# 2.3 RateLimiter Memory Leak
# Find the setInterval block for rateLimitStore
rateLimitPatch = """const rateLimitStore = new Map();
// ÿ5ڵ¼ֹڴй©
setInterval(function() {
    var now = Date.now();
    rateLimitStore.forEach(function(record, key) {
        if (now > record.resetAt) rateLimitStore.delete(key);
    });
    // Add size limit to prevent OOM
    if (rateLimitStore.size > 10000) {
        let count = 0;
        for (let key of rateLimitStore.keys()) {
            if (count++ > 5000) break;
            rateLimitStore.delete(key);
        }
    }
}, 300000);"""

server = re.sub(
    r'const rateLimitStore = new Map\(\);\s*//.*?\s*setInterval\(function\(\) \{\s*var now = Date\.now\(\);\s*rateLimitStore\.forEach\(function\(record, key\) \{\s*if \(now > record\.resetAt\) rateLimitStore\.delete\(key\);\s*\}\);\s*\}, 300000\);',
    rateLimitPatch,
    server,
    flags=re.DOTALL
)

# 2.1 Global Async Error Catcher
async_error_patch = """
// Monkey patch Express router to catch async errors automatically
const Layer = require('express/lib/router/layer');
const originalHandleRequest = Layer.prototype.handle_request;
Layer.prototype.handle_request = function handle(req, res, next) {
    var fn = this.handle;
    if (fn.length > 3) { return originalHandleRequest.apply(this, arguments); }
    try {
        var ret = originalHandleRequest.apply(this, arguments);
        if (ret && ret.catch) { ret.catch(next); }
    } catch (err) { next(err); }
};
"""
if 'originalHandleRequest' not in server:
    # insert after const express = require('express');
    server = re.sub(
        r"(const express = require\('express'\);)",
        r"\1\n" + async_error_patch,
        server,
        count=1
    )

with open('render-api/server.js', 'w', encoding='utf-8') as f:
    f.write(server)

print("Backend patched")
