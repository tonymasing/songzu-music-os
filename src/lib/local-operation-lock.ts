import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { storagePath } from "@/lib/paths";

function processIsAlive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

// A separate local coordination database, never the user's song database.
// SQLite serializes acquisition across dev/desktop processes; age alone never
// authorizes stealing a lock from a still-running operation.
export function acquireLocalOperationLock(resource: string): (() => void) | null {
  const directory = storagePath("cache", "operation-locks");
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, "locks.sqlite"), { timeout: 1000 });
  const token = randomUUID();
  try {
    db.exec("CREATE TABLE IF NOT EXISTS OperationLock (resource TEXT PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL)");
    db.exec("BEGIN IMMEDIATE");
    const owner = db.prepare("SELECT pid FROM OperationLock WHERE resource = ?").get(resource);
    if (owner && processIsAlive(Number(owner.pid))) {
      db.exec("ROLLBACK");
      db.close();
      return null;
    }
    db.prepare("DELETE FROM OperationLock WHERE resource = ?").run(resource);
    db.prepare("INSERT INTO OperationLock VALUES (?, ?, ?)").run(resource, token, process.pid);
    db.exec("COMMIT");
  } catch (error) {
    db.close();
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    try {
      db.prepare("DELETE FROM OperationLock WHERE resource = ? AND token = ?").run(resource, token);
    } finally {
      released = true;
      db.close();
    }
  };
}
