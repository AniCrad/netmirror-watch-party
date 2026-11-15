# Troubleshooting

## Party is live, but “Looking for your video”

The relay is connected, but the extension has not found an accessible player. Start the movie, then open **Video not detected? → Enable embedded player access** and approve it. Do this on both host and guest browsers. Reload the page if detection does not begin.

NetMirror may embed its player on a different domain. This project initially grants access only to `net77.cc` and its subdomains. If a player changes domains later, grant access again. The permission action requests the origins of frames currently in the tab; start the player before clicking it.

Also check:

- You are watching in the party tab. Use **Go to party tab**.
- Reload NetMirror after installing/updating the extension.
- Chrome's extension site-access setting permits NetMirror and the embedded player.
- Complete website verification normally. The extension does not bypass verification.

## Video detected, but playback is paused

Guest autoplay may be blocked. Click **Click to sync** on the video. Ensure the host is online, both participants opened the exact same movie/episode, and ads have finished. A duration mismatch over 15 seconds stops seeking and asks for the same title.

Guest play/pause/seek is corrected to follow the host. Guests can independently adjust volume, subtitles, and fullscreen.

## Cannot reach the relay / stuck reconnecting

- Check `/health` at the relay's HTTP(S) address and inspect server logs.
- Share the same relay address. `localhost` refers to each participant's own computer.
- Use `wss://` for public deployment, with a valid certificate and a proxy supporting WebSockets.
- Use the root address without a path, query, credentials, or fragment.
- LAN Docker requires `BIND_ADDRESS=0.0.0.0` and the host firewall to permit the published port.
- Ensure a hosting platform is not sleeping or running multiple independent replicas.

## Party not found

Check the 8-character code and relay address. Rooms disappear after a relay restart or host expiry. Create a new room after a deployment. Different relay replicas do not share rooms.

## Testing two people locally

Use two browser profiles, each with the extension installed. One profile supports one active party tab, so two tabs in the same profile do not represent separate participants.

## Updating the extension

At `chrome://extensions`, click **Reload** for Watch Party, then reload the NetMirror tabs. The extension root remains `extension/`, even though scripts are organized into subfolders. Recreate/rejoin the party after a reload clears session storage.

## Safari

Safari compatibility is experimental. The source supports Safari's browser API namespace and WebSocket origins, but current work and primary validation target Chromium. If using a temporary Safari installation, reload it after source changes. A packaged extension requires a Safari Web Extension app; with Xcode on Mac, start with `xcrun safari-web-extension-converter extension`. iPhone/iPad require an iOS build and installation.

Older Safari versions without extension session storage keep credentials in background memory and lose them if the background process restarts. Safari playback and packaging have not been verified on a device.

## Reporting a bug

Include browser/version, operating system, extension status text, host/guest role, whether player access was granted, and relevant error text. Never include room tokens, active private party codes, cookies, or credentials. Useful logs are the extension's service worker console and relay stdout/stderr. The relay does not log session tokens or playback payloads by default.
