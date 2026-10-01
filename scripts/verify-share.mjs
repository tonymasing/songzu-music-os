import assert from "node:assert/strict";
import { readdir, readFile, lstat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const roots = ["src", "electron", "prisma", "public", "mobile-shell", "scripts", "native", "docs", "build", ".github"];
const ignored = new Set(["target", "node_modules", ".git", "__pycache__", "sound-assets"]);
const failures = [];
let count = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(dir, entry.name), rel = relative(root, path);
    if (entry.isSymbolicLink()) { failures.push({file: rel, reason: "source symlink"}); continue; }
    if (entry.isDirectory()) { await walk(path); continue; }
    // Locally generated dev DBs are ignored by Git; release baselines checked separately.
    if (/\.db(?:-|$)|\.pyc$/.test(entry.name)) continue;
    await inspect(path);
  }
}
async function inspect(path) {
  const name = relative(root, path);
  count++;
  if ((/(^|\/)\.env(?:\..*)?$/.test(name) || /^(?:security|uploads|exports|backups|mobile-shell\/scores)(?:\/|$)/.test(name)) && name !== ".env.example") failures.push({file:name, reason:"private path"});
  const buffer = await readFile(path);
  if (buffer.includes(0)) return;
  const source = buffer.toString("utf8");
  const checks = [
    ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["credential literal", /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,})/],
    ["personal absolute path", /\/Users\/[^\s/]+\/|\/Volumes\/[^\s/]+\/AI\//],
    ["private integration thread", /codex:\/\/threads\/[0-9a-f-]{30,}/]
  ];
  for (const [reason, pattern] of checks) if (pattern.test(source)) failures.push({file:name,reason});
}
for (const dir of roots) await walk(join(root, dir));
for (const name of ["package.json", "package-lock.json", "next.config.ts", "electron-builder.yml", ".env.example"]) await inspect(join(root,name));
const baselineArg = process.argv.find(arg => arg.startsWith("--baseline="));
let baseline = null;
if (baselineArg) {
  const path = resolve(baselineArg.slice("--baseline=".length));
  assert((await lstat(path)).isFile());
  const db = new DatabaseSync(path, {readOnly:true});
  try {
    const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const nonempty = names.filter(({name}) => db.prepare(`SELECT count(*) AS n FROM "${name.replaceAll('"','""')}"`).get().n !== 0);
    assert.deepEqual(nonempty, [], "baseline must not contain user records");
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    baseline={tables:names.length,empty:true};
  } finally { db.close(); }
}
assert.deepEqual(failures, [], "share privacy audit failed (values intentionally omitted)");
console.log(JSON.stringify({passed:true,sourceFiles:count,baseline}));
