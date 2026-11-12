# SPEC · word-games 互动小说 agent 前端

> 状态：待审（issue tracker 未配置，暂以本文件为载体）
> 术语以 `GLOSSARY.md` 为准：互动小说、叙事引擎、玩家、会话、回合、AGENT.md、会话文件夹、引擎契约。

## 问题陈述

玩家想用真实 LLM 玩互动小说，但把游戏塞进一个普通聊天窗口时，几个问题立刻出现：

- **看不到游戏状态。** 角色属性、背包、当前位置只存在于 AI 的上下文里，玩家不知道"我现在有几个道具、还剩几次机会"。
- **看不到引擎在做什么。** 一次行动背后可能有判定、有状态变更，聊天窗口里只剩一段最终文字，玩家无法判断是运气不好还是规则不允许。
- **无法中断、无法回退。** 选错一个选项就是不可逆的一整段，玩家只能重开。
- **存档不透明。** 会话存在某个数据库或 localStorage 里，玩家想手改一句设定、想看上次的快照、想用 git 版本化，都做不到。

## 解决方案

一个本地运行的 Web 应用（前端 React + 后端 Hono），界面形态借用 DSH：三栏布局、消息流、可折叠的工具调用卡片。

应用以**工作区**组织：工作区是磁盘上的一个目录，先打开它，再在里面开一局。每局游戏是一个**自包含的文件夹**（`<工作区>/<id>/`），里面是纯文本与 JSON：`session.json`、`AGENT.md`、`<model>.md`、`world.yaml`、`state.json`、`messages.jsonl`、`memory.jsonl`、`snapshots/`。会话文件夹就是存档，可以拷走、可以 git、可以手改。

叙事引擎由真实 LLM 驱动（OpenAI 兼容协议），通过一组工具调用维护世界状态；每回合必须调用 `end_turn` 收尾并给出 2–4 个建议行动。界面与磁盘状态双向可视：右栏就是 `state.json`，工具卡片就是每回合的工具调用记录。

## 用户故事

1. 作为玩家，我想在左栏看到所有会话列表，以便继续之前的一局。
2. 作为玩家，我想一键新建一局，以便马上开始。
3. 作为玩家，我想新建会话时在磁盘上生成一个自包含文件夹，以便我用任何编辑器查看和修改。
4. 作为玩家，我想在会话列表里看到标题和回合数，以便判断每局玩到哪了。
5. 作为玩家，我想重命名会话标题，以便区分几局相似的冒险。
6. 作为玩家，我想删除不要的会话，以便列表不越积越乱。
7. 作为玩家，我想在消息流里看到自己输入的行动，以便回顾我说过什么。
8. 作为玩家，我想看到叙事引擎的文字逐字流出，以便不用干等整段生成完。
9. 作为玩家，我想在每回合之间看到一条分隔线（回合号 + 时间），以便分清回合边界。
10. 作为玩家，我想看到引擎调用了哪个工具，折叠成一行摘要，以便不被打断阅读。
11. 作为玩家，我想展开工具卡片看到参数、判定计算、结果和对状态的影响，以便理解引擎为什么这样判定。
12. 作为玩家，我想在输入框上方看到 2–4 个建议行动，以便不想打字时也能推进。
13. 作为玩家，我想点击建议行动直接发送，以便减少一次输入。
14. 作为玩家，我想仍然可以自由输入任意行动，以便不被选项限制。
15. 作为玩家，我想在右栏看到角色属性、背包物品、当前场景与出口，以便随时掌握局势。
16. 作为玩家，我想在状态变化时看到右栏即时更新，以便知道刚才那步改变了什么。
17. 作为玩家，我想在模型流式输出时按下中断按钮，以便停止一次不满意的生成。
18. 作为玩家，我想回到上一回合的快照重新选择，以便不用重开整局。
19. 作为玩家，我想在会话文件夹里看到并自由编辑 `AGENT.md`，以便定制叙事风格与规则，且代码不解析它的结构。
20. 作为玩家，我想引擎自动按当前模型选择 `<model>.md`（存在则优先，否则用 `AGENT.md`），以便同一局可以喂不同模型不同的指令。
21. 作为玩家，我想在设置里填写 API key、base URL 与模型名，以便调用真实模型，而不是被 mock 数据糊弄。
22. 作为玩家，我想在一局中途切换模型，且切换从下一回合生效，以便比较不同模型讲同一个故事的差异。
23. 作为玩家，我想刷新页面后会话、消息与状态都还在，以便关掉浏览器不算丢档。
24. 作为玩家，我想把一局导出为 Markdown，以便分享或存档。
25. 作为玩家，我想在模型调用失败时看到错误条目与重试入口，以便网络抖动不是死路。
26. 作为玩家，我想在工具调用失败时看到失败原因，以便知道是规则拒绝还是程序错误。
27. 作为玩家，我想在新会话里看到引擎生成的开场场景，而不是空白输入框。
28. 作为玩家，我想在触发结局时被明确告知，并看到结局文本，以便知道这一局结束了。
29. 作为玩家，我想让引擎记住更早的剧情（摘要 + 索引，需要细节时能按索引回忆原文），以便长局不丢前情。
30. 作为玩家，我想看到已结束的会话在列表里被标记，以便区分进行中与已完结。
31. 作为维护者，我想整个工作区目录是纯文本且可 git，以便版本化管理我的所有存档。
32. 作为维护者，我想每个会话文件夹自包含（拷贝即迁移），以便不依赖中心数据库。
33. 作为维护者，我想每回合在 `snapshots/` 留一份状态快照，以便回滚有据可依。
34. 作为维护者，我想代码强制的引擎契约与用户可编辑的 `AGENT.md` 严格分离，以便改叙事不用重启代码。
35. 作为维护者，我想工具调用的参数与结果写进 `messages.jsonl`，以便事后复盘引擎行为。

