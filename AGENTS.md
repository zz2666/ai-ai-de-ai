# AGENTS.md — Codex 工作协议（WSL 环境 - NPM 专属版）
冲突时，优先级从高到低：用户明确指令 > 本文件 > 子目录 AGENTS.md > 现有代码约定 > 模型默认行为

本文件置于仓库根目录，自动对所有子目录生效。
Git 推送权限：已开启。用户明确同意变更后，Codex 须按"提交并推送流程"自动完成 commit + push，无需再次询问。

禁止事项（速查）
不得手动编辑 package-lock.json 或生成文件
不得直接向 main / master 提交或推送（功能分支可以）
不得在未经说明的情况下引入生产依赖
不得在任务未明确要求时创建或修改 migration
不得提交 secrets、token、密钥或凭据
不得在脚本中使用 Windows 路径（C:\...），统一用 WSL 路径（/mnt/c/...）
不得使用 push --force、reset --hard、--no-verify
不得假设沙箱内可访问外部网络（默认仅 localhost 可用）
未经用户同意，不得自行 commit 或 push 任何内容

本仓库信息
技术栈：Next.js (App Router) + TypeScript + Tailwind CSS + Lucide React (图标库)
项目名称：AI AI 的 AI
入口文件：src/app/page.tsx 与 src/components/
包管理器：npm
常用命令：

# 安装依赖
npm install

# 启动本地开发服务器
npm run dev

# 完整验证门
npm run lint && npm run build

# 构建项目
npm run build

分支约定：
功能开发 → develop
生产     → main（受保护，不得直接提交）

Codex 沙箱初始化（setup）
# 安装依赖
npm install

沙箱网络限制说明：
任务执行阶段默认断网，仅 localhost 可通。
测试若依赖外部 API，需 mock 或使用本地 stub，不可直接请求真实端点。

WSL 专项注意事项
- 路径：统一使用 Linux 路径（/home/user/project）。
- 换行符：仓库统一使用 LF，不得引入 CRLF。确认本地配置：git config core.autocrlf false 且 git config core.eol lf
- 文件权限：Shell 脚本须有执行权限：chmod +x script.sh。
- 性能：项目必须克隆在 WSL 原生文件系统下，严禁在 /mnt/c/... 下运行。

核心原则
- 最小变更：只做任务要求的改动，不顺手重构无关代码。
- 保持一致：匹配周围代码的命名、结构、错误处理风格。

验证要求
任务完成前必须执行：npm run lint && npm run build。修复所有 TypeScript 报错。

=======================================================
🔥 项目专属上下文与第三方 API 规范（AI AI 的 AI 专属）
=======================================================
1. 视觉设计约束：
- 严格遵循赛博朋克 2077 官方美学（#080808 深黑背景，#fcee0a 赛博黄，#00f0ff 科技青）。
- UI 组件边缘必须呈现锐利直角，鼓励使用 CSS clip-path 制作切角按钮。
- 所有文字、边框在 Hover 时需带有轻微的故障艺术（Glitch）或霓虹流光动效。

2. AI HOT 数据 API 规范：
- 匿名免费，无需任何 Token/密钥。
- 精选/热点端点：GET https://aihot.virxact.com/api/public/items?mode=selected
- 全量/动态端点：GET https://aihot.virxact.com/api/public/items?mode=all
- 搜索端点：GET https://aihot.virxact.com/api/public/items?q=关键词
- 每日精编日报端点：GET https://aihot.virxact.com/api/public/daily

3. 网页实时截图黑魔法（Microlink 整合）：
- 渲染热点卡片时，图片 src 必须通过以下逻辑动态生成：
  `https://api.microlink.io/?url=${encodeURIComponent(item.url)}&screenshot=true&embed=screenshot.url`
- 截图未加载完成时，必须渲染带有“矩阵注入中...”字样的赛博朋克骨架屏。

任务结束汇报
每次任务结束时，输出变更文件、验证结果、未执行验证，并附带：
✅ 验证通过，回复"同意"后将自动提交并推送到 <当前分支名>。
