# Manta 的 Agent 执行层（0.5）

Manta 的主要 Agent 选项是 Codex 与 Claude Code；另保留可选的模型 API 兼容模式。它负责项目、可见主/子线程、消息总线、队列、工程上下文快照、权限桥、MBSE/Computer 工具与界面；单个 Agent 的推理和工具循环由运行时负责。`server/engine.mjs` 不再实现模型—工具往返循环。

## 当前运行时

| 配置类型 | 执行方式 | 持久化与公开事件 |
|---|---|---|
| `codex-app-server`（兼容旧 `codex-cli` 配置） | 本机 Codex app-server，保留原生编程工具，并注册 Manta 动态工具 | 原生线程与会话、文字增量、工具/审批事件、原生 steering 与取消 |
| `claude-agent` | 官方 Claude Agent SDK，原生编程工具 + 权限 hooks + 进程内 MCP | 原生会话与文字增量；追加要求时中断查询，再恢复同一会话 |
| OpenAI Chat / Responses、Anthropic API、Ollama、demo | 官方 OpenAI Agents SDK 的 Agent、Runner、tool；模型桥调用提供方 | 自定义持久 Session 保存 Runner 原生消息和工具历史；公开运行/工具事件，当前不是逐 token 流式 |

OpenAI Chat/Responses 使用官方 `openai` SDK，Anthropic API 使用官方 `@anthropic-ai/sdk`，Ollama 保留其接口适配。API 兼容模式由官方 Runner 决定何时调用模型和工具，Manta 只衔接用户轮，不在外面再套模型—工具循环。此模式没有实现或声称原生上下文压缩，长会话仍会受到模型上下文限制。Agents SDK tracing 已关闭，不额外将自定义模型数据上传至 OpenAI tracing 服务。

原生 Codex 复用正常 CLI 登录，应用不读取或提取 OAuth 令牌；自定义模型端点走 app-server 支持的 Responses 配置。Claude Agent 模式必须显式配置 API key，使用服务数据目录内的独立配置，不借用 claude.ai 登录或用户已有 Claude 设置。模型设置页可编辑名称、模型、base URL、环境变量名及密钥。API key 只存服务进程内存或来自服务端环境变量，不返回公开 bootstrap/list 配置；重启后需要重新填写内存密钥或继续使用环境变量。

## Codex 模型选择

