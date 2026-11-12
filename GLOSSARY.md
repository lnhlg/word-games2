# word-games

一个偏向文字游戏的 agent 前端：界面借用 DSH 的形态（会话、消息流、工具调用卡片），里面跑的是一个叙事引擎，陪玩家玩互动小说。

## Language

**互动小说（Interactive Fiction）**：
以场景为单位推进、玩家通过行动或选项推动的纯文字游戏。
_Avoid_: 文字冒险、text adventure、MUD

**叙事引擎（Narrative Engine）**：
游戏中没有固定人格的 AI 角色，只负责生成场景、判定玩家行动的后果，不扮演某个具体人物。
_Avoid_: GM、主持人、DM、游戏主持人

**玩家（Player）**：
通过输入行动推动剧情的人，是叙事引擎唯一的对话方。
_Avoid_: 用户

**会话（Session）**：
一局游戏在前端里的载体；左栏的每一条就是一个会话，结束即归档。
_Avoid_: 聊天、对话记录

**回合（Turn）**：
玩家一次输入到引擎给出结果之间的完整单元；一个回合 = 一条玩家消息 + 若干引擎消息 + 工具调用。
_Avoid_: 轮次、step

**AGENT.md**：
会话文件夹里由用户自由编写的指令文件，作为引擎的补充指令被注入；代码不解析它的结构。存在同名模型文件（如 `DeepSeek-V4.1-Flash.md`）时优先于它。
_Avoid_: 系统提示词、prompt 文件、配置

**会话文件夹（Session Folder）**：
`sessions/<id>/` 下自包含的一局游戏：`session.json`、`AGENT.md`、`world.yaml`、`state.json`、`messages.jsonl`、`snapshots/`。
_Avoid_: 存档、数据库记录

**引擎契约（Engine Contract）**：
代码注入、用户不可编辑的最小系统指令：工具清单、每回合必须调用 `end_turn`、输出节奏。它不承载世界设定，也不承载风格。
_Avoid_: 系统提示词
