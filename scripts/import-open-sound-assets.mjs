import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dbPath = join(root, "prisma", "dev.db");
const publicDir = join(root, "public");
const originalDir = join(publicDir, "sound-assets", "originals", "university-of-iowa");
const previewDir = join(publicDir, "sound-assets", "previews", "university-of-iowa");
const sourceBase = "https://theremin.music.uiowa.edu/";
const licenseName = "University of Iowa MIS - unrestricted use";
const licenseUrl = "https://theremin.music.uiowa.edu/mis.html";

const items = [
  {
    name: "Iowa Steinway Piano C4 mf",
    itemType: "instrument",
    family: "鍵盤",
    era: "Anechoic / Natural",
    sourcePage: "https://theremin.music.uiowa.edu/MISpiano.html",
    relativeUrl: "sound files/MIS/Piano_Other/piano/Piano.mf.C4.aiff",
    description: "Steinway & Sons model B，中力度 C4；適合作為自然鋼琴參考與敬拜主歌鋪底。",
    tags: ["piano", "steinway", "C4", "mf", "natural"],
    character: ["自然", "乾淨", "中頻清楚"],
    useCases: ["敬拜鋼琴參考", "Demo 主歌", "音色比較"],
    chain: ["High-pass 40Hz", "Gentle Room Reverb", "Soft Compression"],
    garageBandHint: "用 Steinway Grand 類音色，先保持乾淨，再少量 room reverb。"
  },
  {
    name: "Iowa Classical Guitar C4-B4 mf",
    itemType: "instrument",
    family: "吉他",
    era: "Anechoic / Natural",
    sourcePage: "https://theremin.music.uiowa.edu/MISguitar.html",
    relativeUrl: "sound files/MIS/Piano_Other/guitar/Guitar.mf.sulG.C4B4.stereo.aif",
    description: "古典吉他 G 弦中力度音域片段；適合木吉他 / nylon guitar 音色參考。",
    tags: ["guitar", "classical", "nylon", "mf", "stereo"],
    character: ["木質", "近距離", "自然"],
    useCases: ["前奏 picking 參考", "敬拜木吉他", "短影音安靜段落"],
    chain: ["Low cut", "Small Room", "Light Tape Saturation"],
    garageBandHint: "可用 Nylon String Guitar 類音色，削低頻濁度，保留撥弦 transient。"
  },
  {
    name: "Iowa Violin Arco D String mf",
    itemType: "instrument",
    family: "弦樂",
    era: "Anechoic / Natural",
    sourcePage: "https://theremin.music.uiowa.edu/MISviolin.html",
    relativeUrl: "sound files/MIS/Strings/violin/Violin.arco.mf.sulD.D4A4.aiff",
    description: "小提琴 arco 中力度 D 弦音域；適合弦樂旋律和疊層參考。",
    tags: ["violin", "arco", "strings", "mf"],
    character: ["線性", "明亮", "真實"],
    useCases: ["副歌弦樂旋律", "Bridge 情緒拉升", "管弦參考"],
    chain: ["Bow noise tame EQ", "Hall Reverb", "Stereo Width light"],
    garageBandHint: "用 Studio Strings / Solo Violin 類音色，控制高頻刺感，尾巴用 hall。"
  },
  {
    name: "Iowa Flute Vibrato C5-B5 mf",
    itemType: "instrument",
    family: "木管",
    era: "Anechoic / Natural",
    sourcePage: "https://theremin.music.uiowa.edu/MISflute.html",
    relativeUrl: "sound files/MIS/Woodwinds/flute/Flute.vib.mf.C5B5.aiff",
    description: "長笛 vibrato 中力度中高音域；適合旋律 hook、敬拜間奏或柔和氛圍。",
    tags: ["flute", "woodwind", "vibrato", "mf"],
    character: ["空氣感", "明亮", "輕盈"],
    useCases: ["間奏旋律", "Pad 上方點綴", "影像配樂"],
    chain: ["De-harsh EQ", "Plate or Hall", "Delay very low mix"],
    garageBandHint: "用 Flute / Orchestral Woodwind 類音色，少量 hall，避免太濕。"
  },
  {
    name: "Iowa Marimba Yarn C4-B4 mf",
    itemType: "instrument",
    family: "打擊鍵盤",
    era: "Anechoic / Natural",
    sourcePage: "https://theremin.music.uiowa.edu/Mismarimba.html",
    relativeUrl: "sound files/MIS/Percussion/Marimba/Marimba.yarn.mf.C4B4.aif",
    description: "Marimba yarn mallet 中力度 C4-B4；適合溫暖節奏、童趣或 organic texture。",
    tags: ["marimba", "percussion", "mallet", "organic"],
    character: ["圓潤", "木質", "短尾韻"],
    useCases: ["節奏 riff", "短影音 texture", "兒童 / 溫暖感"],
    chain: ["Transient control", "Room Reverb", "Stereo Delay subtle"],
    garageBandHint: "用 Marimba / Mallet 類音色，保留 attack，少量 room。"
  },
  {
    name: "Iowa Woodblock 7 inch mf",
    itemType: "instrument",
    family: "打擊",
    era: "Anechoic / Natural",
    sourcePage: "https://theremin.music.uiowa.edu/MIShandpercussion.html",
    relativeUrl: "sound files/MIS/Percussion/hand percussion/woodblocks/7wb.mf.aif",
    description: "7 吋 woodblock 中力度；可做節奏點、click layer 或自然打擊 one-shot。",
    tags: ["woodblock", "percussion", "one-shot", "rhythm"],
    character: ["乾", "清楚", "短"],
    useCases: ["節奏點綴", "click layer", "編曲 transition"],
    chain: ["Transient Shaper", "Short Room", "Pan automation"],
    garageBandHint: "用 Woodblock / Percussion one-shot，必要時壓短尾巴。"
  },
  {
    name: "Iowa 17 Crash Cymbal Bell mf",
    itemType: "effect",
    family: "鈸 / 轉場",
    era: "Anechoic / Natural",
    sourcePage: "https://theremin.music.uiowa.edu/MIScymbals.html",
    relativeUrl: "sound files/MIS/Percussion/cymbals/suspended cymbals/stick/17crash.stick.bell.mf.aif",
    description: "17 吋 crash cymbal bell 中力度；適合轉場亮點、段落進入提示。",
    tags: ["cymbal", "bell", "transition", "percussion"],
    character: ["亮", "金屬", "清脆"],
    useCases: ["段落轉場", "副歌入口", "短影音 accent"],
    chain: ["High shelf tame", "Plate Reverb", "Stereo Spread"],
    garageBandHint: "可用 crash bell / ride bell 類素材，混音時注意 3-6k 刺感。"
  },
  {
    name: "Iowa Found Object Paper Bags",
    itemType: "effect",
    family: "生活 Foley",
    era: "Found Object",
    sourcePage: "https://theremin.music.uiowa.edu/MISfoundobjects1.html",
    relativeUrl: "sound files/MIS/Soundmined/PaperBags.aif",
    description: "紙袋 found object texture；可作環境層、lo-fi texture 或短影音聲響設計。",
    tags: ["foley", "paper", "texture", "found-object"],
    character: ["沙沙", "近距離", "生活感"],
    useCases: ["短影音 Foley", "lo-fi texture", "轉場聲響"],
    chain: ["High-pass", "Compression", "Tape / Lo-fi filter"],
    garageBandHint: "放在低音量背景，搭配 tape noise 或 filter automation。"
  }
];