## 实现决策

### 技术栈

- 前端：React 19 + Vite + TypeScript + Tailwind CSS + Zustand。
- 后端：Hono（跑在本地 Node），负责读写工作区目录、调用 LLM、向浏览器推 SSE。
- LLM：OpenAI 兼容协议（`/chat/completions` + tool calling + stream），支持任意兼容端点。
- 传输：回合请求用 SSE；其余用普通 JSON REST。

### 工作区与会话文件夹结构

工作区 = 磁盘上的一个目录；会话 = 工作区里含 `session.json` 的子目录。工作区注册表（最近打开、当前）存在应用数据目录的 `workspaces.json`，不写进工作区。

```
<workspace>/
  <sessionId>/
    session.json       # 元数据：id/title/model/createdAt/updatedAt/turn/status
    AGENT.md           # 用户自由编写，不解析结构
    <model>.md         # 可选，按模型名，优先于 AGENT.md
    world.yaml         # 世界设定 + engine 身份段 + 场景/结局骨架
    state.json         # 当前可量化状态
    messages.jsonl     # 追加写，一行一条，永不改写历史
    snapshots/         # <turn>.json，每回合一份
```

`session.json` 与 `messages.jsonl` 是识别会话的唯一依据；工作区里其他目录/文件不受影响。

### `session.json` 形状

```json
{
  "id": "2026-11-12T08-30-00",
  "title": "雾港旧宅",
  "model": "DeepSeek-V4.1-Flash",
  "createdAt": "2026-11-12T08:30:00+08:00",
  "updatedAt": "2026-11-12T09:12:31+08:00",
  "turn": 12,
  "status": "active"
}
```

`status` 取值 `active | ended | archived`。

### `world.yaml` 形状

```yaml
engine:
  name: "叙事引擎"
  tone: "冷峻、克制、第二人称"
  boundaries:
    - "不替玩家做决定"
    - "不剧透未触发的结局"
opening: "你站在雾港旧宅门口……"
scenes:
  - id: hallway
    name: "门厅"
    exits: [study, parlor]
  - id: study
    name: "旧书房"
    exits: [hallway]
endings:
  - id: escape
    trigger: "flag:found_key && location:door"
```

`world.yaml` 是"冻结骨架 + 可生成细节"的混合：`scenes`/`endings` 给出必须存在的地标，具体描述由叙事引擎生成。

### `state.json` 形状

```json
{
  "turn": 12,
  "scene": "旧书房",
  "location": "study",
  "stats": { "洞察": 3, "胆识": 2, "共情": 4 },
  "inventory": ["黄铜钥匙"],
  "flags": { "met_butler": true },
  "lastCheck": { "attribute": "洞察", "roll": 8, "total": 11, "dc": 12, "success": false },
  "ending": null
}
```

