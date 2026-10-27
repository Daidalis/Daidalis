# 本地隔离 Linux 工程环境

Manta 在 Apple Silicon macOS 上通过 Apple Virtualization.framework 管理 Ubuntu 22.04 ARM64 虚拟机。当前配置为 4 vCPU、4 GiB RAM、10 GiB 稀疏磁盘，宿主剩余空间低于 5 GiB 时停止扩张。虚拟机镜像、源码、收据、SSH 凭据和辅助程序留在单独的 Manta 工程目录；不安装 Homebrew、Docker、全局 Python/Node，不修改 shell、全局 SSH、Codex 或 Claude 配置，不创建系统自启动服务。

安装者在 Manta 私有数据目录 `nos3/local-vm.json` 配置一个固定 `vmRoot`。模型和对话不能提交任意宿主路径、安装命令、连接令牌或 HTTP 地址来替换它。设置 → 工具连接显示准备、连接和停止状态。

Agent 调用 `prepare_nos3_environment`，由固定流程自动准备和启动虚拟机、等待真实 SSH/cloud-init 就绪、核验或首次构建原生环境、准备 Worker、建立仅绑定宿主回环的 SSH 隧道，并检查鉴权后的实际能力。Linux 依赖只在专用虚拟机中安装。首次使用官方 Ubuntu 镜像时校验完整 SHA256；已有虚拟磁盘启动时仅核对启动配置、签名辅助程序、内核和 initrd，不重复读取创建期压缩包。

NOS3、cFE/OSAL/PSP、NOSengine、42 和星敏模拟器在 Linux 内原生执行。选定任务包含 CI/TO/SCH、星敏飞行应用、ADCS 与 GNC；不启动所有默认设备或地面图形软件。已用实际联合运行验证这条完整选定链，并非单一数学函数演示。

典型流程：

1. `inspect_nos3` 确认源码版本与运行环境。
2. `prepare_nos3_environment` 自动准备；重复或并行调用合并，不重复安装。
3. `prepare_nos3_model` 使用 `scope: "integration"`，经真实 SysML 后端验收后取得内容哈希。
4. `submit_nos3_job` 使用 `scope: "integration"`，绑定 `modelFile` 和 `expectedModelHash`；提交后立即返回。
5. `wait_nos3_job` 等待同一作业，准备和等待均暂停 Agent 的执行预算。继续使用 Codex app-server 或 Claude Agent SDK 的同一个原生会话。
6. 复核实际结果和证据，用 `bind_nos3_results` 回写原模型版本，再执行 `verify_system_model`。静态约束结果不代表 SysML 行为被执行。

固定原生验收使用独立矩阵计算，实际启动 42、NOSengine、星敏模拟器、cFS 和时间驱动器。五场景分别为原始缺陷复现、修复、负四元数、无效测量、2° 测量偏差反证。测量偏差场景保持 42 动力学真值不变，检查估计输出跟随传感器输入。每层保留观测、实际 UART、SB 与 UDP 证据，以及源码、二进制和物理资产的 SHA256。图形资源和文档未参与无头仿真，未在每个作业中重复读取；所有实际使用的代码和 220 个私有物理资产单独校验。

测试修改只应用于虚拟机私有副本。最小生产修复与观测/注入补丁分开记录。成功、失败或取消后都尝试恢复修复版本、正常符号和零偏差；恢复失败会使验收失败。取消发给整个仿真进程组，并保留 15 秒有界清理时间。已实际验证取消后全部七个运行进程退出。

结果可从 `GET /api/projects/:id/nos3/jobs/:jobId/result` 读取。公共接口不返回 Worker token、SSH 密钥或隧道地址。结果文件另存保护哈希，修改过的测量、错误模型版本和未实际执行的结果不能回写为验证通过。失败检查同样保留，不因进程正常退出就转换成通过。

完整原始日志和场景数据留在 Linux 的 `/srv/manta/worker/jobs/:jobId/native` 与 `/srv/manta/runs`；紧凑但实际的验证数据回传项目 `engineering/nos3/:jobId`。物理传感器/HIL、硬实时资格、所有设备的完整任务覆盖、陈旧测量超时仍须单独验证。

关闭环境可使用设置里的“停止虚拟机”，或项目 API `POST /nos3/environment/stop`。存在运行作业时会拒绝停止。后续作业由已配置的 managed-local 路径自动再次准备，不要求用户手动开终端。
