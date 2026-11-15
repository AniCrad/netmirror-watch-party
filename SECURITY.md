# Security and privacy

The relay receives room codes, member tokens, playback position, paused state, rate, duration, and timing messages. It does not receive stream content, cookies, credentials, page URLs, subtitles, or browsing history. Network operators can still observe connection metadata such as IP addresses. Reverse proxies may log requests according to their own configuration.

Room codes allow joining; keep them private. Tokens allow a member to resume its own session; never publish them. Browser tokens use extension session storage when available and otherwise background memory. Relay room state is in memory and disappears when the process restarts.

Only a room's host can publish authoritative playback updates. Room codes and resume tokens are type/format-checked before use. Payload size, per-connection message rate, admission timeout, room count, room membership, and total WebSocket connections are bounded. Slow peers are disconnected when their outgoing queue would exceed 256 KiB. The HTTP server also limits total TCP sockets and request/header timeouts. These are basic resource controls, not comprehensive abuse protection.

Public relays have no user accounts or admission password. Native clients can omit or spoof Origin, so extension-origin checks are not authentication. Use TLS and appropriate hosting-edge connection/access controls for your deployment. A room code is not a substitute for an authenticated service when that is required.

The extension starts with NetMirror site permissions and requests embedded-site access explicitly. Broad optional host patterns allow requesting individual sites; they do not grant blanket access at installation.

## Reporting

Use the repository's **Security → Report a vulnerability** if the maintainer has enabled private vulnerability reporting. If that option is unavailable, open an issue requesting a private contact channel without disclosing exploit details or credentials. Maintainers should enable private reporting before public launch.
