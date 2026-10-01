import { NextResponse } from "next/server";

import { appVersion } from "@/lib/app-info";
import { mobileTrustCorsHeaders, MobileTrustError, requireTrustedMobileRequest } from "@/lib/mobile-trust";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const corsHeaders = mobileTrustCorsHeaders;

export async function GET(request: Request) {
  try {
    await requireTrustedMobileRequest(request);
    const songs = await prisma.song.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        bpm: true,
        musicalKey: true,
        dawProjects: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: {
            id: true,
            title: true,
            sampleRate: true,
            bitDepth: true,
            timeSignature: true,
            tracks: {
              orderBy: { sortOrder: "asc" },
              select: { id: true, name: true, trackType: true, color: true }
            }
          }
        }
      }
    });

    return NextResponse.json(
      {
        version: appVersion,
        captureMode: "mobile_native_wav",
        songs: songs.map(({ dawProjects, ...song }) => ({ ...song, project: dawProjects[0] ?? null }))
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "無法讀取手機錄音資料。" },
      { status: error instanceof MobileTrustError ? error.status : 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
