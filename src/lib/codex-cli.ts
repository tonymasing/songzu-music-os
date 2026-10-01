import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type JsonSchema = Record<string, unknown>;

type CodexStructuredRequest<T> = {
  prompt: string;
  outputSchema: JsonSchema;
  parse: (value: unknown) => T;
  timeoutMs?: number;
  signal?: AbortSignal;
};

function runProcess(command: string, args: string[], input: string | null, timeoutMs: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString("utf8")}`.slice(-2_000_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    let stoppedReason: string | null = null;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (reason: string) => {
      if (stoppedReason) return;
      stoppedReason = reason;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      killTimer.unref();
    };
    const abort = () => terminate("已取消 Codex 請求。");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => terminate("Codex 回覆逾時，已停止這次請求。"), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (stoppedReason) reject(new Error(stoppedReason));
      else resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    child.stdin.on("error", () => terminate("Codex 輸入管線已關閉。"));
    child.stdin.end(input ?? undefined);
  });
}

export async function resolveCodexCliPath() {
  const candidates = [
    process.env.SONGZU_CODEX_CLI_PATH,
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex"
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known app path.
    }
  }
  return null;
}

export async function getCodexCliConnection() {
  const cliPath = await resolveCodexCliPath();
  if (!cliPath) return { connected: false, cliPath: null, message: "找不到 Codex CLI。" };
  try {
    const result = await runProcess(cliPath, ["login", "status"], null, 5_000);
    const connected = result.exitCode === 0 && /logged in/i.test(`${result.stdout}\n${result.stderr}`);
    return {
      connected,
      cliPath,
      message: connected ? "已透過這台 Mac 的 ChatGPT 登入連接 Codex。" : "Codex 尚未登入 ChatGPT。"
    };
  } catch (error) {
    return {
      connected: false,
      cliPath,
      message: error instanceof Error ? error.message : "無法確認 Codex 登入狀態。"
    };
  }
}

function parseCodexModel(output: string) {
  return output.match(/(?:^|\n)model:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
}

export async function runCodexStructured<T>(request: CodexStructuredRequest<T>) {
  request.signal?.throwIfAborted();
  const cliPath = await resolveCodexCliPath();
  if (!cliPath) throw new Error("找不到 Codex CLI。");
  const runDir = await mkdtemp(join(tmpdir(), "songzu-codex-"));
  const schemaPath = join(runDir, "output-schema.json");
  const outputPath = join(runDir, "answer.json");
  try {
    await writeFile(schemaPath, JSON.stringify(request.outputSchema));
    const args = [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--disable",
      "shell_tool",
      "--disable",
      "unified_exec",
      "--disable",
      "apps",
      "--disable",
      "browser_use",
      "--disable",
      "computer_use",
      "--color",
      "never",
      "--json",
      "-C",
      runDir,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath
    ];
    if (process.env.SONGZU_CODEX_MODEL) args.push("--model", process.env.SONGZU_CODEX_MODEL);
    args.push("-");
    const result = await runProcess(cliPath, args, request.prompt, request.timeoutMs ?? 180_000, request.signal);
    if (result.exitCode !== 0) throw new Error(`Codex 執行失敗（exit ${result.exitCode}）。`);
    const raw = await readFile(outputPath, "utf8");
    return {
      value: request.parse(JSON.parse(raw)),
      model: parseCodexModel(`${result.stderr}\n${result.stdout}`) || process.env.SONGZU_CODEX_MODEL || "Codex 預設模型"
    };
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}
