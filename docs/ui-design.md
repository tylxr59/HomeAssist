# Watch UI references

HomeAssist follows Pebble's native voice and text screens:

- [System dictation window](https://github.com/coredevices/PebbleOS/blob/main/fw/applib/voice/voice_window.c): uses `GColorLightGray` on color watches, black text, Gothic typography, and a matching status bar. HomeAssist uses this exact background color rather than approximating a screenshot.
- [System Weather app](https://github.com/coredevices/PebbleOS/blob/main/fw/apps/system/weather/weather_app_layout.c): distinguishes compact location headings from larger content with system fonts. HomeAssist uses an 18-bold assistant heading and 24-point reply text.
- [Pebble ScrollLayer example](https://github.com/pebble-examples/feature-scroll-layer): keeps physical UP/DOWN scrolling. HomeAssist adds small chevrons only when there is more content in that direction.

The 200×228 Time 2 layout keeps the clock at the top, the assistant name below it, a dedicated scroll viewport, and a short status label at the bottom. A microphone aligned with SELECT indicates speaking; three static dots replace it while waiting for HA. Back keeps its standard exit behavior.

The microphone and chevrons are drawn with native graphics primitives; no third-party artwork or custom fonts are bundled. The system still owns the actual dictation screen. Setup, errors, transcript processing, and replies all share the light palette so transitions remain consistent.

The reply screenshot is an emulator layout preview using sample text, not a recorded HA interaction. Long-reply scrolling is checked separately in the emulator.
