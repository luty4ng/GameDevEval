# GameDevEval

Unity 图形与引擎能力评测工程。项目使用同一份 GPU Driven Terrain 任务提示词，分别交给 `Luna`、`Terra`、`Sol` 三个模型变体实现，用于比较它们在 GPU 地形、LOD、运行时验证和工程交付方面的差异。

## 评测内容生产工具

[GameEval Studio](Tools/game-eval-studio/README.md) 是中文 WebApp，用于编写游戏开发 coding agent 的需求列表与专家评测规则。支持六类任务模板、需求覆盖与权重检查、带证据试评、版本冻结和公开任务/私有规则分离导出。另有管理员邀请注册、登录、个人配置和 PostgreSQL 账户版，可用 Docker Compose 接入个人服务器现有 Traefik（尚未部署）。启动方式、操作流程、数据备份和验证详情见 [App README](Tools/game-eval-studio/README.md)。

![GameEval Studio 需求与专家规则工作台](Tools/game-eval-studio/docs/screenshots/desktop.png)

## 项目环境

- Unity：`6000.5.5f1`
- Render Pipeline：URP `17.5.0`
- 输入后端：Unity Input System
- 任务类型：GPU Driven Procedural Terrain + First-Person Validation Camera
- 地形数据：Compute Shader FBM 高度场，顶点阶段 GPU 生成/采样几何
- 外部资源：地形颜色和高度均为程序化生成，不依赖外部贴图或模型

## 快速开始

1. 使用 Unity `6000.5.5f1` 打开本项目。
2. 打开下列任一评测场景：

   - `Assets/Luna/Luna.unity`
   - `Assets/Terra/Terra.unity`
   - `Assets/Sol/Sol.unity`

3. 点击 Play 进入运行状态。
4. 优先使用 `Assets/Sol/Sol.unity` 查看当前验证证据最完整的实现。

Sol 的 procedural draw 已将 `RenderParams.camera` 保持为 `null`，因此 Play 状态下 Game View 和 Scene View 都可以显示地形；clipmap 中心仍由验证相机驱动。退出 Play 后不会自动生成编辑态预览，因为地形系统由运行时 Bootstrapper 装配。

## 运行控制

| 操作 | 功能 |
|---|---|
| 鼠标左键 | 锁定鼠标并启用视角旋转 |
| `Esc` | 释放鼠标 |
| `W/A/S/D` | 沿水平视线移动 |
| `Shift` | 加速移动，默认从 8m/s 提升到 40m/s |
| `F1` | 循环切换正常、LOD 分级、线框视图 |
| `P` | 开关 Autopilot |

Autopilot 使用固定路径：

```text
(0,0)
  → (500,0)
  → (500,500)
  → (-500,500)
  → (-500,-500)
  → (0,0)
```

默认巡游速度为 `25m/s`，相机高度保持为地形高度加 `1.7m`。

## 三套实现

| 工作区 | 核心方案 | LOD / 覆盖范围 | 主要特点 |
|---|---|---|---|
| Luna | 静态 Unity Mesh + 6 个 MeshRenderer ring | 6 级，1–32m，4096×4096m | Unity 组件式路径；高度存储在 1024² RFloat RenderTexture；启动时创建一次拓扑 |
| Terra | `Graphics.DrawProcedural` + GPU height buffer | 6 级，1–32m，4096×4096m | 不创建 Unity Mesh；Shader 使用 `SV_VertexID` 展开三角形；结构直接 |
| Sol | `Graphics.RenderPrimitives` + patch/skirt clipmap | 7 级，1–64m，4096×4096m | 中心 patch + 环形 patch；dirty LOD 增量更新；morph 与裙边封口 |

三套实现均遵循以下数据流：

```text
Compute Shader FBM
    → GPU height texture / buffer
    → vertex shader 采样高度并生成几何
    → 差分重建法线
    → fragment shader 按高度/坡度程序化着色
```

## 视觉预览

| Luna | Terra | Sol |
|---|---|---|
| ![Luna 正常视图](Assets/Luna/Report/Luna_GpuTerrain_Normal_Verified2.png) | ![Terra 正常视图](Assets/Terra/Report/Terra_Normal.png) | ![Sol 正常视图](Assets/Sol/Report/Sol_Normal_View.png) |

