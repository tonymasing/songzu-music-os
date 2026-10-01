const storageKey = "songzu.mobile.serverUrl";
const contextKey = "songzu.mobile.recordingContext";
const draftKey = "songzu.mobile.recordingDrafts";
const uploadJobKey = "songzu.mobile.uploadJobs";
const deviceTokensKey = "songzu.mobile.deviceTokens";
const deviceKeyKey = "songzu.mobile.deviceKey";
const connectLinkKey = "songzu.mobile.connectLink";
const connectClientKeysKey = "songzu.mobile.connectClientKeys";
const fallbackUrl = "";

const setupView = document.querySelector("#setupView");
const appView = document.querySelector("#appView");
const connectionForm = document.querySelector("#connectionForm");
const serverUrlInput = document.querySelector("#serverUrl");
const pairingCodeInput = document.querySelector("#pairingCode");
const connectButton = document.querySelector("#connectButton");
const connectionState = document.querySelector("#connectionState");
const stateTitle = document.querySelector("#stateTitle");
const stateMessage = document.querySelector("#stateMessage");
const appFrame = document.querySelector("#appFrame");
const remoteWorkspace = document.querySelector("#remoteWorkspace");
const remoteStatus = document.querySelector("#remoteStatus");
const remoteRecordButton = document.querySelector("#remoteRecordButton");
const remoteRefreshButton = document.querySelector("#remoteRefreshButton");
const remoteSongCount = document.querySelector("#remoteSongCount");
const remoteSongList = document.querySelector("#remoteSongList");
const appVersion = document.querySelector("#appVersion");
const hostButton = document.querySelector("#hostButton");
const offlineBanner = document.querySelector("#offlineBanner");
const retryButton = document.querySelector("#retryButton");
const recorderButton = document.querySelector("#recorderButton");
const pendingBadge = document.querySelector("#pendingBadge");
const recorderSheet = document.querySelector("#recorderSheet");
const recorderScrim = document.querySelector("#recorderScrim");
const closeRecorderButton = document.querySelector("#closeRecorderButton");
const nativeStatus = document.querySelector("#nativeStatus");
const nativeStatusTitle = document.querySelector("#nativeStatusTitle");
const nativeStatusMessage = document.querySelector("#nativeStatusMessage");
const recordingStateLabel = document.querySelector("#recordingStateLabel");
const recordingClock = document.querySelector("#recordingClock");
const recordingFormat = document.querySelector("#recordingFormat");
const inputMeterFill = document.querySelector("#inputMeterFill");
const inputDevice = document.querySelector("#inputDevice");
const peakLevel = document.querySelector("#peakLevel");
const recordButton = document.querySelector("#recordButton");
const recordButtonLabel = document.querySelector("#recordButtonLabel");
const songSelect = document.querySelector("#songSelect");
const trackSelect = document.querySelector("#trackSelect");
const instrumentSelect = document.querySelector("#instrumentSelect");
const recordingLabel = document.querySelector("#recordingLabel");
const hostStatusPill = document.querySelector("#hostStatusPill");
const refreshRecordingsButton = document.querySelector("#refreshRecordingsButton");
const recordingList = document.querySelector("#recordingList");

let activeServerUrl = "";
let activeConnectionKey = "";
let activeConnectionSource = "";
let activeConnectionMode = "direct";
let activeRemoteConfig = null;
let activeRemoteCrypto = null;
let activeDeviceToken = "";
let healthTimer = null;
let recorderTimer = null;
let nativeCapabilities = null;
let nativeRecordings = [];
let recordingContext = readStoredJson(contextKey, { version: null, songs: [] });
let recordingDrafts = readStoredJson(draftKey, {});
let uploadJobs = readStoredJson(uploadJobKey, {});
let activeRecordingId = null;
let activeRecordingIntent = null;
let syncingRecordingId = null;

function readStoredJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "") || fallback;
  } catch {
    return fallback;
  }
}

function saveStoredJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function deviceTokenFor(url) {
  const tokens = readStoredJson(deviceTokensKey, {});
  return typeof tokens[url] === "string" ? tokens[url] : "";
}

function saveDeviceToken(url, token) {
  const tokens = readStoredJson(deviceTokensKey, {});
  tokens[url] = token;
  saveStoredJson(deviceTokensKey, tokens);
  activeDeviceToken = token;
}

function clearDeviceToken(url) {
  const tokens = readStoredJson(deviceTokensKey, {});
  delete tokens[url];
  saveStoredJson(deviceTokensKey, tokens);
  activeDeviceToken = "";
}

