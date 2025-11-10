# Range Weather Control

Step-by-step guide to host the single-file Range Weather Control app, verify it with mock data, and hook it up to real LoRa weather stations.

## 1. Download or clone

1. Clone the repo or unzip it locally.
2. Keep the files in a simple path such as `C:\Users\<you>\Desktop\range_weather`.

## 2. Serve the app locally

Modern browsers restrict Web Serial when you open a file via `file://`, so run a tiny web server:

```
powershell
cd C:\Users\<you>\Desktop\range_weather
python -m http.server 8080
```

Browse to `http://localhost:8080/range-weather-control.html`.

> Any static server (VS Code Live Server, `serve`, nginx, etc.) is fine; the app only needs to load over HTTP/HTTPS.

## 3. Browser setup

1. Use the latest Chrome, Edge, or another Chromium-based browser.
2. Ensure the Web Serial API is enabled (chrome://flags/#enable-experimental-web-platform-features if needed).
3. When prompted, allow the site to access serial ports.

## 4. Mock mode workflow

1. The page opens in Mock mode automatically.
2. Use the Mock Wind Generator sliders (base speed/dir, jitter, packet loss) to simulate all four stations.
3. Click **Inject gust** to test gust handling and the time-series plot.
4. Watch station cards, the schematic, and the hold readout update.
5. In **Settings** you can switch between metric/imperial display units and MIL/MOA output.

## 5. Configure range, stations, and ballistics (Settings drawer)

- **Range & Stations**
  - Enter the range in meters or yards; the opposite field updates automatically.
  - Edit station path fractions (0 = shooter, 1 = target) or type absolute distances.
- **Unit system**
  - Choose Metric or Imperial. All speeds/distances (schematic, station cards, combined crosswind) follow this toggle.
- **Ballistics**
  - Pick a preset or add a cartridge (enter muzzle velocity in ft/s; the app converts internally).
  - Optional: upload a CSV (`range_m,tof_s`) for table-driven TOF interpolation.
  - Optional: enter **Manual TOF** to override computed time of flight for the current range (useful when you have a trusted solver).

## 6. Live Serial mode

1. Change **App mode** to Live Serial.
2. Click **Connect** and select your USB LoRa gateway from the Web Serial picker.
3. Adjust the baud rate first if your device is not at 115200.
4. Once connected, the app listens for two uplink formats:
   - JSON lines such as `{"id":2,"t":1731090001,"spd":5.3,...}`
   - Compact binary frames (`sync=0x42`, `id`, `seq`, `epoch`, `spd`, `dir`, `temp`, `batt`) as documented in `processBinaryBuffer`.
5. Station cards, schematic arrows, logs, RSSI, battery, and packet-loss stats update in real time.

## 7. Downlink control reference

| Field | Command fragment | Purpose |
| --- | --- | --- |
| Network ID | `NET:<id>` | Hex network identifier all nodes must share. |
| Target node | `DEST:<id>` | Leave blank for broadcast. Enter a node ID for unicast. |
| Sample rate (Hz) | `RATE:<value>` | Desired packet rate while streaming. |
| Burst count | `BURST:<value>` | Number of samples each node captures per burst (if firmware supports batching). |
| Duration (s) | `DUR:<value>` | How long nodes stream before auto-stop. |
| Start streaming | `CMD:START;...` | Sends the assembled START command every 500 ms for ~6 s. |
| Stop streaming | `CMD:STOP;` | Broadcasts STOP with the same burst cadence. |
| Gust check | `CMD:START;RATE:5;...;MODE:GUST;` | Short, high-rate burst for wake-up or diagnostics. |

The progress bar under the buttons shows the 6-second transmit window so you know when the burst ends.

## 8. CSV logging

- The app keeps roughly 10 minutes of raw samples plus fused crosswind/hold data in memory.
- Use **Download last 10 min CSV** to export the buffer for further analysis.

## 9. Web Serial fallback / proxy (optional)

If you cannot use Web Serial (e.g., Firefox or a remote machine):

1. Bridge the serial port to a WebSocket using a small proxy (`socat`, `websocketd`, TinyPilot, a Node script, etc.).
2. Feed the JSON/binary payloads from that proxy into the UI (there is a TODO hook near `readSerialLoop` for a WebSocket client).

## 10. Production deployment

1. Host `range-weather-control.html`, `.css`, `.js`, and this README on any static file host (S3, GitHub Pages, Azure Static Web Apps, etc.).
2. Serve them over HTTPS for fewer permission prompts.
3. Remind users they need Chromium + Web Serial access the first time they connect.

---

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Web Serial unavailable" | Use Chrome/Edge 89+, load via http/https, enable experimental web platform features if necessary. |
| Connect button does nothing | Ensure no other app has the COM port open; check Device Manager. |
| Binary packets ignored | Confirm frames begin with `0x42` and fields follow the documented little-endian layout. |
| Range schematic arrows missing | In Live mode, make sure each station ID in the UI matches the `id` field in incoming packets. |

### Notes on the schematic

- The shooter is fixed at the bottom, the target at the top, representing a down-range view.
- The shooting axis stays stationary; wind vectors pivot relative to it so you can see whether the wind is quartering left or right.
- Station cards display the same relative wind angles as the schematic, so the tile and map visuals always agree.

Happy shooting!
