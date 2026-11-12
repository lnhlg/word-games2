# SPEC · word-games 群像剧场

> 状态：待审（issue tracker 未配置，暂以本文件为载体）
> 术语以 `GLOSSARY.md` 为准：群像剧场、角色卡、角色卡库、导演、一场戏、参演角色、大纲、情节段落、回合、重试、重新生成、编辑、后续剧情选项、AGENT.md、剧场契约、视角、角色缺失。

## 问题陈述

想用真实 LLM 演一出"多个角色互相较量、彼此说话"的戏，把这件事塞进一个普通聊天窗口时，几个问题立刻出现：

- **角色立不住。** 一次性聊天的上下文里，人物设定会随对话稀释；换一段对话，人又变了个样。
- **设定没法复用。** 每开一段戏都要重新粘贴人物小传；已有的酒馆角色卡（PNG/JSON）带不过来。
- **谁开口是由格式决定的。** 普通对话是一问一答，"每个角色轮流说一句"很机械；真实的情节里，谁开口该由剧情决定。
- **看不到成品。** 聊天窗口产出的是一问一答的碎片，不是一段能拿去读的小说。

## 解决方案

一个本地运行的 Web 应用（前端 React + 后端 Hono），把"角色"和"演出"分开：

- **角色卡库**：工作区根目录的 `characters/` 目录，一张卡一个酒馆 V2 角色卡 JSON。可以从 SillyTavern 的 PNG/JSON 导入，也可以在应用内和 AI 对话生成。
- **一场戏**：左栏一个会话（`<工作区>/<id>/`），开戏时勾选参演角色、设定默认视角。导演每输入一条大纲，后端发**一次** LLM 调用，把大纲写成一段小说体情节——角色在其中按剧情自然开口，谁说不说由情节决定，不按角色轮转。
- **磁盘即真相**：卡、会话、指令、情节全部是明文与 JSON，可以手改、可以 git。

## 用户故事

导演视角：

1. 作为导演，我想在左栏看到所有戏，以便继续之前那一场。
2. 作为导演，我想点「新建」开一场戏，并在弹窗里勾选参演角色、设定标题与默认视角，以便一开始就把班子搭好。
3. 作为导演，我想在左栏进入「角色」页，看到工作区里的所有角色卡，以便知道手里有哪些演员。
4. 作为导演，我想把酒馆的 PNG 角色卡拖进来就导入，以便不用先手抄设定。
5. 作为导演，我想导入酒馆的 V2 JSON 角色卡，以便接住别人分享的卡。
6. 作为导演，我想在「角色」页和 AI 对话描述我想要的人物，AI 一边聊一边把卡成型并保存，以便不用自己填字段。
7. 作为导演，我想在对话时看到右侧卡片实时预览，以便确认 AI 有没有写歪。
8. 作为导演，我想删除不再需要的角色卡，被引用时先提示，以便库不越积越乱。
9. 作为导演，我想输入一句大纲（"雨夜，阿箬翻沈砚的抽屉，沈砚撞见"），看到一段小说体情节逐字流出，以便导演一出戏。
10. 作为导演，我想情节里由剧情决定谁开口、谁沉默，而不是每个角色各说一句，以便戏看起来是活的。
11. 作为导演，我想在开戏时设定默认视角（第三人称限知/第一人称），并能在单条大纲里临时覆盖，以便控制信息边界。
12. 作为导演，我想中断一次不满意的生成，已生成的部分保留在磁盘上，以便不用整场重来。
13. 作为导演，我想在左栏会话里看到标题、回合数与进行/已落笔状态，以便判断每场演到哪了。
14. 作为导演，我想重命名、删除一场戏，以便管理它们。
15. 作为导演，我想把一场戏导出成 Markdown 小说，以便分享或存档。
16. 作为导演，我想在会话头切换供应商、模型与思考强度，且从下一回合生效，以便比较不同模型写同一场戏的差别。
17. 作为导演，我想刷新页面后戏和情节都还在，以便关掉浏览器不丢稿。
18. 作为导演，我想看到"这一场已经落笔"的明确状态，以便知道这场戏结束了。
19. 作为导演，我想在引用的角色卡被删除后看到"角色缺失"提示，以便重新导入同名卡恢复。
20. 作为导演，我想长剧里早先的情节仍被记住，以便几十回合后角色不丢前情。
21. 作为导演，我想删掉最后一回合演坏了的戏，以便重演这一幕而不丢掉前面的剧情。
22. 作为导演，我想让最后一回合按同一条大纲重新写一遍，以便换一版更好的成品，而不用重新输入大纲。
23. 作为导演，我想直接编辑任意回合的 AI 回复（改错字、删一句），以便不用删掉整回合再重写。
24. 作为导演，我想在每段情节写完后看到几条后续剧情选项，以便顺着一个方向继续开演。