function deviceIdentity() {
  let deviceKey = localStorage.getItem(deviceKeyKey) || "";
  if (!deviceKey) {
    deviceKey = globalThis.crypto?.randomUUID?.() || `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(deviceKeyKey, deviceKey);
  }
  const capacitorPlatform = window.Capacitor?.getPlatform?.() || "";
  const userAgent = navigator.userAgent || "";
  const platform = capacitorPlatform || (/android/i.test(userAgent) ? "android" : /iphone|ipad/i.test(userAgent) ? "ios" : "mobile");
  const family = platform === "ios" ? "iPhone / iPad" : platform === "android" ? "Android" : "行動裝置";
  return { deviceKey, platform, name: `${family} · ${deviceKey.slice(-4).toUpperCase()}` };
}

function trustedHeaders(headers = {}) {
  return activeDeviceToken ? { ...headers, Authorization: `Bearer ${activeDeviceToken}` } : { ...headers };
}

function recorderPlugin() {
  return window.Capacitor?.Plugins?.MobileRecorder || window.SongzuBrowserRecorder || null;
}

function normalizeUrl(value) {
  let candidate = value.trim();
  if (!candidate) return "";
  if (!/^https?:\/\//i.test(candidate)) candidate = `http://${candidate}`;
  try {
    const parsed = new URL(candidate);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

function bytesToBase64url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  return base64Bytes(`${normalized}${"=".repeat((4 - normalized.length % 4) % 4)}`);
}

function parseConnectLink(value) {
  try {
    const url = new URL(String(value || "").trim());
    const hostId = url.searchParams.get("host") || "";
    const keyValue = new URLSearchParams(url.hash.replace(/^#/, "")).get("key") || "";
    if (!/^sz_[A-Za-z0-9_-]{20,30}$/.test(hostId) || !keyValue) return null;
    const publicKeyJwk = JSON.parse(new TextDecoder().decode(base64urlBytes(keyValue)));
    if (publicKeyJwk.kty !== "EC" || publicKeyJwk.crv !== "P-256" || !publicKeyJwk.x || !publicKeyJwk.y) return null;
    const basePath = url.pathname.replace(/\/$/, "");
    return {
      source: url.toString(),
      relayUrl: `${url.origin}${basePath}`,
      hostId,
      publicKeyJwk: { kty: "EC", crv: "P-256", x: publicKeyJwk.x, y: publicKeyJwk.y, ext: true }
    };
  } catch {
    return null;
  }
}

function connectKeyFor(config) {
  return `remote:${config.hostId}`;
}

function headerRecord(headers = {}) {
  const result = {};
  new Headers(headers).forEach((value, name) => { result[name.toLowerCase()] = value; });
  return result;
}

async function bodyBytes(body) {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new Error("這種資料格式尚未支援外出加密傳輸。");
}

async function remoteCrypto(config) {
  if (activeRemoteCrypto?.hostId === config.hostId) return activeRemoteCrypto;
  const hostResponse = await fetch(`${config.relayUrl}/v1/hosts/${config.hostId}`, { cache: "no-store" });
  const host = await hostResponse.json().catch(() => ({}));
  if (!hostResponse.ok) throw new Error(host.error || "找不到頌祖音樂主機。");
  if (!host.online) throw new Error("Mac 主機目前沒有連上頌祖 Connect。");
  if (host.publicKeyJwk?.x !== config.publicKeyJwk.x || host.publicKeyJwk?.y !== config.publicKeyJwk.y) {
    throw new Error("主機公開金鑰與連線網址不一致，已停止連線。");
  }

  const storedKeys = readStoredJson(connectClientKeysKey, {});
  let keyPair = storedKeys[config.hostId] || null;
  if (!keyPair?.privateKeyJwk || !keyPair?.publicKeyJwk) {
    const generated = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    keyPair = {
      privateKeyJwk: await crypto.subtle.exportKey("jwk", generated.privateKey),
      publicKeyJwk: await crypto.subtle.exportKey("jwk", generated.publicKey)
    };
    storedKeys[config.hostId] = keyPair;
    saveStoredJson(connectClientKeysKey, storedKeys);
  }

  const privateKey = await crypto.subtle.importKey("jwk", keyPair.privateKeyJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const hostPublicKey = await crypto.subtle.importKey("jwk", config.publicKeyJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedBits = await crypto.subtle.deriveBits({ name: "ECDH", public: hostPublicKey }, privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(config.hostId), info: new TextEncoder().encode("songzu-connect-v1") },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  activeRemoteCrypto = { hostId: config.hostId, aesKey, clientPublicKeyJwk: keyPair.publicKeyJwk };
  return activeRemoteCrypto;
}

function connectAad(requestId, direction) {
  return new TextEncoder().encode(`songzu-connect:1:${direction}:${requestId}`);
}

async function encryptRemote(aesKey, requestId, direction, value) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: connectAad(requestId, direction) },
    aesKey,
    new TextEncoder().encode(JSON.stringify(value))
  );
  return { nonce: bytesToBase64url(nonce), ciphertext: bytesToBase64url(new Uint8Array(encrypted)) };
}

async function decryptRemote(aesKey, requestId, direction, packet) {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64urlBytes(packet.nonce), additionalData: connectAad(requestId, direction) },
    aesKey,
    base64urlBytes(packet.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function remoteFetch(path, options = {}, timeoutMs = 15000) {
  if (!activeRemoteConfig) throw new Error("頌祖 Connect 尚未設定。");
  const session = await remoteCrypto(activeRemoteConfig);
  const requestId = crypto.randomUUID().replace(/-/g, "");
  const replyToken = bytesToBase64url(crypto.getRandomValues(new Uint8Array(32)));
  const bytes = await bodyBytes(options.body);
  const envelope = {
    version: 1,
    requestId,
    issuedAt: Date.now(),
    method: String(options.method || "GET").toUpperCase(),
    path,
    headers: headerRecord(options.headers),
    bodyBase64: bytes ? bytesToBase64(bytes) : null,
    deviceToken: activeDeviceToken || null
  };
  const encrypted = await encryptRemote(session.aesKey, requestId, "request", envelope);
  const created = await fetch(`${activeRemoteConfig.relayUrl}/v1/hosts/${activeRemoteConfig.hostId}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Songzu-Reply-Token": replyToken },
    body: JSON.stringify({ requestId, clientPublicKeyJwk: session.clientPublicKeyJwk, ...encrypted })
  });
  const createdBody = await created.json().catch(() => ({}));
  if (!created.ok) throw new Error(createdBody.error || `中繼站拒絕請求：HTTP ${created.status}`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waitMs = Math.min(20_000, Math.max(0, deadline - Date.now()));
    const response = await fetch(`${activeRemoteConfig.relayUrl}/v1/hosts/${activeRemoteConfig.hostId}/responses/${requestId}?wait=${waitMs}`, {
      headers: { Authorization: `Bearer ${replyToken}` },
      cache: "no-store"
    });
    const packet = await response.json().catch(() => ({}));
    if (response.status === 202 || packet.ready === false) continue;
    if (!response.ok) throw new Error(packet.error || `中繼站回覆失敗：HTTP ${response.status}`);
    const result = await decryptRemote(session.aesKey, requestId, "response", packet);
    return new Response(base64Bytes(result.bodyBase64 || ""), { status: result.status, headers: result.headers || {} });
  }
  throw new DOMException("頌祖 Connect 等待 Mac 回覆逾時。", "AbortError");
}

function launcherOrigin() {
  if (window.location.origin && window.location.origin !== "null") return window.location.origin;
  return `${window.location.protocol}//${window.location.host}`;
}

function enterTrustedHost(url, token, returnTo) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${url}/api/mobile/pairing/session`;
  for (const [name, value] of Object.entries({ token, returnTo })) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

function updateState(state, title, message) {
  connectionState.dataset.state = state;
  stateTitle.textContent = title;
  stateMessage.textContent = message;
}

function updateNativeState(state, title, message) {
  nativeStatus.dataset.state = state;
  nativeStatusTitle.textContent = title;
  nativeStatusMessage.textContent = message;
}

async function requestJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const parsed = new URL(url, activeServerUrl || window.location.href);
    const response = activeConnectionMode === "remote"
      ? await remoteFetch(`${parsed.pathname}${parsed.search}`, options, timeoutMs)
      : await fetch(url, { cache: "no-store", ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  } finally {
    window.clearTimeout(timer);
  }
}

async function probeServer(url, timeoutMs = 6500) {
  const tokenKey = url === activeServerUrl ? activeConnectionKey || url : url;
  const token = url === activeServerUrl ? activeDeviceToken : deviceTokenFor(tokenKey);
  const headers = { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const body = await requestJson(`${url}/api/mobile/health`, { headers }, timeoutMs);
  if (!body.ok || body.service !== "songzu-music-os") throw new Error("不是頌祖音樂主機");
  return body;
}

async function loadRecordingContext() {
  if (!activeServerUrl) return recordingContext;
  const body = await requestJson(`${activeServerUrl}/api/mobile/recording-context`, { headers: trustedHeaders() }, 8000);
  recordingContext = body;
  saveStoredJson(contextKey, body);
  if (body.version) appVersion.textContent = body.version;
  renderSongOptions();
  if (activeConnectionMode === "remote") renderRemoteWorkspace();
  return body;
}

function setHostAvailable(available) {
  hostStatusPill.textContent = available ? "主機可同步" : "離線可錄";
  hostStatusPill.dataset.online = available ? "true" : "false";
}

function beginHealthWatch() {
  window.clearInterval(healthTimer);
  healthTimer = window.setInterval(async () => {
    if (!activeServerUrl || document.hidden) return;
    try {
      const health = await probeServer(activeServerUrl, 3500);
      if (health.pairingRequired && !health.trusted) {
        clearDeviceToken(activeConnectionKey || activeServerUrl);
        updateState("pairing", "裝置授權已失效", "請回到 Mac 重新產生配對碼。");
        showSetup();
        return;
      }
      offlineBanner.hidden = true;
      setHostAvailable(true);
    } catch {
      offlineBanner.hidden = false;
      setHostAvailable(false);
    }
  }, 12000);
}

async function connectDirect(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    updateState("error", "位址格式不正確", "請輸入 http://Mac名稱.local:3000 或區網 IP。");
    return;
  }

  serverUrlInput.value = url;
  connectButton.disabled = true;
  connectButton.textContent = "檢查中";
  updateState("checking", "正在尋找主機", url);

  try {
    activeConnectionMode = "direct";
    activeRemoteConfig = null;
    activeRemoteCrypto = null;
    activeServerUrl = url;
    activeConnectionKey = url;
    activeConnectionSource = url;
    activeDeviceToken = deviceTokenFor(activeConnectionKey);
    let health = await probeServer(url);
    if (health.pairingRequired && !health.trusted) {
      const pairingCode = pairingCodeInput.value.replace(/\s+/g, "");
      if (!/^\d{6}$/.test(pairingCode)) {
        updateState("pairing", "需要可信裝置配對", "請在 Mac 的「本機 App」產生 6 位數配對碼，再輸入到這裡。");
        pairingCodeInput.focus();
        return;
      }
      const claimed = await requestJson(`${url}/api/mobile/pairing/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pairingCode, ...deviceIdentity() })
      });
      saveDeviceToken(activeConnectionKey, claimed.token);
      health = await probeServer(url);
      if (!health.trusted) throw new Error("主機沒有接受這台裝置的授權。");
    }
    localStorage.setItem(storageKey, url);
    localStorage.removeItem(connectLinkKey);
    appVersion.textContent = health.version || appVersion.textContent;
    updateState("connected", "主機已連接", `${health.appName} ${health.version}`);
    setHostAvailable(true);
    const returnTo = new URL("/", url);
    returnTo.searchParams.set("mobileApp", "1");
    returnTo.searchParams.set("launcher", launcherOrigin());
    pairingCodeInput.value = "";
    updateState("connected", "安全配對完成", "正在進入頌祖音樂 OS。WAV 錄音工具會留在 App 內。");
    enterTrustedHost(url, activeDeviceToken, `${returnTo.pathname}${returnTo.search}`);
  } catch (error) {
    activeServerUrl = url;
    setHostAvailable(false);
    const timedOut = error instanceof Error && error.name === "AbortError";
    const detail = timedOut ? "連線逾時" : errorMessage(error);
    updateState("error", detail, "原生 WAV 仍安全留在手機；確認 Wi-Fi、主機與配對碼後再同步。");
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = "連接";
  }
}

