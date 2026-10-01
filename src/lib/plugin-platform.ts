import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { access, readdir } from "node:fs/promises";

import { prisma } from "@/lib/prisma";

const pluginRoots = [
  { path: "/Library/Audio/Plug-Ins/Components", format: "AU" },
  { path: join(homedir(), "Library/Audio/Plug-Ins/Components"), format: "AU" },
  { path: "/Library/Audio/Plug-Ins/VST3", format: "VST3" },
  { path: join(homedir(), "Library/Audio/Plug-Ins/VST3"), format: "VST3" },
  { path: "/Library/Audio/Plug-Ins/CLAP", format: "CLAP" },
  { path: join(homedir(), "Library/Audio/Plug-Ins/CLAP"), format: "CLAP" }
] as const;

const defaultChains = [
  {
    name: "乾淨人聲起點",
    category: "vocal",
    description: "低切、輕壓縮、去齒音與短板殘響，保留後續手動空間。",
    tags: ["人聲", "清晰", "錄音"],
    steps: [
      { type: "high_pass", frequency: 82, slope: 12, enabled: true },
      { type: "compressor", threshold: -18, ratio: 2.5, attackMs: 18, releaseMs: 110, enabled: true },
      { type: "de_esser", frequency: 6800, amount: 22, enabled: true },
      { type: "reverb", preset: "short_plate", mix: 0.11, enabled: true }
    ]
  },
  {
    name: "清亮木吉他",
    category: "guitar",
    description: "移除低頻堆積，輕微壓縮並保留撥弦瞬態。",
    tags: ["吉他", "木吉他", "清亮"],
    steps: [
      { type: "high_pass", frequency: 72, slope: 12, enabled: true },
      { type: "eq", bands: [{ frequency: 240, gain: -1.8, q: 1.1 }, { frequency: 3200, gain: 1.2, q: 0.8 }], enabled: true },
      { type: "compressor", threshold: -16, ratio: 2, attackMs: 28, releaseMs: 130, enabled: true },
      { type: "reverb", preset: "studio_room", mix: 0.09, enabled: true }
    ]
  },
  {
    name: "鋼琴自然空間",
    category: "piano",
    description: "控制中低頻濁度，使用自然房間殘響維持真實距離。",
    tags: ["鋼琴", "自然", "空間"],
    steps: [
      { type: "eq", bands: [{ frequency: 310, gain: -1.4, q: 1 }, { frequency: 4500, gain: 0.8, q: 0.7 }], enabled: true },
      { type: "compressor", threshold: -14, ratio: 1.7, attackMs: 38, releaseMs: 170, enabled: true },
      { type: "reverb", preset: "natural_room", mix: 0.14, enabled: true }
    ]
  },
  {
    name: "母帶安全檢查鏈",
    category: "master",
    description: "僅供預聽與檢查，保留峰值空間，不覆蓋原始 master。",
    tags: ["母帶", "安全", "預聽"],
    steps: [
      { type: "eq", bands: [{ frequency: 38, gain: -1, q: 0.8 }], enabled: true },
      { type: "compressor", threshold: -10, ratio: 1.4, attackMs: 42, releaseMs: 190, enabled: true },
      { type: "limiter", ceilingDb: -1, releaseMs: 120, enabled: true }
    ]
  }
] as const;

function identifier(format: string, filePath: string) {
  return `${format.toLocaleLowerCase()}:${createHash("sha1").update(filePath).digest("hex")}`;
}

function displayName(fileName: string) {
  return basename(fileName, extname(fileName)).replace(/[-_]+/g, " ").trim();
}