维护者视角：

25. 作为维护者，我想整个工作区是纯文本且可 git，以便版本化所有卡和戏。
26. 作为维护者，我想角色卡与酒馆 V2 格式互操作，导入零损耗，以便不发明私有格式。
27. 作为维护者，我想剧场契约与用户可编辑的 AGENT.md、角色卡严格分离，以便改文风不用动代码。
28. 作为维护者，我想每回合的消息按固定记录类型写进 `messages.jsonl`，以便事后复盘与格式演进；改写只发生在导演主动触发的删除、重新生成与编辑上。
29. 作为导演，我想在工坊里选中一张已有卡继续和 AI 对话修改它，以便不用手改 JSON 就能调整人设。
30. 作为导演，我想把一张角色卡导出成酒馆 V2 JSON，以便备份，或发给用酒馆的人。
31. 作为导演，我想在界面里直接改角色卡的字段并保存，以便不用离开应用去编辑 JSON。
32. 作为导演，我想给参演角色各定几个状态项（好感度、伤势、被谁怀疑），以便人物的处境不用每回合从前面几段里重读。
33. 作为导演，我想把状态项单独建成可复用的模板，一份套给多个角色、多场戏，以便不用每开一场都重定一遍。
34. 作为导演，我想用一句话让 AI 在模板库里把条目定出来，以便不用自己想「该看哪些维度」——但它只给条目，不给数值。
35. 作为导演，我想让状态值跟着剧情每回合自动变，并且看到它为什么变，以便一眼判断 AI 有没有写歪。
36. 作为导演，我想直接点一下把状态值改掉，以便 AI 漏更新或更新错的时候我自己修。

## 实现决策

### 技术栈

- 前端：React 19 + Vite + TypeScript + Tailwind CSS + Zustand。
- 后端：Hono（本地 Node），负责读写工作区、调用 LLM、向浏览器推 SSE。
- LLM：OpenAI 兼容协议（`/chat/completions` + stream + tool calling），支持任意兼容端点。
- 传输：生成类请求用 SSE；其余用普通 JSON REST。

### 目录结构

```
<workspace>/
  characters/
    <id>.json          # 酒馆 V2 角色卡，一张卡一个文件
  status-templates/
    <id>.json          # 状态模板：一份可复用的状态项清单，套到角色上时复制
  <sessionId>/
    session.json       # 元数据：id/title/model/providerId/reasoningEffort/cast/perspective/statusTemplate/statusTemplateIds/turn/status
    AGENT.md           # 全场通用指令，用户自由编写，不解析结构
    messages.jsonl     # 逐行 JSON：导演大纲 + 情节段落 + 系统错误；可原地改写
    memory.jsonl       # 长剧摘要（每 4 回合一条）
    status.jsonl       # 角色状态的变更流；没配状态模板时不存在这个文件
```

工作区注册表（最近打开、当前）仍在应用数据目录的 `workspaces.json`，不写进工作区。会话 = 工作区里含 `session.json` 的子目录；`characters/` 不是会话。

### `session.json` 形状

```json
{
  "id": "2026-11-12T14-30-00",
  "title": "雾港旧宅",
  "model": "DeepSeek-V4.1-Flash",
  "providerId": "deepseek",
  "reasoningEffort": "high",
  "perspective": "第三人称限知",
  "cast": ["沈砚", "阿箬"],
  "statusTemplate": {
    "沈砚": [{ "name": "好感度", "note": "对阿箬的信任与亲近程度" }],
    "阿箬": [{ "name": "伤势", "note": "" }]
  },
  "statusTemplateIds": { "沈砚": "毒医验伤", "阿箬": "毒医验伤" },
  "createdAt": "2026-11-12T14:30:00+08:00",
  "updatedAt": "2026-11-12T15:12:31+08:00",
  "turn": 3,
  "status": "active"
}
```

