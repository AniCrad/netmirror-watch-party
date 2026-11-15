import { randomBytes } from 'node:crypto';
import { projectedPosition, validState, validRoomCode, validMemberToken } from './protocol.js';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode = () => Array.from(randomBytes(8), b => alphabet[b % alphabet.length]).join('');
const token = () => randomBytes(24).toString('base64url');

// Room rules are independent of the HTTP server and WebSocket implementation.
export function createRoomStore({ send, graceMs = 45000, maxRooms = 1000, maxMembers = 16 }) {
  const rooms = new Map();
  const broadcast = (room, message) => {
    for (const member of room.members.values()) send(member.ws, message);
  };
  const presence = room => broadcast(room, {
    type: 'presence', members: [...room.members.values()].filter(m => m.ws).length,
    hostOnline: Boolean(room.members.get(room.host)?.ws),
  });
  function endRoom(room, reason) {
    rooms.delete(room.code);
    for (const member of room.members.values()) {
      clearTimeout(member.expiry);
      send(member.ws, { type: 'ended', message: reason });
      member.ws?.close(1000, 'Room ended');
    }
  }
  function detach(ws, deliberate = false) {
    const room = rooms.get(ws.roomCode);
    const member = room?.members.get(ws.memberToken);
    if (!member || member.ws !== ws) return;
    member.ws = null;
    if (member.token === room.host) {
      if (deliberate) return endRoom(room, 'The host ended the party.');
      if (room.state) {
        room.state = { ...room.state, position: projectedPosition(room.state), paused: true, updatedAt: Date.now() };
        broadcast(room, { type: 'state', state: room.state });
      }
    }
    if (deliberate) room.members.delete(member.token);
    else member.expiry = setTimeout(() => {
      if (member.token === room.host) endRoom(room, 'The host disconnected. Create a new party to continue.');
      else { room.members.delete(member.token); presence(room); }
    }, graceMs);
    presence(room);
  }

  function handle(ws, message) {
    const fail = message => send(ws, { type: 'error', message });
    if (message.type === 'join' && !validRoomCode(message.code)) {
      return fail('Invalid party code. Enter the 8-character code.');
    }
    if (message.type === 'resume' && (!validRoomCode(message.code) || !validMemberToken(message.token))) {
      return fail('Invalid session credentials.');
    }
    if (!ws.memberToken) {
      let room, member;
      if (message.type === 'create') {
        if (rooms.size >= maxRooms) return fail('Relay is full. Try again later.');
        let code;
        do { code = roomCode(); } while (rooms.has(code));
        member = { token: token(), ws };
        room = { code, host: member.token, members: new Map([[member.token, member]]), state: null };
        rooms.set(code, room);
      } else if (message.type === 'join') {
        room = rooms.get(message.code.toUpperCase());
        if (!room) return fail('Party not found. Check the code and relay address.');
        if (room.members.size >= maxMembers) return fail(`This party is full (${maxMembers} people maximum).`);
        member = { token: token(), ws };
        room.members.set(member.token, member);
      } else if (message.type === 'resume') {
        room = rooms.get(message.code.toUpperCase());
        member = room?.members.get(message.token);
        if (!member) return fail('Your party expired. Create or join a party again.');
        if (member.ws) return fail('This session is already connected.');
        clearTimeout(member.expiry);
        member.ws = ws;
      } else return fail('Create or join a party first.');
      ws.roomCode = room.code;
      ws.memberToken = member.token;
      send(ws, { type: 'welcome', code: room.code, token: member.token,
        role: member.token === room.host ? 'host' : 'guest', state: room.state, serverTime: Date.now() });
      presence(room);
      return;
    }
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    if (message.type === 'leave') {
      detach(ws, true);
      ws.close(1000, 'Left party');
    } else if (message.type === 'state') {
      if (ws.memberToken !== room.host) return fail('Only the host can control playback.');
      if (!validState(message.state)) return fail('Invalid playback state.');
      const { position, paused, rate, duration } = message.state;
      room.state = { position, paused, rate, duration, updatedAt: Date.now() };
      broadcast(room, { type: 'state', state: room.state });
    }
  }

  function clear() {
    for (const room of rooms.values()) {
      for (const member of room.members.values()) clearTimeout(member.expiry);
    }
    rooms.clear();
  }
  return { rooms, handle, detach, clear };
}
