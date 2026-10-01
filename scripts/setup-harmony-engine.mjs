import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const engineRoot = process.env.SONGZU_HARMONY_ENGINE_ROOT || join(homedir(), "Library", "Application Support", "頌祖音樂 OS", "harmony-engine");
const venvRoot = join(engineRoot, "venv");
const python = join(venvRoot, "bin", "python");
const basicPitchPython = "/usr/bin/python3";
const vendorRoot = join(engineRoot, "vendor");
const btcRoot = join(vendorRoot, "BTC-ISMIR19");
const probeCode = [
  "import collections, collections.abc, numpy as np",
  "[setattr(collections, n, getattr(collections.abc, n)) for n in ('MutableSequence','MutableMapping','Sequence') if not hasattr(collections, n)]",
  "setattr(np, 'float', float) if not hasattr(np, 'float') else None",
  "setattr(np, 'int', int) if not hasattr(np, 'int') else None",
  "import madmom, scipy"
].join("; ");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

mkdirSync(engineRoot, { recursive: true });

const probe = spawnSync(python, ["-c", probeCode], { stdio: "ignore" });
if (probe.status !== 0) {
  run("/usr/bin/python3", ["-m", "venv", venvRoot]);
  run(python, [
    "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
    "setuptools==69.5.1", "wheel", "cython==0.29.37", "numpy==1.26.4", "scipy==1.13.1"
  ]);
  run(python, [
    "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--no-build-isolation",
    "madmom==0.16.1"
  ]);
}

run(python, ["-c", `${probeCode}; print('Songzu local neural harmony engine ready')`]);

const basicPitchProbe = spawnSync(basicPitchPython, ["-c", "import basic_pitch"], { stdio: "ignore" });
if (basicPitchProbe.status !== 0) {
  run(basicPitchPython, [
    "-m", "pip", "install", "--user", "--disable-pip-version-check", "--no-input", "basic-pitch==0.4.0"
  ]);
}

mkdirSync(vendorRoot, { recursive: true });
if (!existsSync(join(btcRoot, "test", "btc_model_large_voca.pt"))) {
  run("/usr/bin/git", ["clone", "--depth", "1", "https://github.com/jayg996/BTC-ISMIR19.git", btcRoot]);
}

run(basicPitchPython, ["-c", "import basic_pitch; print('Songzu Basic Pitch note layer ready')"]);
console.log(`Harmony engine cache: ${engineRoot}`);
console.log(`BTC external model cache: ${btcRoot}`);
