# Watch UI references

HomeAssist combines Pebble's native voice and text styling with a minimal, response-first layout:

- [System dictation window](https://github.com/coredevices/PebbleOS/blob/main/fw/applib/voice/voice_window.c): uses `GColorLightGray` on color watches, black text, Gothic typography, and a matching status bar. HomeAssist uses this exact background color rather than approximating a screenshot.
- [System Weather app](https://github.com/coredevices/PebbleOS/blob/main/fw/apps/system/weather/weather_app_layout.c): distinguishes compact headings from larger content with system fonts. HomeAssist keeps its 18-bold assistant name, 24-point reply text, and 14-bold action label.
- [Pebble ScrollLayer example](https://github.com/pebble-examples/feature-scroll-layer): keeps physical UP/DOWN scrolling. HomeAssist adds small chevrons only when there is more content in that direction.
- [Siri on Apple Watch](https://support.apple.com/en-ie/guide/watch/apd02f71f945/watchos): inspiration for making the conversation the focus and using one compact voice indicator. HomeAssist interprets that idea with simple, static Pebble graphics.

The 200×228 Time 2 layout keeps the native clock at the top. The response occupies a 168-pixel-wide reading column inside a scroll viewport from y=28 to y=168. Short responses center vertically in that space; long responses start at the top and scroll with UP/DOWN. Small chevrons sit at the right edge only when content extends above or below the viewport.

The assistant name and action label form a compact bottom group beside a voice waveform. Static dots indicate connecting or processing, and a phone outline indicates setup is needed. The group stays visible while scrolling and is separated from the response by whitespace. SELECT speaks again; BACK keeps its standard exit behavior.

The waveform, phone outline, and chevrons use native graphics primitives; no artwork, custom fonts, new colors, or repeating animation timers are bundled. The system still owns the actual dictation screen. Setup, errors, transcript processing, and replies all share the existing light-gray background and black text.

The [reply](reply.png) and [processing](thinking.png) screenshots are emulator layout previews using sample text, not recorded HA interactions. The [long reply](long-reply.png) is also checked by scrolling to its final line in the emulator.