属性固定三项：洞察、胆识、共情，范围 0–5，初始 2。判定公式：`d6 + 属性 vs dc`，`roll_check` 结果写入 `lastCheck`。

### `messages.jsonl` 记录类型

每行一个 JSON 对象，类型由 `role` + 可选 `kind` 区分：

```json
{"role":"player","turn":12,"at":"...","text":"我推开书房的门"}
{"role":"engine","turn":12,"kind":"text","text":"门轴发出一声干涩的呻吟……"}
{"role":"engine","turn":12,"kind":"tool_call","id":"call_1","name":"roll_check","args":{"attribute":"洞察","dc":12}}
{"role":"tool","turn":12,"callId":"call_1","name":"roll_check","ok":true,"result":{"roll":8,"total":11,"success":false}}
{"role":"engine","turn":12,"kind":"options","options":["继续往里走","退回门厅"]}
{"role":"system","kind":"error","text":"上游 503，重试后仍失败"}
```

只追加，不修改。回滚以快照为准，不改历史文件。

### `memory.jsonl` 记录类型

每行一条记忆，覆盖一段已不在最近 8 回合里的剧情：

```json
{"id":"m0-3","turns":[0,3],"summary":"雨夜，玩家两度在门厅翻找。","keywords":["门厅","脚印"],"entities":["沈砚"],"createdAt":"..."}
```

`recall` 用它检索；命中后从 `messages.jsonl` 取回该区间的原文。

### 引擎契约与工具

引擎契约是代码注入、用户不可编辑的最小系统指令，只包含两件事：

1. 身份与协议：你是叙事引擎，每回合必须调用至少一次工具，且必须以 `end_turn` 收尾。
2. 工具清单的一句话说明（实际 schema 由 `tools` 参数传入）。

九个工具：

| 工具 | 语义 |
| --- | --- |
| `move_to` | 移动到某个场景，校验出口 |
| `set_flag` | 设置剧情旗标 |
| `add_item` / `remove_item` | 背包增减 |
| `roll_check` | 属性判定，写 `lastCheck` |
| `lookup_lore` | 查问世界设定（取 `world.yaml` 的段落） |
| `recall` | 回忆更早剧情：按关键词搜记忆索引，或按回合范围取回原文 |
| `trigger_ending` | 触发结局，`status` 转 `ended` |
| `end_turn` | 收尾：叙事文本 + 2–4 个选项 + 可选状态变更 |

`end_turn(narrative, options, status?)` 是唯一结束回合的方式；若模型未调用，后端补一次"系统要求收尾"的续写请求，仍失败则回退为纯文本收尾。

### 每回合上下文组装顺序

1. 引擎契约（代码）。
2. `<model>.md`，存在则用之；否则用 `AGENT.md`。
3. `world.yaml` 的 `engine` 段 + 当前场景与出口。
4. `state.json`。
5. 更早剧情摘要 + 索引（每条记忆：回合区间、摘要、关键词）。
6. 最近 8 回合的原始消息。
7. 玩家本次输入。

更早剧情由后端在超过 8 回合时维护：每批 4 回合压成一条记忆（`memory.jsonl`），摘要与关键词由一次模型调用生成；已记忆的回合不再进最近剧情。需要细节时，引擎调用 `recall` 按关键词检索索引，或按回合范围取回原文。

### HTTP API 契约

所有 `/api/sessions*` 都带 `?workspace=<工作区绝对路径>`，指向会话所属工作区。

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| GET | `/api/workspaces` | 读工作区注册表（最近打开 + 当前） |
| POST | `/api/workspaces` | 打开一个已存在的目录并设为当前 |
| DELETE | `/api/workspaces?path=` | 从最近列表移除 |
| GET | `/api/sessions?workspace=` | 列该工作区下的会话（不含消息正文） |
| POST | `/api/sessions?workspace=` | 新建：在工作区下建文件夹、写 world/state 初值、请求开场 |
| GET | `/api/sessions/:id` | 读会话 + 全量消息 |
| PATCH | `/api/sessions/:id` | 改标题 / 模型 |
| DELETE | `/api/sessions/:id` | 删除会话文件夹 |
| POST | `/api/sessions/:id/turns` | 提交一次玩家输入，返回 SSE 流 |
| POST | `/api/sessions/:id/rollback` | 回滚到指定回合快照 |
| GET | `/api/sessions/:id/export` | 导出 Markdown |
| GET/PUT | `/api/settings` | 读/写 API key、base URL、默认模型 |

