import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kitFolder = join(root, "public", "sound-assets", "originals", "oramics-pearl-master-studio");
const sourcePage = "https://oramics.github.io/sampled/DRUMS/pearl-master-studio/";
const sampleBase = `${sourcePage}samples/`;
const licenseName = "Creative Commons Attribution 3.0";
const licenseUrl = "https://creativecommons.org/licenses/by/3.0/";
const files = [
  "kick-01.wav",
  "snare-01.wav",
  "snare-02.wav",
  "snare-03.wav",
  "hihat-closed.wav",
  "hihat-open.wav",
  "tom-01.wav",
  "tom-02.wav",
  "tom-03.wav",
  "crash-01.wav",
  "crash-02.wav",
  "ride-01.wav",
  "ride-02.wav",
  "splash-01.wav",
  "splash-02.wav"
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function download(fileName) {
  const destination = join(kitFolder, fileName);
  if (!(await exists(destination))) {
    const response = await fetch(`${sampleBase}${fileName}`);
    if (!response.ok) throw new Error(`下載 ${fileName} 失敗：HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.subarray(0, 4).toString("ascii") !== "RIFF") throw new Error(`${fileName} 不是有效 WAV。`);
    await writeFile(destination, bytes);
  }
  const bytes = await readFile(destination);
  if (bytes.subarray(0, 4).toString("ascii") !== "RIFF") throw new Error(`${fileName} 本機檔案不是有效 WAV。`);
  return { fileName, bytes: bytes.length, sha256: sha256(bytes) };
}

await mkdir(kitFolder, { recursive: true });
const downloaded = [];
for (const fileName of files) {
  process.stdout.write(`檢查真人鼓取樣：${fileName}\n`);
  downloaded.push(await download(fileName));
}

const manifest = {
  name: "Pearl Master Studio Pack 1",
  creator: "enoe",
  sourcePage,
  licenseName,
  licenseUrl,
  importedAt: new Date().toISOString(),
  files: downloaded
};
await writeFile(join(kitFolder, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  join(kitFolder, "ATTRIBUTION.md"),
  `# Pearl Master Studio Pack 1\n\n- Creator: enoe\n- Source: ${sourcePage}\n- License: ${licenseName}\n- License URL: ${licenseUrl}\n\nThe samples remain under their original license.\n`
);

const totalBytes = (await Promise.all(files.map((fileName) => stat(join(kitFolder, fileName))))).reduce((sum, item) => sum + item.size, 0);
const prisma = new PrismaClient();
try {
  await prisma.soundLibraryItem.upsert({
    where: { id: "sound_pearl_master_studio_acoustic_kit" },
    create: {
      id: "sound_pearl_master_studio_acoustic_kit",
      name: "Pearl Master Studio 真人鼓組",
      itemType: "instrument",
      family: "鼓組 / 真實取樣",
      era: "現代錄音室",
      source: "Oramics Sampled · Pearl Master Studio Pack 1 by enoe",
      description: "Kick、三組 Snare、Hi-hat、Toms、Crash、Ride 與 Splash 的真實鼓組取樣，供本機 AI 鼓編制進行 round-robin 與真人化播放。",
      tagsJson: JSON.stringify(["acoustic-drums", "humanized", "round-robin", "kick", "snare", "hihat", "tom", "cymbal"]),
      characterJson: JSON.stringify(["自然", "錄音室", "有空氣感", "非電子鼓機"]),
      useCasesJson: JSON.stringify(["AI 鼓編制", "敬拜漸進", "流行抒情", "真人鼓手草稿"]),
      chainJson: JSON.stringify(["Velocity layers", "Round-robin", "Micro-timing", "Light room ambience"]),
      garageBandHint: "可匯出 AI 鼓 Stem 後拖入 GarageBand，保留原始速度並從第 0 秒對齊。",
      notes: `素材目錄：${kitFolder}\n授權與 manifest 已隨檔保存。`,
      assetPath: "/sound-assets/originals/oramics-pearl-master-studio/kick-01.wav",
      previewPath: "/sound-assets/originals/oramics-pearl-master-studio/snare-02.wav",
      sourceUrl: sourcePage,
      licenseName,
      licenseUrl,
      fileSizeBytes: totalBytes,
      sha256: sha256(Buffer.from(downloaded.map((item) => item.sha256).join(""))),
      status: "ACTIVE"
    },
    update: {
      source: "Oramics Sampled · Pearl Master Studio Pack 1 by enoe",
      notes: `素材目錄：${kitFolder}\n授權與 manifest 已隨檔保存。`,
      fileSizeBytes: totalBytes,
      sha256: sha256(Buffer.from(downloaded.map((item) => item.sha256).join(""))),
      status: "ACTIVE"
    }
  });
} finally {
  await prisma.$disconnect();
}

console.log(`真人鼓組匯入完成：${files.length} 個 WAV，${(totalBytes / 1024 / 1024).toFixed(2)} MB。`);
