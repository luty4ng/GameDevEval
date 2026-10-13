import { emptyReview, uid, type Project, type Task, type Requirement, type Rule, type DOMAINS } from './model';

type Feature = { title: string; description: string; steps: string; acceptance: string; dimension: Rule['dimension']; method: Rule['method']; evidence: string };
export const templateDescriptions: Record<typeof DOMAINS[number], string> = {
  '玩法逻辑': '角色移动、跳跃、碰撞与状态重置',
  '图形与地形': 'GPU 地形、LOD 接缝与视觉回归',
  '战斗与 AI': '敌人感知、状态机与战斗结算',
  '游戏 UI': '背包操作、焦点导航与数据一致性',
  '性能优化': '性能基线、热点定位与行为回归',
  '完整小游戏': '可玩的核心循环、胜负与重新开始',
};
const features: Record<typeof DOMAINS[number], Feature[]> = {
  '玩法逻辑': [
    { title: '移动与跳跃控制', description: '实现可配置的角色移动和跳跃，不依赖帧率改变位移。', steps: '在固定场景用同一输入序列分别以 30 / 60 / 120 FPS 运行；持续前进 5 秒并执行跳跃。', acceptance: '不同帧率水平位移偏差不超过 5%；角色只能在允许状态跳跃，落地后能再次跳跃。', dimension: '功能正确性', method: '自动化运行', evidence: '输入回放、三组位移记录、跳跃状态日志。' },
    { title: '碰撞与边界行为', description: '处理墙面、斜坡和平台边缘，避免穿透或永久卡死。', steps: '沿墙移动，连续经过斜坡，跳至平台边缘并掉落，重复 10 次。', acceptance: '10 次运行均无穿墙、掉入非预期区域或永久卡死；边界处理符合场景设定。', dimension: '稳定性', method: '专家试玩', evidence: '包含墙面、斜坡、平台边缘的连续录屏与异常日志。' },
    { title: '状态与重开', description: '提供死亡或越界后的重置，恢复角色、相机和交互状态。', steps: '连续触发死亡并重新开始 3 次，再执行完整操作序列。', acceptance: '每次都返回出生点；残留输入、速度和死亡状态清除，镜头跟随正常。', dimension: '交互体验', method: '专家试玩', evidence: '三次重开录屏、出生位置和状态记录。' },
    { title: '可调参数与交接', description: '公开速度、跳跃高度等参数，解释脚本与场景依赖。', steps: '修改移动速度并运行；按交付说明在干净工作区导入。', acceptance: '参数改动生效，不依赖隐藏绝对路径；说明覆盖输入、参数和场景入口。', dimension: '工程质量', method: '静态检查', evidence: '参数截图、相关文件路径、干净工作区验证步骤。' },
  ],
  '图形与地形': [
    { title: '确定性地形生成', description: '用固定 seed 生成 GPU 地形，并公开尺寸、高度和噪声参数。', steps: '以任务 seed 启动两次，再替换 seed；观察相同相机位置。', acceptance: '同 seed 的地形一致，换 seed 有变化；参数改动能生效，没有 NaN 或无效网格。', dimension: '功能正确性', method: '自动化运行', evidence: '两次相同 seed 和一次不同 seed 的高度采样、参数与截图。' },
    { title: 'LOD 边界与接缝', description: '相邻不同层级地形连续衔接，镜头移动不产生可见裂缝。', steps: '按固定相机轨迹由近向远移动，跨越 LOD 边界并绕行四个边角；重复两次。', acceptance: '预设轨迹上无可见背景裂缝；过渡不出现持续闪烁、细亮线或裙边穿帮。', dimension: '视觉表现', method: '视觉检查', evidence: '固定分辨率连续录屏、相机轨迹、LOD 边界与边角截图。' },
    { title: '运行时资源与性能', description: '复用 GPU 资源；性能采样区分 Editor 与 Player。', steps: '在固定设备与分辨率下用 Player 预热 10 秒，采样 60 秒，再退出和重入 3 次。', acceptance: '预热后稳态脚本 GC Alloc 为 0 B/frame；三次重入无未释放 ComputeBuffer。帧时间与基线同口径报告，不凭 Editor FPS 判断。', dimension: '性能', method: '性能采样', evidence: 'Player Profiler 截图/数据、GC Alloc、设备信息、资源生命周期日志。' },
    { title: 'shader 与组件可维护性', description: '保留项目现有结构，明确 shader 参数与组件职责。', steps: '审查 diff、组件依赖和资源释放路径；按说明创建测试场景。', acceptance: '不修改无关模块；参数有合理范围；GPU 资源生命周期清晰；说明包括限制与复现入口。', dimension: '工程质量', method: '静态检查', evidence: 'diff、文件定位、资源释放代码与交付说明。' },
  ],
  '战斗与 AI': [
    { title: '感知与状态切换', description: '敌人具备巡逻、追击、攻击和返回状态，使用可配置感知范围。', steps: '玩家依次进入感知范围、攻击范围，再离开；固定 seed 重复 3 次。', acceptance: '状态按条件切换；离开后返回巡逻，不持续攻击不存在目标；无状态抖动。', dimension: '功能正确性', method: '自动化运行', evidence: '状态日志、距离数据和三次运行录屏。' },
    { title: '伤害与冷却结算', description: '按攻击窗口结算伤害，死亡目标不再参与战斗。', steps: '连续进入退出攻击范围，触发死亡并重新开始。', acceptance: '每个有效攻击窗口最多结算一次；冷却生效；死亡后不再伤害和被伤害。', dimension: '功能正确性', method: '自动化运行', evidence: '攻击计数、生命值轨迹、死亡与冷却日志。' },
    { title: '障碍与丢失目标', description: '敌人处理路径受阻和目标销毁，避免卡住或空引用。', steps: '放置障碍阻断路径，销毁目标，再重新生成目标。', acceptance: '路径受阻有确定反馈；目标销毁无异常；新目标出现后能恢复行为。', dimension: '稳定性', method: '专家试玩', evidence: '障碍与目标销毁的录屏、Console 日志。' },
    { title: 'AI 参数与可观察性', description: '可调感知、速度、攻击间隔，并提供状态调试入口。', steps: '更改参数并检查状态可视化；审查 AI 与表现层的耦合。', acceptance: '修改参数能生效，状态可观察；职责分离且无散落的魔法常量。', dimension: '工程质量', method: '静态检查', evidence: 'Inspector、状态可视化和代码定位。' },
  ],
  '游戏 UI': [
    { title: '背包数据与交互', description: '实现物品添加、堆叠、移除和使用，UI 与数据保持一致。', steps: '添加同类与不同类物品，堆叠到上限，使用和移除物品。', acceptance: '数量准确、不为负、上限生效；操作后列表与数据一致，无幽灵物品。', dimension: '功能正确性', method: '自动化运行', evidence: '操作序列、数据断言和界面截图。' },
    { title: '键盘与焦点导航', description: '鼠标和键盘均能执行背包主要操作，关闭后恢复焦点。', steps: '只用键盘打开背包、选择、使用物品、关闭，然后再次打开。', acceptance: '焦点可见且顺序合理；无键盘陷阱；弹窗关闭后回到合理焦点。', dimension: '交互体验', method: '专家试玩', evidence: '纯键盘操作录屏、焦点顺序说明。' },
    { title: '分辨率适配与反馈', description: '空状态、满背包、使用失败和长文本有明确反馈。', steps: '在 1280×720 与 1920×1080 检查长名称和空/满背包；触发使用失败。', acceptance: '无文本遮挡、不可点击元素或裁切；反馈解释原因；状态不只用颜色表达。', dimension: '视觉表现', method: '视觉检查', evidence: '两种分辨率、长文本和错误/空状态截图。' },
    { title: '状态持久与说明', description: '明确存储与重置策略，交付 UI 组件使用说明。', steps: '关闭重开 UI，再重载场景；依说明连接数据源。', acceptance: '状态符合公开约定；无重复订阅和异常；文档说明生命周期和接入方式。', dimension: '工程质量', method: '静态检查', evidence: '生命周期代码、重开日志和接入说明。' },
  ],
  '性能优化': [
    { title: '性能基线与热点定位', description: '用一致设备和 Player 场景测量优化前后表现。', steps: '同设备/构建配置预热 10 秒，各采样 60 秒，重复 3 次；定位主要热点。', acceptance: '提供 CPU/GPU 帧时间 P50/P95、GC Alloc、采样方法与热点证据；不得用不同负载对比。', dimension: '性能', method: '性能采样', evidence: '六组以上采样、设备与配置、Profiler 热点和基线数据。' },
    { title: '热点优化效果', description: '降低已定位热点的运行时成本，不降低既定画质和负载。', steps: '对同一输入回放进行基线与优化后对照。', acceptance: '主要热点 CPU P95 相比基线降低至少 20%；GPU P95 回退不超过 5%；画质与实体负载保持一致。阈值须由专家按基线校准。', dimension: '性能', method: '性能采样', evidence: '优化前后 P95、配置对照和改动定位。' },
    { title: '功能与视觉回归', description: '优化后核心行为和输出与基线一致。', steps: '回放相同输入、seed 与相机路径，检查边界场景。', acceptance: '核心行为与基线相同；无新增视觉瑕疵和异常；边界运行不崩溃。', dimension: '稳定性', method: '自动化运行', evidence: '输入回放、行为断言、对照截图和异常日志。' },
    { title: '优化解释与生命周期', description: '解释优化收益、内存代价和资源回收策略。', steps: '审查 diff；连续创建销毁系统 3 次。', acceptance: '每处改动对应证据；解释缓存和内存取舍；创建销毁无资源泄漏。', dimension: '工程质量', method: '静态检查', evidence: 'diff、收益说明、内存与资源日志。' },
  ],
  '完整小游戏': [
    { title: '核心循环与规则', description: '实现公开简述中的移动/操作、挑战与目标，形成可玩闭环。', steps: '按固定输入完成一轮从开始到目标的游戏，并触发边界操作。', acceptance: '操作、挑战、目标相互连贯；公开规则全部生效；没有只展示静态画面的伪玩法。', dimension: '功能正确性', method: '专家试玩', evidence: '完整一局录屏、规则逐项对照、边界操作记录。' },
    { title: '胜负与重新开始', description: '提供开始、进行、成功、失败和重新开始状态。', steps: '分别触发成功和失败，重新开始 3 次。', acceptance: '每个终局有明确反馈；重开清理分数、实体与状态；不存在无路可出的终局。', dimension: '稳定性', method: '自动化运行', evidence: '两种终局与三次重开录屏、状态断言。' },
    { title: '操作引导与反馈', description: '玩家能理解输入、目标和游戏状态；提供有效反馈。', steps: '由未参与开发的专家只读游戏内说明完成一局。', acceptance: '说明包含目标与操作；关键行为及时可见；UI 不遮挡操作目标，反馈不只依赖颜色。', dimension: '交互体验', method: '专家试玩', evidence: '首次试玩录屏、操作引导和关键反馈截图。' },
    { title: '项目完整与合法资产', description: '交付完整源项目、运行说明与资产出处。', steps: '在干净环境按 README 运行，核对外部资产清单。', acceptance: '项目可移交；无隐藏绝对路径；外部资源有来源/授权说明；缺省资源可替代。', dimension: '工程质量', method: '静态检查', evidence: '干净环境运行日志、文件清单、资产来源和 README。' },
  ],
};

