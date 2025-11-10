(() => {
  "use strict";

        const STATION_COUNT = 4;
        const DEG2RAD = Math.PI / 180;
        const MS_TO_MPH = 2.23693629;
        const M_TO_YARDS = 1.0936133;
        const FT_PER_M = 3.280839895;
  const HISTORY_MS = 60 * 1000;
  const LOG_WINDOW_MS = 10 * 60 * 1000;
  const EMA_WINDOW_S = 30;
  const BINARY_FRAME_LEN = 15;
  const GUST_WINDOW_MS = 5 * 1000;

  const defaultProfiles = [
    { id: "308-175", name: ".308 Win 175gr SMK", mv: 800, bc: 0.496, table: [] },
    { id: "65cm-140", name: "6.5 Creedmoor 140gr", mv: 820, bc: 0.61, table: [] }
  ];

  const defaultFractions = [0.05, 0.25, 0.55, 0.85];

  const state = {
    mode: "mock",
    rangeMeters: 800,
    unit: "MIL",
    shootingAzimuth: 0,
    manualTof: "",
    ballisticProfiles: [],
    selectedProfileId: "",
    stations: [],
    history: [],
    log: [],
        ema: { crosswind: null, holdMil: null, holdMoa: null },
        lastFusion: null,
        weighting: { epsilon: 0.1, power: 1.5 },
        displayUnits: "metric",
        mock: {
          baseSpeed: 6,
      baseDir: 270,
      speedNoise: 1.2,
      dirNoise: 15,
      packetLoss: 0.05,
      gustBoostUntil: 0
    },
    serial: {
      port: null,
      reader: null,
      writer: null,
      textDecoder: new TextDecoder(),
      textBuffer: "",
      binaryBuffer: new Uint8Array(),
      isReading: false,
      portLabel: ""
    },
    commandBurst: null
  };

  const dom = {};

  window.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheDom();
    initProfiles();
    initStations();
    bindEvents();
    populateBallisticSelect();
    renderStationConfig();
    renderSchematic();
    renderStationCards();
    updateMockPanelVisibility();
    updatePacketLossLabel();
    logMessage("Range Weather Control ready - Mock mode is active.");
    updateBallisticSummary();
    refreshFusion(false);
    requestAnimationFrame(drawTrend);
    setInterval(processMockTick, 1000);
    setInterval(updateUiHeartbeat, 500);
    window.addEventListener("resize", renderSchematic);
    if (!("serial" in navigator)) {
      dom.serialStatus.textContent = "Web Serial unavailable - stay in mock mode or use a proxy.";
      dom.connectBtn.disabled = true;
    }
  }

  function cacheDom() {
    dom.modeSelect = document.getElementById("modeSelect");
    dom.baudInput = document.getElementById("baudInput");
    dom.connectBtn = document.getElementById("connectBtn");
    dom.disconnectBtn = document.getElementById("disconnectBtn");
    dom.serialStatus = document.getElementById("serialStatus");
    dom.portInfo = document.getElementById("portInfo");
    dom.startBtn = document.getElementById("startBtn");
    dom.stopBtn = document.getElementById("stopBtn");
    dom.gustBtn = document.getElementById("gustBtn");
    dom.netIdInput = document.getElementById("netIdInput");
    dom.targetNodeInput = document.getElementById("targetNodeInput");
    dom.rateInput = document.getElementById("rateInput");
    dom.burstInput = document.getElementById("burstInput");
    dom.durationInput = document.getElementById("durationInput");
    dom.commandProgressFill = document.getElementById("commandProgressFill");
    dom.rangeMetersInput = document.getElementById("rangeMetersInput");
    dom.rangeYardsInput = document.getElementById("rangeYardsInput");
    dom.unitMil = document.getElementById("unitMil");
    dom.unitMoa = document.getElementById("unitMoa");
    dom.unitMetric = document.getElementById("unitMetric");
    dom.unitImperial = document.getElementById("unitImperial");
    dom.shootAzInput = document.getElementById("shootAzInput");
    dom.stationConfigBody = document.getElementById("stationConfigBody");
    dom.mockPanel = document.getElementById("mockPanel");
    dom.baseSpeedInput = document.getElementById("baseSpeedInput");
    dom.baseDirInput = document.getElementById("baseDirInput");
    dom.speedNoiseInput = document.getElementById("speedNoiseInput");
    dom.dirNoiseInput = document.getElementById("dirNoiseInput");
    dom.packetLossInput = document.getElementById("packetLossInput");
    dom.packetLossLabel = document.getElementById("packetLossLabel");
    dom.injectGustBtn = document.getElementById("injectGustBtn");
    dom.ballisticSelect = document.getElementById("ballisticSelect");
    dom.manualTofInput = document.getElementById("manualTofInput");
    dom.ballisticSummary = document.getElementById("ballisticSummary");
    dom.uploadCsvInput = document.getElementById("uploadCsvInput");
    dom.cartNameInput = document.getElementById("cartNameInput");
    dom.cartMvInput = document.getElementById("cartMvInput");
    dom.cartBcInput = document.getElementById("cartBcInput");
    dom.addCartBtn = document.getElementById("addCartBtn");
    dom.downloadCsvBtn = document.getElementById("downloadCsvBtn");
    dom.logSummary = document.getElementById("logSummary");
    dom.console = document.getElementById("console");
    dom.crosswindValue = document.getElementById("crosswindValue");
    dom.crosswindDirection = document.getElementById("crosswindDirection");
    dom.holdReadout = document.getElementById("holdReadout");
    dom.holdSubtext = document.getElementById("holdSubtext");
    dom.gustInfo = document.getElementById("gustInfo");
    dom.stationsContainer = document.getElementById("stationsContainer");
    dom.trendCanvas = document.getElementById("trendCanvas");
    dom.trendCtx = dom.trendCanvas.getContext("2d");
    dom.schematicCanvas = document.getElementById("schematicCanvas");
    dom.schematicCtx = dom.schematicCanvas ? dom.schematicCanvas.getContext("2d") : null;
    dom.settingsBtn = document.getElementById("settingsBtn");
    dom.settingsOverlay = document.getElementById("settingsOverlay");
    dom.closeSettingsBtn = document.getElementById("closeSettingsBtn");
  }

  function initProfiles() {
    state.ballisticProfiles = defaultProfiles.map((profile) => ({ ...profile }));
    state.selectedProfileId = state.ballisticProfiles[0]?.id || "";
  }

  function initStations() {
    state.stations = defaultFractions.slice(0, STATION_COUNT).map((fraction, idx) => ({
      slot: idx,
      nodeId: idx + 1,
      pathFraction: fraction,
      lastSample: null,
      lastUpdate: null,
      lastSeq: null,
      lostPackets: 0,
      totalPackets: 0,
      crosswind: 0,
      mockSeq: 0
    }));
  }

  function bindEvents() {
    dom.modeSelect.addEventListener("change", handleModeChange);
    dom.connectBtn.addEventListener("click", connectSerial);
    dom.disconnectBtn.addEventListener("click", disconnectSerial);
    dom.startBtn.addEventListener("click", sendStartCommand);
    dom.stopBtn.addEventListener("click", sendStopCommand);
    dom.gustBtn.addEventListener("click", sendGustCommand);
    dom.rangeMetersInput.addEventListener("input", handleRangeMetersChange);
    dom.rangeYardsInput.addEventListener("input", handleRangeYardsChange);
    dom.unitMil.addEventListener("change", () => setUnit("MIL"));
    dom.unitMoa.addEventListener("change", () => setUnit("MOA"));
    dom.unitMetric.addEventListener("change", () => setDisplayUnits("metric"));
    dom.unitImperial.addEventListener("change", () => setDisplayUnits("imperial"));
    dom.shootAzInput.addEventListener("input", handleAzChange);
    dom.packetLossInput.addEventListener("input", handlePacketLossChange);
    dom.injectGustBtn.addEventListener("click", injectGust);
    dom.baseSpeedInput.addEventListener("input", () => (state.mock.baseSpeed = parseFloat(dom.baseSpeedInput.value) || 0));
    dom.baseDirInput.addEventListener("input", () => (state.mock.baseDir = normalizeDeg(parseFloat(dom.baseDirInput.value) || 0)));
    dom.speedNoiseInput.addEventListener("input", () => (state.mock.speedNoise = parseFloat(dom.speedNoiseInput.value) || 0));
    dom.dirNoiseInput.addEventListener("input", () => (state.mock.dirNoise = parseFloat(dom.dirNoiseInput.value) || 0));
    dom.ballisticSelect.addEventListener("change", handleCartridgeChange);
    dom.manualTofInput.addEventListener("input", handleManualTofChange);
    dom.uploadCsvInput.addEventListener("change", handleCsvUpload);
    dom.addCartBtn.addEventListener("click", addCartridgeFromForm);
    dom.downloadCsvBtn.addEventListener("click", downloadCsvLog);
    dom.stationConfigBody.addEventListener("input", handleStationConfigInput);
    dom.settingsBtn?.addEventListener("click", () => setSettingsVisibility(true));
    dom.closeSettingsBtn?.addEventListener("click", () => setSettingsVisibility(false));
    dom.settingsOverlay?.addEventListener("click", (event) => {
      if (event.target === dom.settingsOverlay) {
        setSettingsVisibility(false);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setSettingsVisibility(false);
      }
    });
  }

  function handleModeChange() {
    state.mode = dom.modeSelect.value;
    updateMockPanelVisibility();
    logMessage(`Mode set to ${state.mode}`);
  }

  function handleRangeMetersChange() {
    const value = parseFloat(dom.rangeMetersInput.value);
    if (!Number.isFinite(value)) {
      return;
    }
    state.rangeMeters = clamp(value, 1, 1609);
    dom.rangeMetersInput.value = state.rangeMeters.toFixed(0);
    dom.rangeYardsInput.value = Math.round(state.rangeMeters * M_TO_YARDS);
    renderStationConfig();
    renderSchematic();
    refreshFusion(false);
  }

  function handleRangeYardsChange() {
    const value = parseFloat(dom.rangeYardsInput.value);
    if (!Number.isFinite(value)) {
      return;
    }
    const meters = clamp(value / M_TO_YARDS, 1, 1609);
    state.rangeMeters = meters;
    dom.rangeMetersInput.value = meters.toFixed(0);
    renderStationConfig();
    renderSchematic();
    refreshFusion(false);
  }

  function setUnit(unit) {
    state.unit = unit;
    dom.unitMil.checked = unit === "MIL";
    dom.unitMoa.checked = unit === "MOA";
    updateHoldUi();
  }

  function setDisplayUnits(system) {
    state.displayUnits = system;
    dom.unitMetric.checked = system === "metric";
    dom.unitImperial.checked = system === "imperial";
    renderStationCards();
    renderSchematic();
    updateHoldUi();
  }

  function handleAzChange() {
    const value = parseFloat(dom.shootAzInput.value);
    if (!Number.isFinite(value)) {
      return;
    }
    state.shootingAzimuth = normalizeDeg(value);
    dom.shootAzInput.value = state.shootingAzimuth.toFixed(0);
    renderSchematic();
    refreshFusion(false);
  }

  function handlePacketLossChange() {
    state.mock.packetLoss = clamp(parseFloat(dom.packetLossInput.value) || 0, 0, 1);
    updatePacketLossLabel();
  }

  function injectGust() {
    state.mock.gustBoostUntil = Date.now() + 7000;
    logMessage("Injected mock gust for roughly 7 seconds.");
  }

  function handleCartridgeChange(event) {
    state.selectedProfileId = event.target.value;
    updateBallisticSummary();
    refreshFusion(false);
  }

  function handleManualTofChange() {
    const value = parseFloat(dom.manualTofInput.value);
    state.manualTof = Number.isFinite(value) && value > 0 ? value : "";
    updateBallisticSummary();
    refreshFusion(false);
  }

  function handleStationConfigInput(event) {
    const index = Number(event.target.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }
    const station = state.stations[index];
    if (!station) {
      return;
    }
    const field = event.target.dataset.field;
    if (field === "nodeId") {
      const id = parseInt(event.target.value, 10);
      if (Number.isFinite(id)) {
        station.nodeId = id;
      }
    } else if (field === "fraction") {
      const fraction = clamp(parseFloat(event.target.value) || 0, 0, 1);
      station.pathFraction = fraction;
    } else if (field === "distance") {
      const distance = clamp(parseFloat(event.target.value) || 0, 0, state.rangeMeters);
      station.pathFraction = state.rangeMeters > 0 ? distance / state.rangeMeters : 0;
    }
    renderStationConfig();
    renderSchematic();
    refreshFusion(false);
  }

  function populateBallisticSelect() {
    dom.ballisticSelect.innerHTML = state.ballisticProfiles
      .map((profile) => `<option value="${profile.id}">${profile.name}</option>`)
      .join("");
    dom.ballisticSelect.value = state.selectedProfileId;
  }

  function updateBallisticSummary() {
    const profile = getSelectedProfile();
    if (!profile) {
      dom.ballisticSummary.textContent = "No cartridge selected.";
      return;
    }
          const rows = profile.table?.length || 0;
          const mvLabel = formatMuzzleVelocity(profile.mv);
          const method = state.manualTof
            ? "Manual TOF"
            : rows
            ? "Table interpolation"
            : "Simple MV approximation";
          dom.ballisticSummary.textContent = `${profile.name} - MV ${mvLabel} | BC ${profile.bc} | Table rows ${rows} | Method ${method}`;
        }

  function getSelectedProfile() {
    return state.ballisticProfiles.find((profile) => profile.id === state.selectedProfileId) || null;
  }

        function addCartridgeFromForm() {
          const name = dom.cartNameInput.value.trim();
          const mvFps = parseFloat(dom.cartMvInput.value);
          const bc = parseFloat(dom.cartBcInput.value);
          if (!name || !Number.isFinite(mvFps) || !Number.isFinite(bc)) {
            logMessage("Enter name, muzzle velocity, and BC to add a cartridge.", "warn");
            return;
          }
          const mv = mvFps / FT_PER_M;
          const id = `${name.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}`;
          state.ballisticProfiles.push({ id, name, mv, bc, table: [] });
          state.selectedProfileId = id;
    populateBallisticSelect();
    dom.cartNameInput.value = "";
    dom.cartMvInput.value = "";
    dom.cartBcInput.value = "";
    dom.ballisticSelect.value = id;
    logMessage(`Added cartridge ${name}.`);
    updateBallisticSummary();
    refreshFusion(false);
  }

  function handleCsvUpload(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    file
      .text()
      .then((text) => {
        const parsed = parseBallisticCsv(text);
        const profile = getSelectedProfile();
        if (!profile) {
          return;
        }
        if (parsed.table.length) {
          profile.table = parsed.table;
          logMessage(`Loaded ${parsed.table.length} TOF rows for ${profile.name}.`);
        }
        if (parsed.dropTable.length) {
          profile.dropTable = parsed.dropTable;
          logMessage(
            `Stored ${parsed.dropTable.length} drop rows for ${profile.name}. TODO: hook into future CAD wake solver.`
          );
        }
        if (!parsed.table.length && !parsed.dropTable.length) {
          logMessage("CSV did not contain usable rows.", "warn");
        }
        updateBallisticSummary();
        refreshFusion(false);
      })
      .catch((err) => logMessage(`CSV parse failed: ${err.message}`, "error"))
      .finally(() => {
        event.target.value = "";
      });
  }

  function parseBallisticCsv(text) {
    const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const table = [];
    const dropTable = [];
    if (!rows.length) {
      return { table, dropTable };
    }
    const headerCells = rows[0].split(/[,;\t]/).map((cell) => cell.trim().toLowerCase());
    const hasHeader =
      headerCells.some((cell) => cell.includes("range") || cell.includes("tof") || cell.includes("drop"));
    const dataRows = hasHeader ? rows.slice(1) : rows;
    dataRows.forEach((line) => {
      const cells = line.split(/[,;\t]/).map((cell) => cell.trim());
      if (cells.length < 2) {
        return;
      }
      const range = parseFloat(cells[0]);
      const second = parseFloat(cells[1]);
      if (!Number.isFinite(range) || !Number.isFinite(second)) {
        return;
      }
      if (hasHeader && headerCells.some((cell) => cell.includes("drop"))) {
        dropTable.push({ range, drop: second });
        return;
      }
      if (hasHeader && headerCells.some((cell) => cell.includes("tof"))) {
        table.push({ range, tof: second });
        return;
      }
      table.push({ range, tof: second });
    });
    table.sort((a, b) => a.range - b.range);
    dropTable.sort((a, b) => a.range - b.range);
    return { table, dropTable };
  }

  function updateMockPanelVisibility() {
    dom.mockPanel.classList.toggle("hidden", state.mode !== "mock");
  }

  function setSettingsVisibility(open) {
    if (!dom.settingsOverlay) {
      return;
    }
    dom.settingsOverlay.classList.toggle("hidden", !open);
  }

  function updatePacketLossLabel() {
    dom.packetLossLabel.textContent = `${Math.round(state.mock.packetLoss * 100)}% simulated loss`;
  }

  function getSpeedDisplay(value) {
    if (!Number.isFinite(value)) {
      return { primary: "--", secondary: "" };
    }
    if (state.displayUnits === "metric") {
      return {
        primary: `${value.toFixed(1)} m/s`,
        secondary: `${(value * MS_TO_MPH).toFixed(1)} mph`
      };
    }
    return {
      primary: `${(value * MS_TO_MPH).toFixed(1)} mph`,
      secondary: `${value.toFixed(1)} m/s`
    };
  }

  function getDistanceDisplay(value) {
    if (!Number.isFinite(value)) {
      return { primary: "--", secondary: "" };
    }
    if (state.displayUnits === "metric") {
      return {
        primary: `${value.toFixed(0)} m`,
        secondary: `${(value * M_TO_YARDS).toFixed(0)} yd`
      };
    }
    return {
      primary: `${(value * M_TO_YARDS).toFixed(0)} yd`,
      secondary: `${value.toFixed(0)} m`
    };
  }

  function formatSpeedText(value) {
    const { primary, secondary } = getSpeedDisplay(value);
    return secondary ? `${primary} (${secondary})` : primary;
  }

  function formatDistanceText(value) {
    const { primary, secondary } = getDistanceDisplay(value);
    return secondary ? `${primary} (${secondary})` : primary;
  }

  function formatRangePair(value, remaining) {
    const dist = getDistanceDisplay(value);
    const remain = getDistanceDisplay(remaining);
    return `${dist.primary} / ${remain.primary}`;
  }

  function formatMuzzleVelocity(mps) {
    if (!Number.isFinite(mps)) {
      return "-- ft/s";
    }
    return `${(mps * FT_PER_M).toFixed(0)} ft/s`;
  }

  function renderStationConfig() {
    dom.stationConfigBody.innerHTML = state.stations
      .map((station, index) => {
        const distance = station.pathFraction * state.rangeMeters;
        return `
          <tr>
            <td>S${index + 1}</td>
            <td><input type="number" data-index="${index}" data-field="nodeId" value="${station.nodeId}" /></td>
            <td><input type="number" step="0.01" min="0" max="1" data-index="${index}" data-field="fraction" value="${station.pathFraction.toFixed(2)}" /></td>
            <td><input type="number" min="0" data-index="${index}" data-field="distance" value="${distance.toFixed(0)}" /></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderSchematic() {
    const canvas = dom.schematicCanvas;
    const ctx = dom.schematicCtx;
    if (!canvas || !ctx) {
      return;
    }
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "rgba(79, 176, 255, 0.05)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0.02)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const paddingY = 60;
    const laneX = width / 2;
    const shooterY = height - paddingY;
    const targetY = paddingY;
    const laneLength = shooterY - targetY;

    const radius = laneLength * 0.55;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(laneX, (shooterY + targetY) / 2, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "11px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.fillText("N", laneX, targetY - radius - 6);
    ctx.fillText("S", laneX, shooterY + radius + 12);
    ctx.fillText("E", laneX + radius + 12, (shooterY + targetY) / 2 + 4);
    ctx.fillText("W", laneX - radius - 12, (shooterY + targetY) / 2 + 4);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(laneX, shooterY);
    ctx.lineTo(laneX, targetY);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.font = "13px 'Segoe UI', sans-serif";
    ctx.fillText(`Shooting axis ${state.shootingAzimuth.toFixed(0)}°`, laneX, targetY - 26);
    ctx.beginPath();
    ctx.moveTo(laneX, targetY - 20);
    ctx.lineTo(laneX, targetY - 40);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(laneX, targetY - 40);
    ctx.lineTo(laneX - 6, targetY - 32);
    ctx.lineTo(laneX + 6, targetY - 32);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const fraction = i / 4;
      const y = shooterY - laneLength * fraction;
      ctx.beginPath();
      ctx.moveTo(laneX - 8, y);
      ctx.lineTo(laneX + 8, y);
      ctx.stroke();
    }

    drawEndpoint(ctx, laneX, shooterY, "Shooter", -1);
    drawEndpoint(ctx, laneX, targetY, "Target", 1);

    ctx.font = "11px 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    const range = state.rangeMeters;

    state.stations.forEach((station, index) => {
      const fraction = clamp(station.pathFraction, 0, 1);
      const py = shooterY - laneLength * fraction;
      const px = laneX;

      ctx.fillStyle = "rgba(79, 176, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(4, 17, 24, 0.9)";
      ctx.stroke();

      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.fillText(`S${index + 1}`, px + 18, py - 16);
      ctx.fillStyle = "rgba(140, 162, 184, 0.9)";
      const rangePair = formatRangePair(fraction * range, Math.max(range - fraction * range, 0));
      ctx.fillText(rangePair, px + 18, py - 2);

      const sample = station.lastSample;
      if (sample && typeof sample.spd === "number" && typeof sample.dir === "number") {
        drawWindVectorArrow(ctx, px, py - 26, sample.dir, sample.spd);
      }
    });
  }

  function drawEndpoint(ctx, x, y, label, side) {
    ctx.fillStyle = label === "Shooter" ? "#4fb0ff" : "#ffb347";
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(4, 17, 24, 0.8)";
    ctx.stroke();
    ctx.fillStyle = "#f0f4f8";
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.textAlign = side < 0 ? "right" : "left";
    ctx.fillText(label, x + side * 40, y + 4);
  }

  function drawWindVectorArrow(ctx, x, y, dirDegComingFrom, speed) {
    if (!Number.isFinite(speed) || !Number.isFinite(dirDegComingFrom)) {
      return;
    }
    const relative = normalizeDeg(dirDegComingFrom - state.shootingAzimuth);
    const relRad = relative * DEG2RAD;
    // Arrow points toward the station from the incoming direction.
    const axisX = -Math.sin(relRad);
    const axisY = Math.cos(relRad);
    const clampedSpeed = Math.max(0, speed);
    const arrowLength = 18 + Math.min(120, clampedSpeed * 8);
    const endX = x + axisX * arrowLength;
    const endY = y + axisY * arrowLength;

    ctx.strokeStyle = "rgba(79, 176, 255, 0.9)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    const angle = Math.atan2(endY - y, endX - x);
    const headSize = 6 + Math.min(10, clampedSpeed * 0.6);
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - Math.cos(angle - Math.PI / 6) * headSize,
      endY - Math.sin(angle - Math.PI / 6) * headSize
    );
    ctx.lineTo(
      endX - Math.cos(angle + Math.PI / 6) * headSize,
      endY - Math.sin(angle + Math.PI / 6) * headSize
    );
    ctx.closePath();
    ctx.fillStyle = "rgba(79, 176, 255, 0.85)";
    ctx.fill();

    ctx.fillStyle = "#f0f4f8";
    ctx.font = "11px 'Segoe UI', sans-serif";
    ctx.textAlign = axisX >= 0 ? "left" : "right";
    const speedLabel = getSpeedDisplay(clampedSpeed).primary;
    ctx.fillText(speedLabel, endX + Math.sign(axisX || 1) * 6, endY - 6);
  }

  function renderStationCards() {
    const now = Date.now();
    const html = state.stations
      .map((station) => {
        const sample = station.lastSample;
        const speedText = sample ? formatSpeedText(sample.spd) : "--";
        const dir = sample ? sample.dir.toFixed(0) : "--";
        const rssi =
          sample && typeof sample.rssi === "number" ? `${sample.rssi.toFixed(0)} dBm` : "n/a";
        const batt =
          sample && typeof sample.batt === "number" ? `${sample.batt.toFixed(2)} V` : "n/a";
        const ageSeconds = sample
          ? ((now - (sample.t ? sample.t * 1000 : station.lastUpdate || now)) / 1000).toFixed(1)
          : "--";
        const packetTotal = station.totalPackets + station.lostPackets;
        const lossPct = packetTotal > 0 ? ((station.lostPackets / packetTotal) * 100).toFixed(1) : "0.0";
        const crosswindText =
          typeof station.crosswind === "number" ? formatSpeedText(station.crosswind) : "--";
        const thetaVec =
          sample && typeof sample.dir === "number"
            ? normalizeDeg(sample.dir - state.shootingAzimuth + 180)
            : 0;
        const distMeters = station.pathFraction * state.rangeMeters;
        const distShooter = formatDistanceText(distMeters);
        const distTarget = formatDistanceText(Math.max(state.rangeMeters - distMeters, 0));
        return `
          <div class="station-card">
            <div class="station-header">
              <div>
                <div class="badge">Node ${station.nodeId}</div>
                <div class="mono">${speedText}</div>
              </div>
              <div class="arrow-icon" style="transform: rotate(${thetaVec}deg)"></div>
            </div>
            <div class="detail">Dir ${dir}° coming</div>
            <div class="detail">Crosswind ${crosswindText}</div>
            <div class="detail">RSSI ${rssi}</div>
            <div class="detail">Battery ${batt}</div>
            <div class="detail">Age ${ageSeconds} s | Loss ${lossPct}%</div>
            <div class="detail">Distance ${distShooter} | ${distTarget} to target</div>
          </div>
        `;
      })
      .join("");
    dom.stationsContainer.innerHTML = html || "<p class='subtext'>Awaiting station samples...</p>";
    renderSchematic();
  }

  function processMockTick() {
    if (state.mode !== "mock") {
      return;
    }
    state.stations.forEach((station) => {
      if (Math.random() < state.mock.packetLoss) {
        station.lostPackets += 1;
        return;
      }
      const now = Date.now();
      station.mockSeq = (station.mockSeq + 1) % 65535;
      const gustBoost = now < state.mock.gustBoostUntil ? 4 + Math.random() * 2 : 0;
      const spd = Math.max(0, state.mock.baseSpeed + randRange(state.mock.speedNoise) + gustBoost);
      const dir = normalizeDeg(state.mock.baseDir + randRange(state.mock.dirNoise));
      const sample = {
        id: station.nodeId,
        t: Math.floor(now / 1000),
        spd,
        dir,
        temp: 15 + randRange(1),
        batt: 4.8 - station.slot * 0.04,
        seq: station.mockSeq,
        rssi: -85 + randRange(2),
        source: "mock"
      };
      handleIncomingSample(sample);
    });
  }

  function handleIncomingSample(sample) {
    const station = state.stations.find((st) => Number(st.nodeId) === Number(sample.id)) || null;
    if (!station) {
      logMessage(`Ignoring sample for unknown station ${sample.id}`, "warn");
      return;
    }
    const now = Date.now();
    station.lastSample = sample;
    station.lastUpdate = now;
    if (typeof sample.seq === "number") {
      if (typeof station.lastSeq === "number") {
        const diff = computeSeqDelta(station.lastSeq, sample.seq);
        if (diff > 1) {
          station.lostPackets += diff - 1;
        }
      }
      station.lastSeq = sample.seq;
      station.totalPackets += 1;
    }
    refreshFusion(true);
    const fusion = state.lastFusion;
    state.log.push({
      ts: now,
      stationId: sample.id,
      seq: sample.seq ?? "",
      speed: sample.spd ?? "",
      direction: sample.dir ?? "",
      temp: sample.temp ?? "",
      batt: sample.batt ?? "",
      rssi: sample.rssi ?? "",
      combinedCross: fusion?.crosswind ?? "",
      holdMil: fusion?.holdMil ?? "",
      holdMoa: fusion?.holdMoa ?? ""
    });
    pruneLogs();
    renderStationCards();
    updateBallisticSummary();
    updateLogSummary();
  }

  function computeSeqDelta(prev, current) {
    if (current >= prev) {
      return current - prev;
    }
    return current + 65536 - prev;
  }

  function refreshFusion(shouldLog) {
    const crosswind = computeCombinedCrosswind();
    const tof = computeTof(state.rangeMeters);
    const lateralDisp = crosswind * tof;
    const angleRad = state.rangeMeters > 0 ? lateralDisp / state.rangeMeters : 0;
    const holdMil = angleRad * 1000;
    const holdMoa = angleRad * 3437.74677;
    const now = Date.now();
    const dt = state.lastFusion ? (now - state.lastFusion.ts) / 1000 : 0;
    const alpha = dt > 0 ? dt / (EMA_WINDOW_S + dt) : 1;
    state.ema.crosswind = state.ema.crosswind == null ? crosswind : state.ema.crosswind + alpha * (crosswind - state.ema.crosswind);
    state.ema.holdMil = state.ema.holdMil == null ? holdMil : state.ema.holdMil + alpha * (holdMil - state.ema.holdMil);
    state.ema.holdMoa = state.ema.holdMoa == null ? holdMoa : state.ema.holdMoa + alpha * (holdMoa - state.ema.holdMoa);
    if (shouldLog) {
      state.history.push({ ts: now, crosswind, holdMil, holdMoa });
      state.history = state.history.filter((point) => now - point.ts <= HISTORY_MS);
    }
    state.lastFusion = { ts: now, crosswind, holdMil, holdMoa, tof };
    updateHoldUi();
  }

  function computeCombinedCrosswind() {
    let numerator = 0;
    let denominator = 0;
    state.stations.forEach((station) => {
      const sample = station.lastSample;
      if (!sample) {
        return;
      }
      const component = computeCrosswindForSample(sample);
      station.crosswind = component;
      const weight =
        state.weighting.epsilon +
        Math.pow(clamp(station.pathFraction, 0, 1), state.weighting.power);
      numerator += weight * component;
      denominator += weight;
    });
    return denominator > 0 ? numerator / denominator : 0;
  }

  function computeCrosswindForSample(sample) {
    const thetaVec = normalizeDeg((sample.dir ?? 0) + 180);
    const delta = normalizeDeg(thetaVec - state.shootingAzimuth);
    const deltaRad = delta * DEG2RAD;
    const speed = sample.spd ?? 0;
    return speed * Math.sin(deltaRad);
  }

  function computeTof(rangeMeters) {
    if (!rangeMeters || rangeMeters <= 0) {
      return 0;
    }
    if (state.manualTof) {
      return state.manualTof;
    }
    const profile = getSelectedProfile();
    if (!profile) {
      return 0;
    }
    if (profile.table && profile.table.length) {
      return interpolateTof(rangeMeters, profile.table);
    }
    if (!profile.mv) {
      return 0;
    }
    // TODO: Replace this approximation with a drag solver that leverages BC, atmosphere, and future CAD wake data.
    return rangeMeters / (profile.mv * 0.9);
  }

  function interpolateTof(range, table) {
    if (!table.length) {
      return 0;
    }
    if (range <= table[0].range) {
      return table[0].tof;
    }
    const last = table[table.length - 1];
    if (range >= last.range) {
      return last.tof;
    }
    for (let i = 0; i < table.length - 1; i += 1) {
      const a = table[i];
      const b = table[i + 1];
      if (range >= a.range && range <= b.range) {
        const ratio = (range - a.range) / (b.range - a.range);
        return a.tof + ratio * (b.tof - a.tof);
      }
    }
    return last.tof;
  }

  function updateHoldUi() {
    const fusion = state.lastFusion;
    if (!fusion) {
      dom.crosswindValue.textContent = formatSpeedText(0);
      dom.crosswindDirection.textContent = "Waiting for samples";
      dom.holdReadout.textContent = `0.00 ${state.unit}`;
      dom.holdSubtext.textContent = "Steady average pending";
      dom.gustInfo.textContent = "";
      return;
    }
    dom.crosswindValue.textContent = formatSpeedText(fusion.crosswind);
    dom.crosswindDirection.textContent =
      fusion.crosswind >= 0 ? "Right crosswind (push left)" : "Left crosswind (push right)";
    const unitValue = state.unit === "MIL" ? fusion.holdMil : fusion.holdMoa;
    const steady = state.unit === "MIL" ? state.ema.holdMil : state.ema.holdMoa;
    const directionLabel = fusion.crosswind >= 0 ? "RIGHT" : "LEFT";
    dom.holdReadout.textContent = `${Math.abs(unitValue).toFixed(2)} ${state.unit} ${directionLabel}`;
    dom.holdSubtext.textContent = `Steady 30 s avg ${steady ? Math.abs(steady).toFixed(2) : "0.00"} ${state.unit}`;
    const gust = computeGustInfo();
    dom.gustInfo.textContent = gust
      ? `Gust window (5 s) ${Math.abs(gust.min).toFixed(2)} to ${Math.abs(gust.max).toFixed(2)} ${state.unit}`
      : "";
  }

  function computeGustInfo() {
    if (!state.history.length) {
      return null;
    }
    const now = Date.now();
    const windowPoints = state.history.filter((point) => now - point.ts <= GUST_WINDOW_MS);
    if (!windowPoints.length) {
      return null;
    }
    const holds = windowPoints.map((point) =>
      state.unit === "MIL" ? point.holdMil : point.holdMoa
    );
    return {
      min: Math.min(...holds),
      max: Math.max(...holds)
    };
  }

  function pruneLogs() {
    const cutoff = Date.now() - LOG_WINDOW_MS;
    state.log = state.log.filter((entry) => entry.ts >= cutoff);
  }

  function updateLogSummary() {
    if (!state.log.length) {
      dom.logSummary.textContent = "No samples yet";
      return;
    }
    const spanMs = state.log[state.log.length - 1].ts - state.log[0].ts;
    const minutes = Math.min(10, spanMs / 60000).toFixed(1);
    dom.logSummary.textContent = `${state.log.length} samples (~${minutes} min)`;
  }

  function downloadCsvLog() {
    if (!state.log.length) {
      logMessage("No samples to export yet.", "warn");
      return;
    }
    const header = "timestamp_iso,station_id,seq,wind_mps,dir_deg,temp_c,batt_v,rssi_dbm,combined_crosswind_mps,hold_mil,hold_moa\n";
    const rows = state.log.map((entry) => {
      const iso = new Date(entry.ts).toISOString();
      return `${iso},${entry.stationId},${entry.seq},${entry.speed},${entry.direction},${entry.temp},${entry.batt},${entry.rssi},${entry.combinedCross},${entry.holdMil},${entry.holdMoa}`;
    });
    const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `range-weather-${new Date().toISOString().replace(/[:]/g, "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    logMessage("CSV export generated.");
  }

  function updateUiHeartbeat() {
    renderStationCards();
    updateHoldUi();
    updateCommandProgress();
    updateSerialStatus();
  }

  function updateSerialStatus(message) {
    if (message) {
      dom.serialStatus.textContent = message;
    } else if (state.serial.port) {
      dom.serialStatus.textContent = `Connected to ${state.serial.portLabel}`;
    } else {
      dom.serialStatus.textContent = "Not connected";
    }
    dom.portInfo.textContent = state.serial.portLabel || "";
  }

  async function connectSerial() {
    if (!navigator.serial) {
      logMessage("Web Serial not available in this browser.", "error");
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      const baudRate = parseInt(dom.baudInput.value, 10) || 115200;
      await port.open({ baudRate });
      state.serial.port = port;
      state.serial.portLabel = describePort(port);
      state.serial.reader = port.readable?.getReader() || null;
      state.serial.writer = port.writable?.getWriter() || null;
      state.serial.textBuffer = "";
      state.serial.binaryBuffer = new Uint8Array();
      state.serial.isReading = true;
      dom.connectBtn.disabled = true;
      dom.disconnectBtn.disabled = false;
      updateSerialStatus();
      logMessage(`Serial connected at ${baudRate} baud.`);
      readSerialLoop();
    } catch (err) {
      logMessage(`Serial connect failed: ${err.message}`, "error");
    }
  }

  async function disconnectSerial() {
    state.serial.isReading = false;
    if (state.serial.reader) {
      try {
        await state.serial.reader.cancel();
      } catch (err) {
        console.error(err);
      }
      state.serial.reader.releaseLock();
      state.serial.reader = null;
    }
    if (state.serial.writer) {
      try {
        state.serial.writer.releaseLock();
      } catch (err) {
        console.error(err);
      }
      state.serial.writer = null;
    }
    if (state.serial.port) {
      try {
        await state.serial.port.close();
      } catch (err) {
        console.error(err);
      }
      state.serial.port = null;
    }
    dom.connectBtn.disabled = false;
    dom.disconnectBtn.disabled = true;
    updateSerialStatus("Disconnected");
  }

  async function readSerialLoop() {
    // Users without Web Serial can route UART bytes through a proxy and call handleIncomingSample from that proxy.
    // TODO: add an optional WebSocket client here for environments that rely on a serial proxy bridge.
    while (state.serial.isReading && state.serial.reader) {
      try {
        const { value, done } = await state.serial.reader.read();
        if (done) {
          break;
        }
        if (value) {
          handleSerialChunk(value);
        }
      } catch (err) {
        logMessage(`Serial read error: ${err.message}`, "error");
        break;
      }
    }
  }

  function handleSerialChunk(chunk) {
    const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    state.serial.binaryBuffer = concatBuffers(state.serial.binaryBuffer, data);
    processBinaryBuffer();
    const text = state.serial.textDecoder.decode(data, { stream: true });
    state.serial.textBuffer += text;
    processTextBuffer();
  }

  function processTextBuffer() {
    let newlineIndex = state.serial.textBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = state.serial.textBuffer.slice(0, newlineIndex).trim();
      state.serial.textBuffer = state.serial.textBuffer.slice(newlineIndex + 1);
      if (line.startsWith("{")) {
        try {
          const sample = JSON.parse(line);
          handleIncomingSample(sample);
        } catch (err) {
          logMessage(`JSON parse failed: ${err.message}`, "warn");
        }
      } else if (line.length) {
        logMessage(`Serial: ${line}`);
      }
      newlineIndex = state.serial.textBuffer.indexOf("\n");
    }
  }

  function processBinaryBuffer() {
    const buffer = state.serial.binaryBuffer;
    let offset = 0;
    while (buffer.length - offset >= BINARY_FRAME_LEN) {
      if (buffer[offset] !== 0x42) {
        offset += 1;
        continue;
      }
      if (buffer.length - offset < BINARY_FRAME_LEN) {
        break;
      }
      const frame = buffer.slice(offset, offset + BINARY_FRAME_LEN);
      const view = new DataView(frame.buffer);
      // Binary frame layout: [sync=0x42][id(1)][seq16][epoch32][spd16][dir16][temp16][batt8]
      // All multi-byte fields are little endian. Speed counts are 0.1 m/s, direction is 0.01 deg, temp is 0.01 Â°C, battery is 2.0 V + 0.02 V per count.
      const sample = {
        id: view.getUint8(1),
        seq: view.getUint16(2, true),
        t: view.getUint32(4, true),
        spd: view.getUint16(8, true) / 10,
        dir: view.getUint16(10, true) / 100,
        temp: view.getInt16(12, true) / 100,
        batt: 2 + view.getUint8(14) * 0.02,
        source: "binary"
      };
      handleIncomingSample(sample);
      offset += BINARY_FRAME_LEN;
    }
    state.serial.binaryBuffer = buffer.slice(offset);
  }

  function concatBuffers(a, b) {
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
  }

  function sendStartCommand() {
    const net = dom.netIdInput.value.trim() || "0x42";
    const dest = dom.targetNodeInput.value.trim();
    const rate = Math.max(1, parseInt(dom.rateInput.value, 10) || 2);
    const burst = Math.max(1, parseInt(dom.burstInput.value, 10) || 5);
    const dur = Math.max(1, parseInt(dom.durationInput.value, 10) || 15);
    let command = `NET:${net};CMD:START;RATE:${rate};BURST:${burst};DUR:${dur};`;
    if (dest) {
      command += `DEST:${dest};`;
    }
    sendCommandBurst(command, { durationMs: 6000, intervalMs: 500 });
  }

  function sendStopCommand() {
    const net = dom.netIdInput.value.trim() || "0x42";
    const dest = dom.targetNodeInput.value.trim();
    let command = `NET:${net};CMD:STOP;`;
    if (dest) {
      command += `DEST:${dest};`;
    }
    sendCommandBurst(command, { durationMs: 6000, intervalMs: 500 });
  }

  function sendGustCommand() {
    const net = dom.netIdInput.value.trim() || "0x42";
    const dest = dom.targetNodeInput.value.trim();
    let command = `NET:${net};CMD:START;RATE:5;BURST:5;DUR:12;MODE:GUST;`;
    if (dest) {
      command += `DEST:${dest};`;
    }
    sendCommandBurst(command, { durationMs: 12000, intervalMs: 200 });
  }

  function sendCommandBurst(command, options) {
    if (!state.serial.writer) {
      logMessage("Connect to a serial port before sending commands.", "warn");
      return;
    }
    const payload = new TextEncoder().encode(`${command}\n`);
    const writer = state.serial.writer;
    const durationMs = options.durationMs;
    const intervalMs = options.intervalMs;
    const start = Date.now();
    const transmit = async () => {
      try {
        await writer.write(payload);
      } catch (err) {
        logMessage(`Serial write failed: ${err.message}`, "error");
      }
    };
    transmit();
    if (state.commandBurst?.intervalId) {
      clearInterval(state.commandBurst.intervalId);
    }
    const intervalId = setInterval(transmit, intervalMs);
    state.commandBurst = { command, start, duration: durationMs, intervalId };
    logMessage(`Transmitting: ${command}`);
  }

  function updateCommandProgress() {
    if (!state.commandBurst) {
      dom.commandProgressFill.style.width = "0%";
      return;
    }
    const now = Date.now();
    const elapsed = now - state.commandBurst.start;
    const ratio = Math.min(1, elapsed / state.commandBurst.duration);
    dom.commandProgressFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    if (elapsed >= state.commandBurst.duration) {
      clearInterval(state.commandBurst.intervalId);
      state.commandBurst = null;
      setTimeout(() => {
        dom.commandProgressFill.style.width = "0%";
      }, 150);
      logMessage("Downlink burst complete.");
    }
  }

  function describePort(port) {
    if (!port.getInfo) {
      return "serial-port";
    }
    const info = port.getInfo();
    const vendor = info.usbVendorId ? `0x${info.usbVendorId.toString(16)}` : "n/a";
    const product = info.usbProductId ? `0x${info.usbProductId.toString(16)}` : "n/a";
    return `USB ${vendor}:${product}`;
  }

  function drawTrend() {
    const ctx = dom.trendCtx;
    const canvas = dom.trendCanvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    const points = state.history;
    if (points.length >= 2) {
      const now = Date.now();
      const start = now - HISTORY_MS;
      const crossMax = Math.max(
        1,
        ...points.map((point) => Math.abs(point.crosswind))
      );
      const holdMax = Math.max(
        0.1,
        ...points.map((point) => Math.abs(state.unit === "MIL" ? point.holdMil : point.holdMoa))
      );
      plotSeries(
        ctx,
        points,
        start,
        HISTORY_MS,
        width,
        height,
        (point) => point.crosswind,
        crossMax,
        "#4fb0ff"
      );
      plotSeries(
        ctx,
        points,
        start,
        HISTORY_MS,
        width,
        height,
        (point) => (state.unit === "MIL" ? point.holdMil : point.holdMoa),
        holdMax,
        "#ffb347"
      );
    }
    requestAnimationFrame(drawTrend);
  }

  function plotSeries(ctx, points, start, span, width, height, accessor, scaleMax, color) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    points.forEach((point, index) => {
      const x = clamp((point.ts - start) / span, 0, 1) * width;
      const value = accessor(point);
      const normalized = clamp(value / (scaleMax || 1), -1, 1);
      const y = height / 2 - normalized * (height / 2 - 10);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }

  function normalizeDeg(angle) {
    return ((angle % 360) + 360) % 360;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function randRange(range) {
    return (Math.random() * 2 - 1) * range;
  }

  function logMessage(message, level = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement("div");
    entry.textContent = `[${timestamp}] ${message}`;
    entry.classList.add(`log-${level}`);
    dom.console.appendChild(entry);
    while (dom.console.childNodes.length > 200) {
      dom.console.removeChild(dom.console.firstChild);
    }
    dom.console.scrollTop = dom.console.scrollHeight;
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](message);
  }
})();
    


