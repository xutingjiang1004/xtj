(function () {
    'use strict';
    var scriptUrl = document.currentScript.src;
    var jobs = new Map(), queue = [], active = null, worker = null, owner = '', generation = 0;
    var preferredModel=window.navigator&&window.navigator.hardwareConcurrency<4?'tiny':'base';
    var MAX_BYTES = 24 * 1024 * 1024;
    function sameUser(job) { return job.generation === generation && String(window.currentUser || '') === job.owner; }
    function notify(job, state, label) {
        job.state = state; job.label = label;
        if (sameUser(job) && job.onState) job.onState(job);
    }
    function reset() {
        generation++;
        jobs.forEach(function (job) { if (job.downloadAbort) job.downloadAbort.abort(); });
        if (worker) worker.terminate();
        worker = null;
        if (active && active.cancel) active.cancel();
        active = null; queue = []; jobs.clear();
    }
    async function request(path, init) {
        if (typeof window.xtjProtectedFetch !== 'function') throw new Error('登录状态不可用');
        var response = await window.xtjProtectedFetch(path, Object.assign({ timeoutMs: 30000, background: true }, init));
        var value = await response.json();
        if (!response.ok || !value.ok) throw new Error(value.error || '请求失败，请重试');
        return value;
    }
    async function audioSamples(job) {
        var file = job.file;
        if (!file) {
            var signed = await request('/api/chat/voice-url?peer=' + encodeURIComponent(job.peer) + '&message_id=' + encodeURIComponent(job.id));
            if (!sameUser(job)) throw new Error('账号已切换');
            var abort = new AbortController();
            job.downloadAbort = abort;
            var timeout = setTimeout(function () { abort.abort(); }, 45000);
            try {
                var response = await fetch(signed.url, { signal: abort.signal, credentials: 'omit' });
                if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('语音无法下载');
                file = await response.blob();
            } finally { clearTimeout(timeout); job.downloadAbort = null; }
        }
        if (!sameUser(job) || !file || file.size > MAX_BYTES) throw new Error('语音不可用');
        var Audio = window.AudioContext || window.webkitAudioContext;
        var Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Audio || !Offline) throw new Error('当前浏览器不支持语音识别，请升级浏览器');
        var context = new Audio();
        var decoded;
        try {
            var bytes = await file.arrayBuffer();
            if (!sameUser(job)) throw new Error('识别已取消');
            decoded = await context.decodeAudioData(bytes);
        }
        finally { try { await context.close(); } catch (_) {} }
        if (!sameUser(job)) throw new Error('识别已取消');
        if (!decoded.duration || decoded.duration > 180) throw new Error('暂时支持 3 分钟以内的语音');
        var offline = new Offline(1, Math.ceil(decoded.duration * 16000), 16000);
        var source = offline.createBufferSource();
        source.buffer = decoded; source.connect(offline.destination); source.start();
        var rendered = await offline.startRendering();
        if (!sameUser(job)) throw new Error('识别已取消');
        return rendered.getChannelData(0).slice();
    }
    function recognize(job, samples) {
        if (!worker) {
            var url = new URL('voice-transcription-worker.mjs', scriptUrl);
            url.search = new URL(scriptUrl).search;
            worker = new Worker(url, { type: 'module' });
        }
        return new Promise(function (resolve, reject) {
            var currentWorker = worker;
            var timer = setTimeout(function () { fail(new Error('识别超时，请检查网络后重试')); }, 300000);
            function cleanup() { clearTimeout(timer); currentWorker.onmessage = null; currentWorker.onerror = null; job.cancel = null; }
            function fail(error) { cleanup(); currentWorker.terminate(); if (worker === currentWorker) worker = null; reject(error); }
            job.cancel = function () { fail(new Error('识别已取消')); };
            currentWorker.onerror = function () { var error=new Error('语音模型无法启动，请升级浏览器或检查网络后重试');error.fallbackModel=preferredModel==='base'?'tiny':null;fail(error); };
            currentWorker.onmessage = function (event) {
                var data = event.data;
                if (!data || data.id !== job.key) return;
                if (data.type === 'progress') {
                    var label = data.phase === 'initializing' ? '正在准备语音模型…' : data.downloading ? '首次下载语音模型' + (data.progress === null ? '…' : ' ' + data.progress + '%') : '正在识别语音…';
                    notify(job, 'working', label);
                } else if (data.type === 'result') { cleanup(); resolve(String(data.text || '').trim()); }
                else if (data.type === 'error') { var error=new Error(data.error);error.cacheReset=data.cacheReset===true;error.fallbackModel=data.fallbackModel;fail(error); }
            };
            currentWorker.postMessage({ type: 'transcribe', id: job.key, audio: samples, model:preferredModel }, [samples.buffer]);
        });
    }
    async function run() {
        if (active || !queue.length) return;
        var job = queue.shift(); active = job;
        try {
            if (!sameUser(job)) return;
            if (!job.text) {
                notify(job, 'working', '准备识别语音…');
                var samples = await audioSamples(job);
                if (!sameUser(job)) return;
                try { job.text = await recognize(job, samples); }
                catch(error){
                    if((!error.cacheReset&&!error.fallbackModel)||job.modelRepairTried||!sameUser(job))throw error;
                    job.modelRepairTried=true;if(error.fallbackModel==='tiny')preferredModel='tiny';notify(job,'working','正在重新准备语音模型…');
                    var retrySamples=await audioSamples(job);
                    if(!sameUser(job))return;
                    job.text=await recognize(job,retrySamples);
                }
                if (!job.text) throw new Error('未识别到清晰语音，可以重新转写');
            }
            if (!sameUser(job)) return;
            var message = null;
            if (job.sent) {
                notify(job, 'working', '正在保存文字…');
                var result = await request('/api/chat/messages/transcript', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ peer: job.peer, message_id: job.id, text: job.text }) });
                message = result.message;
            }
            if (!sameUser(job)) return;
            notify(job, 'done', '');
            if (job.onResult) job.onResult(job.text, message);
            job.file = null;
        } catch (error) {
            notify(job, 'error', String(error.message || '转写失败，请重试'));
        } finally {
            if (active === job) { active = null; setTimeout(run, 0); }
        }
    }
    function enqueue(options) {
        if (!options.owner || options.owner !== String(window.currentUser || '')) return;
        if (owner !== options.owner) { reset(); owner = options.owner; }
        var key = options.owner + '\n' + options.peer + '\n' + options.id;
        var existing = jobs.get(key);
        if (existing) {
            existing.onState = options.onState; existing.onResult = options.onResult;
            if (options.file) existing.file = options.file;
            if (existing.onState) existing.onState(existing);
            if (existing.state === 'done' && existing.onResult) setTimeout(function () {
                if (sameUser(existing)) existing.onResult(existing.text, null);
            }, 0);
            return;
        }
        // Bound queued decoding and model work even for very large histories.
        if (queue.length >= 40) return;
        if (jobs.size >= 300) {
            for (var entry of jobs) { if (entry[1].state === 'done') { jobs.delete(entry[0]); break; } }
            if (jobs.size >= 300) return;
        }
        var job = Object.assign({}, options, { key: key, generation: generation, state: 'queued', text: '', label: '等待语音转写…' });
        jobs.set(key, job);
        if (options.file) queue.unshift(job); else queue.push(job);
        notify(job, 'queued', job.label); void run();
    }
    function retry(peer, id) {
        var job = jobs.get(String(window.currentUser || '') + '\n' + peer + '\n' + id);
        if (!job || job.state !== 'error') return;
        notify(job, 'queued', '等待重新转写…'); queue.push(job); void run();
    }
    // Logout must release the model and discard private in-memory jobs.
    window.addEventListener('xtj:auth-changed', reset);
    window.addEventListener('pagehide', reset);
    window.XTJVoiceTranscription = { enqueue: enqueue, retry: retry, reset: reset };
}());
