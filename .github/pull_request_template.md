## What changed

One sentence on the behaviour this pull request changes. Link the issue with `Closes #N`.

## How it was verified

Paste the commands you ran and their results (test counts, the pages or commands you checked by hand), not just
"tested".

```
```

## Checklist

- [ ] The test suites for the parts I changed pass:
  - collector: `cd collector && go vet ./... && go test ./...`
  - server: `cd server && npm run typecheck && npm test`
  - web: `cd web && npm run typecheck && npm test`
  - scripts: `node --test 'scripts/*.test.mjs' && bash scripts/tests/install-skill-render.sh`
- [ ] A new migration in `server/migrations/` is mentioned above; it must be applied (`cd server && npm run db:migrate`) before the code is deployed
- [ ] Docs affected by the change are updated (`README.md` / `README.zh-CN.md`, `docs/guide/`, `THIRD_PARTY.md`)
- [ ] No token, service token or `.dev.vars` content in the code, the tests or this pull request
