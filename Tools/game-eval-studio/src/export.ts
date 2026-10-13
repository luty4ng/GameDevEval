import { reviewSummary, validateTask } from './domain';
import type { Project, Task, Version } from './model';

const safeInline = (s: string) => s.replace(/[\r\n]/g, ' ');
export const safeName = (s: string) => (s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 80) || 'task');
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
export function csv(rows: unknown[][]): string {
  return '\ufeff' + rows.map(row => row.map(value => {
    let s = String(value ?? '');
    if (/^[\s\uFEFF]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
}
export function taskMarkdown(t: Task): string {
  const publicRules = t.rules.filter(r => r.visibility === 'public');
  return `# ${safeInline(t.title)}\n\n${t.brief}\n\n## 任务条件\n\n- 引擎：${safeInline(t.engine)} ${safeInline(t.engineVersion)}\n- 平台：${safeInline(t.platform)}\n- 基线：${safeInline(t.baseline)}\n- 场景/入口：${safeInline(t.scene)}\n- 设备：${safeInline(t.hardware)}\n- 随机种子：${safeInline(t.seed)}\n- 时间预算：${t.timeBudget} 分钟\n- 难度：${t.difficulty}\n\n## 开发需求\n\n${t.requirements.map(r => `### ${r.id} ${safeInline(r.title)} (${r.priority})\n\n${r.description}\n\n观察步骤：${r.steps}\n\n验收条件：${r.acceptance}`).join('\n\n')}\n\n## 公共运行条件\n\n${t.protocol}\n\n## 工具与资产约束\n\n${t.constraints}\n\n## 交付物\n\n${t.deliverables}\n${publicRules.length ? `\n## 公开评分规则\n\n${publicRules.map(r => `### ${r.id} ${safeInline(r.title)}\n\n权重：${r.weight}；硬门槛：${r.gate ? '是（至少 3 分）' : '否'}\n\n${r.anchors.map((a, i) => `${i} 分：${a}`).join('\n\n')}`).join('\n\n')}\n` : ''}`;
}
export function packageFiles(p: Project, version?: Version): Record<string, string> {
  const t = version?.task ?? p.task;
  const label = version ? `v${version.number}` : 'draft';
  const issues = validateTask(t);
  const { rules, ...agentTask } = t;
  const agent = { ...agentTask, publicRules: rules.filter(r => r.visibility === 'public') };
  const files: Record<string, string> = {
    'agent/task.md': taskMarkdown(t),
    'agent/requirements.json': json({ schemaVersion: 1, taskId: t.id, requirements: t.requirements }),
    'agent/requirements.csv': csv([['ID', '需求', '领域', '优先级', '描述', '观察步骤', '验收条件'], ...t.requirements.map(r => [r.id, r.title, r.domain, r.priority, r.description, r.steps, r.acceptance])]),
    'expert/rubric.private.json': json({ schemaVersion: 1, taskId: t.id, passThreshold: t.passThreshold, rules: t.rules }),
    'expert/rules.csv': csv([['ID', '规则', '关联需求', '维度', '方法', '权重', '硬门槛', '公开性', '证据要求', '0分', '1分', '2分', '3分', '4分'], ...t.rules.map(r => [r.id, r.title, r.requirementIds.join(';'), r.dimension, r.method, r.weight, r.gate, r.visibility, r.evidence, ...r.anchors])]),
    'expert/protocol.md': `# 专家评测协议\n\n任务：${t.title}\n\n版本：${label}\n\n${version ? `确认专家：${version.reviewer}\n\n评审说明：${version.note}` : `草稿，尚未冻结。质量问题：${issues.length}\n\n${issues.map(i => `- ${i.message}`).join('\n')}`}\n\n## 环境\n\n引擎 ${t.engine} ${t.engineVersion}；平台 ${t.platform}；基线 ${t.baseline}；入口 ${t.scene}；seed ${t.seed}；设备 ${t.hardware}。\n\n${t.protocol}\n\n## 判定\n\n总分 Σ(权重 × 评分 / 4)，通过阈值 ${t.passThreshold}。每条规则需 0–4 分与证据；硬门槛至少 3 分才通过。未评或缺证据时结论待完成，不将缺失当作零分。\n\n仅观察与执行交付物，勿让 agent 接触 expert 目录。隐藏规则不得增加公开需求之外的功能。采用匿名提交标识，固定操作轨迹、分辨率、输入回放和采样方法；自动检查与专家试玩结论分别留证。\n\n## 规则\n\n${t.rules.map(r => `### ${r.id} ${r.title}\n\n关联：${r.requirementIds.join(', ')}；维度：${r.dimension}；方法：${r.method}；权重：${r.weight}；硬门槛：${r.gate ? '是' : '否'}\n\n证据：${r.evidence}\n\n${r.anchors.map((a, i) => `${i} 分：${a}`).join('\n\n')}`).join('\n\n')}\n`,
    'expert/evaluation.jsonl': JSON.stringify({ schemaVersion: 1, format: 'game-eval-studio', status: label, versionId: version?.id ?? null, task: t }) + '\n',
    'agent/task.jsonl': JSON.stringify({ schemaVersion: 1, format: 'game-eval-studio-agent', status: label, versionId: version?.id ?? null, task: agent }) + '\n',
    'README.md': `# ${t.title} · ${label}\n\n仅将 agent/ 交给被测 coding agent。expert/ 包含私有规则与专家资料，须隔离存放。\n\n格式为 GameEval Studio 自有交换协议，不是 Promptfoo / SWE-bench 可直接运行的配置。运行器须读取任务环境并实现规则检查；本工具不会运行引擎或采集证据。\n\n此包${version ? '来自冻结快照' : '是尚未批准的草稿'}。manifest.json 提供 UTF-8 文件内容的 SHA-256 校验和。备份/恢复请使用工作区备份 JSON，此 ZIP 不用于恢复题库。\n`,
  };
  // Trial review belongs to the current draft; never attach it to a frozen version.
  if (!version) files['expert/trial-review.json'] = json({ taskId: t.id, review: p.review, summary: reviewSummary(t, p.review) });
  return files;
}
export async function buildPackage(p: Project, version?: Version): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const files = packageFiles(p, version);
  const hashes: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    hashes[name] = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }
  const zip = new JSZip();
  Object.entries(files).forEach(([name, content]) => zip.file(name, content));
  zip.file('manifest.json', json({ schemaVersion: 1, taskId: p.id, version: version?.number ?? null, status: version ? 'frozen' : 'draft', exportedAt: new Date().toISOString(), files: hashes }));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
export function download(content: Blob | string, name: string, type = 'application/json') {
  const blob = typeof content === 'string' ? new Blob([content], { type: `${type};charset=utf-8` }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
