import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Preferences } from './preferences';
import type { User } from './CloudApp';

type Invite = { id: string; email: string; expires_at: string; redeemed_at: string | null; revoked_at: string | null };
export function AccountPanel({ user, preferences, onClose, onSave }: { user: User; preferences: Preferences; onClose: () => void; onSave: (name: string, preferences: Preferences) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(user.name);
  const [prefs, setPrefs] = useState(preferences);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const action = async (run: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await run(); } catch (error) { setError(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusy(false); }
  };
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close(); }, []);
  return <dialog className="modal wide account-modal" ref={dialog} aria-label="账户与配置" onCancel={onClose}><div className="modal-header"><h2>账户与配置</h2><button aria-label="关闭对话框" className="button secondary" onClick={onClose}>关闭</button></div>
    <div className="help-content"><p>{user.email} · {user.role === 'admin' ? '管理员' : '专家'}</p>
      {error && <p className="error-text" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <form onSubmit={e => { e.preventDefault(); void action(async () => { await api('/preferences', { name, preferences: prefs }, 'PUT'); onSave(name, prefs); setMessage('个人资料与默认配置已保存。'); }); }}>
        <h3>个人与评测默认配置</h3><p className="muted">仅用于之后的新建任务，不修改已有题目。</p>
        <label className="field"><span>显示名称</span><input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
        <div className="form-grid">{(['engine', 'engineVersion', 'platform'] as const).map((key, i) => <label className="field" key={key}><span>{['默认引擎', '默认引擎版本', '默认平台'][i]}</span><input required maxLength={100} value={prefs[key]} onChange={e => setPrefs({ ...prefs, [key]: e.target.value })} /></label>)}
          <label className="field"><span>默认难度</span><select aria-label="默认难度" value={prefs.difficulty} onChange={e => setPrefs({ ...prefs, difficulty: e.target.value as Preferences['difficulty'] })}>{['基础', '进阶', '专家'].map(d => <option key={d}>{d}</option>)}</select></label>
          <label className="field"><span>默认时间预算（分钟）</span><input type="number" min={1} max={10080} required value={prefs.timeBudget} onChange={e => setPrefs({ ...prefs, timeBudget: Number(e.target.value) })} /></label>
          <label className="field"><span>默认通过阈值</span><input type="number" min={0} max={100} step="0.5" required value={prefs.passThreshold} onChange={e => setPrefs({ ...prefs, passThreshold: Number(e.target.value) })} /></label>
        </div><button className="button primary" disabled={busy}>保存配置</button>
      </form>
      <form onSubmit={e => { e.preventDefault(); void action(async () => {
        if (newPassword !== confirmation) throw new Error('两次输入的密码不一致');
        await api('/auth/change-password', { currentPassword, newPassword, revokeOtherSessions: true });
        setCurrentPassword(''); setNewPassword(''); setConfirmation(''); setMessage('密码已更新，其他设备的会话已撤销。');
      }); }}><h3>修改密码</h3><div className="form-grid"><label className="field"><span>当前密码</span><input type="password" required autoComplete="current-password" maxLength={128} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label><label className="field"><span>新密码</span><input type="password" required minLength={15} maxLength={128} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label><label className="field"><span>再次输入新密码</span><input type="password" required autoComplete="new-password" maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label></div><button className="button secondary" disabled={busy}>更新密码</button></form>
      {user.role === 'admin' && <AdminUsers onError={setError} />}
    </div>
  </dialog>;
}

function AdminUsers({ onError }: { onError: (message: string) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    const [users, invites] = await Promise.all([api<User[]>('/admin/users'), api<Invite[]>('/admin/invites')]);
    setUsers(users); setInvites(invites);
  };
  const action = async (run: () => Promise<void>) => { setBusy(true); onError(''); try { await run(); await reload(); } catch (e) { onError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); } };
  useEffect(() => { void reload().catch(e => onError(e.message)); }, []);
  return <section><h3>用户管理</h3><p className="muted">仅管理员可邀请和停用普通用户。邀请链接只在创建时展示一次，请通过你的可信渠道交付。</p>
    <form className="invite-form" onSubmit={e => { e.preventDefault(); void action(async () => { const result = await api<{ url: string }>('/admin/invites', { email }); setLink(result.url); setEmail(''); }); }}><label className="field"><span>邀请邮箱</span><input type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label><button className="button primary" disabled={busy}>创建邀请</button></form>
    {link && <label className="field"><span>新邀请链接（请复制保存）</span><input readOnly value={link} onFocus={e => e.target.select()} /></label>}
    <div className="account-list" aria-label="用户列表">{users.map(user => <div className="account-row" key={user.id}><span><strong>{user.name}</strong><small>{user.email} · {user.role === 'admin' ? '管理员' : user.disabled ? '已停用' : '可用'}</small></span>{user.role !== 'admin' && <button className="button secondary" disabled={busy} onClick={() => { if (window.confirm(user.disabled ? '启用此用户？' : '停用此用户并立即撤销登录会话？')) void action(async () => { await api(`/admin/users/${encodeURIComponent(user.id)}`, { disabled: !user.disabled }, 'PUT'); }); }}>{user.disabled ? '启用' : '停用'}</button>}</div>)}</div>
    <h4>邀请记录</h4><div className="account-list">{invites.map(invite => <div className="account-row" key={invite.id}><span><strong>{invite.email}</strong><small>{invite.redeemed_at ? '已使用' : invite.revoked_at ? '已撤销' : new Date(invite.expires_at).getTime() <= Date.now() ? '已过期' : '待注册'} · 到期 {new Date(invite.expires_at).toLocaleDateString('zh-CN')}</small></span>{!invite.redeemed_at && !invite.revoked_at && <button className="button secondary" disabled={busy} onClick={() => void action(async () => { await api(`/admin/invites/${invite.id}`, undefined, 'DELETE'); })}>撤销</button>}</div>)}</div>
  </section>;
}
