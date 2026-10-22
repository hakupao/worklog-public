import { Hono } from "hono";
import { buildGuardedUpdate, conflictOrNotFound, isUniqueViolation } from "../concurrency";
import type { AppEnv } from "../env";
import { langOf } from "../i18n/langs";
import { dropUnchanged, localize } from "../i18n/store";
import { translateSoon } from "../i18n/sweep";
import { jstNow } from "../jst";
import { unknownTask } from "../refs";
import { NoteCreate, NoteIn, NotePatch, invalid } from "../schemas";

export const notes = new Hono<AppEnv>();

const localizeNote = async (db: D1Database, lang: ReturnType<typeof langOf>, row: Record<string, unknown>) =>
  (await localize(db, lang, "note", [row], ["text"], undefined, { meta: true }))[0];

notes.put("/:id", async (c) => {
  const parsed = NoteIn.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const n = parsed.data;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO notes (id, text, task_id, minutes, machine, ts, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET
       text=excluded.text, task_id=excluded.task_id, minutes=excluded.minutes,
       machine=excluded.machine, ts=excluded.ts, updated_at=excluded.updated_at`,
  )
    .bind(c.req.param("id"), n.text, n.task_id, n.minutes, n.machine, n.ts, now)
    .run();
  return c.json({ id: c.req.param("id") });
});

notes.post("/", async (c) => {
  const parsed = NoteCreate.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const n = parsed.data;
  const bad = await unknownTask(c, n.task_id);
  if (bad) return bad;

  const db = c.env.DB;
  const now = jstNow();
  const date = n.date ?? now.date;
  const time = now.naive.slice(11); // HH:MM:SS in JST
  const base = `N${date.replaceAll("-", "")}-${time.replaceAll(":", "")}`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const id = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      await db
        .prepare("INSERT INTO notes (id, text, task_id, minutes, machine, ts, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
        .bind(id, n.text, n.task_id, n.minutes, n.machine, `${date}T${time}`, new Date().toISOString())
        .run();
      const row = (await db.prepare("SELECT * FROM notes WHERE id = ?1").bind(id).first<Record<string, unknown>>())!;
      translateSoon(c, "note", id);
      return c.json(await localizeNote(db, langOf(c), row), 201);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (attempt === 5) return c.json({ error: "could not allocate id" }, 500);
    }
  }
  return c.json({ error: "could not allocate id" }, 500);
});

notes.patch("/:id", async (c) => {
  const parsed = NotePatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { updated_at, ...fields } = parsed.data;
  const id = c.req.param("id");
  const bad = await unknownTask(c, fields.task_id);
  if (bad) return bad;
  if (Object.keys(fields).length === 0) {
    return c.json({ error: "invalid", issues: [{ path: "", message: "nothing to update" }] }, 400);
  }
  const lang = langOf(c);
  await dropUnchanged(c.env.DB, lang, "note", id, fields, { text: "text" });
  if (Object.keys(fields).length === 0) {
    // The text was re-sent as shown: nothing to write, but a stale tab still learns it is stale.
    const row = await c.env.DB.prepare("SELECT * FROM notes WHERE id = ?1 AND updated_at = ?2").bind(id, updated_at).first<Record<string, unknown>>();
    return row ? c.json(await localizeNote(c.env.DB, lang, row)) : conflictOrNotFound(c, "notes", id, undefined, (r) => localizeNote(c.env.DB, lang, r));
  }
  const { sql, args } = buildGuardedUpdate("notes", ["text", "task_id", "minutes"], fields, id, updated_at);
  const res = await c.env.DB.prepare(sql).bind(...args).run();
  if (res.meta.changes === 0) return conflictOrNotFound(c, "notes", id, undefined, (r) => localizeNote(c.env.DB, lang, r));
  translateSoon(c, "note", id);
  const row = (await c.env.DB.prepare("SELECT * FROM notes WHERE id = ?1").bind(id).first<Record<string, unknown>>())!;
  return c.json(await localizeNote(c.env.DB, lang, row));
});

notes.delete("/:id", async (c) => {
  const updatedAt = c.req.query("updated_at");
  if (!updatedAt) return c.json({ error: "invalid", issues: [{ path: "updated_at", message: "required" }] }, 400);
  const id = c.req.param("id");
  const res = await c.env.DB.prepare("DELETE FROM notes WHERE id = ?1 AND updated_at = ?2").bind(id, updatedAt).run();
  if (res.meta.changes === 0) return conflictOrNotFound(c, "notes", id);
  return c.body(null, 204);
});
