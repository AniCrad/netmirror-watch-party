(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.runtime?.sendMessage || !api?.storage?.local || !api?.tabs?.query) {
    const error = document.getElementById('error');
    error.textContent = 'Open Watch Party from an installed browser extension. Opening the popup as a webpage cannot join a party.';
    error.hidden = false;
    for (const control of document.querySelectorAll('button, input')) control.disabled = true;
    return;
  }
  const $ = id => document.getElementById(id);
  let action = 'create';
  let party = null;
  let busy = false;
  async function call(message) {
    let timer;
    try {
      const result = await Promise.race([
        api.runtime.sendMessage(message),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('The extension is not responding. Reload the extension and try again.')), 15000);
        }),
      ]);
      if (!result || typeof result !== 'object') throw new Error('The extension could not respond. Reload the extension and try again.');
      return result;
    } finally { clearTimeout(timer); }
  }
  function showError(value = '') { $('error').textContent = value; $('error').hidden = !value; }
  function mode(value) {
    action = value;
    $('host-tab').setAttribute('aria-selected', String(value === 'create'));
    $('join-tab').setAttribute('aria-selected', String(value === 'join'));
    $('code-field').hidden = value === 'create';
    $('code').required = value === 'join';
    $('start').textContent = value === 'create' ? 'Create a party ↗' : 'Join the party ↗';
    showError();
  }
  $('host-tab').addEventListener('click', () => mode('create'));
  $('join-tab').addEventListener('click', () => mode('join'));
  api.storage.local.get('server').then(({ server }) => { $('server').value = server || 'ws://localhost:8787'; }).catch(error => showError(error.message));
  $('party-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    $('start').disabled = true;
    showError();
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      const result = await call({ type: 'ui-start', tabId: tab.id, action, code: $('code').value, server: $('server').value.trim() });
      if (result.error) showError(result.error);
      await refresh();
    } catch (error) { showError(error.message); }
    finally { busy = false; $('start').disabled = false; }
  });
  async function refresh() {
    const result = await call({ type: 'ui-status' });
    if (result.error && !('party' in result)) throw new Error(result.error);
    party = result.party;
    $('setup').hidden = Boolean(party);
    $('party').hidden = !party;
    if (result.error || result.connection === 'connected') showError(result.error || '');
    if (!party) return;
    $('connection').textContent = ({ connected: 'Party is live', connecting: 'Connecting to relay…', reconnecting: 'Reconnecting…' })[result.connection] || result.connection;
    $('connection-dot').className = result.connection === 'connected' ? 'connected' : '';
    $('members').textContent = `${result.members} ${result.members === 1 ? 'person' : 'people'}`;
    $('party-code').textContent = party.code || '········';
    $('copy').disabled = !party.code;
    $('role-help').textContent = party.role === 'host' ? 'You control playback. Your friends follow along.' : 'Open the same movie or episode. The host controls playback.';
    $('leave').textContent = party.role === 'host' ? 'End party for everyone' : 'Leave party';
    $('video-title').textContent = result.video ? 'Video detected' : 'Looking for your video…';
    $('video-help').textContent = !result.video ? 'Start the player, or enable embedded player access below.' :
      party.role === 'guest' && !result.hostOnline ? 'Waiting for the host to reconnect.' :
      party.role === 'host' ? 'Play, pause, or seek. Everyone stays with you.' : 'If playback is blocked, click “Click to sync” on the video.';
  }
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(party.code); $('copy-label').textContent = 'Copied! Share the relay address too.'; }
    catch { $('copy-label').textContent = 'Select and copy the code above.'; }
  });
  $('leave').addEventListener('click', async () => { await call({ type: 'ui-leave' }); showError(); await refresh(); });
  $('focus').addEventListener('click', async () => {
    if (!party) return;
    const tab = await api.tabs.update(party.tabId, { active: true });
    await api.windows.update(tab.windowId, { focused: true });
  });
  $('enable').addEventListener('click', async () => {
    try {
      const [active] = await api.tabs.query({ active: true, currentWindow: true });
      const tabId = party?.tabId ?? active.id;
      const frames = await api.webNavigation.getAllFrames({ tabId }) || [];
      const origins = [...new Set(frames.map(frame => {
        try { const url = new URL(frame.url); return ['https:', 'http:'].includes(url.protocol) ? `${url.origin}/*` : null; }
        catch { return null; }
      }).filter(Boolean))];
      if (!origins.length) throw new Error('Open the NetMirror video player first.');
      const allowed = await api.permissions.request({ origins });
      if (allowed) {
        await call({ type: 'ui-inject', tabId });
        $('permission-status').textContent = 'Player access enabled. If needed, reload the page and start the video.';
      } else $('permission-status').textContent = 'Player access was not granted.';
    } catch (error) { showError(error.message); }
  });
  refresh().catch(error => showError(error.message));
  setInterval(() => refresh().catch(() => {}), 1000);
})();
