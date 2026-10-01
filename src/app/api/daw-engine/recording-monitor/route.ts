import { NextResponse } from "next/server";
import { z } from "zod";
import { isLoopbackRequest } from "@/lib/local-request";
import { nativeDawRequest } from "@/lib/native-daw";

const schema = z.object({ recordingId: z.string().uuid(), level: z.number().min(0).max(1.5) });

export async function POST(request: Request) {
  if (!isLoopbackRequest(request)) return NextResponse.json({ error: "僅限本機錄音監聽。" }, { status: 403 });
  try {
    const body = schema.parse(await request.json());
    return NextResponse.json(await nativeDawRequest("/recordings/monitor", { method: "POST", body: JSON.stringify(body) }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "監聽更新失敗。" }, { status: 409 });
  }
}
