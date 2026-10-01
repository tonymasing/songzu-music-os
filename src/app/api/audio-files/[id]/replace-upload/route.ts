import { NextResponse } from "next/server";

import { replaceAudioFileWithUpload } from "@/lib/audio-repair";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "沒有收到檔案" }, { status: 400 });
  }

  try {
    return NextResponse.json(await replaceAudioFileWithUpload(id, file), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "重新上傳失敗。" },
      { status: 400 }
    );
  }
}
