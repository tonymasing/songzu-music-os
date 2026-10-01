import { Worker } from "node:worker_threads";

// Run SQLite's snapshot and integrity scan off the request/event-loop thread.
// A read-only connection includes committed WAL pages without touching source rows.
const snapshotWorker = `
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
try {
  const source = new DatabaseSync(workerData.source, { readOnly: true, timeout: 5000 });
  try { source.prepare("VACUUM INTO ?").run(workerData.target); }
  finally { source.close(); }
  const snapshot = new DatabaseSync(workerData.target, { readOnly: true });
  try {
    const integrity = snapshot.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw new Error("SQLite integrity_check failed");
    if (snapshot.prepare("PRAGMA foreign_key_check").all().length) throw new Error("SQLite foreign_key_check failed");
  } finally { snapshot.close(); }
  parentPort.postMessage({ ok: true });
} catch (error) { parentPort.postMessage({ ok: false, error: error.message }); }
`;

export function createSqliteSnapshot(source: string, target: string, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(snapshotWorker, { eval: true, workerData: { source, target } });
    let outcome: { ok: boolean; error?: string } | undefined;
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error("資料庫快照逾時，備份未發佈；原始資料保留。");
      void worker.terminate();
    }, timeoutMs);
    worker.on("message", (message) => { outcome = message; });
    worker.on("error", (error) => { failure = error instanceof Error ? error : new Error(String(error)); });
    worker.on("exit", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || !outcome?.ok) reject(new Error(outcome?.error || `資料庫快照未完成 (${code})`));
      else resolve();
    });
  });
}
