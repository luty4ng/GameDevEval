import { z } from 'zod';

export const DOMAINS = ['玩法逻辑', '图形与地形', '战斗与 AI', '游戏 UI', '性能优化', '完整小游戏'] as const;
export const METHODS = ['静态检查', '自动化运行', '性能采样', '视觉检查', '专家试玩'] as const;
export const DIMENSIONS = ['可运行性', '功能正确性', '视觉表现', '交互体验', '稳定性', '性能', '工程质量'] as const;
const text = z.string().max(16000);
const id = z.string().min(1).max(100);
export const requirementSchema = z.object({
  id, title: text, domain: z.enum(DOMAINS), priority: z.enum(['P0', 'P1', 'P2']),
  description: text, steps: text, acceptance: text,
}).strict();
export const ruleSchema = z.object({
  id, title: text, requirementIds: z.array(id).max(200), dimension: z.enum(DIMENSIONS),
  method: z.enum(METHODS), weight: z.number().finite(),
  gate: z.boolean(), visibility: z.enum(['private', 'public']), evidence: text,
  anchors: z.tuple([text, text, text, text, text]),
}).strict();
export const taskSchema = z.object({
  id, title: text, brief: text, domain: z.enum(DOMAINS), difficulty: z.enum(['基础', '进阶', '专家']),
  engine: text, engineVersion: text, platform: text, baseline: text, scene: text,
  seed: text, timeBudget: z.number().finite(), hardware: text,
  protocol: text, constraints: text, deliverables: text,
  passThreshold: z.number().finite(),
  requirements: z.array(requirementSchema).max(200), rules: z.array(ruleSchema).max(300),
}).strict();
const markSchema = z.object({ score: z.number().int().min(0).max(4).nullable(), evidence: text }).strict();
export const reviewSchema = z.object({ reviewer: text, submission: text, notes: text, marks: z.record(id, markSchema) }).strict();
export const versionSchema = z.object({
  id, number: z.number().int().min(1), createdAt: text, reviewer: text.min(1), note: text.min(1), task: taskSchema,
}).strict();
export const projectSchema = z.object({
  id, createdAt: text, updatedAt: text, task: taskSchema, review: reviewSchema,
  versions: z.array(versionSchema).max(100),
}).strict();
export const workspaceSchema = z.object({ schemaVersion: z.literal(1), projects: z.array(projectSchema).max(100) }).strict();
export type Requirement = z.infer<typeof requirementSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Version = z.infer<typeof versionSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export const uid = () => crypto.randomUUID();
export const emptyReview = (): Review => ({ reviewer: '', submission: '', notes: '', marks: {} });
export const nextId = (prefix: string, items: { id: string }[]) => {
  const n = items.reduce((max, x) => {
    const value = x.id.startsWith(`${prefix}-`) ? Number(x.id.slice(prefix.length + 1)) : 0;
    return Number.isSafeInteger(value) && value >= 0 ? Math.max(max, value) : max;
  }, 0) + 1;
  return `${prefix}-${String(n).padStart(3, '0')}`;
};

export function newRequirement(task: Task, history: Requirement[] = []): Requirement {
  return { id: nextId('REQ', [...task.requirements, ...history, ...task.rules.flatMap(r => r.requirementIds.map(id => ({ id })))]), title: '', domain: task.domain, priority: 'P0', description: '', steps: '', acceptance: '' };
}
export function newRule(task: Task, history: Rule[] = []): Rule {
  return { id: nextId('RULE', [...task.rules, ...history]), title: '', requirementIds: [], dimension: '功能正确性', method: '专家试玩', weight: 0, gate: false, visibility: 'private', evidence: '', anchors: ['', '', '', '', ''] };
}
