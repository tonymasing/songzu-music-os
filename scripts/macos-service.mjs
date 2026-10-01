import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SERVICE_LABEL = "com.songzu.music-os";
export const CONNECT_SERVICE_LABEL = "com.songzu.music-os-connect";
export const SERVICE_PORT = 3000;

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const uid = typeof process.getuid === "function" ? process.getuid() : null;

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function servicePaths(home = homedir()) {
  const supportRoot = join(home, "Library", "Application Support", "SongzuMusicOS", "service");
  const logRoot = join(home, "Library", "Logs", "SongzuMusicOS");
  return {
    supportRoot,
    logRoot,
    runnerPath: join(supportRoot, "run-music-os.zsh"),
    agentPath: join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`),
    connectRunnerPath: join(supportRoot, "run-songzu-connect.zsh"),
    connectAgentPath: join(home, "Library", "LaunchAgents", `${CONNECT_SERVICE_LABEL}.plist`),
    stdoutPath: join(logRoot, "service.log"),
    stderrPath: join(logRoot, "service-error.log"),
    connectStdoutPath: join(logRoot, "connect-service.log"),
    connectStderrPath: join(logRoot, "connect-service-error.log")
  };
}

export function buildRunnerScript({ projectRoot = root, nodePath, port = SERVICE_PORT }) {
  return `#!/bin/zsh
set -u

PROJECT_ROOT=${shellQuote(projectRoot)}
NODE_BIN=${shellQuote(nodePath)}
PORT=${shellQuote(String(port))}
HEALTH_URL="http://127.0.0.1:\${PORT}/api/mobile/health"
WAIT_SECONDS=10

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME=${shellQuote(homedir())}

service_log() {
  /bin/echo "[$(/bin/date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Another healthy Songzu process may already own port 3000, for example the
# desktop App. Wait for it to finish instead of creating a duplicate server.
while /usr/bin/curl --silent --fail --max-time 2 "\${HEALTH_URL}" >/dev/null 2>&1; do
  /bin/sleep 5
done

# The runner lives on the internal disk. It can therefore wait safely when the
# external music drive has not mounted yet.
while [[ ! -f "\${PROJECT_ROOT}/.next/standalone/server.js" || ! -f "\${PROJECT_ROOT}/prisma/dev.db" ]]; do
  service_log "等待音樂 OS 外接硬碟與正式建置。"
  /bin/sleep "\${WAIT_SECONDS}"
done

cd "\${PROJECT_ROOT}" || exit 78
service_log "啟動頌祖音樂 OS：\${HEALTH_URL}"
exec "\${NODE_BIN}" "\${PROJECT_ROOT}/scripts/start-standalone.mjs" --hostname 0.0.0.0 --port "\${PORT}"
`;
}

export function buildLaunchAgentPlist({ runnerPath, stdoutPath, stderrPath }) {
  return buildServiceLaunchAgentPlist({ label: SERVICE_LABEL, runnerPath, stdoutPath, stderrPath });
}

export function buildConnectRunnerScript({ projectRoot = root, nodePath, port = SERVICE_PORT }) {
  return `#!/bin/zsh
set -u

PROJECT_ROOT=${shellQuote(projectRoot)}
NODE_BIN=${shellQuote(nodePath)}
PORT=${shellQuote(String(port))}
WAIT_SECONDS=10

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME=${shellQuote(homedir())}
export SONGZU_MUSIC_OS_DATA_ROOT="\${PROJECT_ROOT}"
export SONGZU_CONNECT_LOCAL_URL="http://127.0.0.1:\${PORT}"
export SONGZU_CONNECT_LOCAL_RELAY_URL="http://127.0.0.1:39321"

while [[ ! -f "\${PROJECT_ROOT}/scripts/songzu-connect/supervisor.mjs" || ! -f "\${PROJECT_ROOT}/prisma/dev.db" ]]; do
  /bin/echo "[$(/bin/date '+%Y-%m-%d %H:%M:%S')] 等待音樂 OS 外接硬碟與 Connect 核心。"
  /bin/sleep "\${WAIT_SECONDS}"
done

cd "\${PROJECT_ROOT}" || exit 78
exec "\${NODE_BIN}" "\${PROJECT_ROOT}/scripts/songzu-connect/supervisor.mjs"
`;
}

function buildServiceLaunchAgentPlist({ label, runnerPath, stdoutPath, stderrPath }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${xmlEscape(runnerPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(dirname(runnerPath))}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

export function buildConnectLaunchAgentPlist({ connectRunnerPath, connectStdoutPath, connectStderrPath }) {
  return buildServiceLaunchAgentPlist({
    label: CONNECT_SERVICE_LABEL,
    runnerPath: connectRunnerPath,
    stdoutPath: connectStdoutPath,
    stderrPath: connectStderrPath
  });
}

function runLaunchctl(args, { allowFailure = false } = {}) {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `launchctl ${args.join(" ")} 失敗`);
  }
  return result;
}

function launchDomain() {
  if (uid === null) throw new Error("目前環境無法取得 macOS 使用者識別碼");
  return `gui/${uid}`;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForUnloaded(label = SERVICE_LABEL, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const printed = runLaunchctl(["print", `${launchDomain()}/${label}`], { allowFailure: true });
    if (printed.status !== 0) return true;
    await sleep(500);
  }
  return false;
}

async function bootstrapWithRetry(agentPath, attempts = 10) {
  let lastResult = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastResult = runLaunchctl(["bootstrap", launchDomain(), agentPath], { allowFailure: true });
    if (lastResult.status === 0) return;
    await sleep(Math.min(2_000, attempt * 250));
  }
  throw new Error(
    lastResult?.stderr.trim() || lastResult?.stdout.trim() || "launchd 多次嘗試後仍無法載入常駐核心"
  );
}

async function healthCheck(timeoutMs = 2_000) {
  try {
    const response = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/mobile/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthCheck()) return true;
    await sleep(1_000);
  }
  return false;
}

export async function getServiceStatus() {
  const paths = servicePaths();
  const printed = runLaunchctl(["print", `${launchDomain()}/${SERVICE_LABEL}`], { allowFailure: true });
  const connectPrinted = runLaunchctl(["print", `${launchDomain()}/${CONNECT_SERVICE_LABEL}`], { allowFailure: true });
  const output = `${printed.stdout}\n${printed.stderr}`;
  const connectOutput = `${connectPrinted.stdout}\n${connectPrinted.stderr}`;
  const pidMatch = output.match(/\bpid\s*=\s*(\d+)/);
  const stateMatch = output.match(/\bstate\s*=\s*([^\n]+)/);
  const connectPidMatch = connectOutput.match(/\bpid\s*=\s*(\d+)/);
  const connectStateMatch = connectOutput.match(/\bstate\s*=\s*([^\n]+)/);
  return {
    label: SERVICE_LABEL,
    installed: existsSync(paths.agentPath) && existsSync(paths.runnerPath),
    loaded: printed.status === 0,
    state: stateMatch?.[1]?.trim() ?? (printed.status === 0 ? "loaded" : "not_loaded"),
    pid: pidMatch ? Number(pidMatch[1]) : null,
    healthy: await healthCheck(),
    url: `http://127.0.0.1:${SERVICE_PORT}`,
    connect: {
      label: CONNECT_SERVICE_LABEL,
      installed: existsSync(paths.connectAgentPath) && existsSync(paths.connectRunnerPath),
      loaded: connectPrinted.status === 0,
      state: connectStateMatch?.[1]?.trim() ?? (connectPrinted.status === 0 ? "loaded" : "not_loaded"),
      pid: connectPidMatch ? Number(connectPidMatch[1]) : null,
      stdoutPath: paths.connectStdoutPath,
      stderrPath: paths.connectStderrPath
    },
    ...paths
  };
}

async function installService() {
  if (process.platform !== "darwin") throw new Error("常駐服務安裝只支援 macOS");
  const standaloneEntry = join(root, ".next", "standalone", "server.js");
  if (!existsSync(standaloneEntry)) throw new Error("找不到正式建置，請先執行 npm run build");

  const paths = servicePaths();
  const nodePath = existsSync("/opt/homebrew/bin/node") ? "/opt/homebrew/bin/node" : process.execPath;
  await Promise.all([
    mkdir(paths.supportRoot, { recursive: true }),
    mkdir(paths.logRoot, { recursive: true }),
    mkdir(dirname(paths.agentPath), { recursive: true })
  ]);
  await writeFile(paths.runnerPath, buildRunnerScript({ projectRoot: root, nodePath }), "utf8");
  await chmod(paths.runnerPath, 0o755);
  await writeFile(paths.connectRunnerPath, buildConnectRunnerScript({ projectRoot: root, nodePath }), "utf8");
  await chmod(paths.connectRunnerPath, 0o755);
  await writeFile(paths.agentPath, buildLaunchAgentPlist(paths), "utf8");
  await chmod(paths.agentPath, 0o644);
  await writeFile(paths.connectAgentPath, buildConnectLaunchAgentPlist(paths), "utf8");
  await chmod(paths.connectAgentPath, 0o644);

  const target = `${launchDomain()}/${SERVICE_LABEL}`;
  const connectTarget = `${launchDomain()}/${CONNECT_SERVICE_LABEL}`;
  runLaunchctl(["bootout", target], { allowFailure: true });
  runLaunchctl(["bootout", connectTarget], { allowFailure: true });
  if (!(await waitForUnloaded(SERVICE_LABEL))) throw new Error("舊常駐核心在 15 秒內未完成卸載");
  if (!(await waitForUnloaded(CONNECT_SERVICE_LABEL))) throw new Error("舊手機連線核心在 15 秒內未完成卸載");
  await bootstrapWithRetry(paths.agentPath);
  await bootstrapWithRetry(paths.connectAgentPath);
  runLaunchctl(["enable", target], { allowFailure: true });
  runLaunchctl(["enable", connectTarget], { allowFailure: true });
  runLaunchctl(["kickstart", target], { allowFailure: true });
  runLaunchctl(["kickstart", connectTarget], { allowFailure: true });
  const healthy = await waitForHealth();
  const status = await getServiceStatus();
  if (!status.loaded) throw new Error("常駐服務檔案已建立，但 launchd 沒有載入成功");
  if (!healthy) throw new Error(`常駐服務已載入但健康檢查逾時，請查看 ${paths.stderrPath}`);
  return { ...status, healthy };
}

async function uninstallService() {
  const paths = servicePaths();
  runLaunchctl(["bootout", `${launchDomain()}/${SERVICE_LABEL}`], { allowFailure: true });
  runLaunchctl(["bootout", `${launchDomain()}/${CONNECT_SERVICE_LABEL}`], { allowFailure: true });
  await waitForUnloaded(SERVICE_LABEL);
  await waitForUnloaded(CONNECT_SERVICE_LABEL);
  await Promise.all([
    rm(paths.agentPath, { force: true }),
    rm(paths.runnerPath, { force: true }),
    rm(paths.connectAgentPath, { force: true }),
    rm(paths.connectRunnerPath, { force: true })
  ]);
  return getServiceStatus();
}

async function restartService() {
  const status = await getServiceStatus();
  if (!status.loaded) return installService();
  runLaunchctl(["kickstart", "-k", `${launchDomain()}/${SERVICE_LABEL}`]);
  runLaunchctl(["kickstart", "-k", `${launchDomain()}/${CONNECT_SERVICE_LABEL}`], { allowFailure: true });
  await waitForHealth();
  return getServiceStatus();
}

async function main() {
  const action = process.argv[2] || "status";
  let result;
  if (action === "install") result = await installService();
  else if (action === "uninstall") result = await uninstallService();
  else if (action === "restart") result = await restartService();
  else if (action === "status") result = await getServiceStatus();
  else throw new Error(`未知服務指令：${action}`);

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  console.log(JSON.stringify({ appVersion: packageJson.version, action, ...result }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
