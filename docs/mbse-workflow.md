# 从工程目标开始的 Manta 工作流

更新：2026-10-23。最高目标仍是先完整 STF、再 Apollo。任务树、计划、一个数字模型或一次软件联试通过，都不是整个航天器完成。

## 用户如何开始和介入

从零任务选择空白项目文件夹，在主聊天描述想开发的系统及任务要求即可，例如：

> 开发一颗执行 STF 科学任务的卫星：在美国本土、阿拉斯加和夏威夷上空采集科学数据，只在美国附近采集；自主处理故障；科学采集至少持续三个月；全部采集的科学数据在 24 小时内送达地面；航天器健康优先于采集。请自行核对公开资料，开展真实工程开发；缺失的指标和未验证事项明确保留。

用户不需要知道工具函数名、模型哈希、manifest 字段、作业 ID 或 shell 命令。Agent 自己盘点资料与现状，识别权威来源和版本，维护工程计划，调用可用的真实工具，保留失败和缺口。已有模型、源码与证据按接管或变更处理，不能伪装成从零新开发；空项目则从公开来源研究、任务/场景和需求候选开始。现有 STF 候选 SysML 模型仅供从零验收方参考，不预装给 Agent；详见 `planning/stf-requirements-first-evaluation.md`。

类似“开发特斯拉 Model 3”的目标也应触发研究与工程展开，但公开资料不能自动提供 OEM 私有设计、制造参数或认证结果。Agent 应区分“复现原始产品”与“根据公开目标设计新方案”，明确资料与实物制造、试验、法规接受等缺口，并继续能开展的工程。数字原型不得称已制造、认证或交付的汽车。

用户随时可以打开一个子线程直接交流，例如“这个电源方案的食期裕量太小，比较另一个方案”。这是该任务的直接用户输入；无需返回主聊天。任务需将会影响共享接口、预算或范围的决定交回父任务。已完成线程可继续，不因一次交付失去可用性。

## 三种关系分开表示

| 对象 | 回答的问题 | 状态含义 |
|---|---|---|
| 任务树 | 谁负责什么，交给了哪个线程，正在等什么 | 真实执行、等待子任务/作业、批准、复核等运行状态 |
| 工程工作图 | 还需要哪些工程工作，其设计与验证如何对应 | 工作的候选、准备、活动、等待、阻塞、交付、复核；不是系统批准 |
| 工程对象与证据账本 | 哪条需求、接口、模型和结果来自哪里，对哪个配置适用 | 来源、修订、配置、变更影响、实际证据与待决事项 |

