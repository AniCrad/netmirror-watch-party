# NetMirror Watch Party

Watch the same movie together with synchronized play, pause, seeking, and playback speed. One person hosts; everyone else follows using their own stream.

A browser extension for **https://net77.cc** and a self-hosted WebSocket relay. No account, database, or build step. The relay exchanges playback state; it does not relay video or audio. This is an independent project, unaffiliated with NetMirror.

## Quick start

Start a relay with Docker:

```sh
docker compose up -d --build
curl http://localhost:8787/health
```

Or use Node.js 22 or later:

```sh
npm ci
npm start
```

Both use `ws://localhost:8787`. Docker Compose binds to your computer only by default. For friends on other computers, follow the [deployment guide](docs/deployment.md) for LAN access or public HTTPS.

## Install and watch

1. Open `chrome://extensions`, `edge://extensions`, or `brave://extensions`.
2. Enable **Developer mode**, click **Load unpacked**, and select the **`extension/`** folder.
3. Reload existing NetMirror tabs. Everyone opens the same movie or episode and starts the player.
4. The host opens the extension, enters the relay address, and clicks **Create a party**.
5. Share the 8-character party code, relay address, and movie/episode. Friends select **Join friends**.
6. If the extension says **Looking for your video**, open **Video not detected? → Enable embedded player access** and approve access. Each participant must do this for their player.
7. The host controls playback. If a guest's browser blocks autoplay, click **Click to sync** on the video.

**Everyone must connect to the same relay.** `localhost` on a friend's computer points to their computer, not the host's. Use a LAN IP or a public `wss://` address when watching across computers.

One party tab is supported per browser profile. Use separate profiles for local host/guest testing. **Go to party tab** returns to the tab that joined the room. Closing the host tab or ending the party ends the room for everyone.

## Features and boundaries

- Host-controlled playback with clock-offset estimation and drift correction.
- Late joins and a 45-second reconnection grace period.
- Embedded-player access granted per site; no blanket website access at installation.
- Docker image runs as a non-root user and includes a health check.
- Public deployment example includes automatic HTTPS through Caddy.

Chrome, Edge, and Brave 120+ are the primary targets. Safari compatibility is experimental; see [browser notes](docs/troubleshooting.md#safari). Players need an accessible HTML video element. Live streams and browser-native protected player surfaces are not supported. Everyone opens the exact same title; similar durations cannot reliably identify different content.

Rooms live in memory. Restarting or redeploying the relay ends current parties. Run **one relay instance**; independent replicas cannot share rooms.

## Documentation

- [Deployment](docs/deployment.md): Docker, LAN, public HTTPS, Node hosts, configuration, and operations.
- [Troubleshooting](docs/troubleshooting.md): missing video, permissions, connection failures, and browser behavior.
- [Architecture](docs/architecture.md): components, data flow, protocol, and lifecycle.
- [Contributing](CONTRIBUTING.md): local checks and manual validation.
- [Publishing](docs/publishing.md): prepare and push a public repository.
- [Security and privacy](SECURITY.md): data handling and deployment boundaries.

## Development

```sh
npm ci
npm run check
npm test
```

Tests cover real WebSocket room flows and simulated extension/player behavior. CI runs tests on Node.js 22 and 24 and exercises a built Docker container. Chrome playback has been manually confirmed after enabling embedded-player access; automated tests do not replace testing against NetMirror's current player.

```text
extension/           Unpacked browser extension (select this folder to install)
  background/        Worker entrypoint, party controller, relay URL validation
  content/           Video detection, playback synchronization, in-page status
  popup/             Create/join UI and player permission controls
server/              Configuration, protocol rules, room store, HTTP/WebSocket relay
scripts/             Syntax/manifest checks, health check, deployment smoke test
test/                Automated tests
deploy/              Reverse proxy configuration
docs/                Architecture, deployment, troubleshooting, publishing
```

## License

[MIT](LICENSE).
