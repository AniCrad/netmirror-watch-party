# Deployment guide

Deploy the relay once and install the extension separately in every participant's browser. The container serves the relay and `/health`; it does not serve a watch page or install the extension.

## Choose a setup

| Setup | Start command | Address entered in the extension |
| --- | --- | --- |
| One computer | `docker compose up -d --build` | `ws://localhost:8787` |
| Same LAN | `BIND_ADDRESS=0.0.0.0 docker compose up -d --build` | `ws://HOST_LAN_IP:8787` |
| Public server with domain | `docker compose -f compose.production.yaml up -d --build` | `wss://YOUR_DOMAIN` |
| Node hosting platform | `npm ci --omit=dev` then `npm start` | Platform's public `wss://` hostname |

All participants enter the same address. Use the root WebSocket endpoint, without a path or query string.

## Local Docker deployment

Install Docker Engine with the Compose plugin, or Docker Desktop. Run commands from the repository root:

```sh
docker compose up -d --build
docker compose ps
curl --fail http://localhost:8787/health
```

Expected health response:

```json
{"status":"ok","rooms":0}
```

The room count changes while people use the relay. The default Compose setup publishes port 8787 on `127.0.0.1` only. No volumes are needed for the relay.

Optional configuration:

```sh
cp .env.example .env
```

Set `RELAY_PORT` to change the published host port, `BIND_ADDRESS` to change its bind address, and `MAX_ROOMS`/`MAX_MEMBERS`/`MAX_CONNECTIONS` to adjust capacity. Compose reads `.env` automatically. The container continues listening internally on port 8787.

For LAN use:

```sh
BIND_ADDRESS=0.0.0.0 docker compose up -d --build
```

Allow inbound TCP 8787 on the host firewall from your LAN. Share the host's LAN IP, such as `ws://192.168.1.20:8787`. Do not expose this unencrypted port directly to the public internet; use the HTTPS setup below.

Build and run without Compose:

```sh
docker build -t netmirror-watch-party:local .
docker run -d --name watch-party --restart unless-stopped --init \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  -p 127.0.0.1:8787:8787 netmirror-watch-party:local
```

## Public HTTPS with Caddy

Requirements:

- A server running Docker and Compose, with a public IP.
- A domain whose DNS A record points to that server. If you publish an AAAA record, IPv6 must also work.
- Inbound TCP 80 and 443 allowed in the provider firewall and host firewall.
- Ports 80 and 443 available; integrate with your existing proxy instead if another service owns them.

On the server, clone your repository, enter its directory, and configure:

```sh
cp .env.example .env
```

Edit `.env` with your real domain and email:

```dotenv
DOMAIN=party.your-domain.com
ACME_EMAIL=you@your-domain.com
MAX_ROOMS=1000
MAX_MEMBERS=16
```

Then start the **standalone production Compose file**:

```sh
docker compose -f compose.production.yaml config --quiet
docker compose -f compose.production.yaml up -d --build
docker compose -f compose.production.yaml ps
docker compose -f compose.production.yaml logs --tail=100 caddy relay
curl --fail https://party.your-domain.com/health
```

Do not combine `compose.yaml` and `compose.production.yaml`: the production file is complete and intentionally publishes only ports 80/443. Relay port 8787 stays inside the Compose network. Caddy obtains and renews TLS certificates and forwards WebSocket upgrades automatically.

Share **`wss://party.your-domain.com`** with participants. Certificate issuance can take a short time; inspect Caddy logs if the health URL is unavailable. The named `caddy_data` and `caddy_config` volumes preserve certificates and proxy state. Keep them across updates; do not use `down -v` during routine operation.

For a restricted group, apply access and connection limits at your hosting edge as appropriate. The relay does not provide accounts or an admission password. Anyone who can reach it can create rooms; knowing a room code permits joining. Origin checks are not authentication, and native clients can omit or spoof Origin headers.