- `cast` 是角色卡 id（文件名去掉 `.json`）的数组，顺序无意义；空数组表示"零参演"的戏（可用来写独白）。
- `statusTemplate` 是可选的：这场戏里每个参演角色看哪些状态维度，键是角色卡 id。没有这个字段就表示这场戏没启用角色状态。它是**本场生效的定义**——套用模板时复制进来，之后与模板各改各的。
- `statusTemplateIds` 是可选的来源记录：每个角色套的是模板库里的哪一份。只用于界面显示，不影响渲染、注入与导出。
- `perspective` 是自由文本，缺省按 `第三人称限知` 处理。
- `status` 取值 `active | ended | archived`。`ended` 即"已落笔"。
- 模型/供应商/思考强度的解析与回退规则沿用旧实现：缺 `providerId` 或失效时按 `model` 名在已配置供应商里唯一匹配，再退回 `default` 三元组，再不行用 `.env` 兜底；旧枚举折算 `minimal → low`、`xhigh/ultra → max`。

### 角色卡文件

`characters/<id>.json` 的内容就是酒馆 V2 角色卡：

```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "沈砚",
    "description": "……",
    "personality": "……",
    "scenario": "……",
    "first_mes": "……",
    "mes_example": "……",
    "creator_notes": "……",
    "system_prompt": "……",
    "post_history_instructions": "……",
    "alternate_greetings": [],
    "tags": ["民国", "悬疑"],
    "creator": "",
    "character_version": "",
    "extensions": {},
    "character_book": { "entries": [] }
  },
  "name": "沈砚",
  "description": "……",
  "personality": "……",
  "scenario": "……",
  "first_mes": "……",
  "mes_example": "……"
}
```

- 顶层保留 V1 字段（酒馆生态的习惯），`data` 下是权威值；导入时两者都保留，不重写、不丢字段。
- `character_book` 原样保存但**不注入** prompt（v1 不用世界书）。
- `creator_notes`、`tags`、`creator`、`character_version` 只用于展示，不进 prompt。

### 导入与归一化

- **PNG**：读二进制，遍历 chunk，找 keyword 为 `chara` 的 `tEXt`；其值为 base64(JSON)。解出后按 V2/V1 归一化。（`ccv3` chunk 与第三方变体 v1 不支持，遇到时提示"未识别的角色卡格式"。）
- **JSON**：直接解析。`spec === "chara_card_v2"` 且有 `data` 视为 V2；否则若有顶层 `name` 视为 V1，包成 V2。
- **归一化**：`name` 必填且非空，缺失即拒绝导入；字符串字段非字符串时置空串；`alternate_greetings`/`tags` 非数组时置空数组；`extensions` 缺失或非对象时置 `{}`；`character_book` 缺失时不补。归一化后的内容落盘。
- **文件名 id**：由 `name` 清洗得出（保留中文与字母数字，非法字符替换为 `-`，去首尾空白与点，最长 64 字符），重名依次加 `-2`、`-3`。

### 角色卡库 API

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| GET | `/api/characters?workspace=` | 列出卡（id、name、tags、creator），按 name 排序 |
| GET | `/api/characters/:id?workspace=` | 读一张卡的完整 JSON |
| POST | `/api/characters?workspace=` | 保存一张卡（body 为 V2 JSON）；同名覆盖需显式 `overwrite: true` |
| POST | `/api/characters/import?workspace=` | multipart 上传 PNG/JSON，解析、归一化、落盘，返回 `{ id, card }` |
| DELETE | `/api/characters/:id?workspace=` | 删除；被引用时返回 `{ referencedBy: [...] }`，带 `force: true` 才删 |
| PATCH | `/api/characters/:id?workspace=` | 手工编辑：body `{ data }`，按原 id 合并保存，`extensions` 等额外字段保留 |
| POST | `/api/characters/studio?workspace=` | 工坊对话（见下），SSE |

### 工坊（AI 对话创建 / 修改角色卡）

