"use client";

import { FormEvent, useState } from "react";
import {
  ArrowRight,
  Flame,
  RadioTower,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";

type HotItem = {
  title: string;
  heat: number;
  summary: string;
  source: string;
};

type Message = {
  role: "system" | "user";
  content: string;
};

const hotItems: HotItem[] = [
  {
    title: "多模态 Agent 竞速升温，实时视觉推理进入产品战场",
    heat: 98,
    summary:
      "头部实验室开始把实时视觉、工具调用与长上下文压进同一条工作流，开发者侧的自动化边界继续外扩。",
    source: "AI HOT / Model Pulse",
  },
  {
    title: "开源小模型继续逼近端侧部署临界点",
    heat: 91,
    summary:
      "轻量推理、低显存微调与本地隐私场景正在形成新的独立开发者机会窗口。",
    source: "Edge Intelligence Wire",
  },
  {
    title: "RAG 工作流从检索问答转向行动编排",
    heat: 87,
    summary:
      "新一代知识系统不再只回答问题，而是把搜索、筛选、规划和执行串成可观测任务链。",
    source: "Vector Matrix",
  },
  {
    title: "AI 编程工具进入多人协作与仓库级理解阶段",
    heat: 84,
    summary:
      "代码助手正在从补全器演化为工程代理，能读取上下文、生成补丁并参与验证门。",
    source: "Builder Terminal",
  },
];

const initialMessages: Message[] = [
  {
    role: "system",
    content:
      "TERMINAL ONLINE. AI 问答舱已挂载 Mock 推理核心，等待你的第一条指令。",
  },
];

export default function Home() {
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextMessage = input.trim();
    if (!nextMessage) {
      return;
    }

    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content: nextMessage },
      {
        role: "system",
        content:
          "Mock Core: 已捕获你的指令。真实 AI HOT 数据流与外脑模型 API 将在后续阶段接入。",
      },
    ]);
    setInput("");
  }

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
              <span className="block text-[#fcee0a]">MOCK</span>
            </div>
            <div className="border border-[#00f0ff]/40 px-3 py-2">
              RAG CORE
              <span className="block text-[#fcee0a]">STANDBY</span>
            </div>
            <div className="border border-[#00f0ff]/40 px-3 py-2">
              VECTOR DB
              <span className="block text-[#fcee0a]">PHASE 3</span>
            </div>
          </div>
        </header>

        <div className="grid min-h-[calc(100vh-170px)] gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="border border-[#00f0ff]/45 bg-[#080808]/88 shadow-[0_0_28px_rgba(0,240,255,0.12)]">
            <div className="flex items-center justify-between border-b border-[#00f0ff]/35 px-5 py-4">
              <h3 className="flex items-center gap-3 text-2xl font-black uppercase text-[#fcee0a]">
                <Flame className="size-7" />
                AI 前沿热点大厅
              </h3>
              <span className="flex items-center gap-2 text-xs font-bold uppercase text-[#00f0ff]">
                <RadioTower className="size-4 animate-pulse" />
                AIHOT CONTAINER READY
              </span>
            </div>
            <div className="grid gap-4 p-5 xl:grid-cols-2">
              {hotItems.map((item) => (
                <article
                  key={item.title}
                  className="cyber-card group border border-[#00f0ff]/35 bg-black/45 p-5 transition duration-300 hover:border-[#fcee0a] hover:shadow-[0_0_26px_rgba(252,238,10,0.22)]"
                >
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2 text-xs font-black uppercase text-[#00f0ff]">
                      <Sparkles className="size-4" />
                      {item.source}
                    </div>
                    <div className="flex min-w-20 items-center justify-center gap-1 border border-[#fcee0a] px-2 py-1 text-sm font-black text-[#fcee0a]">
                      <Zap className="size-4" />
                      {item.heat}
                    </div>
                  </div>
                  <h4 className="text-2xl font-black leading-tight text-[#fcee0a] transition group-hover:text-[#080808] group-hover:[text-shadow:0_0_12px_#fcee0a]">
                    {item.title}
                  </h4>
                  <p className="mt-4 text-base leading-7 text-[#9ffbff]">
                    {item.summary}
                  </p>
                  <div className="mt-6 h-2 border border-[#00f0ff]/30 bg-[#00f0ff]/10">
                    <div
                      className="h-full bg-[#fcee0a] shadow-[0_0_14px_rgba(252,238,10,0.85)]"
                      style={{ width: `${item.heat}%` }}
                    />
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="flex min-h-[640px] flex-col border border-[#fcee0a]/70 bg-black/78 shadow-[0_0_30px_rgba(252,238,10,0.16)]">
            <div className="flex items-center justify-between border-b border-[#fcee0a]/40 px-5 py-4">
              <h3 className="flex items-center gap-3 text-xl font-black uppercase text-[#fcee0a]">
                <Terminal className="size-6" />
                AI 问答舱
              </h3>
              <span className="border border-[#00f0ff]/45 px-3 py-1 text-xs font-black uppercase text-[#00f0ff]">
                TERMINAL v1.0
              </span>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}-${message.content}`}
                  className={`border px-4 py-3 text-sm leading-6 ${
                    message.role === "user"
                      ? "ml-8 border-[#fcee0a]/70 bg-[#fcee0a] text-[#080808]"
                      : "mr-8 border-[#00f0ff]/45 bg-[#00191c] text-[#b7feff]"
                  }`}
                >
                  <span className="mb-1 block text-xs font-black uppercase">
                    {message.role === "user" ? "YOU" : "SYSTEM"}
                  </span>
                  {message.content}
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
                className="min-w-0 flex-1 border border-[#00f0ff]/45 bg-[#080808] px-4 py-3 text-sm font-bold text-[#00f0ff] outline-none transition placeholder:text-[#00f0ff]/45 focus:border-[#fcee0a] focus:shadow-[0_0_18px_rgba(252,238,10,0.28)]"
                placeholder="输入指令，审问 AI 矩阵..."
              />
              <button
                type="submit"
                className="grid size-12 place-items-center border border-[#fcee0a] bg-[#fcee0a] text-[#080808] transition hover:bg-[#080808] hover:text-[#fcee0a] hover:shadow-[0_0_22px_rgba(252,238,10,0.65)]"
                aria-label="发送消息"
              >
                <Send className="size-5" />
              </button>
            </form>
          </aside>
        </div>
      </section>

      <div className="scanline pointer-events-none absolute inset-0 z-30" />
    </main>
  );
}
