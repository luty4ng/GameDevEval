export async function api<T = unknown>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error('无法连接服务器，请保留并备份当前改动'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) throw new Error('请求过于频繁，请稍后重试');
    if (path === '/auth/sign-in/email' && response.status === 401) throw new Error('邮箱或密码不正确');
    if (path === '/auth/change-password' && data.code === 'INVALID_PASSWORD') throw new Error('当前密码不正确');
    if (response.status === 401) throw new Error('登录已过期或账户已停用；请备份当前改动，再刷新登录');
    throw new Error(data.error ?? data.message ?? '操作失败，请稍后重试');
  }
  return data as T;
}