- 一个独立页面：中间是对话流，右侧是当前卡片的只读预览，底部输入框；顶部有「导入」按钮与卡库列表。
- 后端 `POST /api/characters/studio?workspace=`，body `{ messages: [{ role, content }], cardId? }`，SSE 返回 `delta` 与 `card_saved` 事件。
- **新建**（不传 `cardId`）：系统提示由代码注入，告诉模型它是一个角色卡合写助手，通过 `save_character_card` 工具提交卡片；字段定义与 V2 一致。
- **修改已有卡**（传 `cardId`）：后端先读该卡，把完整 JSON 附进系统提示，并要求模型保存时提交整张卡的字段；落卡按原 id 合并保存（工具参数里没出现的字段保留原值），文件名不变——改名只改 `data.name`，不迁移文件，避免打断已有会话的 cast 引用。`cardId` 不存在时直接 404，不会退化成新建。
- 前端：选中卡后点「用 AI 修改」进入编辑态，工坊顶部显示「正在修改 …」横幅与「退出修改」；进入编辑态会清空当前对话（已有对话时先确认）。
- `save_character_card` 工具参数即 `data` 对象（name 必填）。后端校验、归一化、落盘为 `characters/<id>.json`，向流里推 `card_saved`，并返回工具结果给模型（"已保存为 characters/沈砚.json"）。
- 工坊对话本身不落盘；只有卡片落盘。
- 模型复用当前默认选择（供应商/模型/思考强度），不单独配置。

### 开戏流程

1. 点「＋ 新建」：弹窗勾选参演角色（多选，来自卡库）、填标题（可空）、选默认视角。
2. `POST /api/sessions?workspace=`，body `{ title?, cast: string[], perspective? }`。
3. 后端建 `<工作区>/<id>/`，写 `session.json`、默认 `AGENT.md`、空 `messages.jsonl`；`cast` 里任一 id 不存在则 400。
4. 进入会话，composer 提示"写下第一幕的大纲"。右栏每张角色卡下面是空的状态区，可以「＋ 加状态」手动加，或「选模板」从模板库套一份。

### 每回合的生成

1. 导演在 composer 输入大纲，`POST /api/sessions/:id/turns?workspace=`，body `{ input }`。
2. 后端把导演消息追加到 `messages.jsonl`（`role: "director"`）。
3. 组装 messages（见下），**一次** LLM 调用，流式返回。
4. SSE 事件：`turn_start`、`delta`（情节增量）、`done`、`error`；选项生成成功时在 `done` 之后追加一条 `next_options`（`{ turn, options: string[] }`）。
5. 生成结束后把完整情节追加为 `role: "narrative"`；中断时把已到达部分落盘并标 `interrupted: true`；`session.json` 的 `turn` 与 `updatedAt` 更新。
6. 正文落盘后，用最近一段剧情 + 当前状态做一次不传思考强度的轻量调用，**同时**产出 3 条候选大纲与角色状态更新：选项写进该回合 `narrative.nextOptions`，状态变化追加进 `status.jsonl` 并推一条 `status_update`。解析按字段降级，失败静默，不影响正文。

### 回合管理

导演可以管理已经写下的回合（完整决策见 `docs/adr/0001-turn-rewriting.md`）：

- **最后一回合的判定**：取 `messages.jsonl` 里最后一条非 `system` 记录的回合号，而不是 `session.json` 的 `turn - 1`。生成失败时回合号不前进、只留下大纲，这条大纲因此同样是最后一回合。
- **删除（只限最后一回合）**：`DELETE /api/sessions/:id/turns/:turn`。删掉该回合的导演大纲与情节，`turn` 回退一格（删的是失败后只剩大纲的那一回合时，它本来没占回合号，`turn` 不变），不重排编号；`memory.jsonl` 不受影响（最后一回合永远在最近 8 回合内，尚未被压缩）。
- **重新生成（只限最后一回合）**：`POST /api/sessions/:id/turns/regenerate`，复用该回合已落盘的大纲重跑，SSE 事件与普通回合相同；新情节覆盖旧稿，回合号不变。失败时该回合只留下导演大纲，可以再次重新生成或删除（`turn` 不前进）。
- **失败后改发新大纲**：新大纲直接顶替那条只剩大纲的回合，避免两条大纲挤同一个回合号；重试（`retry: true`）保留原大纲。
- **编辑（任意回合）**：`PATCH /api/sessions/:id/turns/:turn`，body `{ text }`。直接改写该回合情节并标记 `edited: true`；若该回合已被压进记忆，响应带 `memoryStale: true`，界面提示摘要不会同步。
- **选项（只对最新回合可点）**：生成成功即写入 `nextOptions`，点击只填入 composer，不自动开演；旧回合的选项只读展示。编辑或中断后该回合选项作废，不自动重新生成。

