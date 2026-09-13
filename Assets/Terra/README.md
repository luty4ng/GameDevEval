# Terra GPU Driven Terrain

打开 `Assets/Terra/Terra.unity` 并进入 Play 即可运行。场景默认处于正常着色模式。

## 操作

- 单击画面：锁定鼠标并启用视角转动。
- `Esc`：释放鼠标。
- `W` `A` `S` `D`：沿相机水平视线移动。
- `Shift`：从 8 m/s 提升到 40 m/s。
- `F1`：正常 → LOD 分级 → 线框。
- `P`：切换 Autopilot；开始时归位 `(0, 0)`，以 25 m/s 循环固定航线。

## 模块和数据流

```
Terra_GpuTerrainRenderer.LateUpdate
    相机 XZ → 各 LOD 1/2/4/8/16/32 m snap 原点
    → Terra_GpuTerrainHeight.compute (5 octave FBM)
    → ComputeBuffer<float> (6 × 129 × 129 高度样本)
    → Graphics.DrawProcedural (6 个 128 × 128 GPU 网格)
    → Terra_GpuTerrain.shader 顶点阶段取高度/差分法线
    → URP 像素阶段高度 + 坡度着色 / 调试视图
```

`Terra_GpuTerrainHeight.compute` 在 GPU 生成五层 FBM 的高度值，默认种子 `20260912`、最大高度 `110m`。`Terra_GpuTerrainRenderer` 不创建 Mesh；顶点索引在 shader 内展开三角形，CPU 仅更新相机相关的六个 snap 原点、调度 Compute 和提交 Procedural Draw。

六级 clipmap 每级为 128×128 格，格距依次为 1、2、4、8、16、32m；最外级为 4096×4096m。顶点在层级外缘 74%–96% 区间 morph 至下一层格点。每级内方形裁剪保留一个父级格距的覆盖，防止独立 snap 时形成裂缝。法线由相邻四个 buffer 高度样本重建，颜色由高度和坡度混合草地、岩石与雪色，未使用外部贴图。

`Terra_FirstPersonController` 使用 Input System 的 `Keyboard` 和 `Mouse`，高度通过与 Compute 相同的 CPU 噪声公式求得，因此相机持续处于 `terrain height + 1.7m`。这条 CPU 路径只用于相机贴地，不构建或更新任何地形网格。

## 关键取舍

- 使用 `Graphics.DrawProcedural` 而非静态 Mesh：保证几何在 GPU 顶点阶段生成，且代码中不存在逐帧 `Mesh.vertices` 或其他 Mesh 更新。
- 使用 CPU 同公式贴地而非 AsyncGPUReadback：避免 readback 延迟导致相机穿地；高度场仍只在 GPU 端用于渲染。
- 使用一个父级格距的环带交叠：比大面积共面覆盖更稳，后者会在 LOD 着色中产生深度争用。

## 已知限制

- 功能层面无已知限制。
- Unity MCP 的全局 Profiler 计数包含 Editor/MCP 本身，最近一帧显示 `GC Allocated In Frame = 832B`，不能归因到本系统。地形和相机逐帧路径没有托管集合、字符串格式化或 Mesh API；若需验收精确的系统级 `0B`，应在 Player Profiler 以组件采样确认。
- MCP 没有对 Game View 键盘注入的通道，因此本次自动化未实际发送 WASD/P；相机控制与 Autopilot 已按代码和场景配置交付。

## MCP 自检记录

1. 读取 Unity 6000.5.5f1 / `Assets/Terra/Terra.unity` 状态，确认初始场景和零控制台条目。
2. 创建 `Terra.GpuTerrain` asmdef、Compute、URP Shader、Material 和两个运行脚本；首次导入的 HLSL 保留字冲突已修正，随后编译为零错误。
3. 首次 Play 发现 Compute 不在 `Resources`；移动至 `Assets/Terra/Resources` 后，最终多次 Play 均为 0 错误 / 0 警告。
4. 使用主验证相机采集正常、LOD 分级、线框与远景截图，均位于 `Report/`。

## 证据

- `Report/Terra_Normal.png`：正常 URP 程序化着色。
- `Report/Terra_LOD.png`：可区分六个 LOD 色带。
- `Report/Terra_Wireframe.png`：近密远疏线框与连续环带。
- `Report/Terra_Distant.png`：验证相机远景。

详细逐项结果见 `Terra_SelfAssessment.md`。
