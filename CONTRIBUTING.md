# Contributing

Use Node.js 22 or later. Install locked dependencies and run checks from the repository root:

```sh
npm ci
npm run check
npm test
```

`npm run test:coverage` provides optional Node test coverage. `npm run check` validates JavaScript syntax and manifest entrypoint paths. CI tests Node.js 22/24 and a Docker deployment.

Keep changes focused. Preserve the no-build extension workflow unless a change clearly justifies adding tooling. Follow the module boundaries in [Architecture](docs/architecture.md), use two-space indentation and ES modules for server/background code, and add regression tests for behavioral fixes.

## Player and extension validation

Load `extension/` unpacked in two Chromium profiles. After edits, reload the extension and NetMirror tabs, and recreate the party if necessary. Verify:

- Host play/pause, forward/backward seeking, and playback rate reach the guest.
- A late guest catches up, including an autoplay-blocked guest after clicking to sync.
- Embedded-player access enables detection on both profiles.
- Reload/navigation restores detection, and short host disconnects pause guests and resume.
- Leaving/end-party releases player control and closes the room appropriately.

The player tests simulate media elements; include actual browser results with player changes.

## Deployment validation

```sh
docker compose up -d --build
node scripts/smoke.js ws://127.0.0.1:8787
docker compose down
```

Use a free host port if another relay is running. The smoke command creates a temporary room and ends it. Validate both Compose configurations for deployment changes; see the guide for required production variables.

## Pull requests

Describe the concrete problem, changed behavior, and validation. Update user-facing docs for changed setup, configuration, protocol, or limitations. Do not commit local `.env` files, IDE state, node_modules, tokens, or generated archives. Contributions are under the project's [MIT license](LICENSE).
