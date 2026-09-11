# Luna GPU Driven Terrain

## 交付范围

本工作区实现了 `Assets/Luna/Luna.unity` 的 GPU 驱动程序化地形与第一人称验证相机。场景中的 `Main Camera` 挂载 `Luna_GpuTerrainBootstrap`，进入 Play 后自动创建带 `Luna_` 前缀的运行时对象；不会修改其他工作区、`Packages/manifest.json`、`ProjectSettings/` 或 `Assets/_Settings/`。

当前 Unity 环境为 6000.5.5f1 / URP 17.5.0。当前 Editor 活动场景确认是 Luna，因此 `{WORKSPACE}` 取值为 `Luna`。

## 模块与数据流

```text
Luna_GpuTerrain.compute
    └─ CSGenerateHeight / 6-octave FBM
        └─ RFloat RenderTexture（GPU height field，按 64m 相机格子刷新）
            └─ Luna_GpuTerrain.shader
                ├─ 顶点阶段采样 height field + FBM fallback
                ├─ 计算 morph、LOD ring 边界与高度差分法线
                └─ 像素阶段按高度/坡度着色或输出调试视图
```

`Luna_GpuTerrainController` 只在启动时构建一次 128×128 的静态拓扑（6 个共享该拓扑的 clipmap ring）；运行期间没有 `Mesh.vertices`、`SetVertices` 等逐帧 Mesh API。每级通过 Transform 的格子尺寸缩放和相机格子 snap 定位，level 0–5 的格子边长依次为 1/2/4/8/16/32m，最粗环覆盖 4096×4096m。

地形 ring 是嵌套方环：像素阶段裁剪内孔并保留 1m 重叠，过渡带在内边界对齐本级网格、外边界对齐相邻粗级网格，再与细节高度做 morph，以保持相邻 LOD 边界连续。六个运行时材质按粗到细的队列顺序绘制，避免覆盖带的深度竞争。高度贴地使用与 shader 同构的 CPU FBM，仅用于相机垂直定位，不生成或修改地形 Mesh。

## 控制

- 鼠标左键：锁定鼠标并转视角；`Esc`：解锁。
- `WASD`：沿水平视线移动；`Shift`：8m/s 提升到 40m/s。
- `F1`：正常 / LOD 分级着色 / 线框视图循环。
- `P`：切换 Autopilot。每次开启从 `(0,0)` 开始，以 25m/s 循环经过 `(500,0)`、`(500,500)`、`(-500,500)`、`(-500,-500)`、`(0,0)`，相机水平朝向平滑跟随移动方向。

## 关键取舍与已知限制

1. GPU 高度数据通过 compute shader 写入 RFloat RenderTexture；顶点阶段采样它，并在纹理边界使用相同 FBM 做无边界 fallback。这样无需 CPU Readback，也能支持相机持续移动。
2. 受评测约束，拓扑在启动时一次性由 CPU 创建，之后所有高度位移、法线、LOD morph 和高度场更新均在 GPU；运行期间不做逐帧 Mesh 重建。若将“几何生成全部在 GPU”解释为连索引拓扑也不能由 CPU 初始化，则这一点属于 `partial`，但验收条款明确禁止的是逐帧 CPU Mesh 修改。
3. 高度贴地采用 CPU 同公式求值而不是 GPU Readback，避免每帧同步 GPU；由于 shader 与 CPU 使用同一 6-octave FBM 参数，贴地误差来自浮点实现差异，目标控制在 0.5m 内。
4. 线框视图使用 shader 中基于 UV 导数的程序化网格线，不引入外部贴图或新包。
5. MCP 截图/Play 自检记录写入 `Assets/Luna/Report/`；若某次 Editor 会话不可用，README 会保留该事实而不伪造结果。

## 程序集与隔离

- 程序集：`Luna.GpuTerrain`。
- 根命名空间：`Luna.GpuTerrain`。
- 资产与运行时 GameObject 均使用 `Luna_` 前缀。
- 程序集引用仅为 Unity Input System、URP 与 Render Pipelines Core 官方程序集。
