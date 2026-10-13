import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { BookOpen, Plus, Search, Download, Upload, Copy, Trash2, ArrowRight, Check, AlertCircle, ChevronDown, Layers3, FileText, ListChecks, SlidersHorizontal, ClipboardCheck, Package, X, CheckCircle2, Save, ShieldCheck, CircleHelp, ChevronRight, Gamepad2, Eye, LockKeyhole, History, ExternalLink } from 'lucide-react';
import { DOMAINS, DIMENSIONS, METHODS, emptyReview, newRequirement, newRule, uid, type Project, type Requirement, type Rule, type Task, type Workspace, type Version } from './model';
import { diffTasks, editTask, freezeVersion, importProjects, reviewSummary, validateTask, type Tab, type Issue } from './domain';
import { createProject, templateDescriptions } from './templates';
import { buildPackage, download, safeName, taskMarkdown } from './export';
import { loadView, loadWorkspace, saveView, STORAGE_KEY } from './storage';

const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: 'setup', label: '任务设定', icon: SlidersHorizontal },
  { id: 'requirements', label: '需求列表', icon: FileText },
  { id: 'rules', label: '评测规则', icon: ListChecks },
  { id: 'review', label: '专家试评', icon: ClipboardCheck },
  { id: 'export', label: '版本与导出', icon: Package },
];
const formatDate = (s: string) => new Date(s).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  const fieldId = useId();
  const control = isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, {
    'aria-labelledby': `${fieldId}-label`, 'aria-describedby': hint ? `${fieldId}-hint` : undefined,
    ...(children.type === 'textarea' || (children.type === 'input' && (children.props as { type?: string }).type !== 'number') ? { maxLength: (children.props as { maxLength?: number }).maxLength ?? 16000 } : {}),
  }) : children;
  return <label className={`field ${className}`}><span className="field-label" id={`${fieldId}-label`}>{label}</span>{control}{hint && <small id={`${fieldId}-hint`}>{hint}</small>}</label>;
}
function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current!; el.showModal(); return () => el.close(); }, []);
  return <dialog ref={ref} className={wide ? 'modal wide' : 'modal'} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={onClose}><X size={20} /></button></div>{children}
  </dialog>;
}
function NewTask({ onClose, onCreate }: { onClose: () => void; onCreate: (p: Project) => void }) {
  const [domain, setDomain] = useState<Task['domain']>('玩法逻辑');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [difficulty, setDifficulty] = useState<Task['difficulty']>('进阶');
  return <Modal title="新建评测任务" onClose={onClose} wide>
    <form onSubmit={e => { e.preventDefault(); onCreate(createProject(domain, title, brief, difficulty)); }}>
      <p className="muted">选一个任务领域，起草相互关联的需求和规则。模板在本地生成，之后由专家逐条校准。</p>
      <div className="template-grid">{DOMAINS.map(d => <button type="button" className={`template-option ${d === domain ? 'selected' : ''}`} key={d} aria-pressed={d === domain} onClick={() => setDomain(d)}><span>{d}<Check size={16} /></span><small>{templateDescriptions[d]}</small></button>)}</div>
      <Field label="任务名称"><input required maxLength={150} placeholder="例如：带缓冲跳跃的 2D 角色控制器" value={title} onChange={e => setTitle(e.target.value)} /></Field>
      <Field label="任务简述" hint="简述作为任务背景保留；模板不会自动理解和拆解任意自然语言。"><textarea required rows={3} placeholder="说明要开发什么、已有项目情况和关键约束…" value={brief} onChange={e => setBrief(e.target.value)} /></Field>
      <Field label="难度"><select value={difficulty} onChange={e => setDifficulty(e.target.value as Task['difficulty'])}>{['基础', '进阶', '专家'].map(d => <option key={d}>{d}</option>)}</select></Field>
      <div className="modal-actions"><button type="button" onClick={onClose} className="button secondary">取消</button><button className="button primary" type="submit"><Layers3 size={17} />从模板起草</button></div>
    </form>
  </Modal>;
}

