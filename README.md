# AI AI 的 AI

赛博朋克风格的 AI 资讯工作台。项目把 AI HOT 的实时资讯流、网页截图预览、自然语言问答和大模型工具调用整合在一个 Next.js 应用里，目标是让用户用聊天方式检索、追问和判断 AI 行业动态。

当前版本已经不是 mock UI：左侧工作台会拉取 AI HOT 资讯，右侧问答舱会通过后端 API 调用大模型，并在回答前自动查询 AI HOT 数据库，把命中的信源链接返回给用户。

## 技术栈

- Next.js 16 App Router：页面、API Route、服务端代理和生产构建。
- React 19：入口页、工作台、聊天流、热点卡片等交互组件。
- TypeScript：前后端共用严格类型检查。
- Tailwind CSS 4：赛博朋克 UI、响应式布局、动效和视觉主题。
- Lucide React：工作台图标系统。
- React Markdown：渲染 AI 回复中的 Markdown 列表和信源链接。
- AI HOT Public API：实时/精选 AI 资讯数据源。
- Microlink Screenshot API：热点卡片网页实时截图。
- OpenAI-compatible Chat Completions API：通过 `AI_BASE_URL` 接入 OneAPI 或其他兼容网关。

## 核心体验

1. 入口页

   首屏只显示黑色背景、扫描线、`public/picture.png` 和 `[ ACCESS SYSTEM ]` 按钮。点击后进入工作台，工作台以 700ms 淡入。

2. AI HOT 工作台

   左侧会请求 `/api/api/aihot?mode=selected`，展示精选 AI 资讯。每张卡片会用 Microlink 根据原文 URL 生成截图：

   ```txt
   https://api.microlink.io/?url=<encoded-url>&screenshot=true&embed=screenshot.url
   ```

   截图加载前显示“矩阵注入中...”骨架屏。

3. 聊天问答舱

   用户在右侧输入自然语言问题后，前端请求 `/api/chat`。后端会先抽取关键词或让模型规划工具调用，再查询 AI HOT，最后把工具结果交给大模型生成流式 Markdown 答案。

4. 赛博交互

   顶部标题、热点 tab、按钮、边框和状态灯都使用霓虹、glitch、扫描线和硬边切角视觉。`精选热点 / 模型产品 / 研究观点` 切换时有明显的赛博闪烁动效。

## Agent 联动设计

这里的“Agent”不是多个外部服务，而是代码里拆出来的几个协作角色。它们共同完成一次 AI 问答：

- UI Agent：`src/app/page.tsx`
  - 维护入口页、工作台、聊天消息、热点列表和加载状态。
  - 解析 OpenAI-compatible SSE 流，把增量 token 追加到最后一条 assistant 消息。
  - 如果流中途异常但已经收到正文，会保留已有答案，避免把正常回答覆盖成红色错误。

- Feed Agent：`src/app/api/aihot/route.ts`
  - 作为 AI HOT 的服务端代理。
  - 支持 `mode=selected`、`mode=all` 和 `q=关键词`。
  - 使用 15 秒超时、300 秒 revalidate 和统一 User-Agent。

- Tool Planner Agent：`src/app/api/chat/route.ts`
  - 根据用户最后一条消息抽取具体关键词，如 OpenAI、Sora、Claude、RAG。
  - 如果本地规则无法抽取，会调用大模型的 tool planning 能力，让模型生成 `query_ai_hot_news` 工具参数。

- AI HOT Tool Agent：`query_ai_hot_news`
  - 按关键词精准查询 AI HOT。
  - 最多执行 3 次工具调用，防止 Agent loop。
  - 返回标题、摘要、来源、URL、发布时间和分类。

- Answer Agent：`/api/chat` 的最终流式调用
  - 把系统提示词、用户上下文、工具调用记录和工具结果组合成最终消息。
  - 要求模型只基于 AI HOT 工具结果回答，不能编造热点。
  - 每条引用资讯必须带 `[🔗 查看信源](url)`。

## AI 调用链路

完整链路如下：

```txt
用户输入
  -> 前端 /api/chat
  -> 系统提示词约束回答格式
  -> 关键词抽取或模型工具规划
  -> query_ai_hot_news 查询 AI HOT
  -> 注入 tool messages
  -> 大模型生成最终答案
  -> SSE 流式返回前端
  -> ReactMarkdown 渲染答案和信源链接
```

关键保护机制：

- 工具查询超时：15 秒。
- 最终回答流超时：90 秒。
- 最大工具调用次数：3 次。
- 无命中时直接返回“历史上未找到相关热点。”。
- 工具结果有错误时提示稍后重试。
- 前端读流异常时，如果已经收到正文，保留已生成内容。

## 目录结构

```txt
src/app/page.tsx
  主页面。包含 EntryPage、Dashboard、热点卡片、聊天流读取、Markdown 渲染。

src/app/api/aihot/route.ts
  AI HOT 服务端代理接口。

src/app/api/api/aihot/route.ts
  兼容路径，复用 /api/aihot 的 GET 逻辑。

src/app/api/chat/route.ts
  大模型聊天接口、AI HOT 工具调用、流式响应和熔断保护。

src/app/globals.css
  全局主题、字体、赛博按钮、卡片、扫描线和 glitch 动画。

public/picture.png
  入口页主视觉图片。
```

## 环境变量

本地需要创建 `.env.local`，不要提交真实密钥。

```bash
AI_API_KEY="你的模型网关 Key"
AI_BASE_URL="OpenAI-compatible API base URL，例如 https://example.com/v1"
AI_MODEL="模型名称"
```

要求：

- `AI_BASE_URL` 必须兼容 `/chat/completions`。
- 模型需要支持普通 chat completion。
- 如果希望启用模型侧工具规划，网关应支持 `tools` 和 `tool_choice`。

AI HOT 接口匿名免费，不需要配置 token。

## 本地开发

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

默认访问：

```txt
http://localhost:3000
```

完整验证：

```bash
npm run lint && npm run build
```

说明：当前环境中 Turbopack build 在受限沙箱内可能因为本地端口绑定权限失败；在正常 WSL 或部署环境中执行 `npm run build` 即可。

## API 说明

### GET `/api/aihot`

查询 AI HOT 数据。

示例：

```txt
/api/aihot?mode=selected
/api/aihot?mode=all
/api/aihot?q=OpenAI
```

### GET `/api/api/aihot`

兼容路径，等价于 `/api/aihot`。

### POST `/api/chat`

请求体：

```json
{
  "messages": [
    {
      "role": "user",
      "content": "最近 OpenAI 有什么动态？"
    }
  ]
}
```

返回：

- 成功时为 `text/event-stream`，兼容 OpenAI Chat Completions 的 SSE 格式。
- 失败时返回 JSON 错误。

## 部署前检查

1. 确认 `.env.local` 中的 Key 没有被提交。
2. 确认生产环境配置了 `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`。
3. 执行 `npm run lint`。
4. 执行 `npm run build`。
5. 打开入口页，确认 `public/picture.png` 正常显示。
6. 点击 `[ ACCESS SYSTEM ]`，确认工作台加载 AI HOT 数据。
7. 在问答舱提问，确认回答包含 AI HOT 信源链接。

## 后续可以继续做的事

- 增加聊天重置按钮，清空消息并重置熔断状态。
- 为 AI HOT 查询增加更细的分类筛选。
- 把当前工具调用日志显示在 UI 中，让用户看到 AI 如何检索。
- 增加 E2E 测试，覆盖入口页、热点同步、聊天流式输出。
- 接入长期记忆或向量库，支持跨时间线趋势分析。
