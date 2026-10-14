(function (global) {
  'use strict';
  var core = global.XtjAiCore = global.XtjAiCore || {};
  function speechText(value) {
    var fence=null,lines=[];
    String(value||'').split(/\r?\n/).forEach(function(line){
      var marker=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if(fence){if(marker&&marker[1][0]===fence.marker&&marker[1].length>=fence.length&&!marker[2].trim())fence=null;return;}
      if(marker&&(marker[1][0]==='~'||marker[2].indexOf('`')<0)){fence={marker:marker[1][0],length:marker[1].length};lines.push('（代码片段）');return;}
      lines.push(line);
    });
    return lines.join('\n').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '链接').replace(/[*_#`>|]/g, '').trim();
  }
  function create(options) {
    var enabled = false, disposed = false, seq = 0, speechSeq = 0, recognition = null, recorder = null, media = null;
    var decodeAbort = null, recordTimer = null, listening = false, speaking = false, utterance = null;
    var owner = options.owner(), lastTranscript = '', finalTranscript = '', baseText = '';
    function current(token) { return !disposed && seq === token && options.current(owner); }
    function state(label,stage,progress) { options.onState({enabled:enabled,listening:listening,speaking:speaking,stage:stage||(speaking?'speaking':utterance?'speech_wait':listening?'listening':'idle'),progress:progress===undefined?null:progress,label:label || (speaking?'正在朗读，点击麦克风可打断并提问':utterance?'正在准备朗读，点击麦克风可打断':'')}); }
    function releaseMedia() {
      clearTimeout(recordTimer); recordTimer = null;
      if (media) media.getTracks().forEach(function(track) { track.stop(); }); media = null;
    }
    function stopSpeech() {
      speechSeq++;
      speaking = false;
      if (utterance) utterance.onstart = utterance.onend = utterance.onerror = null;
      utterance = null;
      try { if (global.speechSynthesis) global.speechSynthesis.cancel(); } catch (_) {}
      state();
    }
    function cancelInput() {
      seq++; listening = false;
      var rec = recognition; recognition = null;
      if (rec) { rec.onstart = rec.onresult = rec.onerror = rec.onend = null; try { rec.abort(); } catch (_) {} }
      if (recorder) { recorder.ondataavailable = recorder.onstop = recorder.onerror = null; try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) {} recorder = null; }
      if (decodeAbort) decodeAbort.abort(); decodeAbort = null;
      releaseMedia(); state();
    }
    function interrupt() { cancelInput(); stopSpeech(); options.onInterrupt(); }
    function completeInput(token, text, final) {
      if (!current(token)) return;
      listening = false; state();
      if (!text.trim()) { options.notify('没有识别到语音，点击麦克风可重试'); return; }
      options.onTranscript(baseText ? baseText + ' ' + text : text);
      var confirm=typeof options.confirmBeforeSend==='function'&&options.confirmBeforeSend();
      if (enabled && final && !confirm) options.onSend();
      else if (final && confirm) state('文字已识别，请确认或编辑后点击发送','draft');
      else if (enabled) options.notify('语句未识别完整，文字已保留，可手动发送或重新说');
    }
    async function listen() {
      if (disposed || !options.current(owner)) return;
      interrupt();
      var token = seq, SR = global.SpeechRecognition || global.webkitSpeechRecognition;
      baseText = options.draft().replace(/\s+$/, ''); lastTranscript = finalTranscript = '';
      if (SR) {
        try {
          var rec = new SR(); recognition = rec;
          rec.lang = 'zh-CN'; rec.interimResults = true; rec.continuous = false;
          rec.onresult = function(event) {
            if (!current(token) || recognition !== rec) return;
            var text = '', final = '';
            for (var i=0; i<event.results.length; i++) {
              if (!event.results[i] || !event.results[i][0]) continue;
              text += event.results[i][0].transcript;
              if (event.results[i].isFinal) final += event.results[i][0].transcript;
            }
            lastTranscript = text; finalTranscript = final;
            if (text) options.onTranscript(baseText ? baseText + ' ' + text : text);
          };
          rec.onend = function() {
            if (!current(token) || recognition !== rec) return;
            recognition = null; rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
            completeInput(token, finalTranscript || lastTranscript, !!finalTranscript);
          };
          rec.onerror = function(event) {
            if (!current(token) || recognition !== rec) return;
            cancelInput();
            options.notify(event.error === 'not-allowed' ? '请允许麦克风权限后重试' : '语音识别未完成，输入文字仍保留，可重试');
          };
          rec.onstart=function(){if(current(token)&&recognition===rec)state('正在聆听…','listening');};
          rec.start(); listening = true; state('正在等待麦克风权限…','permission');
        } catch (_) { cancelInput(); options.notify('系统语音识别无法启动，请重试或使用文字'); }
        return;
      }
      if (!global.navigator.mediaDevices || !global.navigator.mediaDevices.getUserMedia || !global.MediaRecorder || !global.XTJVoiceTranscription?.transcribeBlob) {
        options.notify('当前浏览器无法录音转写，请使用文字输入'); return;
      }
      listening = true; state('正在申请麦克风权限…','permission');
      try {
        var stream = await global.navigator.mediaDevices.getUserMedia({audio:true});
        if (!current(token)) { stream.getTracks().forEach(function(track) { track.stop(); }); return; }
        media = stream;
        var types = ['audio/webm;codecs=opus','audio/mp4','audio/webm'];
        var mime = types.find(function(type) { return global.MediaRecorder.isTypeSupported && global.MediaRecorder.isTypeSupported(type); });
        var capture = new global.MediaRecorder(stream,mime ? {mimeType:mime} : {}); recorder = capture;
        var chunks = [], size = 0;
        capture.ondataavailable = function(event) {
          if (!current(token) || !event.data || !event.data.size) return;
          size += event.data.size;
          if (size > 24*1024*1024) { cancelInput(); options.notify('录音过大，请缩短后重试'); return; }
          chunks.push(event.data);
        };
        capture.onerror = function() { if (current(token)) { cancelInput(); options.notify('录音失败，请检查麦克风后重试'); } };
        capture.onstop = async function() {
          if (!current(token)) return;
          releaseMedia();
          recorder = null; listening = false;
          var blob = new Blob(chunks,{type:capture.mimeType || mime || 'audio/webm'}); chunks = [];
          if (!blob.size) { state(); options.notify('未录到声音，请重试'); return; }
          decodeAbort = new AbortController(); state('准备本地语音识别…','initializing');
          try {
            var text = await global.XTJVoiceTranscription.transcribeBlob(blob,{owner:owner.user,signal:decodeAbort.signal,onState:function(job) { if (current(token)) state(job.label,job.phase||'recognition',job.progress); }});
            if (!current(token)) return;
            decodeAbort = null; completeInput(token,text,true);
          } catch (_) { if (current(token)) { decodeAbort = null; state(); options.notify('本地转写失败，可重新录音；文字草稿仍保留'); } }
        };
        capture.start(250); state('正在录音，点击麦克风结束（最长 90 秒）','recording');
        recordTimer = setTimeout(function() { if (current(token) && capture.state === 'recording') capture.stop(); },90000);
      } catch (_) { if (current(token)) { cancelInput(); options.notify('无法使用麦克风，请检查权限后重试'); } }
    }
    function toggleListening() {
      if (disposed || !options.current(owner)) return;
      if (listening) {
        if (recognition) { try { recognition.stop(); } catch (_) { cancelInput(); } }
        else if (recorder) { try { if (recorder.state === 'recording') recorder.stop(); } catch (_) { cancelInput(); } }
        else cancelInput(); // A second click cancels pending permission, not a new request.
        return;
      }
      if (decodeAbort) { cancelInput(); return; }
      void listen();
    }
    function speak(value, autoContinue) {
      cancelInput(); stopSpeech();
      if (!options.current(owner)) return;
      if (!global.speechSynthesis || !global.SpeechSynthesisUtterance) { options.notify('当前浏览器不支持朗读，仍可使用语音输入'); return; }
      var text = speechText(value);
      if (!text) return;
      if (text.length > 50000) { text = text.slice(0,50000); options.notify('回复较长，本次朗读前 5 万字'); }
      var parts = text.match(/[\s\S]{1,220}(?:[。！？\n]|$)|[\s\S]{1,220}/g) || [text];
      var speechToken = speechSeq, index = 0;
      function speechCurrent(){return !disposed&&speechToken===speechSeq&&options.current(owner);}
      function next() {
        if (!speechCurrent()) return;
        if (index >= parts.length) { speaking = false; utterance = null; state(); if (enabled && autoContinue) void listen(); return; }
        var speech = new global.SpeechSynthesisUtterance(parts[index++]); utterance = speech;
        speech.lang = 'zh-CN'; speech.rate = 1;
        var voices = global.speechSynthesis.getVoices();
        var voice = voices.find(function(item) { return /^zh/i.test(item.lang) && item.localService; }) || voices.find(function(item) { return /^zh/i.test(item.lang); });
        if (voice) speech.voice = voice;
        speech.onend = next;
        speech.onerror = function() { if (speechCurrent()) { stopSpeech(); options.notify('浏览器暂停了朗读，点击回复下的“朗读”可重试'); } };
        speech.onstart=function(){if(speechCurrent()){speaking=true;state('正在朗读，点击麦克风可打断并提问','speaking');}};
        speaking = false; state('正在准备朗读，点击麦克风可打断','speech_wait');
        try { global.speechSynthesis.speak(speech); }
        catch (_) { stopSpeech(); options.notify('朗读暂时无法启动，点击回复下的“朗读”可重试'); }
      }
      next();
    }
    function setEnabled(value) {
      enabled = !!value; cancelInput(); stopSpeech(); state();
      if (enabled) { options.notify('语音对话已开启：完整识别后发送，回复朗读完会继续聆听'); void listen(); }
    }
    function suspend() { enabled = false; cancelInput(); stopSpeech(); }
    function visibility() { if (global.document.hidden) suspend(); }
    function identityChanged() { if (!options.current(owner)) suspend(); }
    global.document.addEventListener('visibilitychange',visibility);
    global.addEventListener('pagehide',suspend);
    global.addEventListener('xtj:auth-changed',identityChanged);
    return {listen:toggleListening,cancelInput:cancelInput,speak:speak,stopSpeech:stopSpeech,setEnabled:setEnabled,
      reply:function(text) { if (enabled) speak(text,true); },
      isEnabled:function() { return enabled; }, isSpeaking:function() { return speaking || !!utterance; },
      dispose:function() { suspend(); disposed = true; global.document.removeEventListener('visibilitychange',visibility); global.removeEventListener('pagehide',suspend); global.removeEventListener('xtj:auth-changed',identityChanged); }};
  }
  core.VoiceConversation = {create:create,speechText:speechText};
}(window));