export default function App() {
  const [initial] = useState(loadWorkspace);
  const [initialView] = useState(loadView);
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace);
  const [selected, setSelected] = useState(initial.workspace.projects.some(p => p.id === initialView.selected) ? initialView.selected : initial.workspace.projects[0]?.id ?? '');
  const [tab, setTab] = useState<Tab>(initialView.tab);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(initial.error);
  const [paused, setPaused] = useState(!!initial.error);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => void } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const lastWritten = useRef<string | null>(initial.raw);
  const latestWorkspace = useRef(workspace);
  const savePaused = useRef(paused);
  latestWorkspace.current = workspace;
  savePaused.current = paused;
  const p = workspace.projects.find(p => p.id === selected) ?? workspace.projects[0];
  const task = p?.task;
  const issues = task ? validateTask(task) : [];
  useEffect(() => { saveView(p?.id ?? '', tab); }, [p?.id, tab]);

  useEffect(() => {
    if (paused) return;
    setSaving(true);
    const timer = setTimeout(() => {
      try {
        const existing = localStorage.getItem(STORAGE_KEY);
        if (existing !== lastWritten.current) {
          setPaused(true); setStorageError('其他标签已修改题库，自动保存暂停。请先备份当前改动，再载入其他标签的数据。'); return;
        }
        const raw = JSON.stringify(workspace);
        localStorage.setItem(STORAGE_KEY, raw);
        lastWritten.current = raw;
        setStorageError(null); setSavedAt(new Date().toISOString());
      } catch { setStorageError('浏览器存储不可用或容量不足。当前改动仅保留在内存，请下载工作区备份。'); }
      finally { setSaving(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [workspace, paused]);
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if ((e.key === STORAGE_KEY || e.key === null) && e.newValue !== lastWritten.current) {
        setPaused(true); setSaving(false); setStorageError('其他标签已修改或清空题库，自动保存暂停。请先备份当前改动，再载入最新数据。');
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
  useEffect(() => {
    const flush = () => {
      if (savePaused.current) return;
      try {
        if (localStorage.getItem(STORAGE_KEY) !== lastWritten.current) return;
        const raw = JSON.stringify(latestWorkspace.current);
        localStorage.setItem(STORAGE_KEY, raw);
        lastWritten.current = raw;
      } catch { /* The live UI already reports storage errors; keep recovery data in memory. */ }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', flush); };
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  const update = (next: Project) => setWorkspace(w => ({ ...w, projects: w.projects.map(x => x.id === next.id ? next : x) }));
  const changeTask = (next: Task) => { if (p) update(editTask(p, next)); };
  const addProject = (project: Project) => {
    if (workspace.projects.length >= 100) { setNotice('最多保存 100 个任务，请先备份和整理题库。'); return; }
    setWorkspace(w => ({ ...w, projects: [project, ...w.projects] }));
    setSelected(project.id); setTab('setup'); setShowNew(false); setNotice('已生成模板草稿，请先补全评测环境。');
  };
  const go = (next: Tab, target?: string) => {
    setTab(next);
    if (target) setTimeout(() => {
      const el = document.getElementById(target);
      el?.scrollIntoView({ behavior: 'auto', block: 'center' });
      if (el instanceof HTMLDetailsElement) { el.open = true; el.querySelector<HTMLElement>('summary')?.focus(); }
      else if (el instanceof HTMLElement) el.focus();
    }, 50);
  };
  const backup = () => { download(JSON.stringify(workspace, null, 2), `game-eval-workspace-${new Date().toISOString().slice(0, 10)}.json`); setNotice('工作区备份已下载。'); };
  const loadLatest = () => {
    const loaded = loadWorkspace();
    if (loaded.error) { setStorageError(loaded.error); return; }
    setWorkspace(loaded.workspace); setSelected(loaded.workspace.projects[0]?.id ?? '');
    lastWritten.current = loaded.raw; setPaused(false); setStorageError(null); setNotice('已载入本地存储的最新题库。');
  };
  const downloadRaw = () => {
    try { download(localStorage.getItem(STORAGE_KEY) ?? '', 'game-eval-raw-recovery.txt', 'text/plain'); }
    catch { setConfirm({ title: '读取原始存储失败', message: '浏览器禁止读取本地存储。仍可下载当前题库备份，再检查浏览器的存储设置。', action: () => {} }); }
  };
  const resumeSaving = () => {
    try { lastWritten.current = localStorage.getItem(STORAGE_KEY); setPaused(false); setStorageError(null); }
    catch { setStorageError('浏览器禁止读取本地存储，无法恢复自动保存。请先下载当前题库备份。'); }
  };
  const readImport = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('文件不能超过 10 MB。');
      const imported = importProjects(await file.text());
      if (workspace.projects.length + imported.length > 100) throw new Error('导入后任务数超过 100，请先整理题库。');
      setWorkspace(w => ({ ...w, projects: [...imported, ...w.projects] }));
      if (imported[0]) setSelected(imported[0].id);
      setNotice(`已导入 ${imported.length} 个任务，现有任务未覆盖。`);
    } catch (e) { setConfirm({ title: '导入失败', message: e instanceof Error ? e.message : String(e), action: () => {} }); }
    finally { if (importInput.current) importInput.current.value = ''; }
  };

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <aside className="sidebar" aria-label="题库导航">
      <div className="brand"><div className="brand-mark"><Gamepad2 size={24} /></div><div><strong>GameEval <span>Studio</span></strong><small>游戏开发专家评测工作台</small></div></div>
      <button className="button sidebar-create" onClick={() => setShowNew(true)}><Plus size={19} />新建评测任务</button>
      <label className="sidebar-search"><Search size={17} /><input aria-label="搜索题库" placeholder="搜索任务或领域" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <div className="sidebar-heading"><span>我的题库</span><span>{workspace.projects.length}</span></div>
      <nav className="project-list">{workspace.projects.filter(p => `${p.task.title} ${p.task.domain}`.toLowerCase().includes(search.toLowerCase())).map(project => <button key={project.id} onClick={() => { setSelected(project.id); setTab('requirements'); }} className={`project-link ${p?.id === project.id ? 'active' : ''}`} aria-current={p?.id === project.id ? 'page' : undefined}>
        <span className="project-icon"><Layers3 size={18} /></span><span><strong>{project.task.title || '未命名任务'}</strong><small>{project.task.domain} <span>{project.versions.length ? `v${project.versions.at(-1)!.number} + 草稿` : '草稿'}</span></small></span>
      </button>)}{!workspace.projects.filter(p => `${p.task.title} ${p.task.domain}`.toLowerCase().includes(search.toLowerCase())).length && <p className="sidebar-empty">{workspace.projects.length ? '没有匹配的任务' : '从模板创建第一道评测题'}</p>}</nav>
      <div className="sidebar-bottom"><div className="local-notice"><span className="local-dot" /><strong>本地工作区</strong><p>数据保存在当前浏览器。定期下载备份，跨设备时再导入。</p></div><div className="sidebar-tools"><button onClick={backup}><Download size={16} />备份</button><button onClick={() => importInput.current?.click()}><Upload size={16} />导入</button></div><button className="help-link" onClick={() => setShowHelp(true)}><CircleHelp size={17} />操作与评测说明</button><div className="sidebar-version">GameEval Studio <span>1.0</span></div></div>
      <input type="file" hidden ref={importInput} accept="application/json,.json" aria-label="导入工作区备份" onChange={e => void readImport(e.target.files?.[0])} />
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><BookOpen size={17} /><span>评测题库</span><ChevronRight size={14} /><span>{task?.domain ?? '工作区'}</span></div><div className={`save-state ${storageError ? 'error-text' : ''}`} aria-live="polite">{storageError ? <AlertCircle size={15} /> : saving ? <Save size={15} /> : <CheckCircle2 size={15} />}<span>{storageError ? '保存需要处理' : saving ? '正在保存…' : savedAt ? '已自动保存' : '准备保存'}</span></div></header>
      {storageError && <div className="storage-banner" role="alert"><AlertCircle size={18} /><div><strong>{storageError}</strong><div className="inline-actions"><button onClick={backup}>备份当前题库</button><button onClick={downloadRaw}>下载原始存储</button>{paused && <><button onClick={loadLatest}>载入最新数据</button><button onClick={() => setConfirm({ title: '继续保存当前题库', message: '当前题库会替换浏览器中的题库。请确认已下载需要保留的原始数据和当前备份。', action: resumeSaving })}>用当前题库继续保存</button></>}</div></div></div>}
      {p && task ? <>
        <div className="task-header"><div><div className="title-meta"><span className="badge draft">编辑草稿</span><span>{task.difficulty}</span><span>{task.engine}</span></div><h1>{task.title || '未命名任务'}</h1><p>{task.brief}</p></div><div className="header-actions"><button className="icon-button" title="复制任务" aria-label="复制任务" onClick={() => { const id = uid(); addProject({ ...structuredClone(p), id, task: { ...structuredClone(task), id, title: `${task.title}（副本）` }, review: emptyReview(), versions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); }}><Copy size={18} /></button><button className="icon-button danger" title="删除任务" aria-label="删除任务" onClick={() => setConfirm({ title: '删除任务', message: `删除“${task.title}”及其本地版本记录。请先下载备份；其他任务不受影响。`, action: () => { setWorkspace(w => ({ ...w, projects: w.projects.filter(x => x.id !== p.id) })); setSelected(''); } })}><Trash2 size={18} /></button><button className="button primary" onClick={() => go('export')}><Package size={17} />交付评测包</button></div></div>
        <nav className="tabs" aria-label="评测制作流程">{tabs.map(item => <button className={tab === item.id ? 'active' : ''} key={item.id} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><item.icon size={17} /><span>{item.label}</span>{item.id === 'requirements' || item.id === 'rules' ? <span className="tab-count">{task[item.id].length}</span> : null}</button>)}</nav>
        <main id="main-content" tabIndex={-1} className="content-grid">
          <div className="page-content" key={p.id}>
            {tab === 'setup' && <Setup task={task} onChange={changeTask} />}
            {tab === 'requirements' && <Requirements task={task} versions={p.versions} onChange={changeTask} onConfirm={setConfirm} />}
            {tab === 'rules' && <Rules task={task} versions={p.versions} onChange={changeTask} onConfirm={setConfirm} />}
            {tab === 'review' && <TrialReview project={p} onChange={update} />}
            {tab === 'export' && <ExportPanel project={p} onChange={update} onNotice={setNotice} onGo={go} />}
          </div>
          <Quality task={task} issues={issues} go={go} />
        </main>
      </> : <main id="main-content" tabIndex={-1} className="empty-workspace"><div className="empty-symbol"><Layers3 size={42} /></div><h1>从一道好题开始</h1><p>将游戏开发需求变成可观察、可复现、可评判的任务。</p><button className="button primary" onClick={() => setShowNew(true)}><Plus size={18} />创建评测任务</button></main>}
      <footer className="workspace-footer"><span>需求可观察 · 标准可解释 · 结果可复现</span><span>数据仅保存在当前浏览器</span></footer>
    </div>
    {notice && <div className="toast" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {showNew && <NewTask onClose={() => setShowNew(false)} onCreate={addProject} />}
    {confirm && <Modal title={confirm.title} onClose={() => setConfirm(null)}><p>{confirm.message}</p><div className="modal-actions"><button className="button secondary" onClick={() => setConfirm(null)}>取消</button><button className="button primary" onClick={() => { confirm.action(); setConfirm(null); }}>确认</button></div></Modal>}
    {showHelp && <Modal title="操作与评测说明" onClose={() => setShowHelp(false)} wide><div className="help-content"><p>这是一款评测内容生产工具。它不会运行 coding agent、启动游戏或自动采集性能证据。</p><ol><li><strong>任务设定：</strong>从六类模板起草，替换仓库基线、引擎版本、入口与设备。</li><li><strong>需求列表：</strong>逐条写清开发内容、观察步骤和验收条件，避免“好看”“流畅”等模糊词。</li><li><strong>评测规则：</strong>关联需求，设置权重、方法、证据、0–4 分锚点。总权重必须为 100。</li><li><strong>专家试评：</strong>填写匿名提交标识和专家，逐条打分并记录证据。未评、缺证据或题目检查失败时结论待完成。硬门槛至少 3 分。</li><li><strong>版本与导出：</strong>修复质量问题，由专家确认后冻结快照。仅将 ZIP 的 agent/ 交给被测模型，expert/ 单独保管。</li></ol><div className="callout"><LockKeyhole size={20} /><p>数据保存在当前浏览器、当前网址。清理浏览器数据前先下载工作区备份；更换浏览器或端口需导入备份。证据字段保存引用文本，不上传附件。</p></div><p>起草使用确定性模板，没有连接生成模型。自定义任务需专家修改模板条目。冻结只发生在本地，不会发布到外部平台。</p><a href="https://github.com/waynchi/gamedevbench" target="_blank" rel="noreferrer">调研参考：GameDevBench <ExternalLink size={14} /></a></div></Modal>}
  </div>;
}

function Setup({ task: t, onChange }: { task: Task; onChange: (t: Task) => void }) {
  const field = (key: keyof Task, label: string, hint?: string, multi = false) => <Field key={key} label={label} hint={hint}>{multi ? <textarea id={key} rows={3} value={String(t[key])} onChange={e => onChange({ ...t, [key]: e.target.value })} /> : <input id={key} value={String(t[key])} onChange={e => onChange({ ...t, [key]: e.target.value })} />}</Field>;
  return <><SectionTitle title="先定义一场公平的评测" description="固定环境与范围，保证不同 agent 面对相同任务。" /><section className="panel"><h3>任务背景</h3>{field('title', '任务名称')}{field('brief', '任务简述', '描述交付目标和既有项目背景；修改后需自行同步相关需求。', true)}<div className="form-grid"><Field label="任务领域"><select value={t.domain} onChange={e => onChange({ ...t, domain: e.target.value as Task['domain'] })}>{DOMAINS.map(d => <option key={d}>{d}</option>)}</select></Field><Field label="难度"><select value={t.difficulty} onChange={e => onChange({ ...t, difficulty: e.target.value as Task['difficulty'] })}>{['基础', '进阶', '专家'].map(d => <option key={d}>{d}</option>)}</select></Field></div><p className="subtle-note">修改领域或难度仅更新元信息；需求和规则保留当前内容。</p></section><section className="panel"><h3>可复现的运行环境</h3><div className="form-grid">{field('engine', '引擎', 'Unity / Unreal / Godot / Web 或自定义')}{field('engineVersion', '引擎版本', '写明具体版本，避免使用 latest')}{field('platform', '目标平台')}{field('seed', '随机种子')}{field('baseline', '仓库基线', '仓库 URL + commit SHA / 项目归档标识')}{field('scene', '运行入口 / 场景', '场景路径、启动命令或构建入口')}</div>{field('hardware', '评测设备', 'CPU / GPU / 内存 / OS / 分辨率与构建配置')}{field('protocol', '运行协议', '固定输入序列、相机路径、预热与采样时间。', true)}</section><section className="panel"><h3>执行边界与交付</h3><div className="form-grid"><Field label="时间预算（分钟）"><input id="timeBudget" type="number" min={1} max={10080} value={t.timeBudget} onChange={e => onChange({ ...t, timeBudget: Number(e.target.value) })} /></Field><Field label="通过阈值（0–100）"><input id="passThreshold" type="number" min={0} max={100} value={t.passThreshold} onChange={e => onChange({ ...t, passThreshold: Number(e.target.value) })} /></Field></div>{field('constraints', '工具、联网与资产约束', undefined, true)}{field('deliverables', '交付物清单', undefined, true)}</section></>;
}
function SectionTitle({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="section-title"><div><h2>{title}</h2><p>{description}</p></div>{action}</div>; }

type ConfirmAction = { title: string; message: string; action: () => void };
function Requirements({ task, versions, onChange, onConfirm }: { task: Task; versions: Version[]; onChange: (t: Task) => void; onConfirm: (c: ConfirmAction) => void }) {
  const change = (req: Requirement) => onChange({ ...task, requirements: task.requirements.map(r => r.id === req.id ? req : r) });
  return <><SectionTitle title="把需求写成可验收的行为" description="每条需求回答：做什么、怎么观察、什么才算完成。" action={<button className="button secondary" disabled={task.requirements.length >= 200} onClick={() => onChange({ ...task, requirements: [...task.requirements, newRequirement(task, versions.flatMap(v => v.task.requirements))] })}><Plus size={16} />添加需求</button>} /><div className="callout compact"><Eye size={18} /><p>需求和验收条件对 agent 公开；私有规则只细化判断，不增加秘密功能。</p></div>{!task.requirements.length && <div className="empty-panel">没有需求。添加第一条需求，并写明观察步骤。</div>}
    <div className="item-list">{task.requirements.map((r, i) => {
      const covered = task.rules.filter(rule => rule.requirementIds.includes(r.id)).length;
      return <details className="editor-item" id={r.id} key={r.id} open={i === 0 ? true : undefined}><summary><span className="item-id">{r.id}</span><span className="item-title">{r.title || '未命名需求'}</span><span className={`priority ${r.priority.toLowerCase()}`}>{r.priority}</span><span className={`coverage-label ${covered ? '' : 'warning-text'}`}>{covered ? `${covered} 条规则` : '未覆盖'}</span><ChevronDown size={16} /></summary><div className="item-body"><div className="form-grid"><Field label={`${r.id} 需求名称`}><input value={r.title} onChange={e => change({ ...r, title: e.target.value })} /></Field><Field label={`${r.id} 优先级`}><select value={r.priority} onChange={e => change({ ...r, priority: e.target.value as Requirement['priority'] })}>{['P0', 'P1', 'P2'].map(v => <option key={v}>{v}</option>)}</select></Field></div><Field label={`${r.id} 所属领域`}><select value={r.domain} onChange={e => change({ ...r, domain: e.target.value as Requirement['domain'] })}>{DOMAINS.map(d => <option key={d}>{d}</option>)}</select></Field><Field label={`${r.id} 开发描述`}><textarea rows={2} value={r.description} onChange={e => change({ ...r, description: e.target.value })} /></Field><Field label={`${r.id} 观察步骤`} hint="给出输入、场景、次数与观察位置。"><textarea rows={2} value={r.steps} onChange={e => change({ ...r, steps: e.target.value })} /></Field><Field label={`${r.id} 验收条件`} hint="可观察的行为或有明确采样口径的阈值。"><textarea rows={3} value={r.acceptance} onChange={e => change({ ...r, acceptance: e.target.value })} /></Field><div className="item-footer"><span>{covered ? `关联 ${task.rules.filter(rule => rule.requirementIds.includes(r.id)).map(r => r.id).join('、')}` : '尚无评测规则，下一步建立关联。'}</span><button className="text-button danger" onClick={() => onConfirm({ title: '删除需求', message: `删除 ${r.id}？${covered ? `有 ${covered} 条规则引用此需求，删除后需修复规则关联。` : ''}`, action: () => onChange({ ...task, requirements: task.requirements.filter(req => req.id !== r.id) }) })}><Trash2 size={15} />删除需求</button></div></div></details>;
    })}</div><p className="subtle-note">修改任务定义会清空当前试评记录；已冻结版本不受影响。</p></>;
}

function Rules({ task, versions, onChange, onConfirm }: { task: Task; versions: Version[]; onChange: (t: Task) => void; onConfirm: (c: ConfirmAction) => void }) {
  const change = (rule: Rule) => onChange({ ...task, rules: task.rules.map(r => r.id === rule.id ? rule : r) });
  return <><SectionTitle title="让每一次评分都有依据" description="关联需求、选定观察方法，定义可解释的评分锚点。" action={<button className="button secondary" disabled={task.rules.length >= 300} onClick={() => onChange({ ...task, rules: [...task.rules, newRule(task, versions.flatMap(v => v.task.rules))] })}><Plus size={16} />添加规则</button>} /><div className="callout compact"><ShieldCheck size={18} /><p>硬门槛至少 3 分才通过。默认私有，公开规则会进入 agent 任务提示。</p></div>{!task.rules.length && <div className="empty-panel">没有规则。添加规则并关联需求。</div>}<div className="item-list">{task.rules.map((r, i) => <details key={r.id} id={r.id} className="editor-item" open={i === 0 ? true : undefined}><summary><span className="item-id">{r.id}</span><span className="item-title">{r.title || '未命名规则'}</span>{r.gate && <span className="badge gate">硬门槛</span>}<span className="weight-label">{r.weight}%</span><ChevronDown size={16} /></summary><div className="item-body"><Field label={`${r.id} 规则名称`}><input value={r.title} onChange={e => change({ ...r, title: e.target.value })} /></Field><fieldset className="associations"><legend>关联需求</legend><div className="association-options">{task.requirements.map(req => <label key={req.id}><input type="checkbox" checked={r.requirementIds.includes(req.id)} onChange={e => change({ ...r, requirementIds: e.target.checked ? [...r.requirementIds, req.id] : r.requirementIds.filter(id => id !== req.id) })} /><span>{req.id}<small>{req.title || '未命名'}</small></span></label>)}</div>{r.requirementIds.filter(id => !task.requirements.some(req => req.id === id)).map(id => <button key={id} className="text-button danger" onClick={() => change({ ...r, requirementIds: r.requirementIds.filter(x => x !== id) })}>移除失效关联 {id} <X size={14} /></button>)}</fieldset><div className="form-grid"><Field label={`${r.id} 评分维度`}><select value={r.dimension} onChange={e => change({ ...r, dimension: e.target.value as Rule['dimension'] })}>{DIMENSIONS.map(d => <option key={d}>{d}</option>)}</select></Field><Field label={`${r.id} 评测方法`}><select value={r.method} onChange={e => change({ ...r, method: e.target.value as Rule['method'] })}>{METHODS.map(d => <option key={d}>{d}</option>)}</select></Field><Field label={`${r.id} 权重（%）`}><input type="number" min={0} max={100} step="0.5" value={r.weight} onChange={e => change({ ...r, weight: Number(e.target.value) })} /></Field><Field label={`${r.id} 公开范围`}><select value={r.visibility} onChange={e => change({ ...r, visibility: e.target.value as Rule['visibility'] })}><option value="private">私有 · 仅专家可见</option><option value="public">公开 · agent 可见</option></select></Field></div><label className="check-field"><input type="checkbox" checked={r.gate} onChange={e => change({ ...r, gate: e.target.checked })} /><span>设为硬门槛 <small>低于 3 分，即使总分达标仍不通过</small></span></label><Field label={`${r.id} 证据要求`}><textarea rows={2} value={r.evidence} onChange={e => change({ ...r, evidence: e.target.value })} /></Field><div className="anchor-header"><h4>0–4 分评分锚点</h4><span>描述实际行为，减少专家间分歧</span></div><div className="anchors">{r.anchors.map((anchor, score) => <label key={score}><span className={`score-anchor score-${score}`}>{score}<small>{['未实现', '核心失败', '部分达标', '完整达标', '稳定验证'][score]}</small></span><textarea aria-label={`${r.id} ${score} 分锚点`} rows={2} value={anchor} onChange={e => { const anchors = [...r.anchors] as Rule['anchors']; anchors[score] = e.target.value; change({ ...r, anchors }); }} /></label>)}</div><div className="item-footer"><span>{r.visibility === 'private' ? <><LockKeyhole size={14} />私有评分规则</> : <><Eye size={14} />将在任务提示中公开</>}</span><button className="text-button danger" onClick={() => onConfirm({ title: '删除规则', message: `删除 ${r.id}？权重和需求覆盖需要重新检查。`, action: () => onChange({ ...task, rules: task.rules.filter(rule => rule.id !== r.id) }) })}><Trash2 size={15} />删除规则</button></div></div></details>)}</div></>;
}

function TrialReview({ project: p, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const review = p.review;
  const summary = reviewSummary(p.task, review);
  const update = (next: Project['review']) => onChange({ ...p, review: next, updatedAt: new Date().toISOString() });
  const mark = (id: string, patch: Partial<Project['review']['marks'][string]>) => update({ ...review, marks: { ...review.marks, [id]: { ...(review.marks[id] ?? { score: null, evidence: '' }), ...patch } } });
  return <><SectionTitle title="先试评，再校准标准" description="记录真实运行证据，检查评分锚点是否清晰。这里不执行游戏。" /><section className="panel"><div className="form-grid"><Field label="评审专家"><input value={review.reviewer} onChange={e => update({ ...review, reviewer: e.target.value })} placeholder="填写专家姓名或内部编号" /></Field><Field label="匿名提交标识"><input value={review.submission} onChange={e => update({ ...review, submission: e.target.value })} placeholder="例如：submission-014" /></Field></div><div className={`review-summary ${summary.complete ? 'complete' : ''}`}><div><strong>{summary.score.toFixed(1)}<small>/ 100</small></strong><span>{summary.complete ? '加权总分' : '已评分部分的临时分'}</span></div><div><span className={`badge ${summary.verdict === '通过' ? 'ready' : summary.complete ? 'error' : 'draft'}`}>{summary.verdict}</span><p>证据完整 {summary.evidenced} / {p.task.rules.length} · 通过阈值 {p.task.passThreshold}</p>{summary.failedGates.length > 0 && <p className="error-text">硬门槛失败：{summary.failedGates.map(r => r.id).join('、')}</p>}{!summary.valid && <p className="warning-text">任务质量检查未通过，暂不能生成正式结论。</p>}</div></div></section><div className="item-list">{p.task.rules.map(r => <section className="review-item" key={r.id}><div className="review-title"><span className="item-id">{r.id}</span><h3>{r.title || '未命名规则'}</h3>{r.gate && <span className="badge gate">硬门槛</span>}<span className="weight-label">{r.weight}%</span></div><p className="muted">{r.method} · {r.dimension}</p><div className="score-buttons" role="group" aria-label={`${r.id} 评分`}><button aria-pressed={review.marks[r.id]?.score == null} className={review.marks[r.id]?.score == null ? 'selected' : ''} onClick={() => mark(r.id, { score: null })}>未评</button>{[0, 1, 2, 3, 4].map(score => <button key={score} aria-label={`${r.id} 评分 ${score}`} title={r.anchors[score]} aria-pressed={review.marks[r.id]?.score === score} className={review.marks[r.id]?.score === score ? 'selected' : ''} onClick={() => mark(r.id, { score })}>{score}</button>)}</div><div className="selected-anchor">{review.marks[r.id]?.score != null ? r.anchors[review.marks[r.id].score!] : '选择分数后显示对应锚点。'}</div><Field label={`${r.id} 证据与评语`} hint={`所需证据：${r.evidence}`}><textarea rows={2} value={review.marks[r.id]?.evidence ?? ''} placeholder="例如：playthrough.mp4 00:12–00:38；日志路径；观察结果与扣分原因" onChange={e => mark(r.id, { evidence: e.target.value })} /></Field></section>)}</div><section className="panel"><Field label="标准校准备注"><textarea rows={3} value={review.notes} onChange={e => update({ ...review, notes: e.target.value })} placeholder="记录锚点歧义、采样限制与后续调整建议" /></Field><p className="subtle-note">修改需求或规则后，当前试评会清空，需在新标准上重新评判。</p></section></>;
}

function Quality({ task, issues, go }: { task: Task; issues: Issue[]; go: (tab: Tab, target?: string) => void }) {
  const [all, setAll] = useState(false);
  const covered = task.requirements.filter(r => task.rules.some(rule => rule.requirementIds.includes(r.id))).length;
  const total = task.rules.reduce((s, r) => s + r.weight, 0);
  return <aside className="quality-panel" aria-label="质量检查"><div className="quality-heading"><ShieldCheck size={20} /><h3>交付前检查</h3><span className={`status-dot ${issues.length ? 'warning' : 'good'}`} /></div><p>完整的标准，让评测可复现。</p><div className="quality-metrics"><div><span>需求覆盖</span><strong>{covered}<small> / {task.requirements.length}</small></strong></div><div className="progress-track"><span style={{ width: `${task.requirements.length ? covered / task.requirements.length * 100 : 0}%` }} /></div><div><span>规则权重</span><strong className={Math.abs(total - 100) < 0.001 ? '' : 'warning-text'}>{Number(total.toFixed(2))}<small> / 100</small></strong></div><div><span>硬门槛</span><strong>{task.rules.filter(r => r.gate).length}<small> 条</small></strong></div></div><div className={`quality-result ${issues.length ? '' : 'passed'}`}>{issues.length ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<strong>{issues.length ? `${issues.length} 项待完善` : '标准已就绪'}</strong></div>{issues.length ? <><ul className="issue-list">{(all ? issues : issues.slice(0, 4)).map(issue => <li key={issue.key}><button onClick={() => go(issue.tab, issue.target)}>{issue.message}<ArrowRight size={14} /></button></li>)}</ul>{issues.length > 4 && <button className="text-button" onClick={() => setAll(v => !v)}>{all ? '收起问题' : `查看全部 ${issues.length} 项`}</button>}</> : <p className="ready-copy">需求覆盖完整，权重闭合。仍需专家确认内容与阈值，再冻结版本。</p>}<div className="quality-divider" /><h4>评测约定</h4><ul className="conventions"><li><Check size={14} />0–4 分，按权重计入总分</li><li><Check size={14} />硬门槛需至少 3 分</li><li><Check size={14} />无证据时保留待评状态</li><li><LockKeyhole size={14} />私有规则与任务分开交付</li></ul><button className="button secondary full-width" onClick={() => go('export')}><Package size={16} />版本与交付</button></aside>;
}

function ExportPanel({ project: p, onChange, onNotice, onGo }: { project: Project; onChange: (p: Project) => void; onNotice: (s: string) => void; onGo: (tab: Tab) => void }) {
  const [reviewer, setReviewer] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState('draft');
  const version = p.versions.find(v => v.id === selectedVersion);
  const task = version?.task ?? p.task;
  const issues = validateTask(p.task);
  const differences = p.versions.length ? diffTasks(p.versions.at(-1)!.task, p.task) : [];
  const pack = async () => {
    setBusy(true); setError('');
    try { download(await buildPackage(p, version), `${safeName(task.title)}-${version ? `v${version.number}` : 'draft'}.zip`); onNotice('评测包已下载。仅将 agent 目录提供给被测模型。'); }
    catch (e) { setError(`导出失败：${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  return <><SectionTitle title="冻结标准，交付可复用的评测包" description="正式版本保留独立快照；草稿也可以导出用于讨论。" /><section className="panel freeze-panel"><div className="panel-icon"><ShieldCheck size={22} /></div><div className="freeze-content"><h3>专家确认与版本冻结</h3><p className="muted">确认任务范围、采样条件和评分锚点后，将当前标准冻结为 v{(p.versions.at(-1)?.number ?? 0) + 1}。</p><div className="form-grid"><Field label="确认专家"><input value={reviewer} onChange={e => setReviewer(e.target.value)} placeholder="专家姓名或编号" /></Field><Field label="评审说明"><input value={note} onChange={e => setNote(e.target.value)} placeholder="本版标准的确认依据或变更说明" /></Field></div>{issues.length > 0 && <p className="warning-text">还有 {issues.length} 项质量问题，修复后才能冻结。<button className="text-button" onClick={() => onGo(issues[0].tab)}>去修复 <ArrowRight size={14} /></button></p>}<button className="button primary" disabled={issues.length > 0 || !reviewer.trim() || !note.trim()} onClick={() => {
      try { const next = freezeVersion(p, reviewer, note); onChange(next); setSelectedVersion(next.versions.at(-1)!.id); setNote(''); setError(''); onNotice('已冻结版本，后续修改只影响草稿。'); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    }}><LockKeyhole size={16} />冻结当前标准</button></div></section><section className="panel"><div className="panel-heading"><h3><Download size={18} />交付文件</h3><Field label="导出版本"><select value={selectedVersion} onChange={e => setSelectedVersion(e.target.value)}><option value="draft">当前草稿（未冻结）</option>{[...p.versions].reverse().map(v => <option key={v.id} value={v.id}>v{v.number} · {v.reviewer}</option>)}</select></Field></div><div className="package-layout"><div className="package-tree"><div><Package size={17} />{version ? `v${version.number} 正式快照` : '草稿评测包'}</div><ul><li><span>agent/</span><small>交给被测模型</small><p>task.md · requirements.json / csv · task.jsonl</p></li><li><span>expert/</span><small>专家私有</small><p>rubric.private.json · rules.csv · protocol.md · evaluation.jsonl{version ? '' : ' · trial-review.json'}</p></li><li><span>manifest.json</span><small>SHA-256 文件校验和</small></li></ul></div><div className="package-actions"><p>仅提供 <strong>agent/</strong> 给被测模型，私有规则单独保管。</p><button className="button primary full-width" disabled={busy} onClick={() => void pack()}><Download size={17} />{busy ? '正在打包…' : '下载完整 ZIP'}</button><button className="button secondary full-width" onClick={() => download(taskMarkdown(task), `${safeName(task.title)}-task.md`, 'text/markdown')}><FileText size={16} />仅下载任务提示</button><button className="text-button" onClick={() => download(JSON.stringify({ schemaVersion: 1, taskId: task.id, rules: task.rules }, null, 2), `${safeName(task.title)}-rubric.private.json`)}>下载专家规则 JSON <ArrowRight size={14} /></button></div></div>{error && <p className="error-text" role="alert">{error}</p>}<details className="preview-details"><summary><Eye size={16} />预览 agent 任务提示 <ChevronDown size={15} /></summary><pre>{taskMarkdown(task)}</pre></details></section><section className="panel"><h3><History size={18} />版本记录</h3>{!p.versions.length ? <p className="muted">尚无冻结版本。先完成质量检查，再由专家确认。</p> : <><div className="version-list">{[...p.versions].reverse().map(v => <div key={v.id}><span className="version-number">v{v.number}</span><div><strong>{v.note}</strong><p>{v.reviewer} · {formatDate(v.createdAt)}</p></div><button className="text-button" onClick={() => { setSelectedVersion(v.id); onNotice(`导出版本已切换为 v${v.number}。`); }}>选择版本</button></div>)}</div><div className="version-diff"><h4>当前草稿相对 v{p.versions.at(-1)!.number}</h4>{differences.length ? <ul>{differences.map(d => <li key={d}>{d}</li>)}</ul> : <p>尚无内容变化。</p>}</div></>}</section><p className="subtle-note">导出是本工具的交换格式；实际执行需接入引擎运行器。冻结版本不附带当前草稿试评，避免混用不同标准。</p></>;
}
