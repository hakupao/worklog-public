import { Hono } from "hono";
import { auth } from "./auth";
import type { AppEnv } from "./env";
import { deliverableVerdicts, deliverablesIngest } from "./routes/deliverables";
import { i18n } from "./routes/i18n";
import { ingest } from "./routes/ingest";
import { meta } from "./routes/meta";
import { prefs } from "./routes/prefs";
import { reportDownloads } from "./routes/report-downloads";
import { notes } from "./routes/notes";
import { dashboard } from "./routes/dashboard";
import { reports } from "./routes/reports";
import { dayPlanItems, dayPlans } from "./routes/day-plans";
import { planItems } from "./routes/plan-items";
import { reviews } from "./routes/reviews";
import { sessions } from "./routes/sessions";
import { stats } from "./routes/stats";
import { tasks } from "./routes/tasks";
import { weeks } from "./routes/weeks";
import { scheduled } from "./cron";

const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.use("/api/*", auth);

app.route("/api/tasks", tasks);
app.route("/api/notes", notes);
app.route("/api/sessions", sessions);
app.route("/api/ingest/deliverables", deliverablesIngest);
app.route("/api/ingest", ingest);
app.route("/api/deliverable-verdicts", deliverableVerdicts);
app.route("/api/weeks", weeks);
app.route("/api/dashboard", dashboard);
app.route("/api/reports", reports);
app.route("/api/reviews", reviews);
app.route("/api/plan-items", planItems);
app.route("/api/day-plans", dayPlans);
app.route("/api/day-plan-items", dayPlanItems);
app.route("/api/prefs", prefs);
app.route("/api/report-downloads", reportDownloads);
// Before meta: meta owns GET /api/stats itself; this one only defines /api/stats/sessions.
app.route("/api/stats", stats);
app.route("/api/i18n", i18n);
app.route("/api", meta);

app.notFound((c) => c.json({ error: "not found" }, 404));

export default { fetch: app.fetch, scheduled };