更多 LOD、线框、远景和第一人称截图位于各自的 `Report/` 目录。

## 评测结果

当前报告使用 16 个维度进行证据加权评分。每个维度先按 `0–5` 评分，再计算：

```text
单项加权分 = 维度权重 × 原始分 / 5
最终得分 = 所有单项加权分之和
```

| 排名 | 工作区 | 得分 | 结论 |
|---:|---|---:|---|
| 1 | Sol | **94.8 / 100** | 实现、运行探针和证据闭环最完整 |
| 2 | Terra | **81.8 / 100** | 架构清晰、视觉稳定，但运行态验证和 dispatch 优化不足 |
| 3 | Luna | **75.0 / 100** | Unity 组件式 GPU 路径成立，但接缝和性能证据仍有风险 |

分数是基于当前仓库中的代码、截图、README、自评表和运行日志计算的证据加权结果，不代表模型能力的绝对排名。完整维度、权重、计算过程和扣分原因见：

- [三模型对比报告](Docs/游戏开发大模型评测_三模型对比报告.md)

## 目录结构

```text
GameDevEval/
├─ Assets/
│  ├─ _Settings/                 # 项目预置 URP 设置
│  ├─ Luna/                      # Luna 工作区
│  │  ├─ Luna.unity
│  │  ├─ *.cs / *.shader
│  │  └─ Report/
│  ├─ Terra/                     # Terra 工作区
│  │  ├─ Terra.unity
│  │  ├─ Scripts/ / Shaders/ / Resources/
│  │  └─ Report/
│  └─ Sol/                       # Sol 工作区
│     ├─ Sol.unity
│     ├─ Runtime/ / Resources/
│     └─ Report/
├─ Tools/game-eval-studio/        # 需求与专家规则生产 WebApp
├─ Docs/                         # 统一提示词、评分标准、对比报告
├─ Packages/                     # Unity 包配置
└─ ProjectSettings/              # Unity 项目设置
```

每个工作区都拥有独立的程序集、命名空间、资源前缀和场景，避免模型之间互相引用或污染。

## 工作区文档

### Luna

- [Luna README](Assets/Luna/README.md)
- [Luna 自评表](Assets/Luna/Report/Luna_GpuTerrain_SelfAssessment.md)
- [Luna Console 记录](Assets/Luna/Report/Luna_GpuTerrain_Console.txt)

### Terra

- [Terra README](Assets/Terra/README.md)
- [Terra 自评表](Assets/Terra/Terra_SelfAssessment.md)

### Sol

- [Sol README](Assets/Sol/README.md)
- [Sol 自评表](Assets/Sol/Sol_SelfAssessment.md)

### 评测设计

- [统一任务提示词](Docs/游戏开发大模型评测_GPU驱动地形任务提示词_下发版.md)
- [完整提示词与评分 Checklist](Docs/游戏开发大模型评测_GPU驱动地形任务提示词.md)
- [提示词设计指导文档](Docs/游戏开发大模型评测_提示词设计指导文档.md)
- [三模型对比报告](Docs/游戏开发大模型评测_三模型对比报告.md)

## 已知限制

- Luna 的正常/远景截图存在明显的环带接缝风险，系统级 GC=0 也没有被独立证明。
- Terra 的实现每个 `LateUpdate` 都会重新 dispatch 六个 LOD；可以进一步改成按 snap 变化更新 dirty LOD。
- Terra 的 WASD/P 交互没有通过当前自动化通道完成完整实测。
- Sol 的裙边解决了独立 snap 造成的孔洞风险，但极端视角下可能看到重叠封口三角形或细亮线。
- 非 Play 状态下，三套场景不会自动提供完整的编辑态 procedural terrain 预览；验证应在 Play 状态进行。

## 验证建议

建议每套场景至少检查：

1. Console 无编译错误和运行时异常。
2. 第一人称相机可以使用鼠标、WASD 和 Shift 控制。
3. 连续移动或开启 Autopilot，观察地形是否随相机延伸。
4. 使用 F1 检查正常、LOD 分级、线框三种视图。
5. 使用 Unity Profiler 检查稳定帧 GC Alloc，并单独区分 Editor 与运行时开销。
6. 对 LOD 边界、裙边和远景细亮线进行视觉回归。

