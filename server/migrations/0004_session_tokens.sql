-- Token usage and API-equivalent cost of a session, as JSON:
--   {"by_model": {model: {input, output, cache_read, cache_write_5m, cache_write_1h, reasoning}},
--    "subagent": {same shape: the part of by_model its subagents used}, "cost_usd": number|null,
--    "cost_partial": bool}
-- NULL = never collected (harvested before this column, or by an older collector). Written only by the collector.
ALTER TABLE sessions ADD COLUMN tokens TEXT;
