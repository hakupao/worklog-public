-- Weekly report downloads (docs/design/2026-10-05-ui-redesign-design.md §10.2). One row per week and
-- template; `at` is the last successful xlsx download (UTC ISO). Read by the 此刻 page's
-- report.undownloaded rule and, later, the report page's 「上次下载」.
CREATE TABLE report_downloads (
  week TEXT NOT NULL,
  template TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (week, template)
);
