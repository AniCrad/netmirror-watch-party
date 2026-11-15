(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (globalThis.__netmirrorParty) return;
  globalThis.__netmirrorParty = true;
  let video = null;
  let config = { active: false };
  let remote = null;
  let clockOffset = 0;
  let buffering = false;
  let blocked = false;
  let applyingUntil = 0;
  let hostStateSent = 0;
  let badge, label, button;
  const events = ['play', 'playing', 'pause', 'seeked', 'ratechange', 'waiting', 'ended', 'loadedmetadata'];
  const message = data => api.runtime.sendMessage(data).catch(() => null);
  function allVideos(root = document) {
    const result = [...root.querySelectorAll('video')];
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) result.push(...allVideos(element.shadowRoot));
    return result;
  }
  function score(v) {
    const rect = v.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 30 || getComputedStyle(v).visibility === 'hidden') return 0;
    return rect.width * rect.height + (!v.paused ? 1000000 : 0) + (Number.isFinite(v.duration) && v.duration > 60 ? 500000 : 0);
  }
  function selectVideo() {
    const candidates = allVideos().filter(v => score(v) > 0).sort((a, b) => score(b) - score(a));
    const next = candidates[0] || null;
    if (next === video) return;
    if (video) for (const event of events) video.removeEventListener(event, onVideoEvent);
    video = next;
    buffering = false;
    blocked = false;
    if (video) for (const event of events) video.addEventListener(event, onVideoEvent);
    if (config.active) { if (config.role === 'host') publish(); else apply(true); }
  }
  function snapshot() {
    return { position: video.currentTime, paused: video.paused || video.ended || buffering,
      rate: video.playbackRate, duration: Number.isFinite(video.duration) ? video.duration : 0 };
  }
  function publish() {
    if (!video || !config.active || config.role !== 'host' || !config.connected || video.readyState < 1) return;
    hostStateSent = Date.now();
    message({ type: 'video-state', state: snapshot() });
  }
  function onVideoEvent(event) {
    if (event.type === 'waiting') buffering = true;
    if (['playing', 'seeked', 'loadedmetadata'].includes(event.type)) buffering = false;
    if (!config.active) return;
    if (config.role === 'host') publish();
    else if (Date.now() > applyingUntil) apply(event.type === 'seeked');
  }
  function renderBadge() {
    if (!config.active || !video) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement('div');
      const shadow = badge.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = ':host{position:fixed!important;bottom:22px!important;left:22px!important;z-index:2147483647!important;font:12px system-ui!important;color:#f5f3ff!important}div{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #a78bfa66;border-radius:12px;background:#171326ee;box-shadow:0 4px 24px #0006}i{width:7px;height:7px;background:#a78bfa;border-radius:50%}button{background:#bca5ff;color:#180d32;border:0;border-radius:7px;padding:6px 9px;font:600 12px system-ui;cursor:pointer}button[hidden]{display:none}';
      const body = document.createElement('div');
      const dot = document.createElement('i');
      label = document.createElement('span');
      button = document.createElement('button');
      button.textContent = 'Click to sync';
      button.addEventListener('click', () => {
        if (!video) return;
        blocked = false;
        // play() must happen synchronously inside a user gesture.
        if (remote && !remote.paused) video.play().then(() => apply(true)).catch(() => { blocked = true; renderBadge(); });
        else apply(true);
      });
      body.append(dot, label, button);
      shadow.append(style, body);
    }
    const container = document.fullscreenElement || document.documentElement;
    if (badge.parentNode !== container) container.append(badge);
    label.textContent = !config.connected ? 'Party reconnecting…' : config.role === 'host' ? 'Watch Party · You’re hosting' :
      !config.hostOnline ? 'Host disconnected · Paused' : !remote ? 'Waiting for the host’s video…' :
      blocked ? 'Click to allow synchronized playback' : differentVideo() ? 'Open the same movie / episode as the host' : 'Watch Party · Following host';
    button.hidden = !blocked;
  }
  function differentVideo() {
    return remote?.duration > 0 && Number.isFinite(video?.duration) && Math.abs(remote.duration - video.duration) > 15;
  }
  function apply(force = false) {
    if (!config.active || config.role !== 'guest' || !video || !remote || !config.connected || video.readyState < 1) return;
    if (differentVideo()) { renderBadge(); return; }
    const elapsed = remote.paused ? 0 : Math.max(0, Date.now() + clockOffset - remote.updatedAt) / 1000;
    let target = remote.position + elapsed * remote.rate;
    if (Number.isFinite(video.duration)) target = Math.min(target, video.duration);
    applyingUntil = Date.now() + 350;
    if (Math.abs(video.currentTime - target) > (force ? 0.05 : 0.8) && !video.seeking) {
      try { video.currentTime = target; } catch {}
    }
    if (video.playbackRate !== remote.rate) video.playbackRate = remote.rate;
    if (remote.paused) { video.pause(); blocked = false; }
    else if (video.paused && !blocked) video.play().catch(() => { blocked = true; renderBadge(); });
    renderBadge();
  }
  function configure(value) {
    const wasActive = config.active;
    const wasConnected = config.connected;
    config = value;
    if (!config.active) { remote = null; blocked = false; }
    if (config.active && (!wasActive || (!wasConnected && config.connected))) {
      if (config.role === 'host') publish();
      else apply(true);
    }
    // A guest stops advancing while its relay connection is unavailable.
    if (config.active && config.role === 'guest' && !config.connected) video?.pause();
    renderBadge();
  }
  api.runtime.onMessage.addListener(message => {
    if (message.type === 'party-config') configure(message);
    if (message.type === 'party-state') {
      remote = message.state;
      clockOffset = message.clockOffset;
      apply(remote.paused);
    }
  });
  document.addEventListener('fullscreenchange', renderBadge);
  let ticks = 0;
  const timer = setInterval(async () => {
    if (!api.runtime?.id) { clearInterval(timer); badge?.remove(); return; }
    if (ticks++ % 4 === 0) {
      selectVideo();
      const response = await message({ type: 'video-report', score: video ? score(video) : 0,
        video: video ? { duration: Number.isFinite(video.duration) ? video.duration : 0, paused: video.paused } : null });
      if (response) configure(response);
    }
    if (config.role === 'guest') apply();
    else if (Date.now() - hostStateSent >= 2000) publish();
  }, 500);
})();
