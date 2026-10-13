import { emptyReview, uid, workspaceSchema, type Task, type Project, type Review, type Workspace, type Version } from './model';

export type Tab = 'setup' | 'requirements' | 'rules' | 'review' | 'export';
export type Issue = { key: string; message: string; tab: Tab; target?: string };
const nonempty = (s: string) => !!s.trim();
const placeholder = (s: string) => /示例|请替换|待填写/.test(s);
export function validateTask(t: Task): Issue[] {
  const issues: Issue[] = [];
  const add = (key: string, message: string, tab: Tab, target?: string) => issues.push({ key, message, tab, target });
  const fields: [keyof Task, string][] = [['title', '任务名称'], ['brief', '任务简述'], ['engine', '引擎'], ['engineVersion', '引擎版本'], ['platform', '目标平台'], ['baseline', '仓库基线'], ['scene', '运行入口/场景'], ['seed', '随机种子'], ['hardware', '评测设备'], ['protocol', '运行协议'], ['constraints', '工具与资产约束'], ['deliverables', '交付物']];
  fields.forEach(([key, label]) => {
    if (!nonempty(String(t[key]))) add(String(key), `补全${label}`, 'setup', String(key));
    else if (['baseline', 'scene', 'hardware'].includes(key) && placeholder(String(t[key]))) add(String(key), `替换${label}中的示例信息`, 'setup', String(key));
  });
  if (!Number.isInteger(t.timeBudget) || t.timeBudget < 1 || t.timeBudget > 10080) add('timeBudget', '时间预算须为 1–10080 分钟的整数', 'setup', 'timeBudget');
  if (!Number.isFinite(t.passThreshold) || t.passThreshold < 0 || t.passThreshold > 100) add('passThreshold', '通过阈值须为 0–100', 'setup', 'passThreshold');
  if (!t.requirements.length) add('no-req', '至少添加一条需求', 'requirements');
  if (!t.rules.length) add('no-rule', '至少添加一条评测规则', 'rules');
  const ids = new Set<string>();
  t.requirements.forEach(r => {
    if (ids.has(r.id)) add(`dup-${r.id}`, `${r.id} 需求 ID 重复`, 'requirements', r.id);
    ids.add(r.id);
    (['title', 'description', 'steps', 'acceptance'] as const).forEach(k => {
      if (!nonempty(r[k])) add(`${r.id}-${k}`, `${r.id} 缺少${({ title: '名称', description: '描述', steps: '观察步骤', acceptance: '验收条件' })[k]}`, 'requirements', r.id);
    });
    if (!t.rules.some(rule => rule.requirementIds.includes(r.id))) add(`uncovered-${r.id}`, `${r.id} 尚未被规则覆盖`, 'rules');
  });
  const ruleIds = new Set<string>();
  t.rules.forEach(r => {
    if (ruleIds.has(r.id)) add(`dup-rule-${r.id}`, `${r.id} 规则 ID 重复`, 'rules', r.id);
    ruleIds.add(r.id);
    if (!nonempty(r.title)) add(`${r.id}-title`, `${r.id} 缺少规则名称`, 'rules', r.id);
    if (!r.requirementIds.length) add(`${r.id}-ref`, `${r.id} 尚未关联需求`, 'rules', r.id);
    r.requirementIds.forEach(id => { if (!ids.has(id)) add(`${r.id}-${id}`, `${r.id} 引用了已不存在的 ${id}`, 'rules', r.id); });
    if (new Set(r.requirementIds).size !== r.requirementIds.length) add(`${r.id}-duplicate-ref`, `${r.id} 有重复需求关联`, 'rules', r.id);
    if (!Number.isFinite(r.weight) || r.weight <= 0 || r.weight > 100) add(`${r.id}-weight`, `${r.id} 权重须大于 0 且不超过 100`, 'rules', r.id);
    if (!nonempty(r.evidence)) add(`${r.id}-evidence`, `${r.id} 缺少证据要求`, 'rules', r.id);
    if (r.anchors.some(a => !nonempty(a))) add(`${r.id}-anchor`, `${r.id} 需补全 0–4 分锚点`, 'rules', r.id);
  });
  const total = t.rules.reduce((s, r) => s + r.weight, 0);
  if (Math.abs(total - 100) > 0.001) add('weights', `规则权重合计 ${Number(total.toFixed(2))}，应为 100`, 'rules');
  if (!t.rules.some(r => r.gate && r.dimension === '可运行性')) add('gate', '至少设置一条可运行性硬门槛', 'rules');
  return issues;
}

