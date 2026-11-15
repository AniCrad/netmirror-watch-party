function integer(env, name, fallback, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}.`);
  }
  return value;
}

export function readConfig(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: integer(env, 'PORT', 8787, 65535),
    maxRooms: integer(env, 'MAX_ROOMS', 1000, 100000),
    maxMembers: integer(env, 'MAX_MEMBERS', 16, 100),
    maxConnections: integer(env, 'MAX_CONNECTIONS', 2000, 100000),
  };
}
