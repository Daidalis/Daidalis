# CoastDemo 生成、语义验证与 FMI 仿真结果

## 结论

**流程已实际跑通，CoastCheck 通过。** 模型仅含一个根 part `car`，未使用 ShapeItems，未复制新能源汽车整车文件。

## 生成的文件

所有本机产物均位于 `examples/agent-opus-run/`：

- `CoastDemo.mo`：Modelica 滑行模型，初值 `v=20`、`s=0`；方程为 `der(v)=-0.15*v`、`der(s)=v`；实验时间 0–8 秒，步长 0.05 秒。
- `CoastDemo.sysml`：SysML v2 模型，包含 `Coast`、FMI 工具与变量绑定，以及 `CoastCheck` 断言。
- `validation.json`：语义验证工具输出的原始 JSON，未重新格式化。
- `CoastDemo.mos`：OpenModelica FMU 导出脚本。
- `build.log`：FMU 导出日志。
- `CoastDemo.fmu`：实际编译生成的 FMI 2.0 co-simulation FMU。
- `simulate.py`：FMPy 仿真脚本。
- `simulation.log`：仿真输出，记录行数、首末采样及断言结果。
- `trajectory.csv`：实际仿真轨迹，表头为 `time,v,s`。
- `RESULT.md`：本报告。

## 语义验证

- 使用指定的 Docker worker，通过标准输入提交 `validate` 请求。
- 内核实际返回版本：**0.10.10**。
- `valid: true`，`findings: []`，无 error 或 referential。
- 首次验证即通过，未进行修改重试。
- `Coast` 绑定 `file:///examples/agent-opus-run/CoastDemo.fmu`；`stopTime=8.0` 绑定 `fmi:stopTime`，`stepSize=0.05` 绑定 `fmi:stepSize`，返回变量绑定 FMU 输出 `v`。

## FMU 检查

- 实际编译器版本：**OpenModelica 1.27.1**。
- 在运行容器的 `/tmp` 中执行 `buildModelFMU(CoastDemo, version="2.0", fmuType="cs")`，未修改容器配置。
- `modelDescription.xml` 中的 `modelName`：**CoastDemo**。
- FMI 版本：**2.0**，包含 `CoSimulation`。
- `v` 与 `s` 的 `causality` 均为 **output**。
- 已确认存在 `binaries/linux64/CoastDemo.so`。

## 真实仿真结果

使用容器中指定的 Python 调用 `fmpy.simulate_fmu`，设置 `start_time=0`、`stop_time=8`、`step_size=0.05`、`output_interval=0.05`、`output=["v", "s"]`、`validate=False`。

共 **161 行数据**（不含 CSV 表头），逐行检查时间采样间隔为 0.05 秒，数值均有限。

| 采样 | time | v | s |
| --- | ---: | ---: | ---: |
| 第一行 | 0 | 20 | 0 |
| 最后一行 | 8 | 5.9967019687455094 | 93.355320208363167 |

`CoastCheck` 在 SysML 中调用 `Coast()` 并断言 `result > 5.5 and result < 6.5`。以真实仿真 t=8 的输出 `v` 核对：

**5.5 < 5.9967019687455094 < 6.5，因此 CoastCheck 通过。**

## 运行说明

- FMPy 提示缺少 `logging.so`，但仿真正常完成，轨迹及首末值检查均通过。
- 首次尝试用 `docker cp` 取回 FMU 时报告找不到文件；随后在容器内确认文件实际存在，改用 `docker exec` 标准输出传回，取回后已检查 FMU 内容。
- 未执行 git commit、git push，未修改 Docker 容器配置；容器内生成与仿真的临时写入均位于 `/tmp`。
- 本机未修改本目录以外的文件；产物未写入密钥或环境变量值。
