# datasets

初版：13 个真实上游 issue，覆盖 4 个项目。**来源已核对，全部尚未复现。** 数据集说明见 `../docs/dataset-card.md`。

## 导入

应用只读取 `real-issues.v1.json` 的公开任务；不自动克隆仓库、不执行上游命令。导入时可建立工程项目，添加中文任务、来源与交付要求。`evaluator/` 不得经公开 API、知识检索或 agent 工具暴露。

## 字段

| 字段 | 含义 |
| --- | --- |
| `version` / `createdAt` | 本数据集版本与创建日期，不是上游发布时间 |
| `id` / `project` / `repository` / `issueUrl` | 稳定任务 ID、项目及官方来源 |
| `status` | 核对时的上游 issue 状态；closed 不代表本地复现或修复通过 |
| `title` / `summary` / `publicPrompt` | 中文任务描述，不包含历史解法 |
| `category` / `difficulty` / `tags` / `taskType` | 编者给出的分类和估计 |
| `inputs` | 正式执行需要提供的资料；列出不等于已经捆绑 |
| `deliverables` | 要求提交的文件和证据 |
| `acceptanceCriteria` / `gates` | 编者设计的独立验收计划，尚未实现或运行 |
| `evidenceLevel` | source-verified：只表示官方来源核对 |
| `executionStatus` | not-reproduced：本地未复现 |
| `baselineCommit` | null：基线未锁定；不能用于正式比较成绩 |
| `hardwareRequired` / `hardwareScope` | 原始症状/选定验收层的硬件需要及软件替身边界 |
| `environment` | 候选执行环境，版本和依赖仍待冻结 |
| `upstreamFacts` | 可公开的来源事实；报告者观察仍是报告者观察 |
| `curatorAdditions` | 编者新增需求、边界工况、模型与交付规则 |
| `sources` / `sourceNotes` / `checkedOn` | 链接及可复用的来源核对元数据 |
| `limitations` | 答案泄漏、环境、政策、模型适用性等实际限制 |

`evaluator/answers.v1.json` 的 `answers[]` 以 taskId 关联，仅保存历史线索；不含已经验证的 golden patch。所有结果状态必须由实际运行产生，不能从 task.status 推导。

## 结构检查

在项目根目录执行 `node datasets/validate.mjs`。该命令只检查 JSON、数量、项目数、字段、ID 和状态标签。通过并不表示运行过原始工程。

## 建议先试

- `nos3-351`：跨坐标、传感器、通信与 ADCS 的历史问题，适合系统接口与追溯；需先锁定修复前子模块。
- `ardupilot-33961`：范围较小的诊断信息问题，适合先建立 fail-to-pass 题包。
- `crazyflie-1714`：适合主机字节向量重放与配置矩阵；来源链接可能透露解法。
- `nos3-800`：开放性能调查，无唯一正确补丁，不能按 golden patch 评分。
