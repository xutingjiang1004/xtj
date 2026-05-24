var fs = require('fs');
var html = fs.readFileSync('index.html', 'utf8');
var count = 0;
var r = html;

// safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {})
r = r.replace(/safeLocalStorageGetJSON\(AVATAR_CACHE_KEY,\s*\{\}\)/g, function(m) {
    count++;
    return "JSON.parse(localStorage.getItem(AVATAR_CACHE_KEY) || '{}')";
});

// safeLocalStorageSetJSON(AVATAR_CACHE_KEY, cv)
r = r.replace(/safeLocalStorageSetJSON\(AVATAR_CACHE_KEY,\s*cv\)/g, function(m) {
    count++;
    return "localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cv))";
});

// safeLocalStorageSetJSON(AVATAR_CACHE_KEY, cachedAvatars)
r = r.replace(/safeLocalStorageSetJSON\(AVATAR_CACHE_KEY,\s*cachedAvatars\)/g, function(m) {
    count++;
    return "localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cachedAvatars))";
});

// safeLocalStorageRemove(CACHE_KEY)
r = r.replace(/safeLocalStorageRemove\(CACHE_KEY\)/g, function(m) {
    count++;
    return "localStorage.removeItem(CACHE_KEY)";
});

// safeLocalStorageRemove("xtj_user")
r = r.replace(/safeLocalStorageRemove\(["']xtj_user["']\)/g, function(m) {
    count++;
    return 'localStorage.removeItem("xtj_user")';
});

// safeLocalStorageGetJSON(VIEW_HISTORY_KEY, [])
r = r.replace(/safeLocalStorageGetJSON\(VIEW_HISTORY_KEY,\s*\[\]\)/g, function(m) {
    count++;
    return "JSON.parse(localStorage.getItem(VIEW_HISTORY_KEY) || '[]')";
});

// safeLocalStorageSetJSON(VIEW_HISTORY_KEY, history)
r = r.replace(/safeLocalStorageSetJSON\(VIEW_HISTORY_KEY,\s*history\)/g, function(m) {
    count++;
    return "localStorage.setItem(VIEW_HISTORY_KEY, JSON.stringify(history))";
});

fs.writeFileSync('index.html', r, 'utf8');
console.log('Replaced ' + count + ' occurrences');