export function createProject(domain: Task['domain'], title: string, brief: string, difficulty: Task['difficulty'] = '进阶'): Project {
  const pid = uid();
  const now = new Date().toISOString();
  const boot: Requirement = {
    id: 'REQ-001', title: '项目构建与可运行交付', domain, priority: 'P0',
    description: '在指定引擎和固定项目基线实现任务，保留既有功能，交付可打开、可运行的项目。',
    steps: '在干净工作区按交付说明打开指定场景，构建目标平台并运行 60 秒。',
    acceptance: '构建成功、入口可运行，无阻断性异常；核心操作能执行，不用静态截图替代运行成果。',
  };
  const reqs: Requirement[] = [boot, ...features[domain].map((f, i) => ({
    id: `REQ-${String(i + 2).padStart(3, '0')}`, title: f.title, domain,
    priority: (i === 3 ? 'P1' : 'P0') as Requirement['priority'], description: f.description, steps: f.steps, acceptance: f.acceptance,
  }))];
  const rules: Rule[] = reqs.map((req, i) => {
    const f = features[domain][i - 1];
    return {
      id: `RULE-${String(i + 1).padStart(3, '0')}`, title: req.title,
      requirementIds: [req.id], dimension: i === 0 ? '可运行性' : f.dimension,
      method: i === 0 ? '自动化运行' : f.method, weight: [20, 25, 25, 20, 10][i],
      gate: i === 0, visibility: 'private',
      evidence: i === 0 ? '引擎版本、构建日志、指定场景 60 秒运行录屏与异常日志。' : f.evidence,
      anchors: [
        `${req.title}未实现或提交物无法验证。`,
        `已尝试实现，但核心验收失败：${req.acceptance}`,
        `仅部分验收达标，记录未通过项；未完整满足：${req.acceptance}`,
        `完整满足：${req.acceptance}`,
        `完整满足验收，并重复执行观察步骤两轮仍稳定：${req.steps}`,
      ],
    };
  });
  const task: Task = {
    id: pid, title: title.trim() || `${domain}评测任务`, brief: brief.trim() || `在既有项目中完成${templateDescriptions[domain]}，交付可运行成果及复现说明。`,
    domain, difficulty, engine: 'Unity', engineVersion: '6000.5.5f1', platform: 'Windows Standalone',
    baseline: '', scene: '', seed: '42', timeBudget: difficulty === '基础' ? 60 : difficulty === '专家' ? 240 : 120,
    hardware: '', protocol: '固定 seed 和输入序列；1920×1080；保留完整 Console 日志与相机路径；性能检查使用 Player，预热 10 秒，采样 60 秒。',
    constraints: '仅修改任务相关文件；不得改写评测器或隐藏测试；允许查阅官方文档，禁止使用参考答案；外部资产须有合法来源且列出授权；工具和联网范围由组织者在运行前固定。',
    deliverables: '完整源项目或相对基线补丁；启动与操作 README；验证日志；关键场景截图/录屏；已知限制与资产来源清单。',
    passThreshold: 70, requirements: reqs, rules,
  };
  return { id: pid, createdAt: now, updatedAt: now, task, review: emptyReview(), versions: [] };
}

export function demoProject(): Project {
  const p = createProject('图形与地形', 'GPU 地形的 LOD 连续性', '在 Unity 中实现确定性的 GPU 地形与无裂缝 LOD。沿固定相机轨迹验证近景、边界和远景表现，并提供 Player 性能证据。', '专家');
  p.task.baseline = '示例基线：由题目作者替换为仓库 URL + commit SHA';
  p.task.scene = '示例场景：Assets/Scenes/TerrainBenchmark.unity（请替换）';
  p.task.hardware = '示例设备：Windows / RTX 3060 / 1920×1080（请替换）';
  return p;
}
