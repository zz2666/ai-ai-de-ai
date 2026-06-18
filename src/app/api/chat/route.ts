import { NextRequest, NextResponse } from "next/server";

const AIHOT_ITEMS_ENDPOINT = "https://aihot.virxact.com/api/public/items";
const AIHOT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ai-ai-de-ai-tools/0.1.0";
const HARD_TIMEOUT_MS = 15_000;
const STREAM_TIMEOUT_MS = 90_000;
const MAX_TOOL_API_CALLS = 3;
const SERVER_CIRCUIT_BREAKER_ERROR = "SERVER_CIRCUIT_BREAKER_TRIGGERED";
const EMPTY_SEARCH_MESSAGE = "历史上未找到相关热点。";
const KNOWN_AI_KEYWORDS = [
  "OpenAI",
  "Anthropic",
  "Google",
  "DeepMind",
  "Gemini",
  "ChatGPT",
  "GPT-5",
  "GPT-4o",
  "Claude",
  "Grok",
  "xAI",
  "Sora",
  "DeepSeek",
  "Qwen",
  "通义千问",
  "Kimi",
  "豆包",
  "Moonshot",
  "月之暗面",
  "MiniMax",
  "阶跃星辰",
  "RAG",
  "MCP",
  "Agent",
];
const GENERIC_LATIN_TERMS = new Set([
  "ai",
  "llm",
  "news",
  "latest",
  "today",
  "yesterday",
  "week",
  "month",
  "year",
  "history",
  "about",
  "with",
  "what",
  "which",
  "when",
  "where",
  "how",
  "and",
  "or",
  "the",
  "for",
  "from",
  "update",
  "updates",
]);

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: "query_ai_hot_news";
    arguments: string;
  };
};

type ToolArguments = {
  q?: string;
  category?: string;
};

type NextFetchInit = RequestInit & {
  next?: {
    revalidate?: number;
  };
};

type AiHotNewsItem = {
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  category: string;
};

type AiHotQueryResult = {
  query: string;
  category: string | null;
  count: number;
  items: AiHotNewsItem[];
  error?: string;
};

type ToolExecutionBatch = {
  toolMessages: ChatMessage[];
  totalItemCount: number;
  hasError: boolean;
};

type ToolContextResult = {
  messages: ChatMessage[];
  directReply?: string;
};

const queryAiHotNewsTool = {
  type: "function",
  function: {
    name: "query_ai_hot_news",
    description:
      "Precision search AI HOT by one concrete keyword. Always use the q parameter; never paginate, browse daily archives, or broaden the query when q returns no items.",
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description:
            "用户问题中的唯一核心关键词、公司名、模型名或技术名，例如 Grok、Sora、OpenAI、RAG、Claude。必须用于 ?q= 精准查询。",
        },
        category: {
          type: "string",
          enum: ["ai-models", "ai-products", "industry", "paper", "tip"],
          description: "可选分类筛选。",
        },
      },
      required: ["q"],
      additionalProperties: false,
    },
  },
} as const;

const systemPrompt: ChatMessage = {
  role: "system",
  content: `你是一个通晓 AI 圈全量历史与前沿资讯的超级智能 Chatbot。
当用户问及任何 AI 行业动态、历史事件（如去年的进展）、特定模型或技术时，你禁止直接回答“不知道”或“只能看今天的资讯”。
你必须优先调用 \`query_ai_hot_news\` 工具，利用用户问题中的核心主体（如 OpenAI, Sora, RAG 等）作为关键词去 AI HOT 数据库中动态检索历史与前沿线索。
只要用户问题里出现具体项目、公司、模型、产品或技术关键词（例如 Grok、Sora、Claude、DeepSeek），必须且只能用该关键词进行 \`?q=\` 精准查询。
禁止通过分页、日报归档、日期回退或扩大关键词去穷举历史数据。若精准关键词查询没有返回热点，必须直接回答“历史上未找到相关热点。”并结束。

【输出格式硬性规范】：
1. 必须使用 Markdown 的无序列表（- 分点）进行陈述，且每一点之间必须有清晰的换行。
2. 凡是在回答中引用、提及、概括了某条 AI HOT 资讯，你必须在对应小点的末尾，附带该条资讯的原始 URL 链接。超链接的标准 Markdown 格式严格规定为：\`[🔗 查看信源](url)\`。`,
};
const finalAnswerInstruction: ChatMessage = {
  role: "user",
  content:
    "请只基于上面的 AI HOT 工具结果回答上一条用户问题。禁止继续请求工具，禁止编造工具结果之外的热点。若所有工具结果 count 均为 0，只回答“历史上未找到相关热点。”；若工具结果包含 error，说明检索失败并建议稍后重试。",
};
const allowedCategories = new Set([
  "ai-models",
  "ai-products",
  "industry",
  "paper",
  "tip",
]);

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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isCircuitBreakerError(error: unknown): boolean {
  return error instanceof Error && error.message === SERVER_CIRCUIT_BREAKER_ERROR;
}

