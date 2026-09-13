# Terra GPU Driven Terrain — 自评表

| 项 | 结果 | 证据 |
|---|---|---|
| A. 编译零错误；Play 无报错 | pass | 最终 Shader/脚本导入后，MCP 多次读取 Console 均为 `0 error / 0 warning`；最终 Play 同样为 0 条目。 |
| B. 鼠标 + WASD + Shift 可控且贴地 | partial | `Terra_FirstPersonController.cs` 使用 Input System，速度字段默认 8/40m/s，逐帧高度为 `SampleHeight + 1.7m`；MCP 无 Game View 键盘注入能力，未自动实际发送输入。 |
| C. 任意方向连续移动 1km 无边界、无重载 | partial | 六级 clipmap 随主相机 snap 更新，最外级为 4096m；没有加载/网格重建逻辑。未通过自动化实际驾车 1km。 |
| D. F1 可见至少 4 个 LOD，近密远疏 | pass | `Report/Terra_LOD.png` 显示六种层级色；`Report/Terra_Wireframe.png` 显示每级 1/2/4/8/16/32m 格距。 |
| E. LOD 过渡无顶点突跳 | partial | vertex shader 在外缘 `smoothstep(0.74, 0.96)` morph 到下一层格点；已做静态截图检查，但未自动驱动相机穿越边界。 |
| F. 相邻层级无裂缝 | pass | `Report/Terra_Wireframe.png` 中环带连续；相邻层使用父级格距覆盖并让顶点向粗层格点 morph。 |
| G. 稳定后本系统 GC 0；无逐帧 Mesh API | partial | 代码无 Mesh 创建/更新，使用 `Graphics.DrawProcedural`；MCP 全局 Profiler 帧显示 832B（含 Editor/MCP，不能单独归因），因此未声称已用 Player Profiler 完成 0B 验证。 |
| H. P Autopilot 严格路径与速度 | partial | `AutopilotWaypoints` 逐项为 `(0,0) → (500,0) → (500,500) → (-500,500) → (-500,-500) → (0,0)`，速度字段默认 25m/s，循环跨点余量；未能自动发送 P 键进行实测。 |
| I. asmdef / 命名空间 / 前缀 / 工作区隔离 | pass | `Terra.GpuTerrain.asmdef` 根命名空间为 `Terra.GpuTerrain`；所有新增 Unity 资产和对象均在 `Assets/Terra/` 且使用 `Terra_` 前缀。 |
| J. README 与自评完整 | pass | 本 README、此自评表和 `Report/` 四张截图均已交付。 |

## 截图索引

| 文件 | 说明 |
|---|---|
| `Report/Terra_Normal.png` | 默认正常程序化山地。 |
| `Report/Terra_LOD.png` | 六级 LOD 分色。 |
| `Report/Terra_Wireframe.png` | 线框、近密远疏和环带连接。 |
| `Report/Terra_Distant.png` | 主验证相机的远景。 |

## 验收建议

在 Unity Game View 中点击以锁鼠标，手动执行 `WASD + Shift`、`F1` 三次、`P` 并让路径运行一圈；随后用 Player Profiler 只选择 `Terra.GpuTerrain` 相关采样验证 GC。上述三项是 MCP 当前自动化通道未直接覆盖的运行时交互验证。
