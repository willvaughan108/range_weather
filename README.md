# Range Weather Control

Step-by-step guide to getting the single-file Range Weather Control app running, testing it in mock mode, and then wiring it up to your real LoRa-based weather stations.

## 1. Download or clone

1. Get this repo onto your machine (git clone or unzip).
2. The working files should live under something like `C:\Users\<you>\Desktop\range_weather\`.

## 2. Serve the app locally

The app is just HTML/CSS/JS, but most browsers restrict access to the Web Serial API when loaded from the filesystem, so run a tiny static server:

```powershell
cd C:\Users\<you>\Desktop\range_weather
python -m http.server 8080
```

Then browse to `http://localhost:8080/range-weather-control.html`.

> Tip: If you already have a preferred static server (Live Server, serve, nginx, etc.) use that instead—the app just needs to be available over `http://` or `https://`.

## 3. Recommended browser settings

1. Use the latest Chrome, Edge, or other Chromium-derived browser.
2. Make sure the Web Serial API is enabled (chrome://flags/#enable-experimental-web-platform-features if necessary).
3. Allow the site to access serial ports when prompted.

## 4. Explore Mock Mode

This lets you verify the UI, math, and logging before plugging in hardware.

1. Load the page; “Mock mode” is selected by default.
2. Adjust the mock generator sliders (base speed/direction, jitter, packet loss).
3. Hit “Inject gust” to see gust handling and time-series behavior.
4. Watch the station cards, schematic arrows, and hold readout update in real time.
5. Use the unit toggles in the Settings drawer to flip between Metric/Imperial and MIL/MOA.

## 5. Configure stations, range, and ballistics

All of the “set-and-forget” controls live in the Settings drawer (Open Settings button on the left).

1. Range & Stations:
   - Enter the target range in meters or yards.
   - Adjust each station’s path fraction (0 = shooter, 1 = target) or absolute distance.
2. Ballistics:
   - Pick a default cartridge or add your own (MV is entered in ft/s; the app converts internally).
   - Upload a `range_m,tof_s` CSV if you have high-fidelity TOF data.
   - Optional: enter a Manual TOF to override calculations for testing.

## 6. Connect to the LoRa gateway (Live Serial mode)

1. Switch “App mode” from Mock to Live Serial.
2. Click **Connect**; Chrome will show a serial-port picker. Select your USB LoRa gateway and confirm.
3. If your gateway uses a custom baud rate, edit the baud field before connecting (default 115200).
4. Once connected, the app starts listening for two uplink formats:
   - JSON lines like `{"id":2,"t":1731090001,"spd":5.3,...}`
   - Compact binary frames documented in the code (`sync=0x42` … `batt8`)
5. Incoming packets paint the station cards, schematic arrows, and logs just like Mock mode. Packet loss stats, battery, RSSI, and delays also populate live.

## 7. Send downlink commands

With the serial port connected you can start/stop the network sampling and run gust checks:

1. Adjust Network ID, target node (leave blank for broadcast), sample rate, burst count, duration.
2. Click **Start streaming** to send `NET:...;CMD:START;...` bursts for 6 seconds.
3. **Stop streaming** issues the corresponding STOP command.
4. **Gust check (5 Hz burst)** sends a short high-rate START, useful for wake-up or diagnostics.
5. A progress bar shows the 6-second transmit window.

## 8. CSV logging

1. The app keeps the last 10 minutes of raw station data plus fused crosswind/hold values in memory.
2. Hit “Download last 10 min CSV” in Settings to pull it down for analysis or archival.

## 9. Web Serial fallback / proxy (if needed)

If your environment can’t use Web Serial (non-Chromium browser, remote server, etc.):

1. Use a serial-to-WebSocket proxy (e.g., `socat` + `websocketd`, TinyPilot, or a custom Node/Python bridge) to forward gateway packets to the browser.
2. Mirror the JSON/binary payloads into `handleIncomingSample` via a `postMessage` or WebSocket client. The code already has a TODO hook in `readSerialLoop` for adding such a client.

## 10. Production deployment

1. Host the three files (`range-weather-control.html`, `.css`, `.js`, plus this README) on any static site (S3, GitHub Pages, Azure Static Web Apps, etc.).
2. Serve over HTTPS so the Web Serial permission prompt is cleaner.
3. Remind end-users they need to run Chrome/Edge and grant serial access the first time they connect.

---

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| “Web Serial unavailable” message | Use Chrome/Edge 89+, load via `http(s)://`, enable experimental web platform features if required |
| Serial connect button does nothing | Make sure no other app is holding the COM port; check Device Manager for the gateway |
| Binary packets ignored | Confirm frames start with `0x42` and use little-endian fields as documented in `processBinaryBuffer` |
| Range schematic arrows don’t show | In Live mode, ensure each station ID in the app matches the `id` field in incoming packets |

That’s it! Use Mock mode for bench testing, then flip to Live Serial when you’re on site. The UI is tuned for a down-range view (north fixed) so the shooter stays at the bottom, target at the top, and crosswind arrows extend left/right as the wind pushes the bullet. Happy shooting.
