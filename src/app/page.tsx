"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Flame,
  RadioTower,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

type HotItem = {
  id: string;
  title: string;
  score: number | null;
  scoreLabel: string;
  summary: string;
  source: string;
  category: string;
  publishedAtLabel: string;
  url?: string;
};

type Message = {
  role: "system" | "user" | "assistant";
  content: string;
  tone?: "error";
};

type HotFeedStatus = "idle" | "loading" | "success" | "error";
type DeckTabId = "featured" | "models" | "research";

const CHAT_REQUEST_TIMEOUT_MS = 90_000;
const CRITICAL_BREAK_MESSAGE =
  "⚠️ [CRITICAL_BREAK]: 死循环拦截成功，系统强行熔断";

const initialMessages: Message[] = [
  {
    role: "system",
    content:
      "TERMINAL ONLINE. OneAPI 流式链路已挂载，等待你的第一条指令。",
  },
];

const categoryLabels: Record<string, string> = {
  "ai-models": "模型发布/更新",
  "ai-products": "产品发布/更新",
  industry: "行业动态",
  paper: "论文研究",
  tip: "技巧与观点",
};

const deckTabs: Array<{
  id: DeckTabId;
  label: string;
  hint: string;
}> = [
  {
    id: "featured",
    label: "精选热点",
    hint: "SELECTED",
  },
  {
    id: "models",
    label: "模型产品",
    hint: "MODELS",
  },
  {
    id: "research",
    label: "研究观点",
    hint: "RESEARCH",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSafeText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    const serializedValue = JSON.stringify(value);
    return serializedValue ?? String(value);
  } catch {
    return String(value);
  }
}

function toErrorText(error: unknown): string {
  const errorText = toSafeText(error).trim();
  return errorText || "UNKNOWN FAILURE";
}

function normalizeMessage(rawMessage: unknown): Message {
  if (!isRecord(rawMessage)) {
    return {
      role: "assistant",
      content: toSafeText(rawMessage),
      tone: "error",
    };
  }

  const rawRole = rawMessage.role;
  const role =
    rawRole === "system" || rawRole === "user" || rawRole === "assistant"
      ? rawRole
      : "assistant";
  const tone = rawMessage.tone === "error" ? "error" : undefined;

  return {
    role,
    content: toSafeText(rawMessage.content),
    tone,
  };
}

function extractTextFragment(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(extractTextFragment).join("");
  }

  if (isRecord(value)) {
    return (
      extractTextFragment(value.text) ||
      extractTextFragment(value.content) ||
      extractTextFragment(value.value)
    );
  }

  return "";
}

function extractChoiceText(choice: unknown): string {
  if (!isRecord(choice)) {
    return "";
  }

  const deltaText = isRecord(choice.delta)
    ? extractTextFragment(choice.delta.content)
    : "";
  const messageText = isRecord(choice.message)
    ? extractTextFragment(choice.message.content)
    : "";

  return deltaText || messageText || extractTextFragment(choice.text);
}

function extractPayloadText(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  if (Array.isArray(payload.choices)) {
    return payload.choices.map(extractChoiceText).join("");
  }

  const deltaText = isRecord(payload.delta)
    ? extractTextFragment(payload.delta.content)
    : "";
  const messageText = isRecord(payload.message)
    ? extractTextFragment(payload.message.content)
    : "";

  return (
    deltaText ||
    messageText ||
    extractTextFragment(payload.content) ||
    extractTextFragment(payload.text)
  );
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  for (const key of ["items", "data", "results", "list"]) {
    const value = payload[key];

    if (Array.isArray(value)) {
      return value;
    }

    if (isRecord(value)) {
      const nestedItems = extractItems(value);
      if (nestedItems.length > 0) {
        return nestedItems;
      }
    }
  }

  return [];
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

    if (isRecord(value)) {
      const nestedValue = pickString(value, ["name", "title", "label"]);
      if (nestedValue) {
        return nestedValue;
      }
    }
  }

  return undefined;
}

function pickNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.min(100, Math.round(value)));
    }

    if (typeof value === "string" && value.trim()) {
      const parsedValue = Number.parseFloat(value);
      if (Number.isFinite(parsedValue)) {
        return Math.max(0, Math.min(100, Math.round(parsedValue)));
      }
    }
  }

  return null;
}