function createChatTextStreamResponse(content: string): Response {
  const encoder = new TextEncoder();
  const payload = JSON.stringify({
    choices: [
      {
        delta: {
          content,
        },
      },
    ],
  });

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    },
  );
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: NextFetchInit = {},
  timeoutMs = HARD_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function createTimeoutSignal(timeoutMs = HARD_TIMEOUT_MS): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

function inferCategory(query: string): string | undefined {
  if (/论文|paper|research/i.test(query)) {
    return "paper";
  }

  if (/模型|model|大模型|llm/i.test(query)) {
    return "ai-models";
  }

  if (/产品|应用|app|product/i.test(query)) {
    return "ai-products";
  }

  if (/融资|收购|合作|行业|监管|公司|industry/i.test(query)) {
    return "industry";
  }

  if (/技巧|教程|观点|prompt|提示词|tip/i.test(query)) {
    return "tip";
  }

  return undefined;
}

function getPreferredKeyword(query: string): string {
  const concreteKeyword = extractConcreteKeywords(query, 1)[0];

  if (concreteKeyword) {
    return concreteKeyword;
  }

  const lowerQuery = query.toLowerCase();

  for (const keyword of KNOWN_AI_KEYWORDS) {
    if (lowerQuery.includes(keyword.toLowerCase())) {
      return keyword;
    }
  }

  const latinEntity = query.match(/[A-Za-z][A-Za-z0-9.+_-]{1,40}/);
  if (latinEntity) {
    return latinEntity[0];
  }

  const compactQuery = query
    .replace(
      /请|帮我|看下|看看|查询|一下|关于|有关|上个月|上月|上周|去年|前年|历史|过去|此前|之前|早前|回顾|复盘|动态|进展|发布|更新|近况|最近|什么|哪些|如何|怎么|的|了|吗|呢|和|与|及|以及|[\s"'“”‘’。，、？！?！：:；;（）()【】\[\]{}<>《》]/g,
      "",
    )
    .trim();

  return compactQuery.slice(0, 40) || query.slice(0, 40) || "AI";
}

function extractConcreteKeywords(
  query: string,
  maxKeywords = MAX_TOOL_API_CALLS,
): string[] {
  const keywords = new Map<string, string>();
  const lowerQuery = query.toLowerCase();

  for (const keyword of KNOWN_AI_KEYWORDS) {
    if (lowerQuery.includes(keyword.toLowerCase())) {
      keywords.set(keyword.toLowerCase(), keyword);
    }
  }

  for (const match of query.match(/[A-Za-z][A-Za-z0-9.+_-]{1,40}/g) ?? []) {
    const normalizedMatch = match.toLowerCase();

    if (!GENERIC_LATIN_TERMS.has(normalizedMatch)) {
      keywords.set(normalizedMatch, match);
    }
  }

  return [...keywords.values()].slice(0, maxKeywords);
}

function createKeywordToolCall(
  query: string,
  keyword: string,
  index = 0,
): ToolCall {
  return {
    id: `call_aihot_keyword_${Date.now()}_${index}`,
    type: "function",
    function: {
      name: "query_ai_hot_news",
      arguments: JSON.stringify({
        q: keyword,
        category: inferCategory(query),
      }),
    },
  };
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

function normalizeAiHotNewsItem(rawItem: unknown): AiHotNewsItem | null {
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
    url: pickString(rawItem, ["url", "sourceUrl", "link"]) ?? "",
    publishedAt:
      pickString(rawItem, [
        "publishedAt",
        "published_at",
        "createdAt",
        "created_at",
      ]) ?? "",
    category: pickString(rawItem, ["category", "section", "type"]) ?? "",
  };
}

function parseToolArguments(rawArguments: string): ToolArguments {
  try {
    const parsedArguments = JSON.parse(rawArguments) as unknown;

    if (!isRecord(parsedArguments)) {
      return {};
    }

    return {
      q: pickString(parsedArguments, ["q"]),
      category: pickString(parsedArguments, ["category"]),
    };
  } catch {
    return {};
  }
}

async function queryAiHotNews(args: ToolArguments): Promise<AiHotQueryResult> {
  const q = args.q?.trim();
  const category =
    args.category && allowedCategories.has(args.category)
      ? args.category
      : undefined;

  if (!q) {
    return {
      query: "",
      category: category ?? null,
      count: 0,
      error: "Missing q. Extract a concrete keyword from the user question.",
      items: [],
    };
  }

  const url = new URL(AIHOT_ITEMS_ENDPOINT);
  url.searchParams.set("q", q);
  url.searchParams.set("take", "30");

  if (category) {
    url.searchParams.set("category", category);
  }

  try {
    const response = await fetchWithTimeout(url, {
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
      .map(normalizeAiHotNewsItem)
      .filter((item): item is AiHotNewsItem => item !== null);

    return {
      query: q,
      category: category ?? null,
      count: items.length,
      items,
    };
  } catch (error) {
    return {
      query: q,
      category: category ?? null,
      count: 0,
      error:
        error instanceof Error
          ? error.message
          : "Unknown AI HOT search failure.",
      items: [],
    };
  }
}

function getLastUserQuery(messages: ChatMessage[]): string {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  return lastUserMessage?.content?.slice(0, 200).trim() || "AI";
}

async function createToolPlanningMessage(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
}): Promise<ChatMessage> {
  const response = await fetchWithTimeout(
    `${params.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        tools: [queryAiHotNewsTool],
        tool_choice: "auto",
        stream: false,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || "AI gateway tool planning failed.");
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: ChatMessage;
    }>;
  };
  const message = payload.choices?.[0]?.message;

  if (!message) {
    throw new Error("AI gateway did not return a planning message.");
  }

  return message;
}

function normalizeToolCalls(toolCalls: ToolCall[], fallbackQuery: string) {
  return toolCalls
    .filter((toolCall) => toolCall.function.name === "query_ai_hot_news")
    .map((toolCall, index): ToolCall => {
      const args = parseToolArguments(toolCall.function.arguments);

      return {
        id: toolCall.id || `call_aihot_planned_${Date.now()}_${index}`,
        type: "function",
        function: {
          name: "query_ai_hot_news",
          arguments: JSON.stringify({
            q: args.q?.trim() || getPreferredKeyword(fallbackQuery),
            category: args.category,
          }),
        },
      };
    });
}

async function createToolContext(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  conversationMessages: ChatMessage[];
  lastUserQuery: string;
}): Promise<ToolContextResult> {
  let apiCallCount = 0;
  const maxLoops = MAX_TOOL_API_CALLS;

  async function executeBoundedToolCalls(
    toolCalls: ToolCall[],
  ): Promise<ToolExecutionBatch> {
    const toolMessages: ChatMessage[] = [];
    let totalItemCount = 0;
    let hasError = false;

    for (const toolCall of toolCalls) {
      if (toolCall.function.name !== "query_ai_hot_news") {
        continue;
      }

      if (apiCallCount >= maxLoops) {
        throw new Error(SERVER_CIRCUIT_BREAKER_ERROR);
      }

      apiCallCount += 1;

      const result = await queryAiHotNews(
        parseToolArguments(toolCall.function.arguments),
      );

      totalItemCount += result.count;
      hasError = hasError || Boolean(result.error);

      toolMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    return {
      toolMessages,
      totalItemCount,
      hasError,
    };
  }

  const exactKeywords = extractConcreteKeywords(params.lastUserQuery);
  const toolCalls =
    exactKeywords.length > 0
      ? exactKeywords.map((keyword, index) =>
          createKeywordToolCall(params.lastUserQuery, keyword, index),
        )
      : normalizeToolCalls(
          (
            await createToolPlanningMessage({
              baseUrl: params.baseUrl,
              apiKey: params.apiKey,
              model: params.model,
              messages: params.conversationMessages,
            })
          ).tool_calls ?? [],
          params.lastUserQuery,
        );
  const safeToolCalls =
    toolCalls.length > 0
      ? toolCalls
      : [
          createKeywordToolCall(
            params.lastUserQuery,
            getPreferredKeyword(params.lastUserQuery),
          ),
        ];
  const toolBatch = await executeBoundedToolCalls(safeToolCalls);

  if (toolBatch.totalItemCount === 0 && !toolBatch.hasError) {
    return {
      messages: params.conversationMessages,
      directReply: EMPTY_SEARCH_MESSAGE,
    };
  }

  return {
    messages: [
      ...params.conversationMessages,
      {
        role: "assistant",
        content: null,
        tool_calls: safeToolCalls,
      },
      ...toolBatch.toolMessages,
      finalAnswerInstruction,
    ],
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

  const conversationMessages = [
    systemPrompt,
    ...messages.filter((message) => message.role !== "system"),
  ];
  const lastUserQuery = getLastUserQuery(conversationMessages);

  let upstreamMessages = conversationMessages;

  try {
    const toolContext = await createToolContext({
      baseUrl,
      apiKey,
      model,
      conversationMessages,
      lastUserQuery,
    });

    if (toolContext.directReply) {
      return createChatTextStreamResponse(toolContext.directReply);
    }

    upstreamMessages = toolContext.messages;
  } catch (error) {
    if (isCircuitBreakerError(error)) {
      return NextResponse.json(
        {
          code: SERVER_CIRCUIT_BREAKER_ERROR,
          error:
            "检测到死循环风险，系统已强制断开连接，请尝试用更精准的关键词提问",
        },
        { status: 429 },
      );
    }

    if (isAbortError(error)) {
      return NextResponse.json(
        {
          error: "AI tool planning timed out.",
          detail: "15 second hard breaker tripped.",
        },
        { status: 504 },
      );
    }

    return NextResponse.json(
      {
        error: "AI tool planning failed.",
        detail:
          error instanceof Error ? error.message : "Unknown AI planning failure.",
      },
      { status: 502 },
    );
  }

  const streamTimeout = createTimeoutSignal(STREAM_TIMEOUT_MS);
  let upstreamResponse: Response;

  try {
    upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: streamTimeout.signal,
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
  } catch (error) {
    streamTimeout.clear();

    return NextResponse.json(
      {
        error: isAbortError(error)
          ? "AI gateway stream timed out."
          : "AI gateway request failed.",
        detail: isAbortError(error)
          ? "90 second stream breaker tripped."
          : error instanceof Error
            ? error.message
            : "Unknown AI gateway failure.",
      },
      { status: isAbortError(error) ? 504 : 502 },
    );
  }

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    const errorText = await upstreamResponse.text().catch(() => "");
    streamTimeout.clear();

    return NextResponse.json(
      {
        error: "AI gateway request failed.",
        detail: errorText,
      },
      { status: upstreamResponse.status || 502 },
    );
  }

  const upstreamReader = upstreamResponse.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await upstreamReader.read();

        if (done) {
          streamTimeout.clear();
          controller.close();
          return;
        }

        controller.enqueue(value);
      } catch (error) {
        streamTimeout.clear();
        controller.error(error);
      }
    },
    cancel() {
      streamTimeout.clear();
      void upstreamReader.cancel();
    },
  });

  return new Response(stream, {
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
