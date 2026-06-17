"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
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

const CHAT_REQUEST_TIMEOUT_MS = 15_000;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function extractStreamContent(rawChunk: string): string {
  let content = "";

  for (const line of rawChunk.split("\n")) {
    const trimmedLine = line.trim();

    if (!trimmedLine.startsWith("data:")) {
      continue;
    }

    const data = trimmedLine.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }

    try {
      const payload = JSON.parse(data) as {
        choices?: Array<{
          delta?: {
            content?: string;
          };
          message?: {
            content?: string;
          };
          text?: string;
        }>;
      };

      for (const choice of payload.choices ?? []) {
        content +=
          choice.delta?.content ?? choice.message?.content ?? choice.text ?? "";
      }
    } catch {
      content += data;
    }
  }

  return content;
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

function getChatErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "[ NEON RED ALERT: AI CORE RESPONSE TIMEOUT. 15S HARD BREAKER TRIPPED. MATRIX CHANNEL RELEASED. ]";
  }

  return `[ NEON RED ALERT: AI STREAM DISCONNECTED. ${
    error instanceof Error ? error.message : "UNKNOWN FAILURE"
  } ]`;
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
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [hotFeedStatus, setHotFeedStatus] = useState<HotFeedStatus>("idle");
  const [hotFeedError, setHotFeedError] = useState("");
  const [hotItems, setHotItems] = useState<HotItem[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const syncHotFeed = useCallback(async (signal?: AbortSignal) => {
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
    }
  }, []);

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

    const nextMessage = input.trim();
    if (!nextMessage || isLoading) {
      return;
    }

    const userMessage: Message = { role: "user", content: nextMessage };
    const assistantMessage: Message = { role: "assistant", content: "" };
    const requestMessages = [...messages, userMessage]
      .filter((message) => message.role !== "system" || message.content.trim())
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    setMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
      assistantMessage,
    ]);
    setInput("");
    setIsLoading(true);

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

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const nextContent = extractStreamContent(chunk);

        if (!nextContent) {
          continue;
        }

        setMessages((currentMessages) => {
          const nextMessages = [...currentMessages];
          const lastMessage = nextMessages[nextMessages.length - 1];

          if (lastMessage?.role === "assistant") {
            nextMessages[nextMessages.length - 1] = {
              ...lastMessage,
              content: lastMessage.content + nextContent,
            };
          }

          return nextMessages;
        });
      }

      const tail = decoder.decode();
      const tailContent = extractStreamContent(tail);

      if (tailContent) {
        setMessages((currentMessages) => {
          const nextMessages = [...currentMessages];
          const lastMessage = nextMessages[nextMessages.length - 1];

          if (lastMessage?.role === "assistant") {
            nextMessages[nextMessages.length - 1] = {
              ...lastMessage,
              content: lastMessage.content + tailContent,
            };
          }

          return nextMessages;
        });
      }
    } catch (error) {
      const errorMessage = getChatErrorMessage(error);

      setMessages((currentMessages) => {
        const nextMessages = [...currentMessages];
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
    } finally {
      window.clearTimeout(timeoutId);
      setIsLoading(false);
    }
  }

  const isHotFeedLoading = hotFeedStatus === "loading";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080808] text-[#00f0ff]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(0,240,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(0,240,255,0.08)_1px,transparent_1px)] bg-[size:40px_40px]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,240,255,0.16),transparent_42%),linear-gradient(180deg,transparent,rgba(8,8,8,0.86))]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[#fcee0a] shadow-[0_0_24px_#fcee0a]" />

      <section
        className={`gate-panel absolute inset-0 z-20 flex flex-col items-center justify-center px-5 text-center transition duration-700 ${
          isDashboardOpen
            ? "pointer-events-none scale-105 opacity-0"
            : "scale-100 opacity-100"
        }`}
        aria-hidden={isDashboardOpen}
      >
        <p className="flicker-badge mb-9 border border-[#00f0ff]/70 px-6 py-3 text-lg font-black uppercase text-[#00f0ff] shadow-[0_0_26px_rgba(0,240,255,0.48)] sm:text-2xl">
          CYBERSPACE SIGNAL LOCKED
        </p>
        <h1 className="glitch-title text-[clamp(5.2rem,16vw,15rem)] font-black uppercase leading-[0.82] text-[#fcee0a] drop-shadow-[0_0_34px_rgba(252,238,10,0.95)]">
          <span aria-hidden="true">AI AI 的 AI</span>
          <span className="sr-only">AI AI 的 AI</span>
        </h1>
        <p className="mt-11 max-w-6xl animate-pulse text-xl font-black uppercase text-[#00f0ff] drop-shadow-[0_0_18px_rgba(0,240,255,0.9)] sm:text-3xl lg:text-4xl">
          MATRIX INITIALIZATION SUCCESSFUL. AWAITING SKILL INJECTION...
        </p>
        <button
          type="button"
          onClick={() => setIsDashboardOpen(true)}
          className="matrix-button group mt-14 inline-flex min-h-16 items-center gap-4 border-2 border-[#fcee0a] bg-[#080808] px-7 py-4 text-base font-black uppercase text-[#fcee0a] shadow-[0_0_24px_rgba(252,238,10,0.38)] transition duration-300 hover:bg-[#fcee0a] hover:text-[#080808] hover:shadow-[0_0_42px_rgba(252,238,10,0.9)] sm:px-10 sm:text-2xl"
        >
          [ ENTER MATRIX / 初始化系统 ]
          <ArrowRight className="size-6 transition group-hover:translate-x-1" />
        </button>
      </section>

      <section
        className={`relative z-10 min-h-screen px-4 py-5 transition duration-700 sm:px-6 lg:px-8 ${
          isDashboardOpen
            ? "translate-y-0 opacity-100"
            : "translate-y-8 opacity-0"
        }`}
        aria-hidden={!isDashboardOpen}
      >
        <header className="mb-5 flex flex-col gap-4 border-b border-[#00f0ff]/35 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold uppercase text-[#fcee0a]">
              <ShieldCheck className="size-4" />
              ACCESS GRANTED / MATRIX CORE ONLINE
            </p>
            <h2 className="mt-2 text-4xl font-black uppercase text-[#fcee0a] drop-shadow-[0_0_20px_rgba(252,238,10,0.65)] sm:text-6xl">
              黑客控制台
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs font-bold uppercase text-[#00f0ff] sm:text-sm">
            <div className="border border-[#00f0ff]/40 px-3 py-2">
              HOT FEED
              <span className="block text-[#fcee0a]">
                {hotFeedStatus === "success" ? "LIVE" : "SYNCING"}
              </span>
            </div>
            <div className="border border-[#00f0ff]/40 px-3 py-2">
              LAST SYNC
              <span className="block text-[#fcee0a]">
                {formatSyncTime(lastSyncedAt)}
              </span>
            </div>
            <div className="border border-[#00f0ff]/40 px-3 py-2">
              VECTOR DB
              <span className="block text-[#fcee0a]">PHASE 3</span>
            </div>
          </div>
        </header>

        <div className="grid min-h-[calc(100vh-170px)] gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="border border-[#00f0ff]/45 bg-[#080808]/88 shadow-[0_0_28px_rgba(0,240,255,0.12)]">
            <div className="flex flex-col gap-4 border-b border-[#00f0ff]/35 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
              <h3 className="flex items-center gap-3 text-2xl font-black uppercase text-[#fcee0a]">
                <Flame className="size-7" />
                AI 前沿热点大厅
              </h3>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <span className="flex items-center gap-2 text-xs font-bold uppercase text-[#00f0ff]">
                  <RadioTower className="size-4 animate-pulse" />
                  AIHOT DATA STREAM ONLINE
                </span>
                <button
                  type="button"
                  onClick={() => void syncHotFeed()}
                  disabled={isHotFeedLoading}
                  className="matrix-button inline-flex items-center justify-center gap-2 border border-[#fcee0a] px-4 py-2 text-xs font-black uppercase text-[#fcee0a] transition hover:bg-[#fcee0a] hover:text-[#080808] disabled:cursor-wait disabled:opacity-60"
                >
                  <RefreshCw
                    className={`size-4 ${isHotFeedLoading ? "animate-spin" : ""}`}
                  />
                  [ SYNC DATA / 刷新数据流 ]
                </button>
              </div>
            </div>

            <div className="grid gap-4 p-5 xl:grid-cols-2">
              {isHotFeedLoading && hotItems.length === 0 ? (
                <div className="data-loader cyber-card xl:col-span-2 border border-[#00f0ff]/45 bg-black/60 p-8 text-center">
                  <p className="text-2xl font-black uppercase text-[#fcee0a]">
                    [ DOWNLOADING DATA STREAM... ]
                  </p>
                  <p className="mt-4 text-base font-bold uppercase text-[#00f0ff]">
                    [ DECRYPTING MATRIX DATABASE... 0%... 45%... 100% ]
                  </p>
                </div>
              ) : null}

              {hotFeedStatus === "error" ? (
                <div className="cyber-card xl:col-span-2 border border-[#ff003c] bg-[#160006]/80 p-8 text-center shadow-[0_0_26px_rgba(255,0,60,0.22)]">
                  <AlertTriangle className="mx-auto mb-4 size-10 text-[#ff003c]" />
                  <p className="text-xl font-black uppercase text-[#ff003c] drop-shadow-[0_0_16px_rgba(255,0,60,0.8)]">
                    [ ERROR: SIGNAL LOST. CONNECTION TO AI-HOT SERVER FAILED. ]
                  </p>
                  <p className="mt-3 text-sm text-[#ff9cb1]">{hotFeedError}</p>
                  <button
                    type="button"
                    onClick={() => void syncHotFeed()}
                    className="matrix-button mt-6 inline-flex items-center gap-2 border border-[#ff003c] px-5 py-3 text-sm font-black uppercase text-[#ff003c] transition hover:bg-[#ff003c] hover:text-[#080808]"
                  >
                    <RefreshCw className="size-4" />
                    [ RETRY / 重新连接 ]
                  </button>
                </div>
              ) : null}

              {hotFeedStatus === "success" && hotItems.length === 0 ? (
                <div className="cyber-card xl:col-span-2 border border-[#00f0ff]/45 bg-black/60 p-8 text-center text-xl font-black uppercase text-[#00f0ff]">
                  [ NO SIGNALS DECODED. TRY SYNC DATA. ]
                </div>
              ) : null}

              {hotItems.map((item) => {
                const CardTag = item.url ? "a" : "article";
                const scoreWidth = `${item.score ?? 64}%`;

                return (
                  <CardTag
                    key={item.id}
                    href={item.url}
                    target={item.url ? "_blank" : undefined}
                    rel={item.url ? "noreferrer" : undefined}
                    className="cyber-card group block border border-[#00f0ff]/35 bg-black/45 p-5 transition duration-300 hover:border-[#fcee0a] hover:shadow-[0_0_26px_rgba(252,238,10,0.22)]"
                  >
                    <div className="mb-5 flex items-start justify-between gap-4">
                      <div className="flex flex-col gap-2 text-xs font-black uppercase text-[#00f0ff]">
                        <span className="flex items-center gap-2">
                          <Sparkles className="size-4" />
                          {item.source}
                        </span>
                        <span className="text-[#9ffbff]">{item.category}</span>
                      </div>
                      <div className="flex min-w-20 items-center justify-center gap-1 border border-[#fcee0a] px-2 py-1 text-sm font-black text-[#fcee0a]">
                        {item.score === null ? (
                          <RadioTower className="size-4" />
                        ) : (
                          <Zap className="size-4" />
                        )}
                        {item.scoreLabel}
                      </div>
                    </div>
                    <h4 className="text-2xl font-black leading-tight text-[#fcee0a] transition group-hover:drop-shadow-[0_0_12px_rgba(252,238,10,0.9)]">
                      {item.title}
                    </h4>
                    <p className="mt-4 text-base leading-7 text-[#9ffbff]">
                      {item.summary}
                    </p>
                    <div className="mt-6 flex items-center justify-between gap-4 text-xs font-black uppercase text-[#00f0ff]">
                      <span>{item.publishedAtLabel}</span>
                      {item.url ? (
                        <span className="flex items-center gap-1 text-[#fcee0a]">
                          SOURCE
                          <ExternalLink className="size-3.5" />
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-4 h-2 border border-[#00f0ff]/30 bg-[#00f0ff]/10">
                      <div
                        className="h-full bg-[#fcee0a] shadow-[0_0_14px_rgba(252,238,10,0.85)]"
                        style={{ width: scoreWidth }}
                      />
                    </div>
                  </CardTag>
                );
              })}
            </div>
          </section>

          <aside className="flex min-h-[640px] flex-col border border-[#fcee0a]/70 bg-black/78 shadow-[0_0_30px_rgba(252,238,10,0.16)]">
            <div className="flex items-center justify-between border-b border-[#fcee0a]/40 px-5 py-4">
              <h3 className="flex items-center gap-3 text-xl font-black uppercase text-[#fcee0a]">
                <Terminal className="size-6" />
                AI 问答舱
              </h3>
              <span className="border border-[#00f0ff]/45 px-3 py-1 text-xs font-black uppercase text-[#00f0ff]">
                {isLoading ? "STREAMING" : "TERMINAL v1.0"}
              </span>
            </div>

            <div
              ref={chatScrollRef}
              className="flex-1 space-y-4 overflow-y-auto p-5"
            >
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}-${message.content}`}
                  className={`border px-4 py-3 text-sm leading-6 ${
                    message.tone === "error"
                      ? "mr-8 border-[#ff003c] bg-[#160006] font-black uppercase text-[#ff003c] shadow-[0_0_24px_rgba(255,0,60,0.28)] drop-shadow-[0_0_12px_rgba(255,0,60,0.78)]"
                      : message.role === "user"
                        ? "ml-8 border-[#fcee0a]/70 bg-[#fcee0a] text-[#080808]"
                        : message.role === "assistant"
                          ? "mr-8 border-[#fcee0a]/55 bg-[#1d1a00] text-[#fff7a6]"
                          : "mr-8 border-[#00f0ff]/45 bg-[#00191c] text-[#b7feff]"
                  }`}
                >
                  <span className="mb-1 block text-xs font-black uppercase">
                    {message.role === "user"
                      ? "YOU"
                      : message.role === "assistant"
                        ? "AI CORE"
                        : "SYSTEM"}
                  </span>
                  {message.role === "assistant" && !message.content ? (
                    <span className="terminal-thinking">
                      [ TERMINAL THINKING... ]
                    </span>
                  ) : message.role === "assistant" ||
                    message.role === "system" ? (
                    <MarkdownMessage content={message.content} />
                  ) : (
                    message.content
                  )}
                </div>
              ))}
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex gap-3 border-t border-[#fcee0a]/40 p-4"
            >
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={isLoading}
                className="min-w-0 flex-1 border border-[#00f0ff]/45 bg-[#080808] px-4 py-3 text-sm font-bold text-[#00f0ff] outline-none transition placeholder:text-[#00f0ff]/45 focus:border-[#fcee0a] focus:shadow-[0_0_18px_rgba(252,238,10,0.28)]"
                placeholder="输入指令，审问 AI 矩阵..."
              />
              <button
                type="submit"
                disabled={isLoading}
                className="grid size-12 place-items-center border border-[#fcee0a] bg-[#fcee0a] text-[#080808] transition hover:bg-[#080808] hover:text-[#fcee0a] hover:shadow-[0_0_22px_rgba(252,238,10,0.65)] disabled:cursor-wait disabled:opacity-60"
                aria-label="发送消息"
              >
                <Send
                  className={`size-5 ${isLoading ? "animate-pulse" : ""}`}
                />
              </button>
            </form>
          </aside>
        </div>
      </section>

      <div className="scanline pointer-events-none absolute inset-0 z-30" />
    </main>
  );
}
