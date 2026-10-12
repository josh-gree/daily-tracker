// The cloud copy of the tracker, one row per day, in the D1 database bound as DB.
// A deleted (emptied) day is kept as a row with data = NULL so the deletion
// reaches other devices. The newest edit of a day wins (updated_at, set by the
// phone when the edit was made).
//
// Before the first change each day (UTC), the whole tracker is copied into
// `snapshots`, so any earlier day's state can be recovered, on top of D1's own
// 7-day Time Travel.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 2_000_000;

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS days (date TEXT PRIMARY KEY, data TEXT, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS snapshots (taken_on TEXT PRIMARY KEY, data TEXT NOT NULL)"),
  ]);
  schemaReady = true;
}

async function allDays(db) {
  const { results } = await db.prepare("SELECT date, data, updated_at FROM days").all();
  const days = {};
  for (const r of results) days[r.date] = { data: r.data == null ? null : JSON.parse(r.data), updatedAt: r.updated_at };
  return days;
}

export async function onRequestGet({ env }) {
  await ensureSchema(env.DB);
  return Response.json({ days: await allDays(env.DB) });
}

export async function onRequestPut({ request, env }) {
  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ error: "too large" }, { status: 413 });
  let body;
  try { body = JSON.parse(text); } catch { return Response.json({ error: "bad JSON" }, { status: 400 }); }
  const changes = Object.entries((body && body.days) || {}).filter(([date, c]) =>
    DATE.test(date) && c && Number.isFinite(c.updatedAt) &&
    (c.data === null || (typeof c.data === "object" && Array.isArray(c.data.slots))));
  if (!changes.length) return Response.json({ saved: 0 });

  const db = env.DB;
  await ensureSchema(db);
  const today = new Date().toISOString().slice(0, 10);
  const snap = await db.prepare("SELECT 1 FROM snapshots WHERE taken_on = ?").bind(today).first();
  const stmts = [];
  if (!snap) {
    stmts.push(db.prepare("INSERT OR IGNORE INTO snapshots (taken_on, data) VALUES (?, ?)")
      .bind(today, JSON.stringify(await allDays(db))));
  }
  for (const [date, c] of changes) {
    stmts.push(db.prepare(
      `INSERT INTO days (date, data, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (date) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
       WHERE excluded.updated_at > days.updated_at`,
    ).bind(date, c.data === null ? null : JSON.stringify(c.data), c.updatedAt));
  }
  await db.batch(stmts);
  return Response.json({ saved: changes.length });
}