聊天输入框把 Agent 连接和具体模型分开选择。本机 Codex 连接通过独立 app-server 查询进程完成 `initialize` / `initialized`，读取 `config/read` 中的有效默认模型，并分页调用 `model/list`（`includeHidden: false`）。查询不会创建原生线程、开始推理轮或写入全局配置；模型 ID 和显示名称来自原生返回值，不在界面中固定一组型号。默认值优先采用有效配置，再采用目录的 `isDefault`。接口和分页字段依据 [OpenAI Docs 的 app-server 模型目录说明](https://learn.chatgpt.com/docs/app-server#models)。

目录只说明运行时提供了哪些候选项，不保证当前账号、工作区或端点有使用权限；在部分提供方配置下，返回的是客户端内置目录。目录读取成功不能等同模型调用成功，实际访问能力以该模型的推理结果为准。[官方说明](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

配置自定义 Responses 端点或 API Key 时，Manta 不把本机登录的目录当作该连接的模型清单，改为填写该连接支持的模型 ID。读取本机目录失败时也保留手动 ID 输入与重试。手动填写的 ID 不代表已通过兼容性或访问验证。

每个线程将 Codex 选择保存到 `modelPreferences[providerId]`，服务重启后保留。主对话、子线程及同一线程中的不同连接各自独立，不改写提供方的全局 `model` 配置。创建一轮时，将明确选择、线程偏好或提供方默认解析为 `run.model` 快照；没有具体 ID 时保存 `null`，交给原生默认值。排队之后修改全局配置、选择器或偏好不会改变这一轮的快照；运行中切换模型仅对下一轮生效。

同连接的新子任务继承来源运行的具体模型快照，并保存为子线程偏好，后续可独立修改。改用其他连接的子任务使用该连接的默认或线程偏好。自动汇总读取主线程当前偏好，不沿用返回结果的 worker 模型。

具体 Codex 模型 ID 之间切换时，继续恢复同一原生线程，并在 `thread/resume` 和 `turn/start` 传入本轮 ID；模型选择本身不再使原生会话配置签名变化。兼容的旧签名可以迁移，已有公开对话和原生历史继续保留。清空选择会恢复提供方默认；若提供方也未指定模型、而旧会话已使用具体 ID，则建立新原生会话并迁移公开历史，以免清空后继续继承旧 ID。原生每轮覆盖的语义见 [app-server 线程与轮说明](https://learn.chatgpt.com/docs/app-server#turns)。

`run.model` 记录本轮选定值。原生 `thread/start` / `thread/resume` 响应报告模型时，另外保存到 `run.resolvedModel` 和原生会话元数据；这是运行时会话配置的声明，不能据此声称该模型已成功推理或证明后端实际路由。未返回声明时不推测一个实际型号。

## 消息、会话与恢复

1. 用户消息写入所选线程，创建一轮 Manta 运行，固定所选模型、权限、预算与排队时间。
2. 获得执行位置后，生成项目指令、共享记忆、当前工程模型、资料索引、工具能力和任务结果快照。资料全文仍需按需读取，不是无限上下文。
3. 依据线程、提供方与配置签名创建或恢复运行时会话。首次原生会话只迁移已有公开用户/助手历史；恢复时不重放这些历史，只提交新输入和当前工程快照。API 模式同样以持久 Session 保存自身原生历史。
4. 运行时执行原生循环。Manta 接收公开文字、工具、审批及状态事件；应用工具执行时仍检查项目、角色、版本和权限。界面不显示或伪造内部思考。
5. 记录最终回复、运行时会话 ID、实际结果和起止时间。`Worked for …` 可展开查看公开过程，显示从本轮开始至结束的经过时间，包含等待审批和子任务的时间，不包含排队时间。等待时显示「本轮已用」，不把它描述为模型持续思考；执行预算与此墙钟时间分开计算。

线程记录保存当前运行时会话及历史会话 ID。base URL、运行时、项目目录或工具描述/定义变化会使配置签名变化，建立新会话并把旧 ID 归档审计。Codex 的具体模型 ID 通过原生轮覆盖，不触发会话替换；其他运行时仍将提供方模型配置纳入签名。切换提供方使用其对应会话。服务重启把未完成 Manta 运行标为中断；新消息可以恢复已有运行时会话，不会宣称恢复了已取消工具的执行结果。取消、失败或结果未知均不能当成成功证据。

本次增加任务工具契约后，已有 Codex 原生线程需要迁移一次：旧会话 ID 归档，新会话注册完整工具，并迁移公开用户／助手历史。原有聊天和产物保留，但不声称新工具会自动出现在旧原生会话里，也不声称旧会话的内部工具历史被完整迁移。工具契约不再变化的后续轮继续复用已建立的原生会话。

运行中补充要求的交付方式有差异：Codex 调用原生 steering；Claude 通过 interrupt/resume 交付；API 兼容模式返回 `queued-next-turn`，待当前官方 Runner 用户轮完成，再用同一 Session 开始补充轮。UI 保留运行时接受/排队交付状态。补充轮仍属于当前 Manta 运行，不能借补充消息改变这一轮固定权限或 Codex 模型快照；界面新选的模型为下一轮偏好。

## 主线程、任务分工与结果交接

Coordinator 是持久项目主对话，在其中负责目标、分工、依赖和最终整合；一层并列 thread 保存独立任务及其 Agent 会话。用户可直接与任一 thread 交流，thread 不能再创建下级。一次 Run 是线程中的一轮执行。主、子线程仍分别使用 Codex app-server、Claude Agent SDK 或官方 Runner 的原生模型／工具循环；Manta 新增的是任务所有权、等待条件、结果收据与审阅记录，不在运行时外重建推理循环。

### 分工与所有权

主 Agent 通过 `get_task_assignments` 读取项目任务登记，再用 `start_thread`／`delegate_task` 指定稳定的 `taskKey`、工作 `scope`、交付物、验收标准和必要的 `ownedPaths`。创建任务立即返回，worker 排队执行。活动任务使用相同 `taskKey` 时返回已有任务，防止同一项工作重复委派；活动任务的独占写入范围有重叠时拒绝新的委派。主 Agent 应继续做未委派的独立工作，不能重复调查已委派范围。任务失败或需要修订时，使用 `steer_thread` 给原线程明确补充要求，再等待其新一轮结果。

所有线程共用选定项目文件夹，不自动创建 Git 分支或仓库副本。`ownedPaths` 表达项目内相对文件或目录的独占写入范围；Manta 的 `write_file` 拦截其他线程对活动任务独占路径的写入。它不是完整的路径锁：原生 shell、patch 和其他原生编辑入口仍依靠 Codex／Claude 的工作区权限策略及分工指令，不能据此声称所有原生文件修改都受到任务级互斥保护。任务通常应写入 `threads/<id>/` 等独立目录，主线程复核后再合入共享模型。

任务角色和数量按工程需要决定，没有固定三个 Agent。Codex 的内部 `multi_agent` 和 Claude 的原生 `Agent`／`Task` 派生仍禁用，任务统一经过 Manta 可见线程总线；每个 worker 有自己的真实运行时会话、消息与产物。

### 等待与原生恢复

当下一项判断依赖子任务证据时，Agent 调用 `wait_threads`，指定任务及 `all`／`any` 条件；省略任务列表时等待自身已委派的任务。等待固定到调用时的具体任务 Run；Coordinator 只能等待自己已委派的直属 thread，不能等待自己或形成循环依赖。Manta 保持这一次原生工具调用为 pending，不靠 shell sleep、重复查询或不断发起模型轮询等待结果。

等待期间暂停本轮执行预算，Coordinator 释放执行槽，使已委派的平级 thread 可以推进。thread 不能继续创建下级 thread，跨线程依赖和后续分派统一由 Coordinator 管理。达到条件后，原生 pending call 返回对应 Run 的真实状态、摘要、产物引用和验收条件，同一轮原生工具循环继续执行并进入复核阶段。失败、取消和中断也能结束等待，但不能当成成功。超时返回仍未完成的依赖；用户补充消息可释放等待并由原生 steering／interrupt-resume 交付；取消会中断本轮。服务重启后，未完成运行仍按中断处理，不能声称恢复了进程中已丢失的 pending 工具调用。

### 证据复核与汇总

`wait_threads` 返回结果后，Agent 应实际读取证据、对照验收标准，并调用 `review_task_results`，记录准确的 `threadId`／`runId`、发现、证据引用和以下判断之一：

| 判断 | 含义 |
|---|---|
| `accepted` | 已检查的证据支持该任务结论；必须引用项目中真实存在的 artifact ID 或成功的 `tool.completed` event ID |
| `needs_work` | 已发现具体缺口，需要沿原线程修订；记录发现，不把重做包装为独立任务 |
| `blocked` | 证据或执行条件不足，保留阻塞原因和未验证范围 |

失败、取消、中断或已被新一轮取代的任务结果不能被接受。仅凭 worker 自述「已完成」不能通过复核。收到结果但尚未接受时，Manta 拒绝通过 `update_model` 合入这些结论；有记录的 Agent 审阅仍不等于物理试验、独立认证或工程正确性的自动证明。已完成子线程无需用户手工标记或回传，仍可继续聊天；新运行重新打开任务，按最近一轮实际结果更新状态。

主线程正在 `wait_threads` 时，结果直接交还原生循环，不另开一个并行主 Agent。若主线程已经结束，结果回传主对话后，自动汇总等待项目中活动 worker 全部结束，将待处理结果合成一批；它复用主线程运行时检查证据、记录复核并汇总，不能继续派生或指导新的自动任务链。`maxAutoResumes: 0` 禁用此自动唤醒，正值启用，并非整个项目一生最多执行两次；每轮汇总仍受自动执行时间及轮数预算限制。同一批结果只自动尝试一次，失败或取消后标记为 `blocked`，避免失败重试循环；未来新结果可以触发新一批唤醒。已处理的结果不重复自动回传。

### 界面状态

`run.status` 保留排队、运行、审批、完成和失败等真实生命周期；运行中的 `executionPhase` 单独表达执行、等待任务、复核和汇总。界面据此显示：

| 显示状态 | 依据 |
|---|---|
| 执行中 | 正在执行本轮原生工具／模型循环，未登记等待 |
| 等待子任务 | 引擎已登记真实 `wait_threads` 依赖；展示任务名称及各自当前状态 |
| 等待批准 | 存在本轮审批请求；优先显示审批状态，不显示持续思考动画 |
| 复核结果 | 已交接任务结果，正在对照证据和验收条件 |
| 汇总结果 | 已记录本批结果的复核判断，正在整合结论和剩余问题 |

子 Agent 执行并不自动意味着 Coordinator 正在等待：它也可能在做尚未委派的工作。Coordinator 主聊天保持项目整体上下文，行内 thread 引用和右侧 Overview 提供状态与入口；打开 thread 后，具体过程留在该 thread 中。工具细节默认折叠，关键结论和产物按需查看，保留返回来源聊天和继续指导的路径。

## 权限与隔离

全局设置的默认权限用于新项目及尚未选择模式的对话，不覆盖已有明确选择或正在运行的权限。每轮权限固定，子任务继承来源运行权限，不能自行提高；运行中修改模式只对下一轮生效。设置和审批决定不作为 Agent 可自行批准的工具。

| 执行入口 | 实际边界 |
|---|---|
| Manta 文件、模型、记忆、仿真与浏览器工具 | 项目/角色/版本与路径检查；Manual 对应用变更审批，Auto 允许普通项目内操作及操作系统沙箱内命令；原生桌面和远端 Computer 仍逐项审批 |
| Manta 命令工具 | Auto 在受支持的操作系统沙箱内直接运行，Manual 需显式审批；保持项目写入范围、宿主目录与网络限制，不降级为无沙箱执行 |
| Codex 原生编程工具 | Manual 映射 `readOnly`，Auto 映射 `workspaceWrite`；统一使用 `on-request`。普通沙箱内命令自动执行，原生真正发出的审批请求转给用户；网络禁用，额外原生权限扩张仍拒绝 |
| Claude 原生编程工具 | Auto 映射 SDK 原生 `auto`，Manual 映射 `default`。hooks 保留路径、链接与 MCP 来源检查；Auto 普通调用交由 SDK 权限系统和分类器判断，未决请求进入用户审批；不使用 `bypassPermissions` |

应用文件工具的路径检查不能保证 Codex 原生读取范围也被限制在同一目录；实际读取范围取决于 Codex 的沙箱和审批策略。Claude 的原生分类器与文件 hooks 不等于操作系统沙箱，不能把 Auto 描述为进程级文件系统隔离。SDK 报告实际权限模式后，Manta 记录该模式；Auto 不可用或模式未确认时在聊天输入框下显示说明，并保留未决操作的人工审批。自定义端点或模型不保证支持 Claude 原生 Auto。

Codex 的 Auto 预设与 Auto-review 是两个概念：本实现使用项目写入沙箱和 `on-request`，审批 reviewer 仍为用户，没有启用自动审批 reviewer。两种原生运行时都没有启用 Full Access 或跳过权限检查。正在运行的一轮保留其原有策略，不追溯批准已有请求。

项目资料、网页、附件和其他 Agent 消息都是不可信证据，不能授予权限。原生运行时的外部集成与内部派生受到限制，工程工具仍走 Manta 权限桥。Computer 的项目路由、远端域名和原生桌面授权是额外边界，不由模型配置或会话恢复绕过。

## 验证范围与复现

公开源码包含运行时协议、原生参数、会话恢复、模型选择、权限和协调工具等测试。先按[安装说明](installation.md)准备应用依赖，再运行 `npm run smoke` 和 `npm test`。缺少显式配置的外部参考工程时，对应实测项应报告跳过，不能当作工程验证通过。

本地协议 fixture 或模拟 HTTP 端点可验证适配、工具路由和审批行为，不能证明某个付费模型、第三方网关或所有操作系统都已通过真实 Agent 运行。真实模型推理需用户配置兼容连接并实际测试。历史开发日志与私有会话不随源码分发；网站保留的有限软件集成证据见[演示指南](demo.md)，其范围不等于全部运行时或整星验收。

测试定义、应用冒烟、原生 Agent 推理和专业工具执行属于不同证据。题库交付完整性检查、热控制数值结果、NOS3 问题复现、硬件有效性与商业 MBSE 工具操作也不能互相替代。

## 官方参考

已实现的运行时接入依据 [Codex app-server](https://learn.chatgpt.com/docs/app-server)、[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) 和 [OpenAI 平台集成说明](https://developers.openai.com/blog/codex-as-a-platform)。Auto 映射依据 [Codex 权限策略](https://learn.chatgpt.com/docs/agent-approvals-security)、[Codex Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review)、[Claude 权限模式](https://code.claude.com/docs/en/permission-modes) 与 [Claude SDK 权限配置](https://code.claude.com/docs/en/agent-sdk/permissions)。官方产品提供的能力不自动等于 Manta 已开启或验收的全部能力；本页以实际适配器、权限策略与记录为准。


## 项目工程连接与等待作业

工程工具统一经过 Manta 桥，原生 Agent 和可选 API 模式继续使用各自运行时的工具循环，没有为接入 MCP 重建模型循环。`list_external_tools` 发现已启用连接的真实工具 schema，`call_external_tool` 经过项目策略与审批后调用官方 MCP SDK。连接配置保存在服务数据目录的项目文件中，不继承或修改用户全局 MCP 配置。配置工具不开放给 Agent。未分类工具在 Auto 下仍询问；用户明确配置的读写/执行策略按本轮权限生效。

`import_system_model` 在真实 SysML 内核校验后原子提交；`prepare_nos3_model` 建立来源清晰的组件接口模型。`validate_system_model`、`query_system_model`、`verify_system_model` 与 `export_system_model` 操作真实文本模型。原有 `get_model/update_model` 仍是追溯索引，不冒充 SysML。工具链固定版本，依赖只位于应用隔离目录，内核在禁止网络和写入的受限子进程中执行。

`submit_nos3_job` 异步提交作业。模型绑定作业必须携带真实校验通过的精确哈希，执行前再次检查并保存模型快照及校验收据。`wait_nos3_job` 保持同一次原生工具调用为 pending，暂停本轮执行预算，界面显示「等待工程作业」。作业结束后进入复核并返回结果；用户取消会中断等待及本轮提交的作业。没有配置完整执行环境时保留 blocked，不替换为成功的组件结果。

`bind_nos3_results` 从受保护的作业记录取得结果路径与哈希，拒绝被编辑的测量文件以及不匹配的模型版本，再把实际测量写回 SysML 并求值约束。失败值仍可得到 violated；超出该作业实际执行与观测范围的星敏输入路径、完整联合仿真或硬件要求继续保持待验证。所有语言检查、组件计算、完整集成、硬件验证都是不同的证据范围。[模型后端](model-backend.md)、[NOS3 执行器](nos3-runner.md)、[外部 MCP](external-mcp.md)。