### 角色状态

一场戏里每个参演角色的一组「状态项 + 状态值」，让「此刻的处境」不必每次从最近八回合里重读。完整决策见 `docs/adr/0002-character-status.md`。

- **两层**：**状态模板**回答「看哪些维度」，**状态值**回答「此刻是多少」。模板库是工作区级的可复用实体（`status-templates/<id>.json`）；套到角色上是**快照**——条目复制进 `session.json` 的 `statusTemplate`，之后改模板不影响已经开演的戏。值变更流进 `<session>/status.jsonl`，当前值由重放变更流得出。
- **来源**：导演在左栏「模板」页建/改模板（可让 AI 按一句描述生成条目，可选一张角色卡当参考，但**只给名称与说明、不给值**）；在右栏给某个角色「选模板」套用；也可以直接在右栏加/删条目、手改值。每回合正文之后由模型更新已有条目的值，并可提议新增条目。
- **模型输出**：绝对值而不是增量，每次变化带一句依据（`好感度 30 → 35（她替他挡了一刀）`）。模型**不能删除条目**；每角色最多 8 条，超出的新增提议直接丢弃。
- **注入**：接在演员表里该角色段的末尾（`当前状态：好感度 35；被怀疑 未定`）；未取过值的项写「未定」。剧场契约另有一条约束：正文里不要直接报出条目名或数值。
- **回滚**：删除最后一回合 → 丢弃该回合及之后的状态记录（导演在该回合之后的手改一并丢弃）；重新生成最后一回合 → 先丢弃该回合记录再按新稿重算；编辑任意回合 → 不重算，界面上把该回合的依据标为过期；中断的回合不更新状态。
- **导出**：Markdown 在剧情之后附一张「角色状态」表，不打断正文阅读。

`status.jsonl` 每行一次变更，含完整快照所需的信息：

```json
{"turn":3,"at":"...","source":"ai","changes":[{"cardId":"沈砚","item":"好感度","from":"30","to":"35","basis":"她替他挡了一刀"}],"added":[{"cardId":"沈砚","name":"伤势","note":"身上的伤"}]}
```

`turn` 为 `null` 表示不属于任何回合（删条目时的清空记录）；`source` 取 `ai | manual`。旧会话没有这个文件时按「没有状态」处理，不报错。

### prompt 组装顺序

一次调用，两条消息：

**system**（按序拼接）：

1. 剧场契约（代码，用户不可编辑）。
2. `AGENT.md`（全场通用指令）。
3. 演员表：每个参演角色的 `name`、`description`、`personality`、`system_prompt`（若卡自带）、`first_mes`（注明"这是该角色首次登场时的语气参考，不是要照抄的开场"）、`mes_example`（若卡自带）；末尾接该角色此刻的 `当前状态：…`（有模板时）。
4. 视角：本场的默认视角。

**user**（按序拼接）：

1. 更早情节的摘要 + 索引（`memory.jsonl`）。
2. 最近 8 回合的原文（导演大纲与情节段落交替）。
3. 各参演角色的 `post_history_instructions`（若卡自带，按其语义放在历史之后）。
4. 本回合的导演大纲。

**优先级**：剧场契约 > `AGENT.md` > 卡 `system_prompt` > 卡 `description`/`personality`。冲突时更靠前者胜。

### 剧场契约

代码注入、导演不可编辑的最小系统指令，只包含：

1. 身份：你是这场戏的小说家，按导演的大纲写一段小说体情节。
2. 输出：一段连贯的小说正文，第二/第三人称按视角设定；不要标题、列表、元评论，不要问导演问题。
3. 边界：只写参演角色；不替角色做导演没有交代的决定；不剧透没发生的事；角色的人格与说话方式以各自的卡为准。
4. 谁开口由情节决定：不要机械地让每个角色轮流说一句。
5. 状态是处境：若演员表给出某人的当前状态，正文里不要直接报出条目名或数值，只写它在言行、神态上的表现。
6. 排版：自然段之间空一行；段首顶格，不加空格或缩进（缩进由界面统一给）；不用 Markdown 记号（`#`、`**`、`-`、`>`、反引号）。

