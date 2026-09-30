import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const cookieName = 'support_session';
const lifetime = 8 * 60 * 60;
const digest = value => createHash('sha256').update(value).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));
function config(role) {
  const prefix = role === 'admin' ? 'ADMIN' : 'USER';
  const login = process.env[`${prefix}_LOGIN`];
  const password = process.env[`${prefix}_PASSWORD`];
  const secret = process.env.AUTH_SECRET;
  const name = (process.env[`${prefix}_NAME`] || login || '').trim();
  if (!login || !password || !secret || secret.length < 32 || !name || name.length > 120) {
    throw Object.assign(new Error('Вхід не налаштовано на сервері.'), { status: 503 });
  }
  return { login, password, secret, name };
}
const sign = (value, secret) => createHmac('sha256', secret).update(value).digest('base64url');
function identity(role, login) {
  const hex = digest(`support-ai:user:${login}`).toString('hex');
  return { role, login, name: config(role).name, workspaceId: `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}` };
}
export function loginSession(input) {
  if (!input || !['admin', 'user'].includes(input.role) || typeof input.login !== 'string' || typeof input.password !== 'string') {
    throw Object.assign(new Error('Невірний логін або пароль.'), { status: 401 });
  }
  const { login, password, secret } = config(input.role);
  if (!same(input.login, login) || !same(input.password, password)) {
    throw Object.assign(new Error('Невірний логін або пароль.'), { status: 401 });
  }
  const payload = Buffer.from(JSON.stringify({ role: input.role, login, expires: Date.now() + lifetime * 1000 })).toString('base64url');
  return { token: `${payload}.${sign(payload, secret + password)}`, user: identity(input.role, login) };
}
export function session(req) {
  try {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!token) return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!['admin', 'user'].includes(value.role)) return null;
    const { login, password, secret } = config(value.role);
    if (!same(signature, sign(payload, secret + password)) || value.login !== login || !Number.isFinite(value.expires) || value.expires <= Date.now()) return null;
    return identity(value.role, login);
  } catch { return null; }
}
export function setSessionCookie(res, token = '') {
  res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? lifetime : 0}${process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
