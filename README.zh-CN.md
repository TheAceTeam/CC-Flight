# CC Flight

[English](README.md) | [简体中文](README.zh-CN.md)

## 快速开始

```bash
npx --yes cc-flight@latest
```

或全局安装：

```bash
npm install -g cc-flight
ccflight
```

从指定项目目录启动——CC Flight 会自动扫描并默认选中该项目：

```bash
ccflight .                          # 当前目录
ccflight /path/to/your/project      # 绝对路径
ccflight --project-dir=/path/to/project
```

然后打开 **http://127.0.0.1:5174**，扫描你的 agent 日志即可。

CC Flight 是一个本地优先的 coding agent 飞行记录器。它会读取 Codex、Claude Code 和 OpenCode 的 session 日志，重建每一轮任务旅程，并将隐藏的 agent 工作——上下文快照、工具调用、成本、错误和项目遥测——呈现在一个统一的仪表盘中。

## 包名迁移

npm 包名现在是 `cc-flight`。旧包名 `@seanxdo/superview` 会作为兼容包继续保留，避免已有安装立即失效。

新安装建议使用：

```bash
npx cc-flight
```

迁移期间，旧命令仍然可用：

```bash
npx @seanxdo/superview
superview
```

后续脚本和文档建议统一切换到 `cc-flight` 或 `ccflight`。

## 界面预览

<table>
  <tr>
    <td colspan="4" align="center"><img src="docs/assets/02.png" width="900" alt="CC Flight 截图" /></td>
  </tr>
  <tr>
    <td colspan="4" align="center"><img src="docs/assets/03.png" width="900" alt="CC Flight 截图" /></td>
  </tr>
  <tr>
    <td colspan="4" align="center"><img src="docs/assets/08.png" width="900" alt="CC Flight screenshot" /></td>
  </tr>
  <tr>
    <td><img src="docs/assets/04.png" width="100%" alt="CC Flight 截图" /></td>
    <td><img src="docs/assets/05.png" width="100%" alt="CC Flight 截图" /></td>
    <td><img src="docs/assets/06.png" width="100%" alt="CC Flight 截图" /></td>
    <td><img src="docs/assets/07.png" width="100%" alt="CC Flight 截图" /></td>
  </tr>
</table>

## 功能

### 会话概览

可折叠的飞行记录仪面板，包含五个模块：

- **01 总览** — 会话数、预估成本、Token 总量、工具调用次数、错误数、最常用模型、最忙一天和最贵项目。
- **02 节奏** — 每日活动日历热力图、小时×星期时钟热力图、每日 Token 用量图表。
- **03 效率** — 缓存命中率、错误率、每次会话 Token 数、每次会话成本，带动画仪表条。
- **04 模型成本** — 按模型分组的成本明细表，支持自定义 Token 定价。
- **05 工具用量** — 工具调用频率的横向柱状图，标注错误次数。

### 上下文回放

按快照逐步回溯 agent 的上下文窗口：

- 编号步骤栏，显示每步的阶段、标题和 +新增/-丢弃 内容。
- 自动播放模式（每 2.8 秒切换快照）。
- 上下文块按状态分组：延续、新增、变更、丢弃。
- 警告条：过期上下文、矛盾信息、缺失文件。
- **工厂流水线** — 全宽皮带视图，展示所有快照节点及其活跃上下文块的流转。

### Token 时间线

每次旅程的 Token 用量纵向柱状图，按输入/输出/缓存/推理分段。点击任意柱子跳转到对应旅程。顶部汇总条显示会话总数、Token 总量和分类明细。

### 分享卡片

一键生成任务旅程摘要——关键统计、使用技能、判定结果（完成/失败/进行中）、Token 火花图和 Markdown 格式复制。

### 事件条

每条旅程行上的水平迷你时间线，以颜色区分事件类型（用户、agent、工具、思考、错误），悬停显示详情。

### 成本估算

内置 Claude 和 GPT 模型定价表（2026 年 6 月费率）。所有费率可实时编辑。根据原始 Token 用量计算成本，含缓存读写系数。支持按模型聚合成本。

### 多提供商支持

| 提供商 | 数据来源 | 默认路径 |
|--------|---------|---------|
| Codex CLI | Session JSONL 文件 | `~/.codex/sessions/**/*.jsonl` |
| Claude Code | Project JSONL 文件 | `~/.claude/projects/**/*.jsonl` |
| OpenCode | 导出 session 文件 | 手动导出 |