### `messages.jsonl` 记录类型

每行一个 JSON 对象。正常回合只追加；删除与重新生成只改写最后一回合，编辑可以改写任意回合的 `narrative` 行（读全量 → 改 → 临时文件 + rename 原子写回）：

```json
{"role":"director","turn":3,"at":"...","text":"雨夜，阿箬翻沈砚的抽屉，沈砚撞见"}
{"role":"narrative","turn":3,"at":"...","text":"雨顺着檐角淌下来……","edited":true,"nextOptions":["……","……","……"]}
{"role":"system","at":"...","kind":"error","text":"上游 503，重试后仍失败"}
```

`interrupted`、`edited`、`nextOptions` 都是可选字段：缺省视为 false / 无选项。旧文件里的 `player`/`engine`/`tool` 记录不再产生；读取时忽略未知类型。

### `memory.jsonl` 记录类型

每行一条记忆，覆盖一段已不在最近 8 回合里的情节：

```json
{"id":"m0-3","turns":[0,3],"summary":"雨夜，沈砚与阿箬在旧宅对峙。","keywords":["旧宅","抽屉","钥匙"],"createdAt":"..."}
```

超过阈值时后端每 4 回合压缩一条（一次模型调用，不传思考强度）；已被记忆的回合不再进最近情节。v1 没有"按索引取回原文"的入口，摘要即全部。

### HTTP API

所有 `/api/sessions*` 与 `/api/characters*` 都带 `?workspace=<工作区绝对路径>`。

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| GET | `/api/workspaces` | 读工作区注册表 |
| POST | `/api/workspaces` | 打开已存在目录并设为当前 |
| POST | `/api/workspaces/pick` | 系统目录选择器 |
| DELETE | `/api/workspaces?path=` | 从最近列表移除 |
| GET | `/api/sessions?workspace=` | 列会话（不含消息正文） |
| POST | `/api/sessions?workspace=` | 开一场戏（cast/perspective/title） |
| GET | `/api/sessions/:id?workspace=` | 读会话 + 全量消息 + 状态（模板 / 当前值 / 最近 20 条变化） |
| PATCH | `/api/sessions/:id?workspace=` | 改标题 / 状态 / 模型 / 供应商 / 思考强度 |
| DELETE | `/api/sessions/:id?workspace=` | 删除会话文件夹 |
| POST | `/api/sessions/:id/turns?workspace=` | 提交大纲，返回 SSE |
| POST | `/api/sessions/:id/turns/regenerate?workspace=` | 重写最后一回合（复用已落盘大纲），返回 SSE |
| PATCH | `/api/sessions/:id/turns/:turn?workspace=` | 编辑某回合情节，body `{ text }` |
| DELETE | `/api/sessions/:id/turns/:turn?workspace=` | 删除最后一回合（只接受 `turn === meta.turn - 1`），状态随之回滚 |
| PATCH | `/api/sessions/:id/status/template?workspace=` | 整份替换状态模板，body `{ template }`；只接受参演角色的键 |
| PATCH | `/api/sessions/:id/status/value?workspace=` | 手改一个状态值，body `{ cardId, item, value }`；记一条 `manual` 记录 |
| POST | `/api/sessions/:id/status/apply-template?workspace=` | 给某个角色套一份模板（快照）；`templateId` 为空表示清空这个角色的状态项 |
| GET | `/api/sessions/:id/export?workspace=` | 导出 Markdown 小说（剧情之后附角色状态表） |
| GET | `/api/settings` | 读供应商配置（不回传 apiKey）与 default |
| PUT | `/api/settings` | 整体替换供应商配置与 default |
| POST | `/api/providers/:id/models` | 后端代请求 `/models` 拉候选模型 |