SSE 事件：`turn_start`、`delta`（叙事增量）、`tool_call`、`tool_result`、`options`、`state`、`done`、`error`。

### 前端结构

- `AppFrame`：三栏。左栏 280px（会话列表 + 新建 + 设置），中栏弹性（会话头 + 消息流 + 选项条 + composer），右栏 320px（属性 / 背包 / 场景）可折叠。
- 消息流条目类型：用户消息、引擎文本、工具卡片（折叠一行，展开详情）、选项条、回合分隔线、系统/错误条目、压缩标记。
- 状态：Zustand 单 store，按"会话列表 / 当前会话 / 设置"切片；SSE 事件 reducer 化处理。
- 流式：`delta` 累积到当前引擎气泡；`tool_call` 先插入 running 卡片，`tool_result` 后更新为 ok/失败。
- 中断：`AbortController` 断开 SSE，把已到达的内容落盘，标记该回合为"中断"。

### 错误与边界

- 模型调用失败：写入 `system/error` 条目，composer 上方显示重试按钮，重试重发同一输入。
- 工具失败（参数非法/出口不存在）：写入 `tool` 条目 `ok:false`，引擎据此改写叙事，不中断回合。
- 会话不存在 / 文件夹损坏：列表项标红，点击展示具体缺失文件。
- 回滚：只接受已存在的 `snapshots/<turn>.json`；回滚后 `messages.jsonl` 保留，消息流以快照回合截断展示（`session.json` 的 `discarded` 记录每次回滚的回合与时刻，读取时过滤掉被回滚分支里更晚回合、且早于该时刻的消息）。

## 测试决策

**什么算好测试**：只断言外部可观察行为——发出的 HTTP 请求、返回的 SSE 事件序列、磁盘上会话文件夹的最终内容。不断言内部函数调用、不断言 CSS 类名、不 mock 被测试模块自身的内部结构。

**测试接缝（提议，待你确认）**：

1. **主接缝：后端 HTTP API。** 用真实 Hono 实例在内存里跑，把 LLM 客户端替换成一个可编程的假驱动（返回预设的工具调用与文本流）。覆盖：新建会话文件夹、回合 SSE 事件序列、工具结果写入 `messages.jsonl`、`state.json` 更新、快照生成、回滚、会话列表与导出。
2. **辅助接缝：prompt 组装是纯函数。** 输入（契约 + 文件内容 + state + 历史）→ 输出消息数组，用快照测试锁死顺序与优先级（`<model>.md` 优先于 `AGENT.md`）。
3. **前端 UI 不上自动化测试**（v1）。三栏布局、流式渲染、工具卡片折叠属于快速变化区，用人工验收；等 UI 稳定后再补一条 Playwright happy-path。

**测试的模块**：`session-store`（文件夹读写与迁移）、`prompt-builder`、`tool-executor`、`turn-runner`（SSE 状态机）、`rollback`。

**既有先例**：仓库当前为空，无既有测试可沿用；全部为新建接缝。这是本 spec 唯一"多接缝"的取舍——若要收敛到一个，可让 `prompt-builder` 与 `tool-executor` 通过 API 间接断言，代价是排错变慢。

## 范围外

- 多用户、账号、登录、权限。
- 移动端布局与触屏优化。
- 云端同步、协作、分享链接。
- 语音输入/朗读、图片或视频生成。
- 完整规则引擎（先由 LLM 裁量 + 轻量工具约束，不做战斗模拟器）。
- 多人同局、旁观模式。
- 本地模型一键拉取与运行时管理（只支持 OpenAI 兼容端点）。

## 补充说明

- **格式稳定性**：`messages.jsonl` 与快照是长期资产，字段只增不改；新增字段必须可选，旧文件必须可读。
- **成本**：每回合约 3–6k 输入 token（8 回合原文 + 摘要 + 世界），单局数百回合在可接受范围内；模型可随时切换以控制成本。
- **隐私**：会话内容只落本地磁盘；API key 存 `.env`，不写进会话文件夹、不进 `session.json`。
- **可观测**：后端在控制台打印每回合的 prompt 长度、工具调用次数、耗时，便于调 prompt。
