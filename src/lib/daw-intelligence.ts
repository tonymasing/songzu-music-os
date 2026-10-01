import { prisma } from "@/lib/prisma";
import { recordDawEditOperation } from "@/lib/daw-history";

function parseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function applyAudioJobToDaw(input: { jobId: string; projectId: string; applyTempo?: boolean; createMarker?: boolean }) {
  const [job, project] = await Promise.all([
    prisma.audioIntelligenceJob.findUnique({ where: { id: input.jobId } }),
    prisma.dawProject.findUnique({ where: { id: input.projectId } })
  ]);
  if (!job || job.status !== "COMPLETED") throw new Error("分析工作尚未完成");
  if (!project || project.songId !== job.songId) throw new Error("分析結果與 DAW 專案不屬於同一首歌");
  const result = parseObject(job.resultJson);
  const outputAudioFileIds = Array.isArray(result.audioFileIds)
    ? result.audioFileIds.filter((id): id is string => typeof id === "string")
    : [];
  const tempo = result.tempo && typeof result.tempo === "object" ? result.tempo as Record<string, unknown> : {};
  const bpm = typeof tempo.bpm === "number" ? Math.round(tempo.bpm) : null;
  const projectJson = parseObject(project.projectJson);
  const appliedAt = new Date().toISOString();
  const intelligenceImports = Array.isArray(projectJson.intelligenceImports) ? projectJson.intelligenceImports : [];
  const nextJson = {
    ...projectJson,
    intelligenceImports: [...intelligenceImports, { jobId: job.id, jobType: job.jobType, appliedAt }].slice(-30),
    ...(input.applyTempo && bpm
      ? { tempoMap: [{ startSeconds: 0, bpm, confidence: tempo.confidence ?? null, sourceJobId: job.id, appliedAt }] }
      : {})
  };
  const stemAssignments = job.jobType === "STEM_SEPARATION" && outputAudioFileIds.length
    ? await prisma.$transaction(async (tx) => {
        const [stems, tracks] = await Promise.all([
          tx.audioFile.findMany({ where: { id: { in: outputAudioFileIds }, songId: project.songId, archivedAt: null } }),
          tx.dawTrack.findMany({
            where: { projectId: project.id },
            include: { clips: { include: { audioFile: { select: { fileType: true } } }, orderBy: { createdAt: "asc" } } },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
          })
        ]);
        const labels: Record<string, { name: string; trackType: string; color: string }> = {
          vocal_stem: { name: "人聲分軌", trackType: "vocal", color: "#d97706" },
          drum_stem: { name: "鼓組分軌", trackType: "drums", color: "#be123c" },
          bass_stem: { name: "Bass 分軌", trackType: "bass", color: "#0f766e" },
          instrumental_stem: { name: "其他樂器分軌", trackType: "audio", color: "#20816f" }
        };
        const assignments: Array<{ fileType: string; audioFileId: string; trackId: string; clipId: string; replacedAudioFileId: string | null }> = [];

        for (const stem of stems) {
          const presentation = labels[stem.fileType] ?? { name: stem.versionName ?? stem.fileName, trackType: "audio", color: "#475569" };
          const existingTrack = tracks.find((track) => track.clips.some((clip) => clip.audioFile.fileType === stem.fileType));
          if (existingTrack?.clips[0]) {
            const existingClip = existingTrack.clips[0];
            const updatedClip = await tx.dawClip.update({
              where: { id: existingClip.id },
              data: {
                audioFileId: stem.id,
                durationSeconds: stem.durationSeconds ?? existingClip.durationSeconds,
                label: `${presentation.name} · 錄音室品質`,
                locked: true
              }
            });
            await tx.dawTrack.update({
              where: { id: existingTrack.id },
              data: { name: presentation.name, trackType: presentation.trackType }
            });
            await recordDawEditOperation(tx, {
              projectId: project.id,
              operationType: "replace_source",
              entityType: "clip",
              entityId: existingClip.id,
              label: `套用 ${presentation.name} 錄音室分軌`,
              before: existingClip,
              after: updatedClip,
              groupId: `stem-${job.id}`
            });
            assignments.push({
              fileType: stem.fileType,
              audioFileId: stem.id,
              trackId: existingTrack.id,
              clipId: existingClip.id,
              replacedAudioFileId: existingClip.audioFileId
            });
            continue;
          }

          const createdTrack = await tx.dawTrack.create({
            data: {
              projectId: project.id,
              name: presentation.name,
              trackType: presentation.trackType,
              color: presentation.color,
              sortOrder: tracks.length + assignments.length
            }
          });
          const createdClip = await tx.dawClip.create({
            data: {
              trackId: createdTrack.id,
              audioFileId: stem.id,
              startSeconds: 0,
              durationSeconds: stem.durationSeconds,
              label: `${presentation.name} · 錄音室品質`,
              color: presentation.color,
              locked: true
            }
          });
          assignments.push({
            fileType: stem.fileType,
            audioFileId: stem.id,
            trackId: createdTrack.id,
            clipId: createdClip.id,
            replacedAudioFileId: null
          });
        }

        if (assignments.length >= 4) {
          const referenceTracks = tracks.filter((track) => track.trackType === "reference" ||
            (track.clips.length > 0 && track.clips.every((clip) => clip.audioFile.fileType === "reference")));
          for (const referenceTrack of referenceTracks) {
            if (referenceTrack.muted) continue;
            const mutedReference = await tx.dawTrack.update({
              where: { id: referenceTrack.id },
              data: { muted: true }
            });
            await recordDawEditOperation(tx, {
              projectId: project.id,
              operationType: "update",
              entityType: "track",
              entityId: referenceTrack.id,
              label: `將 ${referenceTrack.name} 設為靜音參考軌`,
              before: referenceTrack,
              after: mutedReference,
              groupId: `stem-${job.id}`
            });
          }
        }
        return assignments;
      })
    : [];

  const updated = await prisma.dawProject.update({
    where: { id: project.id },
    data: { projectJson: JSON.stringify(nextJson), ...(input.applyTempo && bpm ? { bpm } : {}) }
  });
  if (input.createMarker) {
    await prisma.dawMarker.create({
      data: {
        projectId: project.id,
        markerType: "analysis",
        label: stemAssignments.length
          ? `套用 ${stemAssignments.length} 軌錄音室品質分軌`
          : input.applyTempo && bpm
            ? `套用本機節奏 ${bpm} BPM`
            : "套用本機音訊分析",
        timestampSeconds: 0,
        relatedModel: "AudioIntelligenceJob",
        relatedId: job.id,
        notes: `分析結果以非破壞性 metadata 寫入，原音檔未變更。`
      }
    });
  }
  return { project: updated, appliedBpm: input.applyTempo ? bpm : null, stemAssignments, originalAudioProtected: true };
}