角色卡库 API 见上节。状态模板库（工作区级）：

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| GET | `/api/status-templates?workspace=` | 列模板（id / name / note / itemCount / updatedAt） |
| GET | `/api/status-templates/:id?workspace=` | 读一份模板 |
| POST | `/api/status-templates?workspace=` | 新建，body `{ template, overwrite? }`；同名 409，`overwrite` 才覆盖 |
| PATCH | `/api/status-templates/:id?workspace=` | 改 name / note / items；id 与文件名不变 |
| DELETE | `/api/status-templates/:id?workspace=` | 删除；已经套用它的戏不受影响（存的是快照） |
| POST | `/api/status-templates/suggest?workspace=` | AI 生成一组条目，body `{ prompt, cardId? }`，返回 `{ items }`（只有名称与说明） |

### 前端结构

- 三栏。左栏 280px：顶部「剧场 / 角色 / 模板」三视图切换 + 工作区选择；下方按视图列会话、角色卡或状态模板；底部设置。中栏：会话头（标题 + 模型选择器 + 落笔/导出）+ 消息流 + composer。右栏 320px：本场参演角色，每张卡一块——上半是名字 / 标签 / 设定摘要（点击打开角色卡），下半是它的状态区。
- 状态区：每行「条目名 —— 值 + 依据」；点值就地变输入框（Enter 保存、Esc 取消），纯数字的条目额外给 `−` / `+`（步长 1）；行尾 `×` 删条目（需确认）；底部「＋ 加状态」「选模板」，每角色 8 项上限，套过模板的显示「模板：毒医验伤」。AI 新增的条目标「新」，依据显示成小字并带回合号；生成进行中状态区只读。
- 「模板」页：中间是编辑器——模板名、说明、条目行（名称 + 这一项看什么）、「＋ 加一项」；下半是一块 AI 生成区（一句话 + 可选「参考某个角色」下拉）；底部「保存 / 删除」。左栏列全部模板，点一条切过去。
- 消息流条目：导演大纲（指令条）、情节段落（小说正文，正常行宽）、系统错误、中断标记。
- 回合操作：导演条右侧悬停显示「重新生成 / 编辑 / 删除」；重新生成与删除只对最后一回合出现（判定见「回合管理」），删除需确认。生成失败只留下大纲的那一回合没有情节，所以只有「重新生成 / 删除」，删除的确认文案也改为「删除这条没生成出正文的大纲」。编辑把该回合情节就地换成 textarea，Ctrl+Enter 保存、Esc 取消，保存后标「已编辑」。
- 后续剧情选项：最新回合情节下方展示 3 条候选，点击填入 composer 并聚焦输入框；旧回合的候选只读展示，不提供点击；落笔状态下不显示可点选项。
- 情节正文渲染：按空行分自然段，每段首行缩进 2em（两个汉字），行高 28px、段距 6px，整体紧凑；模型自带的段首空格先剥掉再缩进，避免缩两遍；相邻消息块间距 24px，流式输出与已落盘消息用同一套排版。
- 「角色」页：左/中为工坊对话，右侧卡片预览与卡库列表；可切换为纯卡库浏览。选中卡后可「编辑」弹出表单改 data 段（`extensions`、`character_book` 等保留）、「用 AI 修改」、以及导出为酒馆 V2 JSON（文件名取角色名，额外字段原样保留）。
- 状态：Zustand 单 store，按"会话列表 / 当前会话 / 卡库 / 设置"切片；SSE 事件 reducer 化。
- 流式：`delta` 累积到当前情节气泡；中断用 `AbortController` 断开 SSE。
- 角色缺失：消息流顶部出现一条常驻提示，列出缺失的卡 id，并给「重新导入」入口。

### 错误与边界

- 模型失败：写一条 `system/error`，界面底部给「重试」；失败的那条大纲留在会话里，同样可以重新生成或删除。
- 卡解析失败：导入接口返回具体原因（"缺少 name"、"不是 PNG"、"未识别的角色卡格式"）。
- 删除被引用的卡：先返回引用列表，确认后带 `force` 删除；相关会话显示"角色缺失"。
- 状态：改不存在的条目返回 404；模板里非参演角色的键静默丢弃；每角色超过 8 项时模板接口截断、AI 的新增提议丢弃；状态解析失败时本回合正文与选项照常，状态不更新。
- 套用模板：角色不在本场演员表里返回 400；模板不存在返回 404；空模板拒绝套用（400），`templateId` 为空串才是「清空这个角色」。
- 旧会话没有 `statusTemplate` / `status.jsonl`：按「没有状态」处理，不报错。
- 删除或重新生成非最后一回合：返回 400；编辑不存在的回合情节：返回 404。生成失败只留下大纲的那一回合没有情节，所以不能编辑（没有「编辑」入口），只能重新生成或删除。
- 编辑已进入记忆的回合：允许，响应带 `memoryStale: true`，界面提示"原文已进摘要，改动不会同步进旧摘要"。
- 生成中关闭页面：已落盘的情节保留（流式内容在 `done` 时落盘，中断时落已到达部分）。
- 旧格式会话（含 `player`/`engine` 记录或 `world.yaml`）：列表里不显示，磁盘原样保留。

