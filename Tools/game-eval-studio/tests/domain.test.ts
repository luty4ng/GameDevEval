import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createProject, demoProject } from '../src/templates';
import { DOMAINS, emptyReview, newRequirement, newRule } from '../src/model';
import { diffTasks, editTask, freezeVersion, importProjects, parseWorkspace, reviewSummary, validateTask } from '../src/domain';
import { buildPackage, csv, packageFiles, taskMarkdown } from '../src/export';

function validProject() {
  const p = createProject('图形与地形', '地形评测', '构建无裂缝 GPU 地形', '专家');
  p.task.baseline = 'https://example.com/game.git @ a1b2c3d4';
  p.task.scene = 'Assets/Scenes/Benchmark.unity';
  p.task.hardware = 'Windows 11 / RTX 3060 / 16GB / 1920×1080 / Release';
  return p;
}
function scoredProject(score = 4) {
  const p = validProject();
  p.review = { reviewer: 'expert-01', submission: 'anon-07', notes: '', marks: Object.fromEntries(p.task.rules.map(r => [r.id, { score, evidence: 'run.mp4 00:10–00:50 + log.json' }])) };
  return p;
}

describe('模板与质量约束', () => {
  it.each(DOMAINS)('%s 模板生成互相覆盖且权重闭合的草稿', domain => {
    const p = createProject(domain, '测试', '简述');
    expect(p.task.rules.reduce((s, r) => s + r.weight, 0)).toBe(100);
    expect(p.task.requirements.every(req => p.task.rules.some(rule => rule.requirementIds.includes(req.id)))).toBe(true);
    expect(validateTask(p.task).map(i => i.key)).toEqual(['baseline', 'scene', 'hardware']);
  });
  it('示例占位信息不允许冻结', () => {
    expect(validateTask(demoProject().task).map(i => i.key)).toEqual(['baseline', 'scene', 'hardware']);
    expect(() => freezeVersion(demoProject(), '专家', '确认')).toThrow();
  });
  it('空白环境、评分锚点、权重和覆盖均可发现', () => {
    const p = validProject();
    p.task.engineVersion = ' ';
    p.task.rules[0].anchors[3] = '';
    p.task.rules[0].weight = 1;
    p.task.rules[1].requirementIds = [];
    const keys = validateTask(p.task).map(i => i.key);
    expect(keys).toContain('engineVersion'); expect(keys).toContain('weights');
    expect(keys).toContain('RULE-001-anchor'); expect(keys).toContain('uncovered-REQ-002');
  });
  it('删除需求产生悬空规则，新增需求不会复用悬空 ID', () => {
    const p = validProject();
    p.task.requirements = p.task.requirements.filter(r => r.id !== 'REQ-005');
    expect(validateTask(p.task).some(i => i.message.includes('已不存在的 REQ-005'))).toBe(true);
    expect(newRequirement(p.task).id).toBe('REQ-006');
  });
  it('可运行性门槛必须存在', () => {
    const p = validProject(); p.task.rules[0].gate = false;
    expect(validateTask(p.task).some(i => i.key === 'gate')).toBe(true);
  });
  it('拒绝重复 ID、重复关联、零权重与空证据', () => {
    const p = validProject(); p.task.rules[0].weight = 0;
    p.task.rules[0].evidence = ''; p.task.rules[0].requirementIds.push('REQ-001');
    p.task.requirements[1].id = 'REQ-001'; p.task.rules[1].id = 'RULE-001';
    const keys = validateTask(p.task).map(i => i.key);
    expect(keys).toContain('RULE-001-weight'); expect(keys).toContain('RULE-001-evidence');
    expect(keys).toContain('RULE-001-duplicate-ref'); expect(keys).toContain('dup-REQ-001'); expect(keys).toContain('dup-rule-RULE-001');
  });
  it('新规则需专家完善，初始不会静默通过检查', () => {
    const p = validProject(); p.task.rules.push(newRule(p.task));
    expect(validateTask(p.task).some(i => i.key === 'RULE-006-ref')).toBe(true);
  });
  it('新增条目不会复用冻结历史中的 ID，差异正确区分删除与新增', () => {
    const p = freezeVersion(validProject(), '专家', '确认');
    p.task.requirements = p.task.requirements.slice(0, -1);
    p.task.rules = p.task.rules.slice(0, -1);
    const req = newRequirement(p.task, p.versions.flatMap(v => v.task.requirements));
    const rule = newRule(p.task, p.versions.flatMap(v => v.task.rules));
    expect(req.id).toBe('REQ-006'); expect(rule.id).toBe('RULE-006');
    p.task.requirements.push(req); p.task.rules.push(rule);
    const diff = diffTasks(p.versions[0].task, p.task);
    expect(diff.some(x => x.startsWith('删除需求 REQ-005'))).toBe(true);
    expect(diff.some(x => x.startsWith('新增需求 REQ-006'))).toBe(true);
    expect(diff.some(x => x.startsWith('删除规则 RULE-005'))).toBe(true);
    expect(diff.some(x => x.startsWith('新增规则 RULE-006'))).toBe(true);
  });
});

