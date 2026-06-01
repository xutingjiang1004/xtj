import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

const args = {};
const argList = process.argv.slice(2);
for (let i = 0; i < argList.length; i++) {
  if (argList[i].startsWith('--')) {
    const key = argList[i].slice(2);
    const val = argList[i + 1] && !argList[i + 1].startsWith('--') ? argList[i + 1] : true;
    args[key] = val;
    if (val !== true) i++;
  }
}

const sessionId = args.session || 'default';
const portStart = parseInt(args.port || '7777', 10);
const outdir = args.outdir || '.dbg';
const clean = args.clean === 'true' || args.clean === true;
const idleMs = parseInt(args.idle || '0', 10) * 1000;
const remote = args.remote === 'true' || args.remote === true;

const host = remote ? '0.0.0.0' : '127.0.0.1';
const logFile = path.resolve(outdir, `trae-debug-log-${sessionId}.ndjson`);
const envFile = path.resolve(outdir, `${sessionId}.env`);

// Ensure outdir exists
try { fs.mkdirSync(outdir, { recursive: true }); } catch (e) {}

// Clean mode
if (clean) {
  try { fs.writeFileSync(logFile, ''); } catch (e) {}
}

let logCount = 0;
let lastEventTime = Date.now();

function appendLog(event) {
  if (!event.ts) event.ts = Date.now();
  const line = JSON.stringify(event) + '\n';
  fs.appendFileSync(logFile, line, 'utf8');
  logCount++;
  lastEventTime = Date.now();
}

function getLogs(lastN) {
  if (!fs.existsSync(logFile)) return [];
  const content = fs.readFileSync(logFile, 'utf8').trim();
  if (!content) return [];
  const lines = content.split('\n');
  const relevant = lastN ? lines.slice(-lastN) : lines;
  return relevant.map(l => JSON.parse(l));
}

function deleteLogs() {
  try { fs.writeFileSync(logFile, ''); return true; } catch (e) { return false; }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === 'POST' && url.pathname === '/event') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const event = JSON.parse(body);
        event.sessionId = sessionId;
        appendLog(event);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      logCount,
      sessionId
    }));
    return;
  }

  if (method === 'GET' && url.pathname === '/logs') {
    const lastParam = url.searchParams.get('last');
    const lastN = lastParam ? parseInt(lastParam, 10) : null;
    const logs = getLogs(lastN);
    // Filter by hypothesisId if provided
    const hypothesisId = url.searchParams.get('hypothesisId');
    const filtered = hypothesisId ? logs.filter(l => l.hypothesisId === hypothesisId) : logs;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(filtered));
    return;
  }

  if (method === 'DELETE' && url.pathname === '/logs') {
    const ok = deleteLogs();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

function findPort(port, cb) {
  const tryPort = (p, attempt) => {
    if (attempt > 10) {
      console.error('Could not find available port');
      process.exit(1);
    }
    const s = server.listen(p, host);
    s.on('listening', () => cb(p));
    s.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        tryPort(p + 1, attempt + 1);
      } else {
        throw err;
      }
    });
  };
  tryPort(port, 0);
}

findPort(portStart, (actualPort) => {
  // Write env file
  const apiUrl = `http://127.0.0.1:${actualPort}/event`;
  const envContent = `DEBUG_SERVER_URL=${apiUrl}\nDEBUG_SESSION_ID=${sessionId}\n`;
  fs.writeFileSync(envFile, envContent, 'utf8');

  console.log(`Debug server started on port ${actualPort}`);
  console.log(`Log file: ${logFile}`);
  console.log(`Env file: ${envFile}`);
  console.log(`@@DEBUG_SERVER_INFO`);
  console.log(JSON.stringify({
    api_url: apiUrl,
    session_id: sessionId,
    log_dir: path.resolve(outdir),
    log_file: logFile,
    env_file: envFile,
    port: actualPort
  }));
  console.log(`@@END_DEBUG_SERVER_INFO`);

  // Idle timeout
  if (idleMs > 0) {
    setInterval(() => {
      if (Date.now() - lastEventTime > idleMs) {
        console.log(`Idle timeout (${idleMs / 1000}s) reached, exiting...`);
        server.close(() => process.exit(0));
      }
    }, 60000);
  }
});