V 模型用于设计层级和验证/确认的对应关系，不是只允许向下走的阶段向导。任务/运行分析、需求、功能与架构、详细设计、实现、集成、验证/确认、运行维护之间可以递归、并行和返工。验证方法与接受标准从早期提出；不同成熟度的工作可以同时存在。参见 [NASA 系统工程](https://www.nasa.gov/reference/2-0-fundamentals-of-systems-engineering/)。

## 主聊天与任务线程的协议

Coordinator 维护目标、工作图、跨域接口、决定及结果合入。其下一层并列 thread 各承担一项有边界、有输出和复核标准的持续任务，thread 不再派生 thread。每个线程继续使用 Codex app-server 或 Claude Agent SDK 的原生单 Agent 会话；Manta 提供可见、跨提供方的项目协作与证据交接，而不是另写模型推理循环。

1. 提出目标后，负责人先看已有工程记录、计划和任务登记，避免重开同样的工作。
2. 委派时记录稳定 taskKey、scope、deliverables、acceptanceCriteria；必要时限定独占输出路径。线程标题使用工程任务名。
3. 主聊天里的具体跟进可以转给已有线程，保留原用户消息身份，并显示“交给哪个任务/为什么”的回执。跨领域问题仍由项目负责人组织；用户明确说留在主聊天时应尊重。
4. Coordinator 只等自己所需的 thread 依赖。等待由原生工具调用暂停完成，不靠 shell sleep、轮询或重复调查。其他无关工作可以继续。
5. thread 向 Coordinator 交付；Coordinator 查看实际产物/配置/工具输出，对照委派要求记下接受、返工或受阻的复核结果，再整合给用户。任务声称完成不是通过证据。
6. 结果返回后继续当前工程目标，需要时指导返工或安排后续工作。运行终止、用户取消与预算边界仍有效，不能无上限自动循环。

交互参考：[Claude Projects](https://claude.com/resources/articles/projects-redesigned)允许在主聊天监控和指导、进入单个线程处理细节，并把请求路由到新建或已有工作；[Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)把独立工作的活动和摘要带回主聊天，减少原始日志占用。Manta 的工程计划与要求/证据管理是本项目增加的领域层，不是声称复刻厂商未公开的调度实现。

## 用户看得到什么

主聊天默认显示当前行动、任务去向、实际正在运行的专业作业、明确的等待原因、关键发现/失败、待决定事项和复核后的交付摘要。模型内部思维链不显示，也不生成假的“思考过程”。完整工具参数、文件搜索、重复进展与原始日志在需要时展开。

工具随工作出现，例如“OpenModelica · 食期能量分析 · 求解中”。完成后，同一入口可打开模型、曲线、判据、输入配置和原始输出。聊天中的 Markdown 报告和原生模型/结果链接在 Manta 右侧打开，保留持续编辑、参数修改和图表查看能力。资产仍从 Library 等项目入口可发现，不强迫翻历史聊天。

全部工具的连接、许可与 runner 状态属于能力管理。普通工程聊天无需先浏览一个无关工具目录。以当次目录探测和实际回执确定能否用；建议、检测到安装、接口已连接、执行完成和验证范围分别记录。

## 持久工程计划接口

`server/engineering-plan.mjs` 将计划保存在 Manta 项目存储的 `engineeringPlans` 集合中。它引用工程对象和任务登记，不复制完整需求数据库。`server/engineering-entry-guidance.mjs` 给两种原生运行时同一套目标驱动行为建议；真实路由、等待和复核仍通过工具执行。

工具：

- `get_engineering_plan`：读取计划、版本、已有线程的真实执行状态及未复核的依赖。
- `update_engineering_plan`：项目负责人提交整个有界计划；`expectedRevision=0` 创建，之后使用读出的 revision 防止覆盖并发编辑。

HTTP：`GET/POST /api/projects/:id/engineering-plan`。POST 使用同一版本检查。示意输入如下，不是要求用户编写的 prompt：

```json
{
  "expectedRevision": 0,
  "goal": "开发一颗满足科学采集、健康优先和 24 小时数据交付要求的 STF 卫星",
  "sources": ["sources/NASA-STF.md"],
  "openQuestions": ["科学产品定义 TBD"],
  "items": [
    {
      "id": "mission",
      "title": "任务与运行场景",
      "stage": "mission",
      "status": "active",
      "verification": {
        "method": "任务场景评审",
        "acceptanceCriteria": ["运行场景和任务需求有可追溯来源"]
      }
    },
    {
      "id": "eps",
      "title": "电源设计与能量预算",
      "parentId": "mission",
      "dependsOn": ["mission"],
      "stage": "design",
      "status": "waiting",
      "taskKey": "eps",
      "modelPaths": ["models/EPS.mo"],
      "deliverables": ["功耗模型、预算及已执行场景结果"]
    }
  ]
}
```

每个 item 可关联已存在的 threadId/taskKey、工程 recordIds、artifactIds、原生 modelPaths，以及 verification 的方法、接受条件、requirementIds、evidenceIds。记录/产物/证据需属于本项目；路径是项目相对导航引用，不证明文件已产生。需求、证据缺失时先保留计划和 TBD，不编造 ID。

层级与依赖分别检查无环和无悬空引用。返工通过修改工作修订、重开任务和更新证据适用性表达，不能用循环前提让执行死锁。计划最多 120 个工作节点，整个输入有大小限制。

阶段 `stage`：mission、requirements、functions、architecture、design、implementation、integration、verification、validation、operations、crosscutting。它们用于对应和呈现，不强制依次完成。

工作状态 `status`：proposed、ready、active、waiting、blocked、delivered、reviewed。`reviewed` 需有 findings 和真实的已记录证据引用，仅表示工作产物经复核；计划 maturity 始终是 candidate。不存在通过本工具授予工程 approved/verified 或放行的路径。实物、HIL、环境、寿命等仍按适用性和有效证据记录，不因软件交付而关闭。

## 专业执行与边界

当前已接入的首批原生后端包括 SysML 语义检查、OpenModelica、ngspice、OpenSCAD，以及选定的 NOS3/cFS/42/EPS/LC/SC 联试；确切版本和项目可用性以 `professional_catalog`、`engineering_catalog`、工程连接和当次回执为准。数字工具接通不意味着完整 STF 所需工具已全部完成，也不意味着 Capella、Cameo、MATLAB/Simulink、FEM、RF、PCB 或硬件平台已自动可用。

实际原生编译/数值依赖继续在隔离 Linux VM/runner 执行，项目源码与大产物位于 NAS。不改本机全局配置，不从 NAS 自动加载本机数值扩展。工具选型、缺依赖时的独立准备和替代分析边界见 `server/engineering-guidance.mjs`。

## 验收方式

产品验收必须从自然工程目标开始，保留实际发送的原始用户消息、线程/路由/等待/交接、计划修订、原生工具执行、产物和失败。不能由开发者给 Agent 写工具调用脚本、预设成功结果或拿旧作业冒充新执行。

2026-10-23 的 M3 资料包验收曾在仅含公开来源的项目中提出“基于这些资料开发 STF”，属于历史增量测试。最终从零验收已按 D015 改为在普通空白项目中由用户描述 STF 任务要求，Agent 自行调研、形成完整目标下的工作图，推进有依据且实际执行的工程工作，并交付可打开的原生模型和结果；评测方持有现有候选 SysML 设计，不预置给 Agent。其余适用工作继续明确可见。目标到工作与证据的链路通过不自动宣称完整 STF 已开发和接受。最终整机要求仍由项目已确认的目标、完整工程工作图和有效工程证据决定；公开产品方向见 [roadmap](ROADMAP.md)。
