# Daidalis 工作台本机验收记录（2026-11-11）

## 范围和部署

- 当前地址：`http://127.0.0.1:4320`（仅回环发布）。
- 验证容器：`daidalis-workbench-validation`，非 root、只读根文件系统、全部 capabilities 去除、无 Docker socket。
- 模式：**shared-container**；没有把它标记成 rootless 隔离执行。
- 本地构建镜像：`daidalis-workbench:validation`。构建文件保存在被忽略的 `deploy/local/validation.Dockerfile`。
- 发布 Dockerfile 的冷构建未通过：Debian/OpenModelica 下载问题已处理并成功构建 native tools 层，但 PyPI/files.pythonhosted.org 持续超时。验证镜像复用已探测、版本固定的本地 `manta-sysml-fmi:test` 的 `/opt/opensysml`，不声称发布冷构建成功。
- 验证镜像包含 OpenModelica 1.27.1、ngspice 39、OpenSCAD、Chromium、OpenSysML 0.12.1 和 FMPy 0.3.32；NASA 42/NOS3 任务未纳入此次部署验收。

## 实测结果

1. Node 22 全量回归：**757 项，742 通过，15 条件跳过，0 失败**。跳过项涉及 macOS OS sandbox、NASA 42、真实 NOS3 和未配置 STF 模板资产等，不视作已验证。
2. 本机真实 FMI Python 测试：4 项通过，包含显式实验时间覆盖和 analysis/trajectory 一致性。
3. 原生 FMI worker：真实 FMU 在离线、非 root、只读根文件系统的独立容器中通过 `worker.main → execute_child → OpenSysML/FMPy` 执行；得到 501 个采样，analysis 断言通过、trajectoryMatchesVerdict=true、源模型与 FMU 哈希均有回执。**此项不是 rootless broker 端到端验证。**
4. 真实浏览器验收：8 条流程通过，页面错误列表为空：
   - 新建绑定目录的项目，保留聊天草稿；
   - Library 进入原生模型工作台；
   - 编辑、保存、切换并重新打开模型；
   - 实际 OpenModelica 校验与指数衰减仿真，终值接近 exp(-1)；
   - 实际 ngspice 瞬态 CSV 与曲线；
   - 实际 OpenSCAD STL，负尺寸断言失败后不显示旧成功网格；
   - SysML analysis 名称推断、FMU 路径与当前哈希绑定；共享模式正确拒绝原生 FMI 提交；
   - 768px 工作区、聊天草稿保留和无页面异常。
5. Python 编译、Shell 语法、git diff 空白检查通过。

截图和 JSON：`.local/workbench-validation/outputs/workbench-native/`（不入库）。浏览器在用户明确授权下仅于验证容器内禁用了 Chromium 自身沙箱；未全局关闭宿主 AppArmor。

## 本次补齐的问题

- 明确安装 OpenAI Agents 实际导入的 `@modelcontextprotocol/client`，避免可选依赖安装缺失导致 runtime 报错。
- FMI 回执补 `sourceHashes`，让真实 worker 结果符合专业作业服务的精确源版本校验。
- SysML 工作台增加 analysis/calc 名称与 FMU 路径、提交前读取哈希，以及 FMI 仿真按钮。
- 修复 OpenModelica 注册卡重复。
- FMI return 绑定识别支持多行；真实时间覆盖测试不再预先修改模型默认值。
- `sysmlsim` 通过工具组 allowlist；安装器复用已签名索引 SHA-256 的包预取，SysML 阶段独立刷新 Debian HTTPS 源。
- 新增独立原生模型 UI 验收脚本，不依赖未配置的 STF 私有/外部资产。

## 复现

```bash
# 容器中的实际浏览器与原生工具验收
# MANTA_UI_NO_SANDBOX=1 只用于明确授权、隔离的本地验证容器。
docker exec -i \
  -e MANTA_ACCEPTANCE_URL=http://127.0.0.1:4320 \
  -e MANTA_UI_WORK_ROOT=/validation \
  -e MANTA_UI_NO_SANDBOX=1 \
  -e MANTA_UI_FMU=/validation/fmus/SimpleDecay.fmu \
  daidalis-workbench-validation node --input-type=module \
  < tests/ui-workbench-native.mjs
```

## 尚未完成：rootless broker 真实 FMI 端到端

宿主目前只有 rootful Docker，缺少 uidmap/rootlesskit 等，`sudo -n` 要求密码。已确认专用 AppArmor `rootlesskit` profile 可创建 user namespace；没有关闭全局策略。需要用户在宿主终端完成有密码的安装：

```bash
sudo apt-get update
sudo apt-get install -y uidmap rootlesskit slirp4netns fuse-overlayfs docker-ce-rootless-extras
dockerd-rootless-setuptool.sh install
```

然后检查 rootless daemon 的 cgroup v2、memory/PID/CPU 委派，将验证镜像导入该 daemon，按 `deploy/docker/install-broker.sh` 部署并重跑同一 UI 脚本；脚本只在 broker 的 `rootless-task-container` attestation 存在时要求 FMI 真正运行且 passed=true。不得移除服务的隔离检查以使测试通过。
