import { getReferenceVideo } from "@/lib/reference-video";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, extname, join, parse, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { MusicMaterial, Prisma } from "@prisma/client";

import { parseJsonValue, toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";
import { appPath } from "@/lib/paths";
import { bundledReferenceAudioPath, bundledReferenceCount, bundledReferenceUris, bundledReferenceSource, ensureBundledReferences } from "@/lib/bundled-references";

const execFileAsync = promisify(execFile);
const nodeFs = process.getBuiltinModule("fs") as typeof import("node:fs");
const nodeFsPromises = process.getBuiltinModule("fs/promises") as typeof import("node:fs/promises");
const ffprobePath = "/opt/homebrew/bin/ffprobe";
const audioExtensions = new Set([".mp3", ".wav", ".aif", ".aiff", ".m4a", ".flac", ".aac", ".ogg"]);

export const hermesMusicDbRoot = process.env.MUSIC_REFERENCE_ROOT?.trim() || appPath("music-db");
export const hermesInboxPath = join(/* turbopackIgnore: true */ hermesMusicDbRoot, "00_INBOX");
export const hermesNotesPath = join(/* turbopackIgnore: true */ hermesMusicDbRoot, "_metadata", "song_notes");

type ParsedNote = {
  path: string;
  title: string;
  artist: string | null;
  sourceUrl: string | null;
  genre: string | null;
  language: string | null;
  downloadedAt: string | null;
  likes: string[];
  referenceUses: string[];
  priorities: string[];
  styleFeatures: string[];
  raw: string;
};

type AudioCandidate = { path: string; fileName: string; normalizedName: string };

type AudioProbe = {
  durationSeconds: number | null;
  codec: string | null;
  bitRate: number | null;
};

type ImportCandidate = {
  note: ParsedNote | null;
  audio: AudioCandidate | null;
  matchStatus: "MATCHED" | "NOTE_ONLY" | "AUDIO_ONLY";
};

const referenceInclude = {
  relatedSong: { select: { id: true, title: true } },
  relatedSound: { select: { id: true, name: true, family: true, previewPath: true, assetPath: true } }
} satisfies Prisma.MusicMaterialInclude;

type ReferenceRecord = Prisma.MusicMaterialGetPayload<{ include: typeof referenceInclude }>;
export type MusicReferenceDto = Awaited<ReturnType<typeof toMusicReferenceDto>>;

function normalizeSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function splitHeading(value: string) {
  const index = value.lastIndexOf(" - ");
  if (index < 0) return { title: value.trim(), artist: null };
  return { title: value.slice(0, index).trim(), artist: value.slice(index + 3).trim() || null };
}

function parseNote(markdown: string, path: string): ParsedNote {
  const lines = markdown.split(/\r?\n/);
  const heading = lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "").trim() || parse(path).name;
  const identity = splitHeading(heading);
  const metadata = new Map<string, string>();
  const sections = new Map<string, string[]>();
  let section = "";
  for (const line of lines) {
    const sectionMatch = /^##\s+(.+)$/.exec(line.trim());
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      if (!sections.has(section)) sections.set(section, []);
      continue;
    }
    const bullet = /^-\s+(.+)$/.exec(line.trim());
    if (!bullet) continue;
    if (!section) {
      const meta = /^([^：:]+)[：:]\s*(.+)$/.exec(bullet[1]);
      if (meta) metadata.set(meta[1].trim(), meta[2].trim());
    } else {
      sections.get(section)?.push(bullet[1].trim());
    }
  }
  const sectionValues = (names: string[]) =>
    names.flatMap((name) => [...sections.entries()].filter(([key]) => key.includes(name)).flatMap(([, values]) => values));
  return {
    path,
    title: identity.title,
    artist: identity.artist,
    sourceUrl: metadata.get("網址") || null,
    genre: metadata.get("曲風") || null,
    language: metadata.get("語言") || null,
    downloadedAt: metadata.get("下載日期") || null,
    likes: sectionValues(["喜歡"]),
    referenceUses: sectionValues(["可參考"]),
    priorities: sectionValues(["在意"]),
    styleFeatures: sectionValues(["風格特點", "總結"]),
    raw: markdown
  };
}

function aliasesFor(title: string) {
  const aliases: Record<string, string[]> = {
    都一樣: ["boththesame"]
  };
  return [normalizeSearch(title), ...(aliases[title] || [])];
}

