import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient;
type Snapshot = Record<string, unknown>;

function parseSnapshot(value: string | null): Snapshot | null {
  if (!value) return null;
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Snapshot) : null;
}

function json(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

function trackData(value: Snapshot) {
  return {
    projectId: String(value.projectId),
    name: String(value.name),
    trackType: String(value.trackType ?? "audio"),
    sortOrder: Number(value.sortOrder ?? 0),
    muted: Boolean(value.muted),
    solo: Boolean(value.solo),
    armed: Boolean(value.armed),
    monitoring: Boolean(value.monitoring),
    volume: Number(value.volume ?? 1),
    pan: Number(value.pan ?? 0),
    color: typeof value.color === "string" ? value.color : null,
    effectsJson: typeof value.effectsJson === "string" ? value.effectsJson : null,
    inputSource: typeof value.inputSource === "string" ? value.inputSource : null,
    outputTarget: typeof value.outputTarget === "string" ? value.outputTarget : "master",
    polarityInverted: Boolean(value.polarityInverted),
    stereoMode: typeof value.stereoMode === "string" ? value.stereoMode : "stereo"
  };
}

function clipData(value: Snapshot) {
  return {
    trackId: String(value.trackId),
    audioFileId: String(value.audioFileId),
    startSeconds: Number(value.startSeconds ?? 0),
    offsetSeconds: Number(value.offsetSeconds ?? 0),
    durationSeconds: value.durationSeconds == null ? null : Number(value.durationSeconds),
    gain: Number(value.gain ?? 1),
    fadeInSeconds: Number(value.fadeInSeconds ?? 0),
    fadeOutSeconds: Number(value.fadeOutSeconds ?? 0),
    locked: Boolean(value.locked),
    label: typeof value.label === "string" ? value.label : null,
    color: typeof value.color === "string" ? value.color : null,
    groupId: typeof value.groupId === "string" ? value.groupId : null,
    zeroCrossingAdjusted: Boolean(value.zeroCrossingAdjusted),
    crossfadeGroupId: typeof value.crossfadeGroupId === "string" ? value.crossfadeGroupId : null
  };
}

function takeLaneData(value: Snapshot) {
  return {
    trackId: String(value.trackId),
    recordingTakeId: String(value.recordingTakeId),
    laneOrder: Number(value.laneOrder ?? 0),
    compStatus: String(value.compStatus ?? "candidate"),
    selectedRangeJson: typeof value.selectedRangeJson === "string" ? value.selectedRangeJson : null,
    notes: typeof value.notes === "string" ? value.notes : null
  };
}

function routeData(value: Snapshot) {
  return {
    projectId: String(value.projectId),
    sourceTrackId: typeof value.sourceTrackId === "string" ? value.sourceTrackId : null,
    destinationTrackId: typeof value.destinationTrackId === "string" ? value.destinationTrackId : null,
    routeType: String(value.routeType ?? "output"),
    name: String(value.name ?? "路由"),
    preFader: Boolean(value.preFader),
    gain: Number(value.gain ?? 1),
    pan: Number(value.pan ?? 0),
    muted: Boolean(value.muted),
    sortOrder: Number(value.sortOrder ?? 0)
  };
}

async function applyEntity(db: Db, entityType: string, entityId: string | null, value: Snapshot | null) {
  if (!entityId) throw new Error("操作紀錄缺少 entityId。");

  if (entityType === "track_effects") {
    if (!value) throw new Error("缺少 DSP 設定，不能復原。");
    await db.dawTrack.update({ where: { id: entityId }, data: {
      effectsJson: typeof value.effectsJson === "string" ? value.effectsJson : null
    } });
    return;
  }

  if (entityType === "track_settings") {
    if (!value) throw new Error("缺少錄音通道設定，不能復原。");
    await db.dawTrack.update({ where: { id: entityId }, data: {
      volume: Number(value.volume), pan: Number(value.pan),
      effectsJson: typeof value.effectsJson === "string" ? value.effectsJson : null
    } });
    return;
  }

  if (entityType === "project") {
    if (!value) throw new Error("DAW 專案不能由 Undo 刪除。");
    await db.dawProject.update({
      where: { id: entityId },
      data: {
        title: String(value.title),
        bpm: value.bpm == null ? null : Number(value.bpm),
        musicalKey: typeof value.musicalKey === "string" ? value.musicalKey : null,
        sampleRate: Number(value.sampleRate ?? 48_000),
        bitDepth: Number(value.bitDepth ?? 24),
        timeSignature: String(value.timeSignature ?? "4/4"),
        status: String(value.status ?? "DRAFT"),
        engineMode: String(value.engineMode ?? "web_fallback"),
        projectJson: typeof value.projectJson === "string" ? value.projectJson : null
      }
    });
    return;
  }

  if (entityType === "track") {
    if (!value) {
      await db.dawTrack.deleteMany({ where: { id: entityId } });
      return;
    }
    const data = trackData(value);
    await db.dawTrack.upsert({ where: { id: entityId }, create: { id: entityId, ...data }, update: data });
    const clips = Array.isArray(value.clips) ? (value.clips as Snapshot[]) : [];
    const takeLanes = Array.isArray(value.takeLanes) ? (value.takeLanes as Snapshot[]) : [];
    for (const clip of clips) {
      const id = String(clip.id);
      const data = clipData(clip);
      await db.dawClip.upsert({ where: { id }, create: { id, ...data }, update: data });
    }
    for (const lane of takeLanes) {
      const id = String(lane.id);
      const data = takeLaneData(lane);
      await db.dawTakeLane.upsert({ where: { id }, create: { id, ...data }, update: data });
    }
    return;
  }

  if (entityType === "clip") {
    if (!value) {
      await db.dawClip.deleteMany({ where: { id: entityId } });
      return;
    }
    const data = clipData(value);
    await db.dawClip.upsert({ where: { id: entityId }, create: { id: entityId, ...data }, update: data });
    return;
  }

  if (entityType === "take_lane") {
    if (!value) {
      await db.dawTakeLane.deleteMany({ where: { id: entityId } });
      return;
    }
    const data = takeLaneData(value);
    await db.dawTakeLane.upsert({ where: { id: entityId }, create: { id: entityId, ...data }, update: data });
    return;
  }

  if (entityType === "route") {
    if (!value) {
      await db.dawRoute.deleteMany({ where: { id: entityId } });
      return;
    }
    const data = routeData(value);
    await db.dawRoute.upsert({ where: { id: entityId }, create: { id: entityId, ...data }, update: data });
    return;
  }

  if (entityType === "comp_segment") {
    if (!value) {
      await db.dawTakeCompSegment.deleteMany({ where: { id: entityId } });
      return;
    }
    const data = {
      takeLaneId: String(value.takeLaneId),
      sourceStartSeconds: Number(value.sourceStartSeconds),
      sourceEndSeconds: Number(value.sourceEndSeconds),
      timelineStartSeconds: Number(value.timelineStartSeconds),
      fadeInSeconds: Number(value.fadeInSeconds ?? 0.01),
      fadeOutSeconds: Number(value.fadeOutSeconds ?? 0.01),
      sortOrder: Number(value.sortOrder ?? 0),
      active: value.active !== false
    };
    await db.dawTakeCompSegment.upsert({ where: { id: entityId }, create: { id: entityId, ...data }, update: data });
    return;
  }

  if (entityType === "automation_lane") {
    if (!value) {
      await db.dawAutomationLane.deleteMany({ where: { id: entityId } });
      return;
    }
    const data = {
      trackId: String(value.trackId),
      parameter: String(value.parameter),
      mode: String(value.mode ?? "read"),
      enabled: value.enabled !== false,
      minValue: Number(value.minValue ?? 0),
      maxValue: Number(value.maxValue ?? 1)
    };
    await db.dawAutomationLane.upsert({ where: { id: entityId }, create: { id: entityId, ...data }, update: data });
    await db.dawAutomationPoint.deleteMany({ where: { laneId: entityId } });
    const points = Array.isArray(value.points) ? (value.points as Snapshot[]) : [];
    if (points.length) {
      await db.dawAutomationPoint.createMany({
        data: points.map((point) => ({
          id: typeof point.id === "string" ? point.id : undefined,
          laneId: entityId,
          timeSeconds: Number(point.timeSeconds),
          value: Number(point.value),
          curve: String(point.curve ?? "linear")
        }))
      });
    }
    return;
  }

  throw new Error(`尚不支援復原 ${entityType}。`);
}

export async function recordDawEditOperation(
  db: Db,
  input: {
    projectId: string;
    operationType: string;
    entityType: string;
    entityId?: string | null;
    label: string;
    before?: unknown;
    after?: unknown;
    groupId?: string | null;
  }
) {
  await db.dawEditOperation.deleteMany({ where: { projectId: input.projectId, status: "UNDONE" } });
  const latest = await db.dawEditOperation.aggregate({ where: { projectId: input.projectId }, _max: { sequence: true } });
  return db.dawEditOperation.create({
    data: {
      projectId: input.projectId,
      sequence: (latest._max.sequence ?? 0) + 1,
      operationType: input.operationType,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      label: input.label,
      beforeJson: json(input.before),
      afterJson: json(input.after),
      groupId: input.groupId ?? null
    }
  });
}

export async function appendDawRecoveryEntry(input: {
  projectId: string;
  sessionId: string;
  eventType: string;
  payload: unknown;
  status?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.dawRecoveryEntry.aggregate({
      where: { projectId: input.projectId, sessionId: input.sessionId },
      _max: { sequence: true }
    });
    return tx.dawRecoveryEntry.create({
      data: {
        projectId: input.projectId,
        sessionId: input.sessionId,
        sequence: (latest._max.sequence ?? 0) + 1,
        eventType: input.eventType,
        payloadJson: JSON.stringify(input.payload),
        status: input.status ?? "PENDING"
      }
    });
  });
}