async function connectRemote(config) {
  serverUrlInput.value = config.source;
  connectButton.disabled = true;
  connectButton.textContent = "加密連線中";
  updateState("checking", "正在建立加密通道", config.hostId);

  try {
    activeConnectionMode = "remote";
    activeRemoteConfig = config;
    activeRemoteCrypto = null;
    activeServerUrl = config.relayUrl;
    activeConnectionKey = connectKeyFor(config);
    activeConnectionSource = config.source;
    activeDeviceToken = deviceTokenFor(activeConnectionKey);
    let health = await probeServer(activeServerUrl, 12000);
    if (health.pairingRequired && !health.trusted) {
      const pairingCode = pairingCodeInput.value.replace(/\s+/g, "");
      if (!/^\d{6}$/.test(pairingCode)) {
        updateState("pairing", "需要可信裝置配對", "請在 Mac 的「本機 App」產生 6 位數配對碼，再輸入到這裡。");
        pairingCodeInput.focus();
        return;
      }
      const claimed = await requestJson(`${activeServerUrl}/api/mobile/pairing/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pairingCode, ...deviceIdentity() })
      }, 20000);
      saveDeviceToken(activeConnectionKey, claimed.token);
      health = await probeServer(activeServerUrl, 12000);
      if (!health.trusted) throw new Error("Mac 主機沒有接受這台裝置的授權。");
    }

    localStorage.setItem(connectLinkKey, config.source);
    appVersion.textContent = health.version || appVersion.textContent;
    pairingCodeInput.value = "";
    updateState("connected", "端對端加密已連線", `${health.appName} ${health.version}`);
    setHostAvailable(true);
    await loadRecordingContext();
    showRemoteWorkspace();
    beginHealthWatch();
  } catch (error) {
    setHostAvailable(false);
    const timedOut = error instanceof Error && error.name === "AbortError";
    updateState("error", timedOut ? "外出連線逾時" : errorMessage(error), "確認 Mac 桌面 App 與公開中繼站都在線；手機原檔不會受影響。");
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = "連接";
  }
}

async function connect(rawValue) {
  const remote = parseConnectLink(rawValue);
  if (remote) return connectRemote(remote);
  return connectDirect(rawValue);
}

function renderRemoteWorkspace() {
  const songs = Array.isArray(recordingContext.songs) ? recordingContext.songs : [];
  remoteSongCount.textContent = `${songs.length} 首`;
  if (!songs.length) {
    remoteSongList.innerHTML = "<p>目前作品庫還沒有歌曲。回到 Mac 建立第一首作品後再重新整理。</p>";
    return;
  }
  remoteSongList.innerHTML = songs.slice(0, 12).map((song) => `
    <article>
      <span>${escapeHtml(song.project?.tracks?.length || 0)} 音軌</span>
      <strong>${escapeHtml(song.title)}</strong>
      <small>${escapeHtml([song.bpm ? `${song.bpm} BPM` : "待補 BPM", song.musicalKey || "待補調性"].join(" · "))}</small>
    </article>`).join("");
}

function showRemoteWorkspace() {
  setupView.hidden = true;
  appView.hidden = false;
  appFrame.hidden = true;
  appFrame.removeAttribute("src");
  remoteWorkspace.hidden = false;
  remoteStatus.textContent = "端對端加密";
  offlineBanner.hidden = true;
  renderRemoteWorkspace();
}

function showSetup() {
  if (activeRecordingId) return;
  window.clearInterval(healthTimer);
  appView.hidden = true;
  setupView.hidden = false;
  remoteWorkspace.hidden = true;
  appFrame.hidden = false;
  serverUrlInput.focus();
  updateState(
    activeServerUrl ? "connected" : "idle",
    activeServerUrl ? "目前主機" : "等待連線",
    activeConnectionMode === "remote" ? "頌祖 Connect 外出通道" : activeServerUrl || "確認 Mac 已開啟頌祖音樂 OS。"
  );
}

function renderSongOptions() {
  const songs = Array.isArray(recordingContext.songs) ? recordingContext.songs : [];
  const previous = songSelect.value;
  songSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = songs.length ? "選擇歌曲" : "連上主機後選擇歌曲";
  songSelect.append(placeholder);
  for (const song of songs) {
    const option = document.createElement("option");
    option.value = song.id;
    option.textContent = song.title;
    songSelect.append(option);
  }
  if (songs.some((song) => song.id === previous)) songSelect.value = previous;
  else if (songs[0]) songSelect.value = songs[0].id;
  renderTrackOptions();
}

function renderTrackOptions() {
  const selectedSong = (recordingContext.songs || []).find((song) => song.id === songSelect.value);
  const tracks = selectedSong?.project?.tracks || [];
  const previous = trackSelect.value;
  trackSelect.replaceChildren();
  const noTrack = document.createElement("option");
  noTrack.value = "";
  noTrack.textContent = tracks.length ? "只建立 take，稍後放入音軌" : "這首歌還沒有 DAW 音軌";
  trackSelect.append(noTrack);
  for (const track of tracks) {
    const option = document.createElement("option");
    option.value = track.id;
    option.textContent = `${track.name} · ${track.trackType}`;
    trackSelect.append(option);
  }
  if (tracks.some((track) => track.id === previous)) trackSelect.value = previous;
  else if (tracks[0]) trackSelect.value = tracks[0].id;
}

function currentDestination() {
  const song = (recordingContext.songs || []).find((item) => item.id === songSelect.value) || null;
  return {
    songId: song?.id || "",
    songTitle: song?.title || "尚未指定歌曲",
    dawTrackId: trackSelect.value || null,
    targetInstrument: instrumentSelect.value,
    label: recordingLabel.value.trim() || "手機錄音",
    targetBpm: song?.bpm || null,
    targetKey: song?.musicalKey || ""
  };
}

function openRecorder() {
  recorderSheet.hidden = false;
  document.body.classList.add("recorder-open");
  renderSongOptions();
  void prepareNativeRecorder();
}

function closeRecorder() {
  if (activeRecordingId) {
    updateNativeState("recording", "錄音仍在進行", "請先停止並保存這段 WAV，再離開錄音室。");
    return;
  }
  recorderSheet.hidden = true;
  document.body.classList.remove("recorder-open");
}

async function prepareNativeRecorder() {
  const plugin = recorderPlugin();
  if (!plugin) {
    nativeCapabilities = null;
    recordButton.disabled = true;
    updateNativeState("error", "瀏覽器無法錄音", "請使用支援麥克風的 Safari 或 Chrome，並確認目前網址為 HTTPS。");
    recordingList.innerHTML = '<p class="empty-state">目前瀏覽器沒有可用的無損 WAV 錄音引擎。</p>';
    return;
  }
  try {
    nativeCapabilities = await plugin.capabilities();
    recordButton.disabled = !nativeCapabilities.inputAvailable;
    recordingFormat.textContent = `${Math.round((nativeCapabilities.preferredSampleRate || 48000) / 1000)} kHz / ${nativeCapabilities.preferredBitDepth || 24}-bit WAV / Mono`;
    updateNativeState(
      nativeCapabilities.inputAvailable ? "ready" : "error",
      nativeCapabilities.inputAvailable ? (nativeCapabilities.engine === "browser_pcm_wav" ? "瀏覽器 24-bit WAV 引擎就緒" : "原生錄音引擎就緒") : "找不到麥克風",
      nativeCapabilities.inputAvailable ? (nativeCapabilities.engine === "browser_pcm_wav" ? "錄音會先保存在瀏覽器裝置空間；單段安全上限為 5 分鐘。" : "WAV 原檔會保留在手機，直到同步驗證完成。") : "請連接或允許一個可用的錄音輸入。"
    );
    const status = await plugin.status();
    if (status.recording) resumeActiveRecording(status);
    await refreshNativeRecordings();
  } catch (error) {
    recordButton.disabled = true;
    updateNativeState("error", "原生錄音引擎無法啟動", errorMessage(error));
  }
}

function resumeActiveRecording(status) {
  activeRecordingId = status.id;
  activeRecordingIntent = recordingDrafts[status.id] || currentDestination();
  recordButton.dataset.recording = "true";
  recordButtonLabel.textContent = "停止並保存";
  recordingStateLabel.textContent = "正在錄音";
  beginRecorderPolling();
  updateLiveStatus(status);
}

function beginRecorderPolling() {
  window.clearInterval(recorderTimer);
  recorderTimer = window.setInterval(async () => {
    const plugin = recorderPlugin();
    if (!plugin || !activeRecordingId) return;
    try {
      const status = await plugin.status();
      updateLiveStatus(status);
      if (!status.recording && activeRecordingId) {
        activeRecordingId = null;
        window.clearInterval(recorderTimer);
        recorderTimer = null;
        recordButton.dataset.recording = "false";
        recordButtonLabel.textContent = "開始錄音";
        recordingStateLabel.textContent = "已自動保存 WAV";
        updateNativeState("ready", "錄音已安全保存", status.error || "錄音引擎已停止，WAV 原檔保留在手機。");
        await refreshNativeRecordings();
      }
    } catch (error) {
      updateNativeState("error", "無法讀取錄音狀態", errorMessage(error));
    }
  }, 150);
}

function updateLiveStatus(status) {
  const seconds = Number(status.elapsedSeconds || 0);
  recordingClock.textContent = formatDuration(seconds, true);
  inputMeterFill.style.width = `${Math.min(100, Math.max(0, Number(status.level || 0) * 125))}%`;
  inputDevice.textContent = status.inputDeviceLabel || "手機麥克風";
  peakLevel.textContent = formatDb(status.peakPowerDb);
  if (status.sampleRate) {
    recordingFormat.textContent = `${Math.round(status.sampleRate / 1000)} kHz / ${status.bitDepth || 24}-bit WAV / ${status.channels > 1 ? "Stereo" : "Mono"}`;
  }
}

async function toggleRecording() {
  const plugin = recorderPlugin();
  if (!plugin) return;
  recordButton.disabled = true;
  try {
    if (activeRecordingId) {
      window.clearInterval(recorderTimer);
      recorderTimer = null;
      const saved = await plugin.stop();
      activeRecordingId = null;
      recordButton.dataset.recording = "false";
      recordButtonLabel.textContent = "開始錄音";
      recordingStateLabel.textContent = "已保存原始 WAV";
      recordingClock.textContent = formatDuration(saved.durationSeconds || 0, true);
      inputMeterFill.style.width = "0%";
      updateNativeState("ready", "錄音已保存在手機", "原檔未壓縮、未覆蓋；連上 Mac 後可進行完整性驗證與入庫。");
      await refreshNativeRecordings();
    } else {
      const intent = currentDestination();
      const status = await plugin.start({ label: intent.label, sampleRate: 48000, bitDepth: 24, channels: 1 });
      activeRecordingId = status.id;
      activeRecordingIntent = intent;
      recordingDrafts[status.id] = intent;
      saveStoredJson(draftKey, recordingDrafts);
      recordButton.dataset.recording = "true";
      recordButtonLabel.textContent = "停止並保存";
      recordingStateLabel.textContent = "正在錄音";
      updateNativeState("recording", "正在寫入原生 WAV", "即使主機離線，這段錄音也會留在手機的 App 私有空間。");
      beginRecorderPolling();
      updateLiveStatus(status);
    }
  } catch (error) {
    updateNativeState("error", activeRecordingId ? "停止錄音失敗" : "無法開始錄音", errorMessage(error));
    if (activeRecordingId && !recorderTimer) beginRecorderPolling();
  } finally {
    recordButton.disabled = !nativeCapabilities?.inputAvailable;
  }
}

async function refreshNativeRecordings() {
  const plugin = recorderPlugin();
  if (!plugin) return;
  try {
    const result = await plugin.list();
    nativeRecordings = Array.isArray(result.recordings) ? result.recordings : [];
    renderRecordingList();
  } catch (error) {
    recordingList.innerHTML = `<p class="empty-state error-text">${escapeHtml(errorMessage(error))}</p>`;
  }
}

function renderRecordingList() {
  const pending = nativeRecordings.filter((item) => !item.uploaded);
  pendingBadge.hidden = pending.length === 0;
  pendingBadge.textContent = String(pending.length);
  recorderButton.dataset.recording = activeRecordingId ? "true" : "false";
  if (!nativeRecordings.length) {
    recordingList.innerHTML = '<p class="empty-state">目前沒有手機錄音。錄下第一段後，原始 WAV 會出現在這裡。</p>';
    return;
  }
  recordingList.innerHTML = nativeRecordings.map((item) => recordingCard(item)).join("");
  recordingList.querySelectorAll("[data-action='sync']").forEach((button) => {
    button.addEventListener("click", () => void syncRecording(button.dataset.id));
  });
  recordingList.querySelectorAll("[data-action='assign']").forEach((button) => {
    button.addEventListener("click", () => assignCurrentDestination(button.dataset.id));
  });
}

function recordingCard(item) {
  const draft = recordingDrafts[item.id] || {};
  const destination = draft.songTitle || "尚未指定歌曲";
  const syncing = syncingRecordingId === item.id;
  const uploaded = Boolean(item.uploaded);
  return `
    <article class="recording-item" data-id="${escapeHtml(item.id)}">
      <div class="recording-item-main">
        <span class="recording-file-icon" aria-hidden="true">WAV</span>
        <div>
          <strong>${escapeHtml(item.label || item.fileName || "手機錄音")}</strong>
          <span>${formatDuration(item.durationSeconds || 0)} · ${formatBytes(item.fileSizeBytes || 0)} · ${item.sampleRate || 48000} Hz / ${item.bitDepth || 24}-bit</span>
          <small>歸檔：${escapeHtml(destination)} · SHA ${escapeHtml(String(item.sha256 || "").slice(0, 10))}</small>
        </div>
        <b class="sync-state" data-state="${uploaded ? "done" : syncing ? "syncing" : "pending"}">${uploaded ? "已同步" : syncing ? "同步中" : "待同步"}</b>
      </div>
      <div class="sync-progress" ${syncing ? "" : "hidden"}><span data-progress></span></div>
      <div class="recording-actions">
        <button type="button" class="quiet-button" data-action="assign" data-id="${escapeHtml(item.id)}" ${uploaded || syncing ? "disabled" : ""}>改用目前歸檔</button>
        <button type="button" class="sync-button" data-action="sync" data-id="${escapeHtml(item.id)}" ${uploaded || syncing ? "disabled" : ""}>${uploaded ? "已驗證" : "同步到 Mac"}</button>
      </div>
    </article>`;
}

function assignCurrentDestination(id) {
  recordingDrafts[id] = currentDestination();
  saveStoredJson(draftKey, recordingDrafts);
  renderRecordingList();
}

async function syncRecording(id) {
  const plugin = recorderPlugin();
  const recording = nativeRecordings.find((item) => item.id === id);
  if (!plugin || !recording) return;
  const draft = recordingDrafts[id] || currentDestination();
  if (!draft.songId) {
    updateNativeState("error", "還不能同步", "請先在「歸檔位置」選擇歌曲，再按「改用目前歸檔」。");
    return;
  }
  if (!activeServerUrl) {
    updateNativeState("error", "主機尚未設定", "WAV 仍安全保存在手機；請先連接 Mac 主機再同步。");
    return;
  }

  syncingRecordingId = id;
  renderRecordingList();
  updateNativeState("syncing", "正在驗證並同步", `${draft.songTitle} · 0%`);
  try {
    await probeServer(activeServerUrl, 5000);
    let job = uploadJobs[id] || null;
    let offset = 0;
    if (job) {
      try {
        const status = await requestJson(`${activeServerUrl}/api/mobile/recordings/uploads/${job.uploadId}`, {
          headers: trustedHeaders({ "X-Upload-Token": job.uploadToken })
        });
        if (status.status !== "uploading") throw new Error("舊工作不可續傳");
        offset = status.nextOffset;
      } catch {
        delete uploadJobs[id];
        job = null;
      }
    }

    if (!job) {
      const started = await requestJson(`${activeServerUrl}/api/mobile/recordings/uploads`, {
        method: "POST",
        headers: trustedHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          songId: draft.songId,
          dawTrackId: draft.dawTrackId || null,
          fileName: recording.fileName,
          mimeType: "audio/wav",
          fileSizeBytes: recording.fileSizeBytes,
          sha256: recording.sha256,
          durationSeconds: recording.durationSeconds,
          sampleRate: recording.sampleRate,
          bitDepth: recording.bitDepth,
          channels: recording.channels,
          inputDeviceLabel: recording.inputDeviceLabel || "手機麥克風",
          targetInstrument: draft.targetInstrument || "vocal",
          detectionMode: "timing_pitch",
          targetBpm: draft.targetBpm || null,
          targetKey: draft.targetKey || "",
          timelineStartSeconds: 0,
          notes: "手機原生 WAV 錄音"
        })
      });
      job = { uploadId: started.uploadId, uploadToken: started.uploadToken, chunkSizeBytes: started.chunkSizeBytes };
      uploadJobs[id] = job;
      saveStoredJson(uploadJobKey, uploadJobs);
      offset = started.nextOffset || 0;
    }

    while (offset < recording.fileSizeBytes) {
      const chunk = await plugin.readChunk({ id, offset, length: job.chunkSizeBytes || 1048576 });
      const bytes = base64Bytes(chunk.data || "");
      if (!bytes.byteLength) throw new Error("手機原檔在完成前提早結束。");
      const result = await requestJson(`${activeServerUrl}/api/mobile/recordings/uploads/${job.uploadId}`, {
        method: "PUT",
        headers: trustedHeaders({
          "Content-Type": "application/octet-stream",
          "X-Upload-Offset": String(offset),
          "X-Upload-Token": job.uploadToken
        }),
        body: bytes
      }, 30000);
      offset = result.nextOffset;
      updateSyncProgress(id, offset / recording.fileSizeBytes, draft.songTitle);
    }

    const completed = await requestJson(`${activeServerUrl}/api/mobile/recordings/uploads/${job.uploadId}/complete`, {
      method: "POST",
      headers: trustedHeaders({ "X-Upload-Token": job.uploadToken })
    }, 120000);
    await plugin.markUploaded({ id, serverAudioFileId: completed.audioFileId });
    delete uploadJobs[id];
    saveStoredJson(uploadJobKey, uploadJobs);
    updateNativeState("ready", "同步與完整性驗證完成", `${draft.songTitle} 已建立 take、DAW 片段與 Audio QA；手機原檔仍保留。`);
    await refreshNativeRecordings();
    if (activeConnectionMode === "remote") await loadRecordingContext();
    else if (appFrame.contentWindow) appFrame.src = appFrame.src;
  } catch (error) {
    updateNativeState("error", "同步尚未完成", `${errorMessage(error)}。手機 WAV 原檔仍在，可稍後續傳。`);
  } finally {
    syncingRecordingId = null;
    renderRecordingList();
  }
}

function updateSyncProgress(id, ratio, songTitle) {
  const item = recordingList.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const bar = item?.querySelector("[data-progress]");
  if (bar) bar.style.width = `${Math.round(Math.min(1, ratio) * 100)}%`;
  updateNativeState("syncing", "正在驗證並同步", `${songTitle} · ${Math.round(Math.min(1, ratio) * 100)}%`);
}

function base64Bytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function formatDuration(value, precise = false) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${precise ? remainder.toFixed(1).padStart(4, "0") : String(Math.floor(remainder)).padStart(2, "0")}`;
}

function formatDb(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > -99 ? `${number.toFixed(1)} dB` : "-∞ dB";
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "發生未知錯誤");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

connectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void connect(serverUrlInput.value);
});

document.querySelectorAll("[data-url]").forEach((button) => {
  button.addEventListener("click", () => {
    serverUrlInput.value = button.dataset.url || "";
    void connect(serverUrlInput.value);
  });
});

songSelect.addEventListener("change", renderTrackOptions);
recordButton.addEventListener("click", () => void toggleRecording());
refreshRecordingsButton.addEventListener("click", () => void refreshNativeRecordings());
recorderButton.addEventListener("click", openRecorder);
remoteRecordButton.addEventListener("click", openRecorder);
remoteRefreshButton.addEventListener("click", () => void loadRecordingContext());
closeRecorderButton.addEventListener("click", closeRecorder);
recorderScrim.addEventListener("click", closeRecorder);
hostButton.addEventListener("click", showSetup);
retryButton.addEventListener("click", () => void connect(activeConnectionSource || serverUrlInput.value));
window.addEventListener("online", () => activeConnectionSource && void connect(activeConnectionSource));
window.addEventListener("offline", () => {
  setHostAvailable(false);
  if (!appView.hidden) offlineBanner.hidden = false;
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !recorderSheet.hidden) void prepareNativeRecorder();
});

renderSongOptions();
const incomingConnectLink = parseConnectLink(window.location.href) ? window.location.href : "";
const savedConnectLink = localStorage.getItem(connectLinkKey) || "";
const savedUrl = localStorage.getItem(storageKey) || fallbackUrl;
const startupTarget = incomingConnectLink || savedConnectLink || savedUrl;
const startupRemote = parseConnectLink(startupTarget);
activeConnectionMode = startupRemote ? "remote" : "direct";
activeRemoteConfig = startupRemote;
activeServerUrl = startupRemote?.relayUrl || normalizeUrl(savedUrl);
activeConnectionKey = startupRemote ? connectKeyFor(startupRemote) : activeServerUrl;
activeConnectionSource = startupTarget;
activeDeviceToken = deviceTokenFor(activeConnectionKey);
serverUrlInput.value = startupTarget;
if (incomingConnectLink || savedConnectLink || localStorage.getItem(storageKey)) void connect(startupTarget);
void prepareNativeRecorder();