describe('试评和版本', () => {
  it('完全达标得 75 分并通过，满分为 100', () => {
    for (const [s, total] of [[3, 75], [4, 100]]) {
      const p = scoredProject(s); expect(reviewSummary(p.task, p.review)).toMatchObject({ score: total, verdict: '通过', complete: true });
    }
  });
  it('未评分保持待完成，不能把缺失当成零分', () => {
    const p = scoredProject(); p.review.marks['RULE-001'].score = null;
    expect(reviewSummary(p.task, p.review)).toMatchObject({ score: 80, verdict: '待完成', complete: false });
  });
  it('有分但无证据、无专家或无匿名提交都不能完成', () => {
    const p = scoredProject(); p.review.marks['RULE-002'].evidence = ' ';
    expect(reviewSummary(p.task, p.review).verdict).toBe('待完成');
    p.review.marks['RULE-002'].evidence = '证据'; p.review.reviewer = '';
    expect(reviewSummary(p.task, p.review).complete).toBe(false);
    p.review.reviewer = '专家'; p.review.submission = '';
    expect(reviewSummary(p.task, p.review).complete).toBe(false);
  });
  it('门槛失败压过高总分，零分是已评而非未评', () => {
    const p = scoredProject(); p.review.marks['RULE-001'].score = 0;
    expect(reviewSummary(p.task, p.review)).toMatchObject({ score: 80, marked: 5, verdict: '不通过：硬门槛失败' });
  });
  it('阈值不达标，即使门槛通过也失败', () => {
    const p = scoredProject(3); p.task.passThreshold = 90;
    expect(reviewSummary(p.task, p.review).verdict).toBe('不通过：未达阈值');
  });
  it('题目检查失败，试评不能出正式结论', () => {
    const p = scoredProject(); p.task.hardware = '';
    expect(reviewSummary(p.task, p.review).verdict).toBe('待完成');
  });
  it('任何题目变更会使旧试评失效', () => {
    const p = scoredProject(); const edited = editTask(p, { ...p.task, title: '新任务' });
    expect(edited.review).toEqual(emptyReview()); expect(p.review.reviewer).toBe('expert-01');
  });
  it('冻结快照独立，修改草稿不会改旧版本', () => {
    const p = freezeVersion(validProject(), '专家', '确认采样口径');
    p.task.rules[0].anchors[3] = '新锚点'; p.task.requirements[0].title = '新名称';
    expect(p.versions[0].task.rules[0].anchors[3]).not.toBe('新锚点');
    expect(diffTasks(p.versions[0].task, p.task)).toEqual(['修改需求 REQ-001：新名称', '修改规则 RULE-001：项目构建与可运行交付']);
    expect(freezeVersion(p, '另一专家', '复核').versions[1].number).toBe(2);
  });
  it('确认人和评审说明缺失时不能冻结', () => {
    expect(() => freezeVersion(validProject(), '', '确认')).toThrow();
    expect(() => freezeVersion(validProject(), '专家', ' ')).toThrow();
  });
});

