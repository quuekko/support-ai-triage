import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let database;
// Node's test runner sets this for each test worker, including direct --test runs.
// Never let tests use persistent storage or inherited Supabase credentials.
const testing = Boolean(process.env.NODE_TEST_CONTEXT);
function localDb() {
  if (!database) {
    if (!testing) mkdirSync('.data', { recursive: true });
    database = new DatabaseSync(testing ? ':memory:' : '.data/support.sqlite');
    database.exec(`CREATE TABLE IF NOT EXISTS support_requests (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, customer_name TEXT NOT NULL,
      message TEXT NOT NULL, created_at TEXT NOT NULL, analysis TEXT, analyzed_at TEXT
    ); CREATE INDEX IF NOT EXISTS workspace_created ON support_requests(workspace_id, created_at DESC);`);
  }
  return database;
}

const remote = () => !testing && Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
function ensureStorage() {
  if (!testing && process.env.VERCEL && !remote()) throw Object.assign(new Error('Сховище не налаштовано: додайте SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY.'), { status: 503 });
}
async function supabase(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/support_requests${path}`, {
    ...options, headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers }
  });
  if (!response.ok) throw Object.assign(new Error('Помилка бази даних. Перевірте налаштування та schema.sql.'), { status: 503 });
  return response.json();
}
function unpack(row) { return { id: row.id, workspaceId: row.workspace_id, customerName: row.customer_name, message: row.message, createdAt: row.created_at,
  analysis: typeof row.analysis === 'string' ? JSON.parse(row.analysis) : row.analysis, analyzedAt: row.analyzed_at }; }

export async function listRequests(workspaceId) {
  ensureStorage();
  if (remote()) return (await supabase(`?${workspaceId ? `workspace_id=eq.${workspaceId}&` : ''}select=*&order=created_at.desc&limit=100`)).map(unpack);
  if (!workspaceId) return localDb().prepare('SELECT * FROM support_requests ORDER BY created_at DESC LIMIT 100').all().map(unpack);
  return localDb().prepare('SELECT * FROM support_requests WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100').all(workspaceId).map(unpack);
}
export async function createRequest(workspaceId, name, message) {
  ensureStorage();
  const row = { id: crypto.randomUUID(), workspace_id: workspaceId, customer_name: name, message, created_at: new Date().toISOString(), analysis: null, analyzed_at: null };
  if (remote()) return unpack((await supabase('', { method: 'POST', body: JSON.stringify(row) }))[0]);
  localDb().prepare('INSERT INTO support_requests VALUES (?, ?, ?, ?, ?, ?, ?)').run(...Object.values(row));
  return unpack(row);
}
export async function getRequest(workspaceId, id) {
  ensureStorage();
  if (remote()) {
    const row = (await supabase(`?${workspaceId ? `workspace_id=eq.${workspaceId}&` : ''}id=eq.${id}&select=*&limit=1`))[0];
    return row ? unpack(row) : null;
  }
  const row = workspaceId ? localDb().prepare('SELECT * FROM support_requests WHERE workspace_id=? AND id=?').get(workspaceId, id) : localDb().prepare('SELECT * FROM support_requests WHERE id=?').get(id);
  return row ? unpack(row) : null;
}
export async function saveAnalysis(workspaceId, id, analysis) {
  ensureStorage();
  const analyzedAt = new Date().toISOString();
  if (remote()) return unpack((await supabase(`?workspace_id=eq.${workspaceId}&id=eq.${id}`, {
    method: 'PATCH', body: JSON.stringify({ analysis, analyzed_at: analyzedAt }) }))[0]);
  localDb().prepare('UPDATE support_requests SET analysis=?, analyzed_at=? WHERE workspace_id=? AND id=?').run(JSON.stringify(analysis), analyzedAt, workspaceId, id);
  return getRequest(workspaceId, id);
}