export async function stepDawHistory(projectId: string, direction: "undo" | "redo", expectedOperationId?: string) {
  return prisma.$transaction(async (tx) => {
    const operation = await tx.dawEditOperation.findFirst({
      where: { projectId, status: direction === "undo" ? "APPLIED" : "UNDONE" },
      orderBy: { sequence: direction === "undo" ? "desc" : "asc" }
    });
    if (expectedOperationId && operation?.id !== expectedOperationId) throw new Error("已有其他編輯；請從操作歷史依序復原，避免覆蓋後續調整。");
    if (!operation) return null;
    const operations = operation.groupId
      ? await tx.dawEditOperation.findMany({
          where: { projectId, groupId: operation.groupId, status: direction === "undo" ? "APPLIED" : "UNDONE" },
          orderBy: { sequence: direction === "undo" ? "desc" : "asc" }
        })
      : [operation];
    for (const item of operations) {
      const target = parseSnapshot(direction === "undo" ? item.beforeJson : item.afterJson);
      await applyEntity(tx, item.entityType, item.entityId, target);
      await tx.dawEditOperation.update({
        where: { id: item.id },
        data: direction === "undo" ? { status: "UNDONE", undoneAt: new Date() } : { status: "APPLIED", undoneAt: null }
      });
    }
    return operation;
  });
}

export async function dawHistorySummary(projectId: string) {
  const [undo, redo] = await Promise.all([
    prisma.dawEditOperation.findFirst({ where: { projectId, status: "APPLIED" }, orderBy: { sequence: "desc" } }),
    prisma.dawEditOperation.findFirst({ where: { projectId, status: "UNDONE" }, orderBy: { sequence: "asc" } })
  ]);
  return {
    canUndo: Boolean(undo),
    canRedo: Boolean(redo),
    undoLabel: undo?.label ?? null,
    redoLabel: redo?.label ?? null
  };
}