function formatSignalTime(value?: string): string {
  if (!value) {
    return "LIVE FEED";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "TIME SIGNAL";
  }

  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;

  if (diffMs >= 0 && diffMs < hour) {
    return `${Math.max(1, Math.floor(diffMs / minute))} 分钟前`;
  }

  if (diffMs >= 0 && diffMs < 24 * hour) {
    return `${Math.floor(diffMs / hour)} 小时前`;
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

function formatSyncTime(value: Date | null): string {
  if (!value) {
    return "PENDING";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

function normalizeHotItem(rawItem: unknown, index: number): HotItem {
  const item = isRecord(rawItem) ? rawItem : {};
  const title =
    pickString(item, ["title", "title_zh", "name", "headline"]) ??
    "UNTITLED MATRIX SIGNAL";
  const summary =
    pickString(item, ["summary", "description", "desc", "abstract", "content"]) ??
    "该条目暂无摘要，等待外脑完成语义解码。";
  const source =
    pickString(item, ["source", "sourceName", "siteName", "publisher", "author"]) ??
    "AI HOT";
  const categoryKey = pickString(item, ["category", "section", "type"]) ?? "";
  const publishedAt = pickString(item, [
    "publishedAt",
    "published_at",
    "createdAt",
    "updatedAt",
    "date",
    "time",
  ]);
  const score = pickNumber(item, ["score", "heat", "hotScore", "rankScore"]);
  const publishedAtLabel = formatSignalTime(publishedAt);
  const category = categoryLabels[categoryKey] ?? (categoryKey || "AI 动态");

  return {
    id:
      pickString(item, ["id", "slug", "url", "sourceUrl"]) ??
      `aihot-signal-${index}`,
    title,
    score,
    scoreLabel: score === null ? publishedAtLabel : `${score}`,
    summary,
    source,
    category,
    publishedAtLabel,
    url: pickString(item, ["url", "sourceUrl", "link", "href"]),
  };
}

type StreamParseResult = {
  content: string;
  isDone: boolean;
  remainder: string;
};

function extractStreamContent(rawChunk: string, flush = false): StreamParseResult {
  let content = "";
  let isDone = false;
  const lines = rawChunk.split("\n");
  const remainder = flush ? "" : lines.pop() ?? "";

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      continue;
    }

    if (trimmedLine.includes("[DONE]") || trimmedLine.includes("data: [DONE]")) {
      isDone = true;
      break;
    }

    if (!trimmedLine.startsWith("data:")) {
      continue;
    }

    const jsonStr = trimmedLine.replace(/^data:\s*/, "");
    if (!jsonStr || jsonStr === "[DONE]" || jsonStr.includes("[DONE]")) {
      isDone = true;
      break;
    }

    try {
      const payload: unknown = JSON.parse(jsonStr);
      content += extractPayloadText(payload);
    } catch (error) {
      console.warn("略过不完整的流数据行:", error);
      continue;
    }
  }

  return { content, isDone, remainder: isDone ? "" : remainder };
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="terminal-markdown">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00f0ff] underline-offset-4 transition hover:text-[#fcee0a] hover:underline hover:drop-shadow-[0_0_10px_rgba(252,238,10,0.75)]"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function HotScreenshot({ url, title }: { url?: string; title: string }) {
  const [isLoaded, setIsLoaded] = useState(false);

  if (!url) {
    return (
      <div className="grid aspect-[16/7] place-items-center border border-cyan-500/15 bg-zinc-950 text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300/50">
        MATRIX SOURCE LOCKED
      </div>
    );
  }

  return (
    <div className="relative aspect-[16/7] overflow-hidden border border-cyan-500/20 bg-zinc-950">
      {!isLoaded ? (
        <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(135deg,rgba(8,145,178,0.18),rgba(24,24,27,0.86)),repeating-linear-gradient(90deg,rgba(34,211,238,0.13)_0_1px,transparent_1px_9px)] text-xs font-black uppercase tracking-[0.28em] text-cyan-300">
          矩阵注入中...
        </div>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&embed=screenshot.url`}
        alt={`${title} screenshot`}
        className={`h-full w-full object-cover opacity-70 mix-blend-screen transition duration-500 ${
          isLoaded ? "scale-100 opacity-80" : "scale-105 opacity-0"
        }`}
        onLoad={() => setIsLoaded(true)}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.78))]" />
    </div>
  );
}

function getChatErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "矩阵安全熔断：大模型调用超过 90 秒未响应，已强制斩断断连，请点击重置";
  }

  const rawErrorMessage = toErrorText(error);

  if (
    rawErrorMessage.includes("检测到死循环风险") ||
    rawErrorMessage.includes("SERVER_CIRCUIT_BREAKER_TRIGGERED")
  ) {
    return CRITICAL_BREAK_MESSAGE;
  }

  return `[ NEON RED ALERT: AI STREAM DISCONNECTED. ${rawErrorMessage} ]`;
}

async function readChatErrorMessage(response: Response): Promise<string> {
  const errorPayload = await response.text().catch(() => "");

  if (!errorPayload) {
    return "AI gateway stream failed.";
  }

  try {
    const parsedPayload: unknown = JSON.parse(errorPayload);

    if (isRecord(parsedPayload)) {
      const errorMessage = pickString(parsedPayload, ["error", "message"]);

      if (errorMessage) {
        return errorMessage;
      }
    }
  } catch {
    return errorPayload;
  }

  return errorPayload;
}

export default function Home() {
  const [activeDeckTab, setActiveDeckTab] = useState<DeckTabId>("featured");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [chatInput, setChatInput] = useState("");
  const [hotFeedStatus, setHotFeedStatus] = useState<HotFeedStatus>("idle");
  const [hotFeedError, setHotFeedError] = useState("");
  const [hotItems, setHotItems] = useState<HotItem[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [armedInjectId, setArmedInjectId] = useState<string | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isFlashActive, setIsFlashActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const isLoadingRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  const setRequestLoading = useCallback((nextLoadingState: boolean) => {
    isLoadingRef.current = nextLoadingState;
    setIsLoading(nextLoadingState);
  }, []);

  const syncHotFeed = useCallback(async (signal?: AbortSignal) => {
    if (isLoadingRef.current) {
      return;
    }

    setRequestLoading(true);
    setHotFeedStatus("loading");
    setHotFeedError("");

    try {
      const response = await fetch("/api/api/aihot?mode=selected", {
        signal,
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("AI HOT upstream returned a non-OK response.");
      }

      const payload: unknown = await response.json();
      const nextItems = extractItems(payload).map(normalizeHotItem);

      if (nextItems.length === 0) {
        throw new Error("AI HOT payload did not contain renderable items.");
      }

      setHotItems(nextItems);
      setLastSyncedAt(new Date());
      setHotFeedStatus("success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setHotFeedError(
        error instanceof Error ? error.message : "Unknown AI HOT fetch failure.",
      );
      setHotFeedStatus("error");
    } finally {
      setRequestLoading(false);
    }
  }, [setRequestLoading]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void syncHotFeed(controller.signal);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [syncHotFeed]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextMessage = chatInput.trim();
    if (!nextMessage || isLoading || isLoadingRef.current) {
      return;
    }

    setRequestLoading(true);

    const userMessage: Message = { role: "user", content: nextMessage };
    const assistantMessage: Message = { role: "assistant", content: "" };
    const requestMessages = [...messages, userMessage]
      .map(normalizeMessage)
      .filter((message) => message.role !== "system" || message.content.trim())
      .map((message) => ({
        role: message.role,
        content: toSafeText(message.content),
      }));

    setMessages((currentMessages) => [
      ...currentMessages.map(normalizeMessage),
      userMessage,
      assistantMessage,
    ]);
    setChatInput("");

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, CHAT_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: requestMessages,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(await readChatErrorMessage(response));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pendingStreamText = "";
      let hasReceivedAssistantContent = false;

      while (true) {
        try {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const chunkText = decoder.decode(value, { stream: true });
          const streamResult = extractStreamContent(
            `${pendingStreamText}${chunkText}`,
          );
          pendingStreamText = streamResult.remainder;
          appendAssistantContent(streamResult.content);
          hasReceivedAssistantContent =
            hasReceivedAssistantContent || Boolean(streamResult.content);

          if (streamResult.isDone) {
            break;
          }
        } catch (streamError) {
          console.warn("流式读取异常，已安全终止:", streamError);
          if (!hasReceivedAssistantContent) {
            replaceAssistantWithError(streamError);
          }
          break;
        }
      }

      try {
        const tail = `${pendingStreamText}${decoder.decode()}`;
        const tailContent = extractStreamContent(tail, true).content;
        appendAssistantContent(tailContent);
        hasReceivedAssistantContent =
          hasReceivedAssistantContent || Boolean(tailContent);
      } catch (streamError) {
        console.warn("流式尾包解析异常，已安全终止:", streamError);
        if (!hasReceivedAssistantContent) {
          replaceAssistantWithError(streamError);
        }
      }
    } catch (error) {
      replaceAssistantWithError(error);
    } finally {
      window.clearTimeout(timeoutId);
      setRequestLoading(false);
    }
  }

  const isHotFeedLoading = hotFeedStatus === "loading";
  const filteredHotItems = hotItems.filter((item) => {
    if (activeDeckTab === "models") {
      return /模型|产品|model|product/i.test(`${item.category} ${item.title}`);
    }

    if (activeDeckTab === "research") {
      return /论文|研究|观点|技巧|paper|research|tip/i.test(
        `${item.category} ${item.title}`,
      );
    }

    return true;
  });
  const visibleHotItems =
    filteredHotItems.length > 0 || activeDeckTab === "featured"
      ? filteredHotItems
      : hotItems;
  const signalStatus =
    hotFeedStatus === "success"
      ? "STABLE"
      : hotFeedStatus === "error"
        ? "DEGRADED"
        : "SYNCING";
  const chatStatus = isLoading ? "STREAMING" : "READY";

  function appendAssistantContent(content: unknown) {
    const safeContent = toSafeText(content);

    if (!safeContent) {
      return;
    }

    setMessages((currentMessages) => {
      const nextMessages = currentMessages.map(normalizeMessage);
      const lastMessage = nextMessages[nextMessages.length - 1];

      if (lastMessage?.role === "assistant") {
        nextMessages[nextMessages.length - 1] = {
          ...lastMessage,
          content: `${toSafeText(lastMessage.content)}${safeContent}`,
        };
      }

      return nextMessages;
    });
  }

  function replaceAssistantWithError(error: unknown) {
    const errorMessage = getChatErrorMessage(error);

    setMessages((currentMessages) => {
      const nextMessages = currentMessages.map(normalizeMessage);
      const lastMessage = nextMessages[nextMessages.length - 1];

      if (lastMessage?.role === "assistant") {
        nextMessages[nextMessages.length - 1] = {
          ...lastMessage,
          content: errorMessage,
          tone: "error",
        };
      }

      return nextMessages;
    });
  }

  function handleInjectToChat(title: string, summary: string) {
    void summary;
    setChatInput(
      `[⚡全息数据注入] 针对当前热点：“${title}”，请结合 AI HOT 数据库进行深度解析和趋势预测。`,
    );
    setIsFlashActive(true);

    window.setTimeout(() => {
      setIsFlashActive(false);
    }, 1000);

    window.setTimeout(() => {
      chatInputRef.current?.focus();
    }, 0);
  }

  return (
    <main className="relative flex h-screen w-screen flex-col overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.07)_1px,transparent_1px)] bg-[size:34px_34px]" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-[repeating-linear-gradient(180deg,rgba(34,211,238,0.16)_0_1px,transparent_1px_12px)] opacity-35" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-[repeating-linear-gradient(180deg,rgba(252,238,10,0.14)_0_1px,transparent_1px_14px)] opacity-30" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_10%,rgba(34,211,238,0.16),transparent_32%),radial-gradient(circle_at_80%_20%,rgba(217,70,239,0.12),transparent_28%),linear-gradient(180deg,rgba(0,0,0,0.12),rgba(0,0,0,0.92))]" />

      <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-cyan-500/30 bg-black/82 px-5 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid size-9 place-items-center border border-[#fcee0a]/70 bg-[#fcee0a]/10 text-[#fcee0a] shadow-[0_0_18px_rgba(252,238,10,0.22)]">
            <Sparkles className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black uppercase text-[#fcee0a] drop-shadow-[0_0_8px_#fcee0a]">
              AI AI 的 AI
            </h1>
            <p className="hidden text-xs font-bold uppercase text-cyan-400/70 sm:block">
              HOLOGRAPHIC OPS WORKBENCH
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs font-black uppercase">
          <div className="hidden border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-cyan-300 sm:block">
            LAST SYNC:{" "}
            <span className="text-[#fcee0a]">{formatSyncTime(lastSyncedAt)}</span>
          </div>
          <button
            type="button"
            onClick={() => setIsGuideOpen(true)}
            className="matrix-button border border-cyan-500/60 bg-cyan-950/25 px-3 py-2 text-cyan-300 transition hover:border-[#fcee0a] hover:bg-gradient-to-r hover:from-cyan-400 hover:to-[#fcee0a] hover:text-black hover:shadow-[0_0_28px_rgba(34,211,238,0.45)]"
          >
            [ ⚡ SYSTEM_MANUAL ]
          </button>
          <div className="flex items-center gap-2 border border-emerald-400/55 bg-emerald-950/30 px-3 py-2 text-emerald-300 shadow-[0_0_14px_rgba(16,185,129,0.16)]">
            <span className="size-2 animate-pulse bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.95)] [animation-duration:3s]" />
            [ SIGNAL: {signalStatus} ]
          </div>
          <div className="flex items-center gap-2 border border-cyan-400/55 bg-cyan-950/20 px-3 py-2 text-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.18)]">
            <ShieldCheck className="size-4" />
            [ BREAKER: ARMED ]
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-transparent" />
      </header>

      <section className="relative z-10 flex h-[calc(100vh-64px)] w-full flex-row overflow-hidden">
        <section className="flex h-full w-[45%] min-w-0 flex-col border-r border-cyan-900/70 bg-zinc-950/70">
          <div className="border-b border-zinc-800/90 bg-black/65 px-4 py-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-black uppercase text-cyan-400">
                  <Flame className="size-4 text-[#fcee0a]" />
                  {"DATA_DECK // 热点矩阵源"}
                </p>
                <h2 className="mt-1 truncate text-lg font-black uppercase text-zinc-100">
                  AI HOT SIGNAL MATRIX
                </h2>
              </div>
              <button
                type="button"
                onClick={() => void syncHotFeed()}
                disabled={isHotFeedLoading}
                className="matrix-button inline-flex h-10 shrink-0 items-center gap-2 border border-[#fcee0a]/70 bg-[#fcee0a]/10 px-3 text-xs font-black uppercase text-[#fcee0a] transition hover:bg-[#fcee0a] hover:text-black hover:shadow-[0_0_18px_rgba(252,238,10,0.55)] disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw
                  className={`size-4 ${isHotFeedLoading ? "animate-spin" : ""}`}
                />
                SYNC
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {deckTabs.map((tab) => {
                const isActive = activeDeckTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveDeckTab(tab.id)}
                    className={`h-11 border px-2 text-xs font-black uppercase transition ${
                      isActive
                        ? "border-cyan-300 bg-gradient-to-r from-cyan-500 to-blue-600 text-black shadow-[0_0_18px_rgba(34,211,238,0.35)]"
                        : "border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:border-cyan-500/70 hover:text-cyan-300"
                    }`}
                  >
                    <span className="block truncate">[ {tab.label} ]</span>
                    <span
                      className={`block text-[10px] ${
                        isActive ? "text-black/70" : "text-cyan-500/50"
                      }`}
                    >
                      {tab.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-color:#22d3ee_#09090b] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-cyan-400/45 [&::-webkit-scrollbar-track]:bg-zinc-950">
            {isHotFeedLoading && hotItems.length === 0 ? (
              <div className="data-loader cyber-card border border-cyan-500/35 bg-black/70 p-8 text-center">
                <p className="text-lg font-black uppercase text-[#fcee0a]">
                  [ DOWNLOADING DATA STREAM... ]
                </p>
                <p className="mt-4 text-sm font-bold uppercase text-cyan-300">
                  矩阵注入中...
                </p>
              </div>
            ) : null}

            {hotFeedStatus === "error" ? (
              <div className="cyber-card border border-rose-500/80 bg-rose-950/30 p-6 text-center shadow-[0_0_24px_rgba(244,63,94,0.22)]">
                <AlertTriangle className="mx-auto mb-4 size-9 text-rose-500" />
                <p className="text-base font-black uppercase text-rose-500">
                  [ ERROR: SIGNAL LOST. AIHOT LINK FAILED. ]
                </p>
                <p className="mt-3 text-sm text-rose-200/80">{hotFeedError}</p>
                <button
                  type="button"
                  onClick={() => void syncHotFeed()}
                  className="matrix-button mt-5 inline-flex h-10 items-center gap-2 border border-rose-500 px-4 text-xs font-black uppercase text-rose-400 transition hover:bg-rose-500 hover:text-black"
                >
                  <RefreshCw className="size-4" />
                  RETRY
                </button>
              </div>
            ) : null}

            {hotFeedStatus === "success" && visibleHotItems.length === 0 ? (
              <div className="cyber-card border border-cyan-500/35 bg-black/70 p-8 text-center text-sm font-black uppercase text-cyan-300">
                [ NO SIGNALS DECODED. TRY SYNC DATA. ]
              </div>
            ) : null}

            <div className="grid gap-3 xl:grid-cols-2">
              {visibleHotItems.map((item) => {
                const scoreWidth = `${item.score ?? 64}%`;
                const isInjectArmed = armedInjectId === item.id;

                return (
                  <article
                    key={item.id}
                    className="cyber-card group relative overflow-hidden border border-zinc-800 bg-zinc-950/82 p-3 transition duration-300 hover:-translate-y-0.5 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.2)]"
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent opacity-0 transition group-hover:opacity-100" />
                    <HotScreenshot url={item.url} title={item.title} />

                    <div className="mt-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 text-[11px] font-black uppercase text-cyan-300">
                        <span className="flex items-center gap-1">
                          <RadioTower className="size-3.5" />
                          {item.source}
                        </span>
                        <span className="mt-1 block truncate text-zinc-500">
                          {`${item.category} // ${item.publishedAtLabel}`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setArmedInjectId(item.id);
                          window.setTimeout(() => {
                            setArmedInjectId((currentId) =>
                              currentId === item.id ? null : currentId,
                            );
                          }, 650);
                          handleInjectToChat(item.title, item.summary);
                        }}
                        className={`grid size-9 shrink-0 place-items-center border text-cyan-300 transition hover:border-rose-400 hover:bg-rose-500 hover:text-black ${
                          isInjectArmed
                            ? "border-cyan-300 bg-rose-500 text-black shadow-[0_0_22px_rgba(34,211,238,0.65)] animate-pulse"
                            : "border-cyan-500/45 bg-black/70"
                        }`}
                        style={{
                          clipPath:
                            "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
                        }}
                        aria-label={`注入热点：${item.title}`}
                        title="注入到指令输入框"
                      >
                        <Zap className="size-4" />
                      </button>
                    </div>

                    <h3 className="mt-3 line-clamp-3 text-base font-black leading-snug text-zinc-100 transition group-hover:text-cyan-200 group-hover:drop-shadow-[0_0_10px_rgba(34,211,238,0.65)]">
                      {item.title}
                    </h3>
                    <p className="mt-2 line-clamp-4 text-sm leading-6 text-zinc-400">
                      {item.summary}
                    </p>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div className="h-1.5 flex-1 border border-cyan-500/20 bg-cyan-500/10">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-400 to-[#fcee0a] shadow-[0_0_12px_rgba(34,211,238,0.7)]"
                          style={{ width: scoreWidth }}
                        />
                      </div>
                      <span className="shrink-0 text-xs font-black text-[#fcee0a]">
                        {item.scoreLabel}
                      </span>
                    </div>

                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-xs font-black uppercase text-cyan-400 transition hover:text-[#fcee0a]"
                      >
                        SOURCE
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <aside
          className={`flex h-full w-[55%] min-w-0 flex-col border-l bg-black/58 transition-all duration-500 ${
            isFlashActive
              ? "border-emerald-500 shadow-[0_0_24px_rgba(16,185,129,0.5)]"
              : "border-zinc-800"
          }`}
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-cyan-900/70 bg-zinc-950/72 px-5">
            <div className="flex items-center gap-3">
              <span className="border border-cyan-500/45 bg-cyan-500/10 px-3 py-1 text-xs font-black uppercase text-cyan-300">
                {"// TERMINAL_LOG_CORE"}
              </span>
              <span className="hidden text-xs font-black uppercase text-zinc-500 md:inline">
                CHAT_STATUS:{" "}
                <span className={isLoading ? "text-[#fcee0a]" : "text-cyan-300"}>
                  {chatStatus}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-black uppercase text-[#fcee0a]">
              <Terminal className="size-4" />
              COMMAND CORE
            </div>
          </div>

          <div
            ref={chatScrollRef}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 [scrollbar-color:#22d3ee_#09090b] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-cyan-400/35 [&::-webkit-scrollbar-track]:bg-zinc-950"
          >
            {messages.map((message, index) => {
              const safeMessage = normalizeMessage(message);
              const safeContent = toSafeText(safeMessage.content);

              if (safeMessage.role === "assistant" && !safeContent) {
                return null;
              }

              return (
                <div
                  key={`${safeMessage.role}-${index}`}
                  className={`animate-[hud-message-in_0.22s_ease-out] ${
                    safeMessage.role === "user"
                      ? "flex justify-end"
                      : "flex justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[86%] border px-4 py-3 text-sm leading-6 shadow-lg ${
                      safeMessage.tone === "error"
                        ? "border-rose-500 bg-rose-950/35 font-black uppercase text-rose-500 shadow-[0_0_24px_rgba(244,63,94,0.2)]"
                        : safeMessage.role === "user"
                          ? "border-cyan-400/55 bg-cyan-950/25 text-cyan-100"
                          : safeMessage.role === "assistant"
                            ? "border-zinc-700 bg-zinc-900/80 text-zinc-100"
                            : "border-[#fcee0a]/45 bg-[#fcee0a]/10 text-[#fcee0a]"
                    }`}
                  >
                    <span className="mb-2 block text-[11px] font-black uppercase text-cyan-400/75">
                      {safeMessage.role === "user"
                        ? "PLAYER_INPUT"
                        : safeMessage.role === "assistant"
                          ? "AI_CORE_OUTPUT"
                          : "SYSTEM_BOOT"}
                    </span>
                    {safeMessage.role === "assistant" ||
                    safeMessage.role === "system" ? (
                      <MarkdownMessage content={safeContent} />
                    ) : (
                      <span>{safeContent}</span>
                    )}
                  </div>
                </div>
              );
            })}

            {isLoading ? (
              <div className="flex justify-start">
                <div className="border border-cyan-500/45 bg-zinc-950/90 px-4 py-3 shadow-[0_0_22px_rgba(34,211,238,0.2)]">
                  <div className="flex items-center gap-3">
                    <span className="relative grid size-4 place-items-center">
                      <span className="absolute size-3 animate-ping bg-cyan-400 opacity-70" />
                      <span className="relative size-2 bg-[#fcee0a]" />
                    </span>
                    <span className="text-xs font-black uppercase text-cyan-300">
                      [SYS_STATUS]: PARSING_AI_HOT_DATABASE_MATRIX...
                    </span>
                    <span className="grid size-7 place-items-center rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 p-px animate-spin">
                      <span className="size-5 rounded-full bg-black" />
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <form
            onSubmit={handleSubmit}
            className="shrink-0 border-t border-cyan-900/80 bg-zinc-950/85 p-4"
          >
            <div
              className={`flex items-center gap-3 border border-cyan-500/35 bg-black/80 px-3 py-2 transition focus-within:border-cyan-300 focus-within:bg-cyan-950/20 focus-within:shadow-[0_0_26px_rgba(34,211,238,0.2)] ${
                isFlashActive
                  ? "border-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.5)]"
                  : ""
              }`}
            >
              <span className="animate-pulse text-2xl font-black text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.85)]">
                &gt;
              </span>
              <input
                ref={chatInputRef}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                disabled={isLoading}
                className="min-w-0 flex-1 border border-[#fcee0a]/30 bg-transparent p-3 font-mono text-sm font-bold text-[#00ffcc] outline-none placeholder-stone-500 focus:border-[#fcee0a] focus:outline-none disabled:cursor-wait"
                placeholder="输入指令，审问 AI 矩阵..."
              />
              <button
                type="submit"
                disabled={isLoading}
                className="grid size-11 shrink-0 place-items-center border border-[#fcee0a]/70 bg-[#fcee0a] text-black transition hover:bg-black hover:text-[#fcee0a] hover:shadow-[0_0_24px_rgba(252,238,10,0.85)] disabled:cursor-wait disabled:opacity-60"
                aria-label="发送消息"
              >
                <Send className={`size-5 ${isLoading ? "animate-pulse" : ""}`} />
              </button>
            </div>
          </form>
        </aside>
      </section>

      {isGuideOpen ? (
        <div
          className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setIsGuideOpen(false)}
        >
          <div
            className="relative bg-[#0b0c10] border-2 border-[#fcee0a] p-8 max-w-xl w-full rounded-none shadow-[0_0_30px_rgba(252,238,10,0.4)] flex flex-col gap-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="font-mono text-stone-200">
              {/* 头部标题区 */}
              <div className="border-b border-[#fcee0a] pb-3 mb-4 flex justify-between items-center">
                <h2 className="text-xl font-bold text-[#fcee0a] tracking-widest animate-pulse">
                  [ MATRIX OPERATIONAL MANUAL / 矩阵控制台操作指南 ]
                </h2>
              </div>

              {/* 第一部分：格局介绍 */}
              <div className="mb-6">
                <h3 className="text-[#00ffcc] font-semibold mb-2">一、全息控制舱格局 (SYSTEM LAYOUT)</h3>
                <ul className="space-y-2 text-sm pl-4 list-disc marker:text-[#00ffcc]">
                  <li><strong className="text-white">左侧控制翼 (Left Deck)：</strong>AI HOT 实时动态流。集成了全量数据与精选信息源，鼠标悬停时触发高光矩阵位移。</li>
                  <li><strong className="text-white">中央主视窗 (Center Feed)：</strong>核心聚焦透视区。呈现当前筛选的最前沿 AI 技术情报与深度日报。</li>
                  <li><strong className="text-white">右侧交互舱 (Right Command)：</strong>Chatbot 智能问答中枢。支持自然语言检索，内置自动化工具调用分流与 90 秒强制熔断保护机制。</li>
                </ul>
              </div>

              {/* 第二部分：操作指引 */}
              <div className="mb-6">
                <h3 className="text-[#00ffcc] font-semibold mb-2">二、核心操作指令 (OPERATIONAL GUIDE)</h3>
                <ol className="space-y-2 text-sm pl-4 list-decimal marker:text-[#00ffcc]">
                  <li><span className="text-white">情报锁定：</span>点击左侧任意一张新闻卡片，中央主视窗将深度锚定该数据源并展开上下文。</li>
                  <li><span className="text-white">赛博提问：</span>在右侧问答舱内直接输入如“最近 OpenAI 有什么发布”或“看下昨天的日报”，AI 将自动调用专属 API 进行端点级高精检索。</li>
                  <li><span className="text-white">安全熔断：</span>若遭遇大模型长循环调用（Agent Loop）或服务器断联，前端会在第 90 秒强制斩断请求并弹出熔断警告，你可随时点击问答舱的“重置矩阵”按钮恢复初始态。</li>
                </ol>
              </div>

              {/* 底部关闭区 */}
              <div className="mt-6 flex justify-end">
                <button 
                  onClick={() => setIsGuideOpen(false)}
                  className="border border-[#fcee0a] text-[#fcee0a] px-6 py-2 hover:bg-[#fcee0a] hover:text-black transition-all duration-300 font-bold tracking-widest text-sm"
                >
                  &gt;&gt; 关闭操作指南 CLOSE_MANUAL
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="scanline pointer-events-none absolute inset-0 z-30" />
      <style jsx global>{`
        @keyframes hud-fade-in {
          from {
            opacity: 0;
            transform: scale(0.985);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes hud-message-in {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </main>
  );
}