### 主题与语言

四种主题：明亮指挥中心（默认）、暗色指挥中心、森林实验室、等离子紫。完整双语支持：英文和简体中文。偏好设置跨会话持久保存。

## 本地开发

```bash
pnpm install
pnpm dev          # 启动 API + Vite 开发服务器
```

打开应用：

```
http://127.0.0.1:5173/
```

API 服务地址：

```
http://127.0.0.1:5174/
```

### CLI 导入

```bash
pnpm ingest /path/to/.codex
```

### API 导入

```bash
curl -X POST http://127.0.0.1:5174/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{"sources":[{"provider":"codex"}]}'
```

Claude Code：

```bash
curl -X POST http://127.0.0.1:5174/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{"sources":[{"provider":"claude-code","root":"/path/to/.claude"}]}'
```

OpenCode：

```bash
curl -X POST http://127.0.0.1:5174/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{"sources":[{"provider":"opencode","path":"/path/to/opencode-export.json"}]}'
```

查询任务状态：

```bash
curl http://127.0.0.1:5174/api/ingest/jobs/<jobId>
```

### 常用脚本

```bash
pnpm dev          # 同时启动 API 和 Vite 客户端
pnpm dev:server   # 只启动 Express API
pnpm dev:client   # 只启动 Vite 客户端
pnpm start        # 启动生产服务器（单端口，同时提供 API + UI）
pnpm build        # 类型检查并构建 UI
pnpm typecheck    # 运行 TypeScript 检查
pnpm test         # 运行 Vitest 测试
pnpm test:e2e     # 运行 Playwright 测试
pnpm publish:dual # 构建并 dry-run 发布 cc-flight + 兼容包
```

### 发布

```bash
pnpm publish:dual       # 构建、打包，并 dry-run 两个 npm 包
pnpm publish:dual:live  # 构建、打包，并正式发布 cc-flight + @seanxdo/superview
```

如需 dry-run 到非 `latest` 标签，可运行 `pnpm publish:dual -- --tag next`。正式发布会先发布 `cc-flight`，再将同一个打包产物改写为旧包名 `@seanxdo/superview` 兼容包后发布。
如果 npm 要求双因素认证，可运行 `pnpm publish:dual:live -- --otp <code>`。

## API Reference

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/ingest` | POST | 启动导入任务 |
| `/api/ingest/jobs/:id` | GET | 查询导入进度 |
| `/api/projects` | GET | 列出所有项目 |
| `/api/projects/:id/timeline` | GET | 获取项目时间线 |
| `/api/projects/:id/token-usage/daily` | GET | 每日 Token 用量 |
| `/api/task-journeys/:id` | GET | 任务旅程详情 |
| `/api/task-journeys/:id/context-replay` | GET | 上下文回放数据 |
| `/api/events/:id/evidence` | GET | 事件证据 |
| `/api/runs/:id` | GET | 运行回放 |
| `/api/reset` | POST | 重置数据库 |

## 架构

```text
ui/            React + Vite 仪表盘
runtime-node/  Express API、导入服务、工作进程、日志适配器
core/          解析器、规范化器、脱敏器、成本引擎、时间线、上下文回放
storage/       SQLite 数据库层和本地数据路径
```

导入路径与 API 路径分离。API 创建导入任务后立即返回，工作进程独立扫描和解析日志文件，将标准化数据写入 SQLite。即使扫描大量历史会话，仪表盘也能保持响应。导入服务采用单飞模式——若已有任务在运行，后续请求返回现有任务而非启动新的全量扫描。

## 环境变量

```bash
SUPERVIEW_DATA_DIR     # 数据目录（默认：./.superview）
SUPERVIEW_CODEX_HOME   # Codex 日志根目录（默认：~/.codex）
SUPERVIEW_CLAUDE_HOME  # Claude Code 日志根目录（默认：~/.claude）
SUPERVIEW_PORT         # 生产服务器端口（默认：5174）
```

## 隐私

CC Flight 完全本地运行。无需账号、云同步或远程后端。原始 agent 日志始终留在你的机器上。标准化记录存储在本地 SQLite 数据库中。证据视图仅暴露脱敏 payload 及来源信息（路径、行号、时间戳、哈希），足以用于调试，但不会泄露原始内容。
