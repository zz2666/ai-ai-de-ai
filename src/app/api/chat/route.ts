import { NextRequest, NextResponse } from "next/server";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    (record.role === "system" ||
      record.role === "user" ||
      record.role === "assistant") &&
    typeof record.content === "string"
  );
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  const model = process.env.AI_MODEL;

  if (!apiKey || !baseUrl || !model) {
    return NextResponse.json(
      { error: "AI gateway environment variables are not configured." },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    messages?: unknown;
  } | null;

  const messages = Array.isArray(body?.messages)
    ? body.messages.filter(isChatMessage)
    : [];

  if (messages.length === 0) {
    return NextResponse.json(
      { error: "Request body must include at least one chat message." },
      { status: 400 },
    );
  }

  // TODO: 准备在此处将 AI HOT 抓取到的实时热点注入为 System Context
  const upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    const errorText = await upstreamResponse.text().catch(() => "");

    return NextResponse.json(
      {
        error: "AI gateway request failed.",
        detail: errorText,
      },
      { status: upstreamResponse.status || 502 },
    );
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type":
        upstreamResponse.headers.get("Content-Type") ??
        "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