function matchScore(note: ParsedNote, audio: AudioCandidate) {
  const titleAliases = aliasesFor(note.title).filter((item) => item.length >= 2);
  if (titleAliases.some((alias) => audio.normalizedName.includes(alias))) return 100 + Math.max(...titleAliases.map((item) => item.length));
  return 0;
}

function matchCandidates(notes: ParsedNote[], audios: AudioCandidate[]) {
  const unused = new Set(audios.map((audio) => audio.path));
  const result: ImportCandidate[] = [];
  for (const note of notes) {
    const ranked = audios
      .filter((audio) => unused.has(audio.path))
      .map((audio) => ({ audio, score: matchScore(note, audio) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (best && best.score >= 100) {
      unused.delete(best.audio.path);
      result.push({ note, audio: best.audio, matchStatus: "MATCHED" });
    } else {
      result.push({ note, audio: null, matchStatus: "NOTE_ONLY" });
    }
  }
  for (const audio of audios) {
    if (unused.has(audio.path)) result.push({ note: null, audio, matchStatus: "AUDIO_ONLY" });
  }
  return result;
}

async function fileSha256(path: string) {
  return new Promise<string>((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = nodeFs.createReadStream(/* turbopackIgnore: true */ path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function probeAudio(path: string): Promise<AudioProbe> {
  try {
    const executable = await nodeFsPromises.stat(ffprobePath).then(() => ffprobePath).catch(() => "ffprobe");
    const { stdout } = await execFileAsync(
      executable,
      ["-v", "error", "-show_entries", "format=duration,bit_rate:stream=codec_type,codec_name,bit_rate", "-of", "json", path],
      { maxBuffer: 2 * 1024 * 1024, timeout: 15_000 }
    );
    const data = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; codec_name?: string; bit_rate?: string }>;
      format?: { duration?: string; bit_rate?: string };
    };
    const audio = data.streams?.find((stream) => stream.codec_type === "audio");
    const duration = Number(data.format?.duration);
    const bitRate = Number(data.format?.bit_rate || audio?.bit_rate);
    return {
      durationSeconds: Number.isFinite(duration) ? duration : null,
      codec: audio?.codec_name || null,
      bitRate: Number.isFinite(bitRate) ? bitRate : null
    };
  } catch {
    return { durationSeconds: null, codec: null, bitRate: null };
  }
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function referenceCategories(values: string[]) {
  const categories: string[] = [];
  for (const value of values) {
    const normalized = value.toLowerCase();
    if (/歌詞|意境|文字/.test(normalized)) categories.push("lyrics");
    if (/編曲|堆疊|樂器|音色|arrangement/.test(normalized)) categories.push("arrangement");
    if (/和弦|chord/.test(normalized)) categories.push("chords");
    if (/唱|人聲|vocal/.test(normalized)) categories.push("vocal");
    if (/情緒|氛圍|氣質|mood/.test(normalized)) categories.push("mood");
    if (/副歌|chorus|hook/.test(normalized)) categories.push("chorus");
    if (/節奏|groove|鼓|rhythm/.test(normalized)) categories.push("rhythm");
  }
  return unique(categories.length ? categories : ["general"]);
}

function suggestedCollection(genre: string | null) {
  const value = (genre || "").toLowerCase();
  if (/worship|gospel|praise/.test(value)) return "11_Worship_Gospel";
  if (/r&b|soul/.test(value)) return "02_R&B_Soul";
  if (/city.?pop/.test(value)) return "03_City_Pop";
  if (/reggae|rocksteady/.test(value)) return "04_Reggae_Rocksteady";
  if (/jazz|swing/.test(value)) return "05_Jazz_Swing";
  if (/folk|acoustic/.test(value)) return "06_Folk_Acoustic";
  if (/latin|world|opera|operatic|k-pop|j-pop|brazil|korean|japanese/.test(value)) return "07_World_Ethnic";
  if (/indie|alternative/.test(value)) return "08_Indie_Alt";
  if (/ost|cinematic|soundtrack|anime/.test(value)) return "09_OST_Cinematic";
  if (/pop|ballad|rock|mandopop/.test(value)) return "01_流行音樂";
  return "10_待分類";
}

function energyFromNote(note: ParsedNote | null) {
  const content = note ? [...note.likes, ...note.styleFeatures].join(" ").toLowerCase() : "";
  if (/爆發|高能量|衝|anthem|強烈|帶動/.test(content)) return 8;
  if (/內斂|淡淡|收斂|安靜|ballad|抒情/.test(content)) return 4;
  return null; // No energy label without an explicit basis in the note.
}

function contentFromNote(note: ParsedNote | null) {
  if (!note) return "尚無 我的偏好筆記；已建立外部音檔索引，等待補寫風格分析。";
  const blocks = [
    note.likes.length ? `喜歡：${note.likes.join("；")}` : null,
    note.referenceUses.length ? `可參考：${note.referenceUses.join("；")}` : null,
    note.priorities.length ? `在意：${note.priorities.join("；")}` : null,
    note.styleFeatures.length ? `風格：${note.styleFeatures.join("；")}` : null
  ];
  return blocks.filter(Boolean).join("\n");
}

function titleFromAudio(audio: AudioCandidate) {
  return parse(audio.fileName).name.replace(/\s*[[(（【].*$/, "").trim();
}

function sourceKey(candidate: ImportCandidate) {
  const identity = candidate.note?.sourceUrl ||
    `${candidate.note?.artist || ""}|${candidate.note?.title || titleFromAudio(candidate.audio as AudioCandidate)}`;
  return `hermes:${createHash("sha256").update(normalizeSearch(identity)).digest("hex").slice(0, 24)}`;
}

async function sourceSnapshot(paths: string[]) {
  const rows = await Promise.all(
    paths.map(async (path) => {
      const info = await nodeFsPromises.stat(/* turbopackIgnore: true */ path);
      return [path, `${info.size}:${info.mtimeMs}`] as const;
    })
  );
  return Object.fromEntries(rows);
}

async function referenceEntries(path: string) {
  return nodeFsPromises.readdir(/* turbopackIgnore: true */ path, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

export async function scanHermesReferenceLibrary() {
  const [audioEntries, noteEntries] = await Promise.all([
    referenceEntries(hermesInboxPath),
    referenceEntries(hermesNotesPath)
  ]);
  const audios = audioEntries
    .filter((entry) => entry.isFile() && audioExtensions.has(extname(entry.name).toLowerCase()))
    .map((entry) => ({
      path: join(/* turbopackIgnore: true */ hermesInboxPath, entry.name),
      fileName: entry.name,
      normalizedName: normalizeSearch(parse(entry.name).name)
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName, "zh-Hant"));
  const notePaths = noteEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => join(/* turbopackIgnore: true */ hermesNotesPath, entry.name))
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const notes = await Promise.all(
    notePaths.map(async (path) => parseNote(await nodeFsPromises.readFile(/* turbopackIgnore: true */ path, "utf8"), path))
  );
  return { audios, notes, candidates: matchCandidates(notes, audios) };
}

export async function importHermesReferenceLibrary() {
  await ensureBundledReferences();
  const scan = await scanHermesReferenceLibrary();
  const sourcePaths = [...scan.audios.map((audio) => audio.path), ...scan.notes.map((note) => note.path)];
  const before = await sourceSnapshot(sourcePaths);
  let created = 0;
  let updated = 0;
  const importedKeys: string[] = [];
  const now = new Date();

  for (const candidate of scan.candidates) {
    const key = sourceKey(candidate);
    importedKeys.push(key);
    const note = candidate.note;
    const audio = candidate.audio;
    const existing = await prisma.musicMaterial.findUnique({ where: { externalSourceKey: key }, select: { id: true, externalAudioPath: true } });
    // A same-title loose note or duplicate import must not replace shipped audio.
    if (existing && bundledReferenceAudioPath(existing.externalAudioPath)) continue;
    const audioInfo = audio ? await nodeFsPromises.stat(/* turbopackIgnore: true */ audio.path) : null;
    const audioProbe = audio ? await probeAudio(audio.path) : { durationSeconds: null, codec: null, bitRate: null };
    const audioHash = audio ? await fileSha256(audio.path) : null;
    const noteHash = note ? createHash("sha256").update(note.raw).digest("hex") : null;
    const title = note?.title || titleFromAudio(audio as AudioCandidate);
    const genres = unique((note?.genre || "").split(/[\/|]+/));
    const referenceUses = note?.referenceUses || [];
    const categories = referenceCategories(referenceUses);
    const tags = unique([
      ...genres,
      ...categories,
      ...(note?.priorities || []),
      ...(note?.styleFeatures || []).filter((item) => item.length <= 28)
    ]).slice(0, 28);
    const moods = unique([
      ...(note?.styleFeatures || []).filter((item) => item.length <= 18 && !item.includes("適合")),
      ...(note?.likes || []).filter((item) => item.length <= 18)
    ]).slice(0, 10);
    const data = {
      title: note?.artist ? `${title} - ${note.artist}` : title,
      materialType: "style_reference",
      content: contentFromNote(note),
      summary: note?.likes.slice(0, 3).join("；") || "尚待補寫 我的偏好筆記。",
      source: "Hermes music-db 唯讀索引",
      sourceUrl: note?.sourceUrl || null,
      externalAudioPath: audio?.path || null,
      externalNotePath: note?.path || null,
      externalFileName: audio?.fileName || null,
      externalFileSizeBytes: audioInfo?.size || null,
      externalDurationSeconds: audioProbe.durationSeconds,
      externalCodec: audioProbe.codec,
      externalBitRate: audioProbe.bitRate,
      externalAudioSha256: audioHash,
      externalNoteSha256: noteHash,
      artist: note?.artist || null,
      language: note?.language || null,
      referenceUsesJson: JSON.stringify(referenceUses),
      preferenceNotesJson: JSON.stringify(note?.likes || []),
      priorityNotesJson: JSON.stringify(note?.priorities || []),
      styleFeaturesJson: JSON.stringify(note?.styleFeatures || []),
      suggestedCollection: suggestedCollection(note?.genre || null),
      matchStatus: candidate.matchStatus,
      lastScannedAt: now,
      genre: note?.genre || null,
      moodJson: JSON.stringify(moods),
      tagsJson: JSON.stringify(tags),
      sectionRole: categories.includes("chorus") ? "Chorus" : categories.includes("vocal") ? "Vocal" : null,
      energy: energyFromNote(note)
    };
    await prisma.musicMaterial.upsert({
      where: { externalSourceKey: key },
      create: {
        externalSourceKey: key,
        importedAt: now,
        status: note ? "ACTIVE" : "COLLECTED",
        favorite: Boolean(note),
        ...data
      },
      update: data
    });
    if (existing) updated += 1;
    else created += 1;
  }

  const offline = importedKeys.length
    ? await prisma.musicMaterial.updateMany({
        where: { materialType: "style_reference", externalSourceKey: { notIn: importedKeys }, OR: [{ externalAudioPath: null }, { externalAudioPath: { notIn: bundledReferenceUris } }] },
        data: { matchStatus: "OFFLINE", lastScannedAt: now }
      })
    : { count: 0 };
  const after = await sourceSnapshot(sourcePaths);
  const sourceUnchanged = JSON.stringify(before) === JSON.stringify(after);
  return {
    root: hermesMusicDbRoot,
    scannedAt: now.toISOString(),
    audioCount: scan.audios.length,
    noteCount: scan.notes.length,
    matchedCount: scan.candidates.filter((item) => item.matchStatus === "MATCHED").length,
    noteOnlyCount: scan.candidates.filter((item) => item.matchStatus === "NOTE_ONLY").length,
    audioOnlyCount: scan.candidates.filter((item) => item.matchStatus === "AUDIO_ONLY").length,
    created,
    updated,
    offline: offline.count,
    sourceUnchanged,
    filesystemChanges: 0,
    unmatched: scan.candidates
      .filter((item) => item.matchStatus !== "MATCHED")
      .map((item) => ({
        status: item.matchStatus,
        title: item.note?.title || titleFromAudio(item.audio as AudioCandidate),
        audioPath: item.audio?.path || null,
        notePath: item.note?.path || null
      }))
  };
}

function pathInsideRoot(path: string) {
  const root = resolve(/* turbopackIgnore: true */ hermesMusicDbRoot);
  const candidate = resolve(/* turbopackIgnore: true */ path);
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

export function assertReferenceAudioPath(path: string | null) {
  const bundled = bundledReferenceAudioPath(path);
  if (bundled) return bundled;
  if (!path || !pathInsideRoot(path) || !audioExtensions.has(extname(path).toLowerCase())) {
    throw new Error("參考音檔路徑不在允許的唯讀資料庫中。");
  }
  return path;
}

export async function toMusicReferenceDto(item: ReferenceRecord) {
  const video = await getReferenceVideo(item.id);
  let audioAvailable = false;
  if (item.externalAudioPath) {
    try {
      await nodeFsPromises.stat(/* turbopackIgnore: true */ assertReferenceAudioPath(item.externalAudioPath));
      audioAvailable = true;
    } catch {
      audioAvailable = false;
    }
  }
  return {
    id: item.id,
    title: item.title,
    artist: item.artist,
    sourceUrl: item.sourceUrl,
    genre: item.genre,
    genres: unique((item.genre || "").split(/[\/|]+/)),
    language: item.language,
    summary: item.summary,
    content: item.content,
    moods: parseJsonValue<string[]>(item.moodJson, []),
    tags: parseJsonValue<string[]>(item.tagsJson, []),
    referenceUses: parseJsonValue<string[]>(item.referenceUsesJson, []),
    preferenceNotes: parseJsonValue<string[]>(item.preferenceNotesJson, []),
    notesAuthor: item.source === bundledReferenceSource ? "Tony" : null,
    priorityNotes: parseJsonValue<string[]>(item.priorityNotesJson, []),
    styleFeatures: parseJsonValue<string[]>(item.styleFeaturesJson, []),
    suggestedCollection: item.suggestedCollection,
    matchStatus: item.matchStatus,
    favorite: item.favorite,
    status: item.status,
    energy: item.energy,
    audioAvailable,
    videoUrl: video ? `/api/music-materials/${item.id}/video?v=${video.fileName.slice(0, 16)}` : null,
    audioUrl: audioAvailable ? `/api/music-materials/${item.id}/audio` : null,
    externalFileName: item.externalFileName,
    externalFileSizeBytes: item.externalFileSizeBytes,
    externalDurationSeconds: item.externalDurationSeconds,
    externalCodec: item.externalCodec,
    externalBitRate: item.externalBitRate,
    externalAudioSha256: item.externalAudioSha256,
    externalNoteSha256: item.externalNoteSha256,
    externalAudioPath: item.externalAudioPath,
    externalNotePath: item.externalNotePath,
    importedAt: toIso(item.importedAt),
    lastScannedAt: toIso(item.lastScannedAt),
    updatedAt: toIso(item.updatedAt)
  };
}

export async function getMusicReferences() {
  await ensureBundledReferences();
  const rows = await prisma.musicMaterial.findMany({
    where: { materialType: "style_reference" },
    include: referenceInclude,
    orderBy: [{ favorite: "desc" }, { artist: "asc" }, { title: "asc" }]
  });
  return Promise.all(rows.map(toMusicReferenceDto));
}

export async function referenceLibraryHealth() {
  await ensureBundledReferences();
  const bundledCount = await bundledReferenceCount();
  try {
    const scan = await scanHermesReferenceLibrary();
    return {
      available: true,
      bundledCount,
      root: hermesMusicDbRoot,
      audioCount: scan.audios.length + bundledCount,
      noteCount: scan.notes.length + bundledCount,
      matchedCount: scan.candidates.filter((item) => item.matchStatus === "MATCHED").length + bundledCount,
      noteOnlyCount: scan.candidates.filter((item) => item.matchStatus === "NOTE_ONLY").length,
      audioOnlyCount: scan.candidates.filter((item) => item.matchStatus === "AUDIO_ONLY").length
    };
  } catch (error) {
    return {
      available: false,
      bundledCount,
      root: hermesMusicDbRoot,
      audioCount: 0,
      noteCount: 0,
      matchedCount: 0,
      noteOnlyCount: 0,
      audioOnlyCount: 0,
      error: error instanceof Error ? error.message : "外部音樂資料庫無法讀取。"
    };
  }
}

export function referenceAudioContentType(fileName: string | null) {
  const extension = extname(fileName || "").toLowerCase();
  if (extension === ".mp3") return "audio/mpeg";
  if ([".aif", ".aiff"].includes(extension)) return "audio/aiff";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".flac") return "audio/flac";
  if ([".m4a", ".aac"].includes(extension)) return "audio/mp4";
  if (extension === ".ogg") return "audio/ogg";
  return "application/octet-stream";
}

export function referenceAudioName(item: Pick<MusicMaterial, "externalFileName">) {
  return basename(item.externalFileName || "reference-audio");
}