export async function saveDawLatencyProfile(input: {
  projectId: string;
  inputDevice?: string | null;
  outputDevice?: string | null;
  measuredRoundTripMs: number;
  inputCompensationMs: number;
  monitoringMode: "direct" | "software" | "off";
}) {
  const project = await prisma.dawProject.findUnique({ where: { id: input.projectId } });
  if (!project) throw new Error("找不到 DAW 專案");
  const projectJson = parseObject(project.projectJson);
  const profile = {
    inputDevice: input.inputDevice ?? null,
    outputDevice: input.outputDevice ?? null,
    measuredRoundTripMs: Math.round(input.measuredRoundTripMs * 10) / 10,
    inputCompensationMs: Math.round(input.inputCompensationMs * 10) / 10,
    monitoringMode: input.monitoringMode,
    calibratedAt: new Date().toISOString()
  };
  const updated = await prisma.dawProject.update({
    where: { id: project.id },
    data: { projectJson: JSON.stringify({ ...projectJson, latencyProfile: profile }) }
  });
  return { project: updated, profile };
}

export async function getDawIntelligenceSummary() {
  const projects = await prisma.dawProject.findMany({
    include: {
      song: { select: { id: true, title: true } },
      tracks: { include: { clips: true, takeLanes: true } },
      markers: true,
      scoreDrafts: true
    },
    orderBy: { updatedAt: "desc" }
  });
  return {
    projects: projects.map((project) => {
      const metadata = parseObject(project.projectJson);
      const takeLanes = project.tracks.flatMap((track) => track.takeLanes);
      return {
        id: project.id,
        song: project.song,
        title: project.title,
        bpm: project.bpm,
        engineMode: project.engineMode,
        tracks: project.tracks.length,
        clips: project.tracks.reduce((count, track) => count + track.clips.length, 0),
        takeLanes: takeLanes.length,
        compRanges: takeLanes.filter((lane) => Boolean(lane.selectedRangeJson)).length,
        markers: project.markers.length,
        scoreDrafts: project.scoreDrafts.length,
        tempoMap: Array.isArray(metadata.tempoMap) ? metadata.tempoMap : [],
        latencyProfile: metadata.latencyProfile ?? null,
        intelligenceImports: Array.isArray(metadata.intelligenceImports) ? metadata.intelligenceImports.length : 0,
        capabilities: {
          nonDestructiveEditing: true,
          takeComping: true,
          punchRecording: true,
          latencyCompensation: Boolean(metadata.latencyProfile),
          tempoMapApplied: Array.isArray(metadata.tempoMap) && metadata.tempoMap.length > 0
        }
      };
    })
  };
}
