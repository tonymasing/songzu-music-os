const { app, BrowserWindow, Menu, dialog, session, shell, utilityProcess } = require("electron");
const { spawn } = require("node:child_process");
const { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { defaultPort, projectRoot, serverScript } = require("./project-root.cjs");

const APP_NAME = "頌祖音樂 OS";
const userDataPath =
  process.env.SONGZU_ELECTRON_USER_DATA_PATH?.trim() ||
  path.join(app.getPath("appData"), "ai-music-os");
app.setPath("userData", userDataPath);

const configuredProjectRoot = projectRoot;
const port = process.env.SONGZU_MUSIC_OS_PORT || defaultPort || "3000";
const nativeServicePort = process.env.SONGZU_DAW_CORE_PORT || "39241";
const baseUrl = `http://127.0.0.1:${port}`;
const startUrl = `${baseUrl}/local-app`;

let mainWindow = null;
let serverProcess = null;
let nativeServiceProcess = null;
let songzuConnectProcess = null;
let songzuConnectRelayProcess = null;
let songzuConnectTunnelProcess = null;
let appQuitting = false;
let cachedDataRoot = null;
let cachedStorageLayout = null;

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function storageConfigPath() {
  return process.env.SONGZU_STORAGE_CONFIG_PATH?.trim() || path.join(app.getPath("userData"), "storage.json");
}

function readStorageConfig() {
  try {
    const config = JSON.parse(readFileSync(storageConfigPath(), "utf8"));
    if (
      config.version === 1 &&
      config.mode === "hybrid" &&
      typeof config.databasePath === "string" &&
      typeof config.uploadsRoot === "string" &&
      typeof config.exportsRoot === "string" &&
      typeof config.backupsRoot === "string" &&
      typeof config.soundLibraryRoot === "string" &&
      typeof config.cacheRoot === "string"
    ) {
      return config;
    }
  } catch {
    // The legacy single-root layout remains the safe fallback.
  }
  return null;
}

function readSettings() {
  try {
    const raw = readFileSync(settingsPath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  mkdirSync(path.dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
}

function hasExistingSongzuData(dataRoot) {
  return existsSync(path.join(dataRoot, "prisma", "dev.db")) || existsSync(path.join(dataRoot, "uploads")) || existsSync(path.join(dataRoot, "exports"));
}

function recommendedDataRoot() {
  if (existsSync(path.join(configuredProjectRoot, "prisma", "dev.db"))) {
    return configuredProjectRoot;
  }
  return path.join(app.getPath("documents"), "Songzu Music OS Data");
}

function askForFirstLaunchDataRoot(defaultDataRoot) {
  if (process.env.SONGZU_ELECTRON_SMOKE === "1") {
    return defaultDataRoot;
  }

  const choice = dialog.showMessageBoxSync({
    type: "info",
    title: `${APP_NAME} 資料位置`,
    message: "設定你的音樂資料資料夾",
    detail: [
      "這個資料夾會保存 SQLite 資料庫、uploads 原始音檔、exports 輸出檔與本機分析結果。",
      "",
      "App 安裝包只包含程式與空白 baseline，不會把你的作品資料塞進 DMG。"
    ].join("\n"),
    buttons: ["使用建議位置", "選擇資料夾"],
    defaultId: 0,
    cancelId: 0
  });

  if (choice !== 1) {
    return defaultDataRoot;
  }

  const selected = dialog.showOpenDialogSync({
    title: "選擇頌祖音樂 OS 資料資料夾",
    defaultPath: path.dirname(defaultDataRoot),
    properties: ["openDirectory", "createDirectory"]
  });

  return selected?.[0] || defaultDataRoot;
}

function chooseDataRootForFuture() {
  const url = `${baseUrl}/settings#storage-layout`;
  if (mainWindow) mainWindow.loadURL(url);
  else shell.openExternal(url);
}

function resolveDataRoot() {
  if (cachedDataRoot) {
    return cachedDataRoot;
  }
  if (process.env.SONGZU_MUSIC_OS_DATA_ROOT) {
    cachedDataRoot = process.env.SONGZU_MUSIC_OS_DATA_ROOT;
    return cachedDataRoot;
  }

  const storageConfig = readStorageConfig();
  if (storageConfig?.dataRoot) {
    cachedDataRoot = storageConfig.dataRoot;
    return cachedDataRoot;
  }

  const settings = readSettings();
  if (typeof settings.dataRoot === "string" && settings.dataRoot.trim()) {
    cachedDataRoot = settings.dataRoot;
    return cachedDataRoot;
  }

  const defaultDataRoot = recommendedDataRoot();
  const dataRoot = hasExistingSongzuData(defaultDataRoot) ? defaultDataRoot : askForFirstLaunchDataRoot(defaultDataRoot);
  writeSettings({
    ...settings,
    dataRoot,
    initializedAt: settings.initializedAt || new Date().toISOString()
  });

  cachedDataRoot = dataRoot;
  return cachedDataRoot;
}

function resolveStorageLayout() {
  if (cachedStorageLayout) return cachedStorageLayout;
  const explicitRoot = process.env.SONGZU_MUSIC_OS_DATA_ROOT?.trim();
  const config = explicitRoot ? null : readStorageConfig();
  const dataRoot = explicitRoot || config?.dataRoot || resolveDataRoot();
  const standaloneEntry = standaloneServerEntry();
  const bundledAssetsRoot = standaloneEntry ? path.dirname(standaloneEntry) : configuredProjectRoot;
  cachedStorageLayout = {
    mode: config ? "hybrid" : "legacy",
    dataRoot,
    databasePath:
      process.env.SONGZU_MUSIC_OS_DATABASE_PATH?.trim() || config?.databasePath || path.join(dataRoot, "prisma", "dev.db"),
    uploadsRoot:
      process.env.SONGZU_MUSIC_OS_UPLOADS_ROOT?.trim() || config?.uploadsRoot || path.join(dataRoot, "uploads"),
    exportsRoot:
      process.env.SONGZU_MUSIC_OS_EXPORTS_ROOT?.trim() || config?.exportsRoot || path.join(dataRoot, "exports"),
    backupsRoot:
      process.env.SONGZU_MUSIC_OS_BACKUPS_ROOT?.trim() || config?.backupsRoot || path.join(dataRoot, "exports", "system-backups"),
    soundLibraryRoot:
      process.env.SONGZU_MUSIC_OS_SOUND_LIBRARY_ROOT?.trim() ||
      config?.soundLibraryRoot ||
      path.join(bundledAssetsRoot, "public", "sound-assets"),
    cacheRoot:
      process.env.SONGZU_MUSIC_OS_CACHE_ROOT?.trim() || config?.cacheRoot || path.join(dataRoot, ".cache")
  };
  return cachedStorageLayout;
}

function resolveLogPath() {
  return path.join(app.getPath("userData"), "logs", "server.log");
}

function resolveDawCoreLogPath() {
  return path.join(app.getPath("userData"), "logs", "daw-core.log");
}

function resolveSongzuConnectLogPath() {
  return path.join(app.getPath("userData"), "logs", "songzu-connect.log");
}

function ensureLogDir() {
  mkdirSync(path.dirname(resolveLogPath()), { recursive: true });
}

function baselineDatabasePath() {
  const candidates = [
    path.join(process.resourcesPath || "", "electron-baseline", "prisma", "dev.db"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "electron-baseline", "prisma", "dev.db"),
    path.join(__dirname, "..", "electron-baseline", "prisma", "dev.db"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "prisma", "dev.db"),
    path.join(__dirname, "..", "prisma", "dev.db"),
    path.join(configuredProjectRoot, "prisma", "dev.db")
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function standaloneServerEntry() {
  const candidates = [
    path.join(process.resourcesPath || "", ".next", "standalone", "server.js"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", ".next", "standalone", "server.js"),
    path.join(__dirname, "..", ".next", "standalone", "server.js"),
    path.join(configuredProjectRoot, ".next", "standalone", "server.js")
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function nativeServiceEntry() {
  const binaryName = process.platform === "win32" ? "songzu-daw-core.exe" : "songzu-daw-core";
  const candidates = [
    path.join(process.resourcesPath || "", "native", "songzu-daw-core", "target", "release", binaryName),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "native", "songzu-daw-core", "target", "release", binaryName),
    path.join(__dirname, "..", "native", "songzu-daw-core", "target", "release", binaryName),
    path.join(configuredProjectRoot, "native", "songzu-daw-core", "target", "release", binaryName)
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function storageMigrationWorkerEntry() {
  const candidates = [
    path.join(process.resourcesPath || "", "storage-worker", "storage-migration-worker.mjs"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "storage-worker", "storage-migration-worker.mjs"),
    path.join(__dirname, "..", "scripts", "storage-migration-worker.mjs"),
    path.join(configuredProjectRoot, "scripts", "storage-migration-worker.mjs")
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function songzuConnectHostEntry() {
  const candidates = [
    path.join(process.resourcesPath || "", "songzu-connect", "host.mjs"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "songzu-connect", "host.mjs"),
    path.join(__dirname, "..", "scripts", "songzu-connect", "host.mjs"),
    path.join(configuredProjectRoot, "scripts", "songzu-connect", "host.mjs")
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function songzuConnectWorkerEntry(fileName) {
  const candidates = [
    path.join(process.resourcesPath || "", "songzu-connect", fileName),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "songzu-connect", fileName),
    path.join(__dirname, "..", "scripts", "songzu-connect", fileName),
    path.join(configuredProjectRoot, "scripts", "songzu-connect", fileName)
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function mobileShellRoot() {
  const candidates = [
    path.join(process.resourcesPath || "", "mobile-shell"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "mobile-shell"),
    path.join(__dirname, "..", "mobile-shell"),
    path.join(configuredProjectRoot, "mobile-shell")
  ];
  return candidates.find((candidate) => candidate && existsSync(path.join(candidate, "index.html")));
}

function ensureDataRoot() {
  const layout = resolveStorageLayout();
  mkdirSync(layout.dataRoot, { recursive: true });
  mkdirSync(path.dirname(layout.databasePath), { recursive: true });
  mkdirSync(layout.uploadsRoot, { recursive: true });
  mkdirSync(layout.exportsRoot, { recursive: true });
  mkdirSync(layout.backupsRoot, { recursive: true });
  mkdirSync(layout.soundLibraryRoot, { recursive: true });
  mkdirSync(layout.cacheRoot, { recursive: true });
  const referenceRoot = process.env.MUSIC_REFERENCE_ROOT?.trim() || path.join(layout.dataRoot, "music-db");
  mkdirSync(path.join(referenceRoot, "00_INBOX"), { recursive: true });
  mkdirSync(path.join(referenceRoot, "_metadata", "song_notes"), { recursive: true });

  const databasePath = layout.databasePath;
  const baselinePath = baselineDatabasePath();
  if (!existsSync(databasePath) && baselinePath) {
    copyFileSync(baselinePath, databasePath);
  }

  return layout;
}

function probe(url = startUrl, timeoutMs = 850) {
  return new Promise((resolve) => {
    const request = http.request(url, { method: "HEAD", timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(Boolean(response.statusCode && response.statusCode < 500));
    });

    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.end();
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (await probe()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function launchServer() {
  const layout = ensureDataRoot();
  ensureLogDir();

  const standaloneEntry = standaloneServerEntry();
  if (!standaloneEntry && !existsSync(configuredProjectRoot)) {
    dialog.showErrorBox(APP_NAME, `找不到專案資料夾：\n${configuredProjectRoot}`);
    return;
  }

  const logPath = resolveLogPath();
  const logStream = createWriteStream(logPath, { flags: "a" });

  const modeLabel = standaloneEntry ? `standalone ${standaloneEntry}` : `npm run ${serverScript}`;
  logStream.write(`\n\n[${new Date().toISOString()}] Electron 啟動 ${modeLabel}\n`);

  const serverEnv = {
    ...process.env,
    HOSTNAME: "0.0.0.0",
    PORT: port,
    DATABASE_URL: `file:${layout.databasePath}`,
    SONGZU_MUSIC_OS_DATA_ROOT: layout.dataRoot,
    SONGZU_MUSIC_OS_DATABASE_PATH: layout.databasePath,
    SONGZU_MUSIC_OS_UPLOADS_ROOT: layout.uploadsRoot,
    SONGZU_MUSIC_OS_EXPORTS_ROOT: layout.exportsRoot,
    SONGZU_MUSIC_OS_BACKUPS_ROOT: layout.backupsRoot,
    SONGZU_MUSIC_OS_SOUND_LIBRARY_ROOT: layout.soundLibraryRoot,
    SONGZU_MUSIC_OS_CACHE_ROOT: layout.cacheRoot,
    SONGZU_STORAGE_MODE: layout.mode,
    SONGZU_MUSIC_OS_APP_ASSETS_ROOT: standaloneEntry ? path.dirname(standaloneEntry) : configuredProjectRoot,
    SONGZU_STORAGE_CONFIG_PATH: storageConfigPath(),
    SONGZU_STORAGE_USER_DATA_ROOT: app.getPath("userData"),
    SONGZU_STORAGE_MIGRATION_WORKER: storageMigrationWorkerEntry() || "",
    SONGZU_DAW_CORE_PORT: nativeServicePort,
    PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ""}`
  };

  if (standaloneEntry) {
    serverProcess = utilityProcess.fork(standaloneEntry, [], {
      cwd: layout.dataRoot,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
      serviceName: "Songzu Music Server",
      allowLoadingUnsignedLibraries: true
    });
  } else {
    serverProcess = spawn(npmCommand(), ["run", serverScript, "--", "--hostname", "0.0.0.0", "--port", port], {
      cwd: configuredProjectRoot,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });
  }

  serverProcess.stdout?.pipe(logStream);
  serverProcess.stderr?.pipe(logStream);

  serverProcess.on("exit", (code, signal) => {
    logStream.write(`\n[${new Date().toISOString()}] server exit code=${code ?? ""} signal=${signal ?? ""}\n`);
    if (!appQuitting && mainWindow) {
      mainWindow.webContents.send?.("server-exit");
    }
  });
}

function launchNativeService() {
  if (nativeServiceProcess && !nativeServiceProcess.killed) return;
  const layout = ensureDataRoot();
  ensureLogDir();
  const entry = nativeServiceEntry();
  const logPath = resolveDawCoreLogPath();
  const logStream = createWriteStream(logPath, { flags: "a" });

  if (!entry) {
    logStream.write(`\n[${new Date().toISOString()}] songzu-daw-core binary not found; Web fallback will be used.\n`);
    return;
  }

  logStream.write(`\n\n[${new Date().toISOString()}] Electron 啟動 native DAW service ${entry}\n`);
  nativeServiceProcess = spawn(entry, [], {
    cwd: layout.dataRoot,
    env: {
      ...process.env,
      SONGZU_MUSIC_OS_DATA_ROOT: path.dirname(layout.uploadsRoot),
      SONGZU_MUSIC_OS_UPLOADS_ROOT: layout.uploadsRoot,
      SONGZU_DAW_CORE_PORT: nativeServicePort,
      PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ""}`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  nativeServiceProcess.stdout?.pipe(logStream);
  nativeServiceProcess.stderr?.pipe(logStream);
  nativeServiceProcess.on("exit", (code, signal) => {
    logStream.write(`\n[${new Date().toISOString()}] daw-core exit code=${code ?? ""} signal=${signal ?? ""}\n`);
  });
}

function launchSongzuConnect() {
  if (songzuConnectProcess && !songzuConnectProcess.killed) return;
  if (persistentSongzuConnectServiceActive()) return;
  const layout = ensureDataRoot();
  ensureLogDir();
  const entry = songzuConnectHostEntry();
  const logStream = createWriteStream(resolveSongzuConnectLogPath(), { flags: "a" });

  if (!entry) {
    logStream.write(`\n[${new Date().toISOString()}] songzu-connect host worker not found.\n`);
    return;
  }

  logStream.write(`\n\n[${new Date().toISOString()}] Electron 啟動 Songzu Connect host ${entry}\n`);
  songzuConnectProcess = utilityProcess.fork(entry, [], {
    cwd: layout.dataRoot,
    env: {
      ...process.env,
      SONGZU_MUSIC_OS_DATA_ROOT: layout.dataRoot,
      SONGZU_CONNECT_LOCAL_URL: baseUrl,
      SONGZU_CONNECT_LOCAL_RELAY_URL: "http://127.0.0.1:39321",
      SONGZU_APP_VERSION: app.getVersion()
    },
    stdio: ["ignore", "pipe", "pipe"],
    serviceName: "Songzu Connect Host",
    allowLoadingUnsignedLibraries: true
  });
  songzuConnectProcess.stdout?.pipe(logStream);
  songzuConnectProcess.stderr?.pipe(logStream);
  songzuConnectProcess.on("exit", (code) => {
    logStream.write(`\n[${new Date().toISOString()}] songzu-connect exit code=${code ?? ""}\n`);
  });
}

function launchSongzuConnectRelay() {
  if (songzuConnectRelayProcess && !songzuConnectRelayProcess.killed) return;
  if (persistentSongzuConnectServiceActive()) return;
  const layout = ensureDataRoot();
  ensureLogDir();
  const entry = songzuConnectWorkerEntry("relay.mjs");
  const webRoot = mobileShellRoot();
  const logStream = createWriteStream(resolveSongzuConnectLogPath(), { flags: "a" });
  if (!entry || !webRoot) {
    logStream.write(`\n[${new Date().toISOString()}] quick relay worker or mobile shell not found.\n`);
    return;
  }
  logStream.write(`\n[${new Date().toISOString()}] Electron 啟動 Songzu Connect local relay ${entry}\n`);
  songzuConnectRelayProcess = utilityProcess.fork(entry, [], {
    cwd: layout.dataRoot,
    env: {
      ...process.env,
      SONGZU_CONNECT_RELAY_HOST: "127.0.0.1",
      SONGZU_CONNECT_RELAY_PORT: "39321",
      SONGZU_CONNECT_RELAY_DATA: path.join(layout.dataRoot, "security", "songzu-connect-relay.json"),
      SONGZU_CONNECT_WEB_ROOT: webRoot
    },
    stdio: ["ignore", "pipe", "pipe"],
    serviceName: "Songzu Connect Relay",
    allowLoadingUnsignedLibraries: true
  });
  songzuConnectRelayProcess.stdout?.pipe(logStream);
  songzuConnectRelayProcess.stderr?.pipe(logStream);
  songzuConnectRelayProcess.on("exit", (code) => {
    logStream.write(`\n[${new Date().toISOString()}] songzu-connect relay exit code=${code ?? ""}\n`);
  });
}

function launchSongzuConnectTunnel() {
  if (songzuConnectTunnelProcess && !songzuConnectTunnelProcess.killed) return;
  if (persistentSongzuConnectServiceActive()) return;
  const layout = ensureDataRoot();
  ensureLogDir();
  const entry = songzuConnectWorkerEntry("tunnel.mjs");
  const logStream = createWriteStream(resolveSongzuConnectLogPath(), { flags: "a" });
  if (!entry) {
    logStream.write(`\n[${new Date().toISOString()}] quick tunnel supervisor not found.\n`);
    return;
  }
  logStream.write(`\n[${new Date().toISOString()}] Electron 啟動 Songzu Connect tunnel supervisor ${entry}\n`);
  songzuConnectTunnelProcess = utilityProcess.fork(entry, [], {
    cwd: layout.dataRoot,
    env: {
      ...process.env,
      SONGZU_MUSIC_OS_DATA_ROOT: layout.dataRoot,
      SONGZU_CONNECT_LOCAL_RELAY_URL: "http://127.0.0.1:39321",
      PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ""}`
    },
    stdio: ["ignore", "pipe", "pipe"],
    serviceName: "Songzu Connect Tunnel",
    allowLoadingUnsignedLibraries: true
  });
  songzuConnectTunnelProcess.stdout?.pipe(logStream);
  songzuConnectTunnelProcess.stderr?.pipe(logStream);
  songzuConnectTunnelProcess.on("exit", (code) => {
    logStream.write(`\n[${new Date().toISOString()}] songzu-connect tunnel exit code=${code ?? ""}\n`);
  });
}

function managedProcessFresh(statusPath, pidKey, maxAgeMs) {
  try {
    const status = JSON.parse(readFileSync(statusPath, "utf8"));
    const updatedAt = status.updatedAt ? new Date(status.updatedAt).getTime() : 0;
    const pid = Number(status[pidKey]);
    if (!Number.isInteger(pid) || pid <= 0 || Date.now() - updatedAt >= maxAgeMs) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function persistentSongzuConnectServiceActive() {
  const securityRoot = path.join(ensureDataRoot().dataRoot, "security");
  return (
    managedProcessFresh(path.join(securityRoot, "songzu-connect-tunnel-status.json"), "managerPid", 12_000) &&
    managedProcessFresh(path.join(securityRoot, "songzu-connect-status.json"), "pid", 45_000)
  );
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }
}

function stopNativeService() {
  if (nativeServiceProcess && !nativeServiceProcess.killed) {
    nativeServiceProcess.kill("SIGTERM");
  }
}

function stopSongzuConnect() {
  if (songzuConnectProcess && !songzuConnectProcess.killed) {
    songzuConnectProcess.kill();
  }
  if (songzuConnectTunnelProcess && !songzuConnectTunnelProcess.killed) {
    songzuConnectTunnelProcess.kill();
  }
  if (songzuConnectRelayProcess && !songzuConnectRelayProcess.killed) {
    songzuConnectRelayProcess.kill();
  }
}

function loadingHtml(message) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html lang="zh-Hant">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${APP_NAME}</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #f5f4ee;
            color: #20241f;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          main {
            width: min(560px, calc(100vw - 48px));
            border: 1px solid #dedccc;
            border-radius: 14px;
            background: #fff;
            padding: 28px;
            box-shadow: 0 18px 48px rgba(32, 36, 31, .07);
          }
          h1 { margin: 0 0 10px; font-size: 28px; }
          p { color: #686e63; line-height: 1.55; }
          code { background: #eeeee5; border-radius: 6px; padding: 2px 6px; }
        </style>
      </head>
      <body>
        <main>
          <h1>${APP_NAME}</h1>
          <p>${message}</p>
          <p>本機入口：<code>${startUrl}</code></p>
        </main>
      </body>
    </html>
  `)}`;
}

function createMenu() {
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: "about", label: `關於 ${APP_NAME}` },
        { type: "separator" },
        { role: "quit", label: "結束" }
      ]
    },
    {
      label: "檢視",
      submenu: [
        { role: "reload", label: "重新整理" },
        { role: "toggleDevTools", label: "開發者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "重設縮放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "縮小" },
        { role: "togglefullscreen", label: "全螢幕" }
      ]
    },
    {
      label: "本機",
      submenu: [
        {
          label: "在瀏覽器開啟",
          click: () => shell.openExternal(startUrl)
        },
        {
          label: "開啟媒體資料夾",
          click: () => shell.openPath(resolveStorageLayout().dataRoot)
        },
        {
          label: "開啟資料庫位置",
          click: () => shell.openPath(path.dirname(resolveStorageLayout().databasePath))
        },
        {
          label: "儲存配置與安全搬移...",
          click: () => chooseDataRootForFuture()
        },
        {
          label: "開啟安裝與資料說明",
          click: () => {
            if (mainWindow) {
              mainWindow.loadURL(`${startUrl}#install-safety`);
            } else {
              shell.openExternal(`${startUrl}#install-safety`);
            }
          }
        },
        {
          label: "查看 server.log",
          click: () => shell.openPath(resolveLogPath())
        },
        {
          label: "查看 daw-core.log",
          click: () => shell.openPath(resolveDawCoreLogPath())
        },
        {
          label: "查看 songzu-connect.log",
          click: () => shell.openPath(resolveSongzuConnectLogPath())
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function configureMediaPermissions() {
  const isTrustedLocalUrl = (url = "") => url.startsWith(`${baseUrl}/`) || url === baseUrl;
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return permission === "media" && isTrustedLocalUrl(requestingOrigin);
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(permission === "media" && isTrustedLocalUrl(requestingUrl));
  });
}

async function prepareRuntimeCache() {
  const settings = readSettings();
  const runtimeVersion = app.getVersion();
  if (settings.runtimeCacheVersion === runtimeVersion) return;

  await session.defaultSession.clearCache();
  await session.defaultSession.clearStorageData({
    storages: ["serviceworkers", "cachestorage"]
  });
  writeSettings({
    ...settings,
    runtimeCacheVersion: runtimeVersion,
    runtimeCacheUpdatedAt: new Date().toISOString()
  });
}

async function createWindow() {
  launchNativeService();
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: "#f5f4ee",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseUrl)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(loadingHtml("正在啟動本機音樂主機..."));

  if (!(await probe())) {
    launchServer();
  }

  const ready = await waitForServer();
  if (!ready) {
    await mainWindow.loadURL(loadingHtml(`啟動失敗，請查看 log：${resolveLogPath()}`));
    dialog.showErrorBox(APP_NAME, `本機服務未啟動成功。\n\nLog：${resolveLogPath()}`);
    return;
  }

  launchSongzuConnectRelay();
  launchSongzuConnectTunnel();
  launchSongzuConnect();
  await mainWindow.loadURL(startUrl);
}

async function runSmokeTest() {
  launchNativeService();
  if (!(await probe())) {
    launchServer();
  }

  let ready = await waitForServer();
  let smokeWindow = null;
  if (ready) {
    try {
      if (process.env.SONGZU_ELECTRON_SMOKE_SKIP_CONNECT !== "1") {
        launchSongzuConnectRelay();
        launchSongzuConnectTunnel();
        launchSongzuConnect();
      }
      smokeWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      await smokeWindow.loadURL(startUrl);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (!(await probe(`${baseUrl}/api/mobile/health`, 2000))) {
          ready = false;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (ready && !(await probe(`${baseUrl}/api/songs`, 5000))) {
        ready = false;
        console.error("electron-smoke-data-api-failed /api/songs");
      }
      if (ready) {
        await smokeWindow.loadURL(`${baseUrl}/music-db/references`);
        const referencesReady = await smokeWindow.webContents.executeJavaScript(`(async () => {
          const response = await fetch('/api/music-references');
          if (!response.ok) return false;
          const { items } = await response.json();
          const bundled = items.filter(item => item.notesAuthor === 'Tony');
          if (bundled.length !== 2) return false;
          for (const item of bundled) {
            if (!item.audioAvailable || item.matchStatus !== 'MATCHED' || !item.preferenceNotes.length || !item.referenceUses.length || !item.priorityNotes.length) return false;
            const range = await fetch(item.audioUrl, { headers: { Range: 'bytes=0-1023' } });
            if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 1024) return false;
            const audio = new Audio(item.audioUrl);
            audio.muted = true;
            await audio.play();
            await new Promise(resolve => setTimeout(resolve, 250));
            const playing = !audio.paused && audio.currentTime > 0;
            audio.pause(); audio.removeAttribute('src'); audio.load();
            if (!playing) return false;
          }
          return true;
        })()`, true);
        if (!referencesReady) throw new Error("bundled reference playback smoke failed");
        console.log("electron-smoke-bundled-references 2 matched/playable");
      }
      if (ready) {
        await smokeWindow.loadURL(`${baseUrl}/daw`);
        const routeHasError = await smokeWindow.webContents.executeJavaScript(
          `document.body.innerText.includes("這個區塊暫時沒有載入成功")`,
          true
        );
        ready = !routeHasError;
      }
    } catch (error) {
      ready = false;
      console.error(`electron-smoke-window-failed ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      smokeWindow?.destroy();
    }
  }

  if (ready) {
    console.log(`electron-smoke-ready ${startUrl}`);
  } else {
    console.error(`electron-smoke-failed ${resolveLogPath()}`);
  }

  stopServer();
  stopNativeService();
  stopSongzuConnect();
  app.exit(ready ? 0 : 1);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    app.setName(APP_NAME);
    await prepareRuntimeCache();
    if (process.env.SONGZU_ELECTRON_SMOKE === "1") {
      await runSmokeTest();
      return;
    }

    configureMediaPermissions();
    createMenu();
    await createWindow();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow();
      }
    });
  });
}

app.on("before-quit", () => {
  appQuitting = true;
  stopServer();
  stopNativeService();
  stopSongzuConnect();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