## 测试决策

**什么算好测试**：只断言外部可观察行为——HTTP 响应、SSE 事件序列、磁盘最终内容；不断言内部函数调用、不断言 CSS 类名。

**测试接缝**：

1. **主接缝：后端 HTTP API。** 真实 Hono 实例 + 可编程假 LLM 驱动。覆盖：开戏（选角校验）、角色卡导入（PNG/JSON/坏文件）、工坊保存、回合 SSE 序列、`messages.jsonl` 落盘、记忆压缩触发、删除被引用卡、导出、供应商配置；删除最后一回合、重新生成最后一回合、编辑任意回合（含 `edited` 落盘）、选项生成与 `next_options` 事件、非最后一回合删除/重生成的 400；状态模板写入与投影、手改值、8 项上限、非参演角色的键丢弃、AI 更新与 `status_update` 事件、删除/重新生成时的回滚；模板库 CRUD、同名覆盖、套用与「改模板不动已开的戏」的快照隔离。
2. **辅助接缝：纯函数。** PNG `chara` chunk 解析、V2/V1 归一化、文件名清洗、prompt 组装顺序（快照测试锁死优先级，含状态注入）、`messages.jsonl` 的删回合/换文/写选项（内存数组上的纯操作）、`parseTurnExtras`（整体 JSON 坏 / 单字段坏两种降级）、`parseSuggestedItems`。
3. **前端不上自动化测试**（v1）：三栏、流式、工坊、状态面板属于快速变化区，人工验收；稳定后补一条 Playwright happy-path。

**测试的模块**：`character-card`（解析/归一化/文件名）、`card-store`（读写/覆盖/删除/引用）、`prompt-builder`、`turn-runner`（SSE 状态机）、`memory`、`providers`、`status`（模板归一化 / 变更流重放 / 回滚）、`status-templates`（文件 CRUD / id 清洗 / 快照套用）。

## 范围外

- 多用户、账号、登录、权限。
- 移动端布局。
- 云端同步、分享链接。
- 语音/图像生成、角色卡立绘。
- 世界书（`character_book`）注入、V3 `ccv3` chunk、第三方卡变体。
- 状态模板存进角色卡（模板是工作区级资产，不挂在某张卡上）。
- 一个角色套多份模板并合并（v1 每角色一份，想更全就改模板）。
- 状态值的类型系统：数值范围、枚举、增减量、越界处理。值一律是字符串。
- 回滚/快照：v1 不做，改坏了就改 `messages.jsonl` 或重开一场戏。
- 每个角色独立模型。
- 旁白/场记角色、`roll_check` 判定、结局触发、场景骨架（旧机制整体下线）。
- 角色卡的应用内表单编辑（磁盘 JSON 即编辑器）。

## 补充说明

- **格式稳定性**：`messages.jsonl`、`memory.jsonl`、`session.json`、角色卡 JSON 都是长期资产；新增字段必须可选，旧文件必须可读。
- **成本**：每回合正文一次调用，输入约等于 8 回合情节 + 摘要 + AGENT.md + 参演角色设定；N 个参演角色 ≈ N 份设定进 system，卡多了要克制。正文之后追加一次轻量调用生成 3 条后续剧情选项与角色状态更新（不带思考强度、输入只有最近一段剧情 + 当前状态清单），失败静默。模型与思考强度可随时切换。
- **隐私**：卡与戏只落本地磁盘；API key 存 `providers.json`（`gitignore`、0600），不写进会话文件夹、不进 `session.json`、不回传前端。
- **可观测**：后端在控制台打印每回合的 prompt 长度、耗时。
