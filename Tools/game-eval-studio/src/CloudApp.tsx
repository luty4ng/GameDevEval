import { useEffect, useRef, useState } from 'react';
import App from './App';
import { api } from './api';
import { defaultPreferences, type Preferences } from './preferences';
import type { Workspace } from './model';
import { AccountPanel } from './account';

export type User = { id: string; name: string; email: string; role: string; disabled: boolean };
type Profile = { user: User; preferences: Preferences };
export default function CloudApp() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(false);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const session = await api<{ user: User } | null>('/auth/get-session');
      if (!session) { setProfile(null); setWorkspace(null); return; }
      const [me, result] = await Promise.all([api<Profile>('/me'), api<{ revision: number; data: Workspace }>('/workspace')]);
      revision.current = result.revision; setProfile(me); setWorkspace(result.data);
    } catch (error) { setError(error instanceof Error ? error.message : '读取失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (!mounted.current) { mounted.current = true; void load(); } }, []);
  const [invite] = useState(() => new URLSearchParams(location.hash.slice(1)).get('invite') ?? '');
  if (loading) return <div className="auth-shell"><div className="panel" role="status">正在连接账户和题库…</div></div>;
  if (error) return <div className="auth-shell"><div className="panel"><p role="alert">{error}</p><button className="button primary" onClick={() => void load()}>重新连接</button><button className="button secondary" onClick={async () => { try { await api('/auth/sign-out', {}); location.reload(); } catch (e) { setError(String(e)); } }}>重新登录</button></div></div>;
  if (!profile || !workspace) return <Login invite={invite} onLogin={load} />;
  const logout = async () => {
    // Dirty-workspace warning is handled by App's beforeunload listener.
    if (!window.confirm('请确认题库已保存或已下载备份，再退出登录。')) return;
    try { await api('/auth/sign-out', {}); location.reload(); }
    catch (error) { window.alert(error instanceof Error ? error.message : '退出失败'); }
  };
  return <>
    <App key={profile.user.id} remote={{
      initial: workspace, preferences: profile.preferences ?? defaultPreferences,
      save: async data => {
        const result = await api<{ revision: number }>('/workspace', { revision: revision.current, data }, 'PUT');
        revision.current = result.revision;
      },
      reload: async () => {
        const result = await api<{ revision: number; data: Workspace }>('/workspace');
        revision.current = result.revision; return result.data;
      },
      toolbar: <div className="account-toolbar"><button className="button secondary" onClick={() => setSettings(true)}>账户与配置 · {profile.user.name}</button><button className="text-button" onClick={() => void logout()}>退出</button></div>,
    }} />
    {settings && <AccountPanel user={profile.user} preferences={profile.preferences} onClose={() => setSettings(false)} onSave={(name, preferences) => setProfile({ user: { ...profile.user, name }, preferences })} />}
  </>;
}

function Login({ invite, onLogin }: { invite: string; onLogin: () => Promise<void> }) {
  const [register, setRegister] = useState(!!invite);
  const [token, setToken] = useState(invite);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <main className="auth-shell"><section className="auth-card panel"><span className="eyebrow">GAMEEVAL STUDIO</span><h1>{register ? '接受专家邀请' : '登录评测工作台'}</h1><p className="muted">使用账户同步题库、评测规则和个人默认配置。</p>
    <form onSubmit={async event => {
      event.preventDefault(); setError(''); setMessage(''); setBusy(true);
      try {
        if (register) {
          if (password !== confirmation) throw new Error('两次输入的密码不一致');
          await api('/register', { token, email, name, password });
          history.replaceState(null, '', location.pathname); setToken(''); setPassword(''); setConfirmation(''); setRegister(false);
          setMessage('注册成功，请使用邮箱和密码登录。');
        } else { await api('/auth/sign-in/email', { email, password }); await onLogin(); }
      } catch (error) { setError(error instanceof Error ? error.message : '操作失败'); }
      finally { setBusy(false); }
    }}>
      {register && <><label className="field"><span>邀请令牌</span><input aria-label="邀请令牌" required value={token} onChange={e => setToken(e.target.value)} autoComplete="off" maxLength={64} /><small>由管理员提供，只能使用一次，有效期 7 天。</small></label><label className="field"><span>显示名称</span><input required value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={100} /></label></>}
      <label className="field"><span>邮箱</span><input aria-label="邮箱" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" maxLength={254} /><small>{register ? '必须与管理员邀请的邮箱一致。' : '忘记密码时，请联系管理员。'}</small></label>
      <label className="field"><span>密码</span><input aria-label="密码" type="password" required minLength={register ? 15 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} autoComplete={register ? 'new-password' : 'current-password'} /><small>注册密码至少 15 个字符，建议使用独立的长密码。</small></label>
      {register && <label className="field"><span>确认密码</span><input type="password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="new-password" maxLength={128} /></label>}
      {error && <p role="alert" className="error-text">{error}</p>}{message && <p role="status">{message}</p>}
      <button disabled={busy} className="button primary full-width">{busy ? '处理中…' : register ? '注册账户' : '登录'}</button>
    </form><button className="text-button" onClick={() => { setRegister(!register); setError(''); setPassword(''); }}>{register ? '已有账户，前往登录' : '已有邀请，注册账户'}</button><p className="subtle-note">题库按账户隔离。旧版浏览器题库请先下载 JSON 备份，登录后手动导入。</p>
  </section></main>;
}
