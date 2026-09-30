import { analyzeRequest, aiConfig } from '../lib/analysis.js';
import { listRequests, createRequest, getRequest, saveAnalysis } from '../lib/storage.js';
import { loginSession, session, setSessionCookie } from '../lib/auth.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let input = '';
  for await (const chunk of req) {
    input += chunk;
    if (input.length > 12000) throw Object.assign(new Error('Завеликий запит.'), { status: 413 });
  }
  try { return JSON.parse(input); } catch { throw Object.assign(new Error('Некоректний JSON.'), { status: 400 }); }
}

export default async function handler(req, res) {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'Запит з іншого сайту заборонено.' });
    if (path === '/api/auth/login' && req.method === 'POST') {
      const { token, user } = loginSession(await body(req));
      setSessionCookie(res, token);
      return send(res, 200, { user });
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      setSessionCookie(res);
      return send(res, 200, { ok: true });
    }
    const user = session(req);
    if (!user) return send(res, 401, { error: 'Увійдіть у свій обліковий запис.' });
    if (path === '/api/auth/me' && req.method === 'GET') return send(res, 200, { user });
    if (path === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, storage: Boolean(process.env.SUPABASE_URL) || !process.env.VERCEL, aiConfigured: aiConfig().providers.some(p => p.configured), ...aiConfig(), allowLocalKey: !process.env.VERCEL });
    const workspaceId = user.workspaceId;
    if (typeof workspaceId !== 'string' || !uuid.test(workspaceId)) return send(res, 400, { error: 'Невірний ідентифікатор робочого простору.' });
    if (path === '/api/requests' && req.method === 'GET') {
      const items = await listRequests(user.role === 'admin' ? null : workspaceId);
      return send(res, 200, { requests: user.role === 'admin' ? items : items.map(({ analysis, ...item }) => ({ ...item, analysis: null })) });
    }
    if (path === '/api/requests' && req.method === 'POST') {
      if (user.role !== 'user') return send(res, 403, { error: 'Створювати звернення можуть лише користувачі.' });
      const input = await body(req);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return send(res, 400, { error: 'Очікується об’єкт звернення.' });
      if (user.role === 'user' && Object.hasOwn(input, 'customerName') && input.customerName !== user.name) {
        return send(res, 403, { error: 'Можна надсилати звернення лише від свого імені.' });
      }
      const name = user.name;
      const message = typeof input.message === 'string' ? input.message.trim() : '';
      if (!name || name.length > 120 || !message || message.length > 5000) return send(res, 400, { error: 'Ім’я має містити 1–120 символів, а звернення — 1–5000.' });
      return send(res, 201, { request: await createRequest(workspaceId, name, message) });
    }
    const match = path.match(/^\/api\/requests\/([0-9a-f-]+)\/analyze$/i);
    if (match && req.method === 'POST' && uuid.test(match[1])) {
      if (user.role !== 'admin') return send(res, 403, { error: 'AI-аналіз доступний лише адміністратору.' });
      const item = await getRequest(null, match[1]);
      if (!item) return send(res, 404, { error: 'Звернення не знайдено.' });
      const input = await body(req);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return send(res, 400, { error: 'Некоректні налаштування аналізу.' });
      const overrideKey = !process.env.VERCEL && typeof input.apiKey === 'string' && input.apiKey.startsWith('sk-') && input.apiKey.length < 250 ? input.apiKey : undefined;
      const analysis = await analyzeRequest(item.customerName, item.message, overrideKey, input.provider);
      return send(res, 200, { request: await saveAnalysis(item.workspaceId, item.id, analysis) });
    }
    return send(res, 404, { error: 'Маршрут не знайдено.' });
  } catch (error) {
    console.error('API error:', error.message);
    return send(res, error.status || 500, { error: error.status ? error.message : 'Внутрішня помилка сервера.' });
  }
}
