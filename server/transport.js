import { WebSocket } from 'ws';

export const MAX_BUFFERED_BYTES = 256 * 1024;

// A slow peer must not accumulate an unlimited queue of room broadcasts.
export function send(ws, message) {
  if (ws?.readyState !== WebSocket.OPEN) return;
  const data = JSON.stringify(message);
  if (ws.bufferedAmount + Buffer.byteLength(data) > MAX_BUFFERED_BYTES) {
    ws.terminate();
    return;
  }
  ws.send(data, error => { if (error) ws.terminate(); });
}
