export function serverAddress(value) {
  const url = new URL(value);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use a relay address like ws://localhost:8787 or wss://party.example.com (without a path).');
  }
  return url.href;
}
