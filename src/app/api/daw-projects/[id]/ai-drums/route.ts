import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { code: "AI_DRUMS_RETIRED", error: "AI 鼓編制已停用。既有鼓軌、音色與原始音檔仍保留。" },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
