# Publishing — Playwright Test Automation

End-to-end UI automation for the Publishing app, built with Playwright + TypeScript. This framework follows the same structure/conventions as the Image Retouching automation project (separate repo, not shared) — page-object model, dual-environment config, HTML reporting, per-run performance tracking.

This project is fully standalone: its own repo, its own `node_modules`, its own `.env.*` files. It does not import from or depend on the Image Retouching project in any way.

## Setup

```
npm install
npx playwright install chromium
cp .env.example .env.uat
# fill in CLIENT_BASE_URL / CLIENT_USERNAME / CLIENT_PASSWORD in .env.uat
```

`.env.uat` and `.env.production` are untracked (see `.gitignore`) — each person running these tests creates their own locally from `.env.example`.

## Running

```
npm run test:uat                     # everything, against UAT
npm run test:uat:login               # just the login flow
npm run test:uat:create-magazine     # just magazine creation
npm run report                       # open the last HTML report
```

Set `TEST_ENV=production` (or use the `test:production*` scripts) to run against production instead of UAT.

## Layout

- `config/env.ts` — loads `.env.<TEST_ENV>` then `.env.local` (untracked personal overrides); fails fast with a clear error if a required var is missing.
- `pages/` — page-object classes, one per screen/flow.
- `tests/` — Playwright specs.
- `utils/PerformanceTracker.ts` — attaches to a page and records API/page-load timings per logical step, written out as CSVs under `reports/performance/` at the end of each run (even on failure).
- `playwright-report/`, `test-results/`, `screenshots/`, `reports/performance/` — all generated, all gitignored.

## Status

Scaffold only so far. Login and magazine-creation page objects/tests are being built next against the real app once its UI is confirmed live (selectors in this framework are always written from confirmed live behavior, never guessed).