function commandExists(command) {
  return spawnSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

function sanitizeFileName(value) {
  return value
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function publicPath(filePath) {
  return `/${filePath.slice(publicDir.length + 1).split("/").join("/")}`;
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function download(url, destination) {
  if (existsSync(destination)) return;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下載失敗 ${response.status}: ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(destination, buffer);
}

function convertPreview(originalPath, previewPath) {
  if (existsSync(previewPath)) return true;
  if (!commandExists("ffmpeg")) return false;
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-i", originalPath, "-t", "12", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", previewPath],
    { encoding: "utf8", stdio: "pipe" }
  );
  return result.status === 0 && existsSync(previewPath);
}

function upsertItem(db, item, originalPath, previewPath, sourceUrl) {
  const now = new Date().toISOString();
  const fileStat = statSync(originalPath);
  const digest = sha256(originalPath);
  const existing = db.prepare('SELECT "id" FROM "SoundLibraryItem" WHERE "sourceUrl" = ? OR "sha256" = ? LIMIT 1').get(sourceUrl, digest);
  const data = {
    name: item.name,
    itemType: item.itemType,
    family: item.family,
    era: item.era,
    source: "University of Iowa Musical Instrument Samples",
    description: item.description,
    tagsJson: JSON.stringify(item.tags),
    characterJson: JSON.stringify(item.character),
    useCasesJson: JSON.stringify(item.useCases),
    chainJson: JSON.stringify(item.chain),
    garageBandHint: item.garageBandHint,
    notes: `本機原檔：${originalPath}\n預覽檔：${previewPath}\n匯入來源頁：${item.sourcePage}`,
    assetPath: publicPath(originalPath),
    previewPath: existsSync(previewPath) ? publicPath(previewPath) : publicPath(originalPath),
    sourceUrl,
    licenseName,
    licenseUrl,
    fileSizeBytes: fileStat.size,
    sha256: digest,
    status: "ACTIVE",
    favorite: 0,
    updatedAt: now
  };

  if (existing?.id) {
    db.prepare(`
      UPDATE "SoundLibraryItem" SET
        "name" = @name,
        "itemType" = @itemType,
        "family" = @family,
        "era" = @era,
        "source" = @source,
        "description" = @description,
        "tagsJson" = @tagsJson,
        "characterJson" = @characterJson,
        "useCasesJson" = @useCasesJson,
        "chainJson" = @chainJson,
        "garageBandHint" = @garageBandHint,
        "notes" = @notes,
        "assetPath" = @assetPath,
        "previewPath" = @previewPath,
        "sourceUrl" = @sourceUrl,
        "licenseName" = @licenseName,
        "licenseUrl" = @licenseUrl,
        "fileSizeBytes" = @fileSizeBytes,
        "sha256" = @sha256,
        "status" = @status,
        "updatedAt" = @updatedAt
      WHERE "id" = @id
    `).run({ ...data, id: existing.id });
    return "updated";
  }

  db.prepare(`
    INSERT INTO "SoundLibraryItem" (
      "id", "name", "itemType", "family", "era", "source", "description",
      "tagsJson", "characterJson", "useCasesJson", "chainJson", "garageBandHint",
      "notes", "assetPath", "previewPath", "sourceUrl", "licenseName", "licenseUrl",
      "fileSizeBytes", "sha256", "status", "favorite", "createdAt", "updatedAt"
    ) VALUES (
      @id, @name, @itemType, @family, @era, @source, @description,
      @tagsJson, @characterJson, @useCasesJson, @chainJson, @garageBandHint,
      @notes, @assetPath, @previewPath, @sourceUrl, @licenseName, @licenseUrl,
      @fileSizeBytes, @sha256, @status, @favorite, @createdAt, @updatedAt
    )
  `).run({ ...data, id: `sound_${randomUUID().replaceAll("-", "")}`, createdAt: now });
  return "created";
}

if (!existsSync(dbPath)) {
  console.error("prisma/dev.db 不存在，請先執行 npm run db:init && npm run db:init");
  process.exit(1);
}

mkdirSync(originalDir, { recursive: true });
mkdirSync(previewDir, { recursive: true });

const db = new DatabaseSync(dbPath);
let created = 0;
let updated = 0;

for (const item of items) {
  const sourceUrl = new URL(item.relativeUrl, sourceBase).toString();
  const extension = extname(item.relativeUrl) || ".aif";
  const fileBase = sanitizeFileName(`${item.name}${extension}`);
  const originalPath = join(originalDir, fileBase);
  const previewPath = join(previewDir, fileBase.replace(/\.(aif|aiff)$/i, ".wav"));

  console.log(`下載 / 檢查：${item.name}`);
  await download(sourceUrl, originalPath);
  convertPreview(originalPath, previewPath);
  const result = upsertItem(db, item, originalPath, previewPath, sourceUrl);
  if (result === "created") created += 1;
  if (result === "updated") updated += 1;
}

db.close();
console.log(`音色匯入完成：新增 ${created}，更新 ${updated}，總計 ${items.length}。`);
