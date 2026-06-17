import { NextRequest, NextResponse } from "next/server";

const AIHOT_ITEMS_ENDPOINT =
  "https://aihot.virxact.com/api/public/items?mode=selected&take=30";
const AIHOT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ai-ai-de-ai-rag/0.1.0";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type AiHotItem = {
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  url: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function extractAiHotItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  const items = payload.items;

  return Array.isArray(items) ? items : [];
}

function normalizeAiHotItem(rawItem: unknown): AiHotItem | null {
  if (!isRecord(rawItem)) {
    return null;
  }

  const title = pickString(rawItem, ["title", "title_zh", "headline"]);

  if (!title) {
    return null;
  }

  return {
    title,
    summary:
      pickString(rawItem, ["summary", "description", "desc"]) ?? "暂无摘要",
    source:
      pickString(rawItem, ["source", "sourceName", "publisher"]) ?? "AI HOT",
    publishedAt:
      pickString(rawItem, ["publishedAt", "published_at", "createdAt"]) ??
      "发布时间未知",
    url: pickString(rawItem, ["url", "sourceUrl", "link"]) ?? "原文链接缺失",
  };
}

function formatPublishedAt(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatAiHotContext(items: AiHotItem[]): string {
  if (items.length === 0) {
    return "AI HOT 实时数据暂未解码成功。回答今日最新新闻时请明确说明当前缺少实时上下文。";
  }

  return items
    .map(
      (item, index) => `${index + 1}. ${item.title}
   来源：${item.source}
   时间：${formatPublishedAt(item.publishedAt)}
   摘要：${item.summary}
   原文：${item.url}`,
    )
    .join("\n\n");
}

async function fetchAiHotContext(): Promise<string> {
  try {
    const response = await fetch(AIHOT_ITEMS_ENDPOINT, {
      headers: {
        Accept: "application/json",
        "User-Agent": AIHOT_USER_AGENT,
      },
      next: {
        revalidate: 300,
      },
    });

    if (!response.ok) {
      throw new Error(`AI HOT responded with ${response.status}`);
    }

    const payload: unknown = await response.json();
    const items = extractAiHotItems(payload)
      .map(normalizeAiHotItem)
      .filter((item): item is AiHotItem => item !== null);

    return formatAiHotContext(items);
  } catch {
    return formatAiHotContext([]);
  }
}

function buildSystemMessage(aiHotContext: string): ChatMessage {
  return {
    role: "system",
    content: `你是一个部署在赛博朋克黑客控制台【AI AI 的 AI】里的前沿科技全能向导。
以下是系统刚刚从 AI HOT 数据库中实时抓取到的今日最新 AI 前沿动态与技术热点：

${aiHotContext}

请严格基于上方提供的最新实时数据，结合你强大的模型泛化能力，充满科技感、一针见血地回答用户的提问。如果用户询问的事情不在上述数据中，你可以使用你的通用知识库（如基础技术概念）进行合理解答，但涉及今日最新新闻时，必须以上述实时抓取的数据为准。`,
  };
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

  const aiHotContext = await fetchAiHotContext();
  const upstreamMessages = [
    buildSystemMessage(aiHotContext),
    ...messages.filter((message) => message.role !== "system"),
  ];

  const upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: upstreamMessages,
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