## Existing reverse proxy or managed Node host

Use a persistent Node.js service or container with WebSocket support. Ordinary request-only/serverless functions are unsuitable for this long-lived relay.

For a Node service:

```sh
npm ci --omit=dev --ignore-scripts
HOST=0.0.0.0 PORT=8787 npm start
```

A platform may supply `PORT` automatically; set `HOST=0.0.0.0` and let the platform provide its port. Configure the health-check path as `/health`. Keep at least one instance running; disable automatic sleeping if you need parties to remain connected.

Put TLS termination in front of the service and forward `/` including WebSocket Upgrade/Connection headers. Set proxy idle timeouts above the 15-second heartbeat interval (60 seconds or more is a reasonable starting point). Preserve extension Origin headers. Do not add an interactive HTTP login flow to the WebSocket endpoint: the extension has no support for that login exchange.

Run **one process / one replica**. Round-robin load balancing, clustered Node workers, or autoscaling independent replicas breaks joining because room state is process-local. Sticky sessions alone do not route new guests to the host's room. Shared room storage and cross-instance messaging would be required to scale horizontally.

## Configuration reference

| Setting | Default | Applies to | Meaning |
| --- | --- | --- | --- |
| `HOST` | `127.0.0.1` | Node process | Bind address; Docker image uses `0.0.0.0` |
| `PORT` | `8787` | Node process | Listening port, 1–65535 |
| `MAX_ROOMS` | `1000` | Node and Compose | Maximum rooms, 1–100000 |
| `MAX_MEMBERS` | `16` | Node and Compose | Participants per room including host, 1–100 |
| `MAX_CONNECTIONS` | `2000` | Node and Compose | Maximum WebSocket connections, 1–100000; 32 extra TCP slots allow HTTP probes |
| `BIND_ADDRESS` | `127.0.0.1` | Local Compose | Host interface for the published port |
| `RELAY_PORT` | `8787` | Local Compose | Published host port; internal port stays 8787 |
| `DOMAIN` | Required | Production Compose | Public hostname without scheme/path |
| `ACME_EMAIL` | Required | Production Compose | Certificate contact email |

The relay validates numeric settings at startup and exits on invalid values. Native `npm start` does **not** automatically read `.env`. Export settings or use `node --env-file=.env server/index.js`. `BIND_ADDRESS` and `RELAY_PORT` are Compose settings; native Node uses `HOST` and `PORT`.

## Verify a deployment

With Node.js and project dependencies available on your machine:

```sh
node scripts/smoke.js wss://party.your-domain.com
```

This checks HTTP health, creates a temporary room, joins as a guest, sends playback state, and ends the room. It does not test a browser's permissions or video player. Complete a real host/guest test using the extension too.

Docker's image health check runs every 30 seconds. It reports whether the process serves a healthy response. Docker restart policies recover an exited process; Docker Compose does not automatically restart a container merely because it is marked unhealthy.

## Updates, logs, and shutdown

For production:

```sh
git pull --ff-only
docker compose -f compose.production.yaml up -d --build
docker compose -f compose.production.yaml logs --tail=100 -f relay
```

Use `--pull always` or `docker compose -f compose.production.yaml pull caddy` when updating the proxy image. To refresh the relay's Node base image, run `docker compose -f compose.production.yaml build --pull relay` before `up -d`.

Stop with:

```sh
docker compose -f compose.production.yaml down
```

For local Compose, omit `-f compose.production.yaml`. Every relay restart/replacement ends active rooms. Let participants know and create a new party afterward. Shutdown handles SIGTERM/SIGINT and closes sockets; there is no room database to back up. Back up `.env` privately and preserve Caddy volumes for certificate continuity.

For reproducible production rollouts, pin tested base/proxy images by digest and deploy a recorded Git commit or image tag. The supplied major-version image tags make it easy to receive updates when rebuilding; they are not immutable releases.
