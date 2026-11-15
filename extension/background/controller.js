import { serverAddress } from './validation.js';

// Browser APIs and timers are injected so the worker can be tested without a browser.
export function createBackground(api, {
  WebSocket = globalThis.WebSocket,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
} = {}) {
  // Older Safari releases lack session storage. Keep credentials in memory there.
  const sessionStorage = api.storage.session;
  let socket = null;
  let session = null;
  let connecting = false;
  let retryTimer;
  let retryCount = 0;
  let clockOffset = 0;
  let bestRtt = Infinity;
  let lastState = null;
  let frames = new Map();
  let selectedFrame = null;
  let status = { connection: 'idle', members: 0, hostOnline: false, video: null, error: '' };
  const ready = (sessionStorage ? sessionStorage.get('party') : Promise.resolve({})).then(result => {
    session = result.party || null;
    if (session) connect();
  });
  const persist = () => session ? sessionStorage?.set({ party: session }) : sessionStorage?.remove('party');
  function send(message) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
  async function tellFrame(frameId, message) {
    if (!session) return;
    try { await api.tabs.sendMessage(session.tabId, message, { frameId }); } catch {}
  }
  function configFrames() {
    for (const frameId of frames.keys()) tellFrame(frameId, {
      type: 'party-config', active: frameId === selectedFrame, role: session?.role,
      connected: status.connection === 'connected', hostOnline: status.hostOnline,
    });
  }
  function applyState() {
    if (session?.role === 'guest' && selectedFrame !== null && lastState) {
      tellFrame(selectedFrame, { type: 'party-state', state: lastState, clockOffset });
    }
  }
  function chooseFrame() {
    const now = Date.now();
    for (const [id, frame] of frames) if (now - frame.seen > 7000) frames.delete(id);
    const candidates = [...frames].filter(([, frame]) => frame.video);
    candidates.sort((a, b) => b[1].score - a[1].score);
    const next = candidates[0]?.[0] ?? null;
    status.video = next === null ? null : frames.get(next).video;
    if (next !== selectedFrame) {
      selectedFrame = next;
      configFrames();
      applyState();
    }
  }
  async function inject(tabId) {
    const list = await api.webNavigation.getAllFrames({ tabId }).catch(() => []) || [];
    for (const frame of list) {
      try {
        const url = new URL(frame.url);
        if (!['https:', 'http:'].includes(url.protocol)) continue;
        if (!await api.permissions.contains({ origins: [`${url.origin}/*`] })) continue;
        await api.scripting.executeScript({ target: { tabId, frameIds: [frame.frameId] }, files: ['content/index.js'] });
      } catch {}
    }
  }
  function connect() {
    if (!session || connecting || socket?.readyState === WebSocket.OPEN) return;
    connecting = true;
    status.connection = 'connecting';
    status.error = '';
    const ws = new WebSocket(session.server);
    socket = ws;
    bestRtt = Infinity;
    let heartbeatDeadline;
    const armHeartbeat = () => {
      clearTimeout(heartbeatDeadline);
      heartbeatDeadline = setTimeout(() => ws.close(), 35000);
    };
    const timeout = setTimeout(() => {
      if (socket === ws && status.connection !== 'connected') ws.close();
    }, 10000);
    ws.onopen = () => {
      if (socket !== ws) return;
      armHeartbeat();
      send(session.token ? { type: 'resume', code: session.code, token: session.token } :
        { type: session.action, code: session.code });
      send({ type: 'ping', sentAt: Date.now() });
    };
    ws.onmessage = async event => {
      if (socket !== ws) return;
      armHeartbeat();
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'welcome') {
        clearTimeout(timeout);
        connecting = false;
        retryCount = 0;
        session = { ...session, code: message.code, token: message.token, role: message.role };
        clockOffset = message.serverTime - Date.now();
        await persist();
        if (socket !== ws || !session) return;
        status.connection = 'connected';
        status.error = '';
        lastState = message.state;
        configFrames();
        applyState();
        await inject(session.tabId);
      } else if (message.type === 'state') {
        lastState = message.state;
        applyState();
      } else if (message.type === 'presence') {
        status.members = message.members;
        status.hostOnline = message.hostOnline;
        configFrames();
      } else if (message.type === 'heartbeat') {
        send({ type: 'ping', sentAt: Date.now() });
        chooseFrame();
      } else if (message.type === 'pong') {
        const rtt = Date.now() - message.sentAt;
        if (rtt >= 0 && rtt < bestRtt) {
          bestRtt = rtt;
          clockOffset = message.serverTime - (message.sentAt + rtt / 2);
          applyState();
        }
      } else if (message.type === 'error' || message.type === 'ended') {
        await stop(false, message.message);
      }
    };
    ws.onerror = () => { if (socket === ws) status.error = 'Cannot reach the relay. Check its address and make sure it is running.'; };
    ws.onclose = () => {
      clearTimeout(timeout);
      clearTimeout(heartbeatDeadline);
      if (socket !== ws) return;
      socket = null;
      connecting = false;
      if (!session) return;
      status.connection = 'reconnecting';
      status.hostOnline = false;
      configFrames();
      const delay = Math.min(1000 * 2 ** retryCount++, 10000);
      retryTimer = setTimeout(connect, delay);
    };
  }
  async function stop(notify = true, error = '') {
    clearTimeout(retryTimer);
    if (notify) send({ type: 'leave' });
    for (const frameId of frames.keys()) await tellFrame(frameId, { type: 'party-config', active: false });
    const old = socket;
    socket = null;
    old?.close();
    session = null;
    connecting = false;
    selectedFrame = null;
    lastState = null;
    frames.clear();
    status = { connection: 'idle', members: 0, hostOnline: false, video: null, error };
    await persist();
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    (async () => {
      await ready;
      if (message.type === 'video-report') {
        if (!session || sender.tab?.id !== session.tabId) return { active: false };
        frames.set(sender.frameId, { video: message.video, score: message.score, seen: Date.now() });
        chooseFrame();
        return { active: selectedFrame === sender.frameId, role: session.role,
          connected: status.connection === 'connected', hostOnline: status.hostOnline };
      }
      if (message.type === 'video-state') {
        if (sender.tab?.id === session?.tabId && sender.frameId === selectedFrame && session.role === 'host') {
          send({ type: 'state', state: message.state });
        }
        return {};
      }
      // UI operations are accepted only from extension pages, never a content script.
      if (sender.tab || !sender.url?.startsWith(api.runtime.getURL(''))) return {};
      if (message.type === 'ui-status') {
        chooseFrame();
        return { ...status, party: session ? { code: session.code, role: session.role, tabId: session.tabId, server: session.server } : null };
      }
      if (message.type === 'ui-start') {
        if (session) throw new Error('Leave your current party first.');
        const tab = await api.tabs.get(message.tabId);
        const url = new URL(tab.url);
        if (url.protocol !== 'https:' || !(url.hostname === 'net77.cc' || url.hostname.endsWith('.net77.cc'))) {
          throw new Error('Open a video on net77.cc, then open this extension again.');
        }
        if (!['create', 'join'].includes(message.action)) throw new Error('Invalid party action.');
        const code = String(message.code || '').trim().toUpperCase();
        if (message.action === 'join' && !/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new Error('Enter the 8-character party code.');
        const server = serverAddress(message.server);
        session = { tabId: tab.id, server, action: message.action, code, role: message.action === 'create' ? 'host' : 'guest' };
        await api.storage.local.set({ server });
        await persist();
        connect();
        await inject(tab.id);
        return { ok: true };
      }
      if (message.type === 'ui-leave') { await stop(); return { ok: true }; }
      if (message.type === 'ui-inject') { await inject(message.tabId); return { ok: true }; }
      return {};
    })().then(respond, error => respond({ error: error.message }));
    return true;
  });
  api.tabs.onRemoved.addListener(async tabId => { await ready; if (session?.tabId === tabId) await stop(); });
  api.webNavigation.onCommitted.addListener(async details => {
    await ready;
    if (details.tabId !== session?.tabId) return;
    if (details.frameId === 0) { frames.clear(); selectedFrame = null; status.video = null; }
    else frames.delete(details.frameId);
  });
  api.webNavigation.onCompleted.addListener(async details => {
    await ready;
    if (details.tabId === session?.tabId) await inject(details.tabId);
  });
  api.alarms.create('party-reconnect', { periodInMinutes: 1 });
  api.alarms.onAlarm.addListener(async () => { await ready; if (session && !socket) connect(); });
  return { ready };
}
