# Sol GPU Driven Terrain

## 打开与操作

打开 `Assets/Sol/Sol.unity` 后直接进入 Play：

- 点击 Game View：锁定鼠标；`Esc`：解锁。
- `WASD`：按视线的水平投影移动；`Shift`：从 8 m/s 加速到 40 m/s。
- `F1`：循环切换正常着色、LOD 分级着色、程序化线框。
- `P`：开关 Autopilot。开启时从 `(0,0)` 出发，以 25 m/s 严格循环指定路径。

## 模块与数据流

1. `Resources/Sol_TerrainHeight.compute`
   - 对 7 个 LOD 各维护一块 `65 × 65` 高度采样区。
   - 以默认种子 `20260912` 执行 6 octave FBM；频率、最大高差和种子由 `Sol_GpuTerrainSystem` 的序列化字段控制。
2. `Runtime/Sol_GpuTerrainSystem.cs`
   - 每级网格中心按本级格子尺寸 snap；仅在跨格或参数变化时重新 dispatch 对应 LOD。
   - 一个 `ComputeBuffer<float>` 容纳全部 29,575 个高度样本。CPU 每帧只更新 draw 参数并提交 `Graphics.RenderPrimitives`，不创建或修改 `Mesh`。
   - LOD 0 为完整 `64 × 64` patch；LOD 1–6 各由四个环形 patch 组成。格子尺寸依次为 `1/2/4/8/16/32/64m`，最粗级覆盖 `4096 × 4096m`。
3. `Resources/Sol_GpuTerrain.shader`
   - `SV_VertexID` 在顶点阶段生成三角形与裙边，并从 GPU 高度 buffer 采样。
   - 外侧过渡带把顶点渐变吸附到父级格点；每个 patch 边缘生成向外、向下扩展的裙边以封闭独立 snap 带来的接口间隙。
   - 高度 buffer 差分重建法线；片元阶段按高度与坡度混合谷地、草地、岩石、雪线颜色，不依赖外部贴图。
4. `Runtime/Sol_FirstPersonController.cs`
   - 只使用 Input System 的 `Keyboard` / `Mouse` API。
   - 相机以同一 FBM 的 CPU 镜像公式做贴地约束，视高固定为 1.7m；该 CPU 公式不参与地形几何生成。
   - Autopilot 会消费跨 waypoint 帧的剩余路程，避免到点时丢失距离而偏离 25 m/s。
5. `Runtime/Sol_GpuTerrainBootstrapper.cs`
   - 场景只需一个入口组件，运行时装配 GPU 地形与相机控制器；不修改全局项目设置。

`Sol_GpuTerrainSystem` 的 `RenderParams.camera` 保持为 `null`，因此 Play 状态下 procedural terrain 会同时提交给 Game View 和 Scene View；clipmap 的中心仍由验证相机驱动。

数据流：`compute shader FBM → ComputeBuffer<float> → vertex shader 程序化几何/高度/法线 → URP fragment 着色`。

## 关键决策

- 选择 7 级、每级 64 格而不是 6 级、每级 128 格：同样满足 4km 覆盖，同时显著降低程序化顶点量。
- 选择 GPU 高度 buffer 而不是 CPU Mesh：compute 只更新跨格的 LOD，顶点阶段直接消费；满足几何和高度数据均在 GPU 端生成/更新。
- 选择“父级吸附 morph + 外扩裙边”：morph 消除远处顶点切换突跳，裙边覆盖各级独立 snap 时可能出现的水平错位。相比强制所有 LOD 共用 1m snap，它不会让粗级顶点随相机逐米游动。
- 贴地选择 CPU 同公式求值而非 AsyncGPUReadback：相机当帧得到确定高度，没有 readback 延迟，也不会产生逐帧托管分配。

## 参数

`Sol_GpuTerrainSystem` 默认值：

- Seed：`20260912`
- Frequency：`0.0018`
- Height Amplitude：`110m`（理论峰谷范围大于 220m，满足最大高差至少 80m）
- FBM：6 octaves，lacunarity 2，persistence 0.5
- Morph 起点：本级半径的 72%

## 已知限制

- 裙边是为独立 snap 的稳健封口取舍；在极端俯视线框下会看到重叠的封口三角形，但正常视角没有地形孔洞。
- Unity Editor 的全局 `GC Allocated In Frame` 包含 Editor 与 MCP 自身的分配。本系统在 `LateUpdate` 和相机 `Update` 内分别用当前线程分配计数自检，稳定帧两者均为 `0 bytes`。
- 运行态证据截图必须用 Game View 捕获；MCP 的“指定 Camera 直接渲染”路径不会重放当帧 `Graphics.RenderPrimitives` 提交，因此该路径只会得到清屏背景。

## MCP 自检记录（2026-09-12）

- 工程：Unity `6000.5.5f1`，目标场景 `Assets/Sol/Sol.unity`。
- 首次脚本编译发现 `Graphics.RenderPrimitives` 的 `in RenderParams` 调用差异，已修正；最终刷新后编译错误为 0。
- Play 初始化：`7 LODs / 64×64 cells / 4096m coverage / 29575 GPU samples`，控制台无 Error/Warning。
- 稳定帧运行态探针：`terrainReady=True`、`terrainAlloc=0`、`cameraAlloc=0`、`groundError=0`。
- Autopilot：`t=20.59349, x=0` 到 `t=39.78557, x=479.80`，速度约 `25.0m/s`；随后完整通过 `(500,500) → (-500,500)` 的 1km 直线段并转向下一 waypoint。
- 证据：
  - 第一人称：`Report/Sol_FirstPerson.png`
  - 正常着色：`Report/Sol_Normal_View.png`
  - LOD 分级：`Report/Sol_LOD_View.png`
  - 线框：`Report/Sol_Wireframe_View.png`
  - 远景：`Report/Sol_Far_View.png`

Unity CLI 在本机 PATH 中不可用，因此环境侦测、编译、Play、运行态探针和截图全部由已连接的 Unity MCP 完成，没有安装任何新工具或包。
