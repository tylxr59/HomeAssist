# Development

## Architecture and protocol

Native C handles UI and Pebble's DictationSession. Phone-side PebbleKitJS owns credentials and HA WebSockets. Clay generates a bundled data-URL settings page. Its Connect button uses a serialized factory from the shared HA client to authenticate and populate the assistant picker while the page stays open. PKJS validates the selected pipeline again after Save. No connection or settings changes are persisted until the page is saved.

AppMessage keys are explicit in `package.json`. Numeric and named keys are accepted by PKJS. Type values:

| Type | Value | Fields |
| --- | --- | --- |
| HELLO | 0 | Resets phone conversation state on watch launch |
| CONFIG | 1 | RequestId (configuration revision), Ready, Assistant, Text |
| COMMAND | 2 | RequestId, Text |
| CHUNK | 3 | RequestId, ChunkIndex, ChunkLast, Text |
| ERROR | 4 | RequestId, Text |
| ACK | 5 | RequestId, ChunkIndex |

Command IDs advance on errors and settings changes so late responses cannot replace current UI. Dictation starts on launch alongside the HELLO/CONFIG handshake. The first ready CONFIG preserves active dictation or submits a held transcript once the outbox is available. Duplicate readiness notifications for the same ready configuration do not restart or cancel dictation. Unready configurations, settings changes, and startup timeouts discard held transcripts. A submitted command is never automatically replayed. Replies use ordered chunks of up to 400 UTF-8 bytes, without splitting characters. The watch acknowledges each chunk, including duplicates, and assembles at most 8,192 bytes. PKJS retries the same chunk at most three total attempts, waiting 2.5 seconds between attempts. Commands themselves are never replayed.

The client authenticates on `/api/websocket`, lists `assist_pipeline/pipeline/list`, and submits `assist_pipeline/run` with intent as both start and end stage. The command's successful `result` message acknowledges subscription only. `intent-end` supplies the response; `run-end` completes it. The returned conversation ID is reused only during the current app session.

Connection/discovery timeouts are 10 seconds; command completion has a 60-second timeout after authentication. The watch waits up to 80 seconds for the command and reply delivery, or 15 seconds for the companion on startup. A completed transcript can wait up to 15 seconds for readiness or a free outbox; it is discarded if that wait expires. Failed responses are never retried as commands.

## Validation

```bash
npm test
npm run build
npm run --silent release:notes
```

The watch startup test requires a host C compiler (`cc`). It compiles the production watch state and event handlers against mocked Pebble APIs to check both handshake/dictation completion orders, cancellation, startup retries, configuration changes, outbox contention, and timeout cleanup. Real phone dictation still requires hardware validation.

The automated suite covers authentication ordering and failures, pipeline discovery and explicit selection, context reset and continuation, stale results, concurrent requests, timeout/disconnection without command replay, Unicode reply chunking, and acknowledgement retries.

Timer regressions also run with browser-sensitive timer functions. When Chromium is available, the suite runs the actual HA client and reply transfer with native browser timers, including authentication, discovery completion, and timeout handling. Real Clay page tests also cover in-place discovery, explicit selection, credential edits, empty lists, stale callbacks, retry, blocked premature submission, and reopening with a saved assistant. Set `CHROMIUM_BIN` to a Chromium executable if it is not found automatically; only the native browser test is skipped when Chromium is unavailable. Tests use synthetic credentials and do not connect to a real HA instance.

For headless emulator inspection:

```bash
pebble install --emulator emery --vnc
pebble screenshot --emulator emery --vnc --no-open build/screen.png
```

Keep VNC enabled in both commands on a headless system.

## Physical Time 2 acceptance checklist

These checks require a real compatible phone companion, working dictation service, and HA instance. Mock tests and emulator screenshots do not prove these work on hardware.

- Enter URL/token, tap Connect, select a named pipeline on the same page, and save. Confirm that cancelling discards edits and reopening restores the selected assistant.
- Launch into dictation while the companion starts, speak a harmless query, and verify HA's reply. Check that readiness arriving during speech does not close dictation, and a transcript completed before readiness is submitted exactly once.
- Speak a device command and confirm it reaches the selected pipeline exactly once.
- Press SELECT for a contextual follow-up; exit/reopen and confirm context resets.
- Cancel dictation and verify no HA request is submitted.
- Scroll a long reply to the bottom; verify text stays above the footer.
- Revoke a token, remove the selected pipeline, disconnect Bluetooth, and interrupt network access; verify visible recovery instructions and no automatic command replay.
- Save settings while processing and verify stale replies do not appear.
- Verify both HTTP LAN and HTTPS/reverse-proxy URLs as relevant to the user's network.

Do not record tokens in logs, screenshots, fixtures, issue reports, or release notes.

## Branding assets

The source logo is `assets/QuickAssist.svg`. The watch launcher uses `resources/images/menu-icon.png`, generated from that SVG. To regenerate it after editing the logo:

```bash
uv run --with cairosvg python -c "import cairosvg; cairosvg.svg2png(url='assets/QuickAssist.svg', write_to='resources/images/menu-icon.png', output_width=25, output_height=25)"
```

The [Pebble launcher](https://developer.rebble.io/guides/app-resources/images/#menu-icon-in-the-launcher) renders the icon in grayscale. The README uses the full-color SVG. The app UUID and original `homeassist-*` phone storage keys are retained so upgrades preserve saved connections.