export function reviewSummary(task: Task, review: Review) {
  const marked = task.rules.filter(r => review.marks[r.id]?.score != null);
  const evidenced = marked.filter(r => nonempty(review.marks[r.id].evidence));
  const pending = task.rules.filter(r => review.marks[r.id]?.score == null || !nonempty(review.marks[r.id]?.evidence ?? ''));
  const score = Math.round(marked.reduce((s, r) => s + r.weight * review.marks[r.id].score! / 4, 0) * 100) / 100;
  const failedGates = task.rules.filter(r => r.gate && review.marks[r.id]?.score != null && review.marks[r.id].score! < 3);
  const valid = validateTask(task).length === 0;
  const complete = task.rules.length > 0 && !pending.length && nonempty(review.reviewer) && nonempty(review.submission) && valid;
  const verdict = !complete ? '待完成' : failedGates.length ? '不通过：硬门槛失败' : score >= task.passThreshold ? '通过' : '不通过：未达阈值';
  return { score, marked: marked.length, evidenced: evidenced.length, pending, failedGates, complete, valid, verdict };
}

export function editTask(p: Project, task: Task): Project {
  return { ...p, task, review: emptyReview(), updatedAt: new Date().toISOString() };
}
export function freezeVersion(p: Project, reviewer: string, note: string): Project {
  if (validateTask(p.task).length) throw new Error('请先修复质量检查中的问题。');
  if (!reviewer.trim() || !note.trim()) throw new Error('填写确认专家和评审说明后才能冻结。');
  if (p.versions.length >= 100) throw new Error('单任务最多 100 个版本，请复制为新任务继续。');
  const v: Version = { id: uid(), number: Math.max(0, ...p.versions.map(v => v.number)) + 1, createdAt: new Date().toISOString(), reviewer: reviewer.trim(), note: note.trim(), task: structuredClone(p.task) };
  return { ...p, versions: [...p.versions, v], updatedAt: v.createdAt };
}
export function diffTasks(before: Task, after: Task): string[] {
  const result: string[] = [];
  const names: Record<string, string> = { title: '任务名称', brief: '任务简述', domain: '领域', difficulty: '难度', engine: '引擎', engineVersion: '引擎版本', platform: '平台', baseline: '仓库基线', scene: '运行入口', seed: '随机种子', timeBudget: '时间预算', hardware: '设备', protocol: '运行协议', constraints: '约束', deliverables: '交付物', passThreshold: '通过阈值' };
  Object.keys(names).forEach(k => { if (before[k as keyof Task] !== after[k as keyof Task]) result.push(`${names[k]}已修改`); });
  for (const [key, label] of [['requirements', '需求'], ['rules', '规则']] as const) {
    const prev = new Map(before[key].map(x => [x.id, x]));
    const next = new Map(after[key].map(x => [x.id, x]));
    prev.forEach((value, id) => { if (!next.has(id)) result.push(`删除${label} ${id}：${value.title}`); });
    next.forEach((value, id) => {
      if (!prev.has(id)) result.push(`新增${label} ${id}：${value.title}`);
      else if (JSON.stringify(prev.get(id)) !== JSON.stringify(value)) result.push(`修改${label} ${id}：${value.title}`);
    });
    if (before[key].map(x => x.id).join() !== after[key].map(x => x.id).join() && before[key].length === after[key].length && before[key].every(x => next.has(x.id))) result.push(`${label}顺序已修改`);
  }
  return result;
}

export function parseWorkspace(raw: string): Workspace {
  if (new TextEncoder().encode(raw).length > 10 * 1024 * 1024) throw new Error('文件不能超过 10 MB。');
  let json: unknown;
  try { json = JSON.parse(raw); } catch { throw new Error('文件不是有效的 JSON。'); }
  const parsed = workspaceSchema.safeParse(json);
  if (!parsed.success) throw new Error(`数据结构不符合备份协议：${parsed.error.issues[0]?.path.join('.') || '根对象'}。请导入本工具的工作区备份 JSON。`);
  const w = parsed.data;
  const ids = new Set<string>();
  w.projects.forEach(p => {
    if (ids.has(p.id) || p.id !== p.task.id) throw new Error('任务 ID 重复或项目与任务 ID 不一致。');
    ids.add(p.id);
    for (const task of [p.task, ...p.versions.map(v => v.task)]) {
      if (task.id !== p.id) throw new Error('版本快照的任务 ID 不一致。');
      if (new Set(task.requirements.map(r => r.id)).size !== task.requirements.length || new Set(task.rules.map(r => r.id)).size !== task.rules.length) throw new Error('需求或规则 ID 重复。');
    }
    if (new Set(p.versions.map(v => v.id)).size !== p.versions.length || new Set(p.versions.map(v => v.number)).size !== p.versions.length) throw new Error('版本 ID 或编号重复。');
    Object.keys(p.review.marks).forEach(key => { if (!p.task.rules.some(r => r.id === key)) throw new Error('试评引用了不存在的规则。'); });
    p.versions.forEach(v => { if (validateTask(v.task).length) throw new Error('正式版本快照未通过质量检查。'); });
  });
  return w;
}
export function importProjects(raw: string): Project[] {
  return parseWorkspace(raw).projects.map(p => {
    const newId = uid();
    return { ...p, id: newId, task: { ...p.task, id: newId }, versions: p.versions.map(v => ({ ...v, id: uid(), task: { ...v.task, id: newId } })) };
  });
}
