import { parseWorkspace, type Tab } from './domain';
import { demoProject } from './templates';
import type { Workspace } from './model';
export const STORAGE_KEY = 'game-eval-studio.workspace.v1';
const VIEW_KEY = 'game-eval-studio.view.v1';
export function loadView(): { selected: string; tab: Tab } {
  try {
    const value = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? '{}');
    return { selected: typeof value?.selected === 'string' ? value.selected : '', tab: ['setup', 'requirements', 'rules', 'review', 'export'].includes(value?.tab) ? value.tab : 'requirements' };
  } catch { return { selected: '', tab: 'requirements' }; }
}
export function saveView(selected: string, tab: Tab) {
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ selected, tab })); } catch { /* View preferences are optional; workspace recovery stays available. */ }
}
export function loadWorkspace(): { workspace: Workspace; error: string | null; raw: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { workspace: raw ? parseWorkspace(raw) : { schemaVersion: 1, projects: [demoProject()] }, error: null, raw };
  } catch (e) {
    return { workspace: { schemaVersion: 1, projects: [] }, error: `本地题库无法读取：${e instanceof Error ? e.message : String(e)} 原数据未覆盖，请先下载原始数据备份。`, raw: null };
  }
}