async function directoryExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDefaultEffectChains() {
  const orderBy = [{ favorite: "desc" as const }, { category: "asc" as const }, { name: "asc" as const }];
  const current = await prisma.effectChain.findMany({ orderBy });
  if (defaultChains.every(chain => current.some(item => item.name === chain.name))) return current;
  return prisma.$transaction(async tx => {
    for (const chain of defaultChains) {
      if (await tx.effectChain.findFirst({ where: { name: chain.name } })) continue;
      await tx.effectChain.create({ data: {
      name: chain.name,
      category: chain.category,
      description: chain.description,
      stepsJson: JSON.stringify(chain.steps),
      tagsJson: JSON.stringify(chain.tags),
      status: "ACTIVE",
      favorite: chain.category === "vocal"
      } });
    }
    return tx.effectChain.findMany({ orderBy });
  });
}

export async function scanLocalPlugins() {
  const scannedAt = new Date();
  const seen = new Set<string>();
  const roots: Array<{ path: string; format: string; count: number }> = [];
  for (const root of pluginRoots) {
    if (!(await directoryExists(root.path))) continue;
    const entries = await readdir(root.path, { withFileTypes: true });
    const plugins = entries.filter((entry) => entry.isDirectory() || [".clap", ".vst3", ".component"].includes(extname(entry.name).toLocaleLowerCase()));
    roots.push({ ...root, count: plugins.length });
    for (const entry of plugins) {
      // String composition keeps Turbopack from treating a runtime plugin path as a bundle-time filesystem glob.
      const filePath = `${root.path.replace(/\/$/, "")}/${entry.name}`;
      const id = identifier(root.format, filePath);
      seen.add(id);
      await prisma.pluginDescriptor.upsert({
        where: { identifier: id },
        create: {
          identifier: id,
          name: displayName(entry.name),
          format: root.format,
          filePath,
          architecture: process.arch,
          status: "DISCOVERED",
          validationStatus: "HOST_UNTESTED",
          capabilitiesJson: JSON.stringify({ scanMode: "metadata_only", canLoadInWeb: false, nativeHostRequired: true }),
          lastScannedAt: scannedAt
        },
        update: {
          name: displayName(entry.name),
          format: root.format,
          filePath,
          architecture: process.arch,
          status: "DISCOVERED",
          lastScannedAt: scannedAt,
          errorMessage: null
        }
      });
    }
  }

  const registered = await prisma.pluginDescriptor.findMany();
  for (const plugin of registered) {
    if (!seen.has(plugin.identifier)) {
      await prisma.pluginDescriptor.update({
        where: { id: plugin.id },
        data: { status: "MISSING", errorMessage: "上次掃描時找不到插件路徑；未自動刪除登記。" }
      });
    }
  }
  await ensureDefaultEffectChains();
  const plugins = await prisma.pluginDescriptor.findMany({ orderBy: [{ quarantined: "asc" }, { format: "asc" }, { name: "asc" }] });
  return {
    roots,
    discovered: plugins.filter((plugin) => plugin.status === "DISCOVERED").length,
    missing: plugins.filter((plugin) => plugin.status === "MISSING").length,
    quarantined: plugins.filter((plugin) => plugin.quarantined).length,
    plugins
  };
}

export async function setPluginQuarantine(pluginId: string, quarantined: boolean) {
  return prisma.pluginDescriptor.update({
    where: { id: pluginId },
    data: {
      quarantined,
      validationStatus: quarantined ? "QUARANTINED" : "HOST_UNTESTED",
      status: quarantined ? "DISABLED" : "DISCOVERED"
    }
  });
}

export async function getPluginPlatformSummary() {
  const [plugins, chains] = await Promise.all([
    prisma.pluginDescriptor.findMany({ orderBy: [{ quarantined: "asc" }, { format: "asc" }, { name: "asc" }] }),
    ensureDefaultEffectChains()
  ]);
  return {
    plugins,
    chains,
    counts: {
      total: plugins.length,
      available: plugins.filter((plugin) => plugin.status === "DISCOVERED" && !plugin.quarantined).length,
      untested: plugins.filter((plugin) => plugin.validationStatus === "HOST_UNTESTED").length,
      quarantined: plugins.filter((plugin) => plugin.quarantined).length
    },
    safety: "插件只做檔案登記；正式載入必須由未來隔離的 native host 執行。"
  };
}