describe('备份与导出隔离', () => {
  it('完整备份回导分配新项目 ID，保留版本与内容', () => {
    const p = freezeVersion(validProject(), '专家', '确认');
    const raw = JSON.stringify({ schemaVersion: 1, projects: [p] });
    expect(parseWorkspace(raw).projects[0].task).toEqual(p.task);
    const [copy] = importProjects(raw);
    expect(copy.id).not.toBe(p.id); expect(copy.task.id).toBe(copy.id); expect(copy.versions[0].task.id).toBe(copy.id);
    expect(copy.task.title).toBe(p.task.title);
  });
  it('拒绝损坏、未知版本、恶意字段和无效评分', () => {
    expect(() => parseWorkspace('{')).toThrow('有效的 JSON');
    expect(() => parseWorkspace('{"schemaVersion":2,"projects":[]}')).toThrow('数据结构');
    const p = scoredProject();
    expect(() => parseWorkspace(JSON.stringify({ schemaVersion: 1, projects: [p], script: 'alert(1)' }))).toThrow();
    p.review.marks['RULE-001'].score = 9;
    expect(() => parseWorkspace(JSON.stringify({ schemaVersion: 1, projects: [p] }))).toThrow();
  });
  it('超大、重复项目与无效正式快照导入被拒绝', () => {
    expect(() => parseWorkspace('a'.repeat(10 * 1024 * 1024 + 1))).toThrow('10 MB');
    const p = validProject(); expect(() => parseWorkspace(JSON.stringify({ schemaVersion: 1, projects: [p, p] }))).toThrow('任务 ID');
    const frozen = freezeVersion(p, '专家', '确认'); frozen.versions[0].task.hardware = '';
    expect(() => parseWorkspace(JSON.stringify({ schemaVersion: 1, projects: [frozen] }))).toThrow('快照');
  });
  it('草稿中未完成的数值仍可备份恢复，正式冻结由质量校验阻止', () => {
    const p = validProject(); p.task.timeBudget = 0; p.task.rules[0].weight = -1;
    const parsed = parseWorkspace(JSON.stringify({ schemaVersion: 1, projects: [p] }));
    expect(parsed.projects[0].task.timeBudget).toBe(0);
    expect(validateTask(parsed.projects[0].task).some(i => i.key === 'timeBudget')).toBe(true);
    expect(() => freezeVersion(parsed.projects[0], '专家', '确认')).toThrow();
  });
  it('CSV 保留引号和换行，防御表格公式注入', () => {
    const result = csv([['=1+1', ' @SUM(1)', '\tformula', '普通,"内容"\n多行', '-cmd']]);
    expect(result).toContain('"\'=1+1"'); expect(result).toContain('"\' @SUM(1)"');
    expect(result).toContain('"\'\tformula"'); expect(result).toContain('"普通,""内容""\n多行"'); expect(result).toContain('"\'-cmd"');
  });
  it('agent 文件不泄漏私有规则锚点和证据', () => {
    const p = validProject(); p.task.rules[0].anchors[3] = 'SECRET_ANCHOR'; p.task.rules[0].evidence = 'SECRET_EVIDENCE';
    const files = packageFiles(p);
    for (const [name, content] of Object.entries(files)) if (name.startsWith('agent/')) {
      expect(content).not.toContain('SECRET_ANCHOR'); expect(content).not.toContain('SECRET_EVIDENCE');
    }
    expect(files['expert/rubric.private.json']).toContain('SECRET_ANCHOR');
    p.task.rules[0].visibility = 'public';
    expect(taskMarkdown(p.task)).toContain('SECRET_ANCHOR');
  });
  it('旧版本导出仍来自旧快照且不带新草稿试评', () => {
    const p = freezeVersion(scoredProject(), '专家', '确认');
    p.task.title = '后续新名称';
    const files = packageFiles(p, p.versions[0]);
    expect(files['agent/task.md']).toContain('# 地形评测');
    expect(files['agent/task.md']).not.toContain('后续新名称');
    expect(files['expert/trial-review.json']).toBeUndefined();
  });
  it('ZIP manifest 哈希确实对应 UTF-8 文件内容', async () => {
    const p = validProject(); const blob = await buildPackage(p);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.status).toBe('draft'); expect(manifest.version).toBeNull();
    for (const [name, hash] of Object.entries(manifest.files)) {
      const raw = await zip.file(name)!.async('string');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const actual = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
      expect(actual).toBe(hash);
    }
  });
});
