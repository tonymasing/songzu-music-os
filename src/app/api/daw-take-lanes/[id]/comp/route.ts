import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const lane = await prisma.dawTakeLane.findUnique({
    where: { id },
    include: {
      track: true,
      recordingTake: { include: { audioFile: true } },
      compSegments: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { timelineStartSeconds: "asc" }] }
    }
  });
  if (!lane) return NextResponse.json({ error: "找不到 Take lane。" }, { status: 404 });
  if (!lane.recordingTake.audioFile) return NextResponse.json({ error: "這個 Take 尚未綁定可用音檔。" }, { status: 400 });
  if (!lane.compSegments.length) return NextResponse.json({ error: "請先加入至少一個啟用中的 Comp 區段。" }, { status: 400 });

  const groupId = `comp-${randomUUID()}`;
  const createdClips = await prisma.$transaction(async (tx) => {
    const clips = [];
    for (const [index, segment] of lane.compSegments.entries()) {
      const durationSeconds = segment.sourceEndSeconds - segment.sourceStartSeconds;
      const clip = await tx.dawClip.create({
        data: {
          trackId: lane.trackId,
          audioFileId: lane.recordingTake.audioFile!.id,
          startSeconds: segment.timelineStartSeconds,
          offsetSeconds: segment.sourceStartSeconds,
          durationSeconds,
          gain: 1,
          fadeInSeconds: Math.min(segment.fadeInSeconds, durationSeconds / 2),
          fadeOutSeconds: Math.min(segment.fadeOutSeconds, durationSeconds / 2),
          label: `${lane.recordingTake.label} · Comp ${index + 1}`,
          color: lane.track.color,
          groupId,
          crossfadeGroupId: groupId
        }
      });
      clips.push(clip);
      await recordDawEditOperation(tx, {
        projectId: lane.track.projectId,
        operationType: "create",
        entityType: "clip",
        entityId: clip.id,
        label: `建立 ${lane.recordingTake.label} Comp`,
        before: null,
        after: clip,
        groupId
      });
    }

    const updatedLane = await tx.dawTakeLane.update({ where: { id }, data: { compStatus: "comped" } });
    await recordDawEditOperation(tx, {
      projectId: lane.track.projectId,
      operationType: "update",
      entityType: "take_lane",
      entityId: id,
      label: `完成 ${lane.recordingTake.label} Comp`,
      before: lane,
      after: updatedLane,
      groupId
    });
    return clips;
  });

  const project = await getDawProjectById(lane.track.projectId);
  return NextResponse.json({
    createdClipCount: createdClips.length,
    groupId,
    project: project ? toDawProjectDto(project) : null
  }, { status: 201 });
}
