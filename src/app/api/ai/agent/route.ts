import { NextResponse } from "next/server";
import { z } from "zod";

import { getAiAgentProviderStatus, getAiConversation, listAiConversations, submitAiAgentMessage } from "@/lib/ai-agent";

export const runtime = "nodejs";
export const maxDuration = 300;

const MessageSchema = z.object({
  conversationId: z.string().optional().nullable(),
  message: z.string().trim().min(1).max(8_000),
  requireCodex: z.boolean().optional().default(false)
});

export async function GET(request: Request) {
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  const [providerStatus, conversation, conversations] = await Promise.all([
    getAiAgentProviderStatus(),
    getAiConversation(conversationId),
    listAiConversations()
  ]);
  return NextResponse.json({ providerStatus, conversation, conversations });
}

export async function POST(request: Request) {
  try {
    const body = MessageSchema.parse(await request.json());
    return NextResponse.json(
      await submitAiAgentMessage({ conversationId: body.conversationId, content: body.message, requireCodex: body.requireCodex }),
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI 代理人無法處理這個問題。" }, { status: 400 });
  }
}
