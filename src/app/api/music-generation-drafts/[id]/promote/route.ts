import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonValue, songInclude, toSongDto } from "@/lib/music";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type GenerationOutput = {
  title?: string;
  concept?: string;
  musicalBrief?: {
    key?: string;
    bpm?: number;
    meter?: string;
    moods?: string[];
    tags?: string[];
  };
  structure?: Array<{ section?: string; instruction?: string }>;
  lyricSeeds?: string[];
  chordPlan?: string;
  rhythmPlan?: string;
  soundPalette?: Array<{ material?: string; sound?: string; family?: string | null; previewPath?: string | null }>;
  personalTheory?: Array<{ title?: string; ruleType?: string; statement?: string }>;
  nextSteps?: string[];
  materialIds?: string[];
  ruleIds?: string[];
};

const PromoteSchema = z.object({
  title: z.string().optional().nullable(),
  status: z.string().optional().default("COMPOSITION")
});

function cleanTitle(value: string) {
  return value
    .replace(/^本機生成草稿\s*[-–]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 42);
}

function deriveTitle(output: GenerationOutput, prompt: string, requested?: string | null) {
  if (requested?.trim()) return requested.trim();
  const concept = cleanTitle(output.concept ?? "");
  if (concept && concept.length >= 4) return concept;
  const fromPrompt = cleanTitle(prompt);
  if (fromPrompt && fromPrompt.length >= 4) return fromPrompt;
  return "未命名生成作品";
}

function buildLyrics(output: GenerationOutput) {
  const seeds = output.lyricSeeds?.filter(Boolean) ?? [];
  if (!seeds.length) return "";
  return [
    "[素材歌詞種子]",
    ...seeds.map((seed, index) => `${index + 1}. ${seed}`),
    "",
    "[下一步]",
    "把上面的句子整理成 Verse / Pre-Chorus / Chorus。"
  ].join("\n");
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = PromoteSchema.parse(await request.json().catch(() => ({})));
  const draft = await prisma.musicGenerationDraft.findUnique({ where: { id } });
  if (!draft) {
    return NextResponse.json({ error: "找不到生成草稿" }, { status: 404 });
  }

  const output = parseJsonValue<GenerationOutput>(draft.outputJson, {});
  const materialIds = parseJsonValue<string[]>(draft.materialIdsJson, output.materialIds ?? []);
  const ruleIds = parseJsonValue<string[]>(draft.ruleIdsJson, output.ruleIds ?? []);
  const styleTags = parseJsonValue<string[]>(draft.styleTagsJson, output.musicalBrief?.tags ?? []);
  const title = deriveTitle(output, draft.prompt, body.title);
  const lyrics = buildLyrics(output);
  const bpm = output.musicalBrief?.bpm && Number.isFinite(output.musicalBrief.bpm) ? Math.round(output.musicalBrief.bpm) : null;
  const musicalKey = output.musicalBrief?.key ?? null;
  const mood = output.musicalBrief?.moods ?? [];
  const notes = [
    output.concept ? `概念：${output.concept}` : null,
    output.chordPlan ? `和弦：${output.chordPlan}` : null,
    output.rhythmPlan ? `節奏：${output.rhythmPlan}` : null,
    output.nextSteps?.length ? `下一步：${output.nextSteps.join(" / ")}` : null
  ]
    .filter(Boolean)
    .join("\n");

  const song = await prisma.$transaction(async (tx) => {
    const created = await tx.song.create({
      data: {
        title,
        workingTitle: draft.title,
        status: body.status,
        bpm,
        musicalKey,
        genre: styleTags[0] ?? null,
        language: "zh-TW",
        moodJson: JSON.stringify(mood),
        summary: output.concept ?? draft.prompt,
        notes,
        statusHistory: {
          create: {
            toStatus: body.status,
            note: "由音樂資料庫生成草稿落地成作品"
          }
        },
        lyricsVersions: lyrics
          ? {
              create: {
                versionName: "素材生成歌詞種子 v1",
                content: lyrics,
                isPrimary: true,
                notes: "由音樂資料庫生成草稿建立。"
              }
            }
          : undefined,
        tasks: {
          create: [
            { title: "把生成草稿整理成完整歌詞", category: "寫作", status: "TODO", sortOrder: 1 },
            { title: "依和弦與節奏計畫建立 GarageBand 8 小節 loop", category: "編曲", status: "TODO", sortOrder: 2 },
            { title: "上傳第一版 demo 並跑 Audio QA", category: "音檔", status: "TODO", sortOrder: 3 }
          ]
        },
        setupChecklistItems: {
          create: [
            { title: "確認調性 / BPM / 拍號", category: "錄音準備", status: "TODO", priority: "high", sortOrder: 1, notes: `${musicalKey ?? "未定"} / ${bpm ?? "未定"} / ${output.musicalBrief?.meter ?? "4/4"}` },
            { title: "選定主音色與節奏素材", category: "音色", status: "TODO", priority: "medium", sortOrder: 2, notes: output.soundPalette?.map((item) => item.material).filter(Boolean).join("、") ?? null },
            { title: "錄製 voice memo 或鋼琴 demo", category: "錄音準備", status: "TODO", priority: "medium", sortOrder: 3 }
          ]
        },
        timelineEvents: {
          create: {
            eventType: "generation_promoted",
            title: "生成草稿落地成作品",
            description: draft.prompt,
            relatedModel: "MusicGenerationDraft",
            relatedId: draft.id,
            metadataJson: JSON.stringify({ materialIds, ruleIds })
          }
        },
        garageBandLogs: {
          create: {
            operation: "建立編曲 Blueprint",
            command: `gbctl create-blueprint --song "${title}"`,
            payloadJson: JSON.stringify(
              {
                structure: output.structure ?? [],
                chordPlan: output.chordPlan,
                rhythmPlan: output.rhythmPlan,
                soundPalette: output.soundPalette ?? [],
                personalTheory: output.personalTheory ?? []
              },
              null,
              2
            ),
            requiresConfirmation: true,
            approvalStatus: "PENDING",
            resultStatus: "QUEUED",
            notes: "由音樂資料庫生成草稿建立，尚未直接執行 GarageBand。"
          }
        }
      }
    });

    await tx.musicGenerationDraft.update({
      where: { id: draft.id },
      data: {
        songId: created.id,
        status: "PROMOTED"
      }
    });

    if (materialIds.length) {
      await tx.musicMaterial.updateMany({
        where: {
          id: { in: materialIds },
          relatedSongId: null
        },
        data: { relatedSongId: created.id }
      });
    }

    return tx.song.findUniqueOrThrow({ where: { id: created.id }, include: songInclude });
  });

  return NextResponse.json({ song: toSongDto(song), songId: song.id }, { status: 201 });
}
