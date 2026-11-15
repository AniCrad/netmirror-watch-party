const extensionOrigin = /^(?:chrome-extension:\/\/[a-p]{32}|safari-web-extension:\/\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

export const isExtensionOrigin = origin => !origin || extensionOrigin.test(origin);

export const validRoomCode = value => typeof value === 'string' && /^[A-HJ-NP-Z2-9]{8}$/i.test(value);
export const validMemberToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);

export function projectedPosition(state, now = Date.now()) {
  const value = state.position + (state.paused ? 0 : Math.max(0, now - state.updatedAt) / 1000 * state.rate);
  return state.duration > 0 ? Math.min(value, state.duration) : value;
}
export function validState(value) {
  return value && typeof value.paused === 'boolean' &&
    Number.isFinite(value.position) && value.position >= 0 && value.position <= 604800 &&
    Number.isFinite(value.rate) && value.rate >= 0.25 && value.rate <= 4 &&
    Number.isFinite(value.duration) && value.duration >= 0 && value.duration <= 604800 &&
    (value.duration === 0 || value.position <= value.duration + 1);
}
