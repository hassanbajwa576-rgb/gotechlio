# Gotechlio

People, time, requests and payroll for one or many companies. Built with Next.js 15, TypeScript, Drizzle ORM and Postgres (Neon in production, an embedded Postgres locally).

## What's in it

| Module | What it does |
|---|---|
| Home | Clock in and out with breaks, monthly stats, leave balances, activity, announcements |
| People | Directory, org chart, profiles, documents, assets, onboarding checklists |
| Time | Timesheets, weekly schedule, shifts, who's in today |
| Requests | Leave, work from home, expenses, punch corrections, tickets, and an approvals inbox |
| Payroll | Salary structures, monthly runs with tax and unpaid leave, payslips, final settlement |
| Talent | Goals and review cycles, training courses, recruitment pipeline with hiring |
| Engage | Announcements, kudos, polls |
| Admin | Employees, leave types, holidays, departments, company settings |
| Careers | Public job listings and applications |

**Multiple companies.** One account can belong to several companies, with a different role in each, and switch between them from the sidebar. Every record is scoped to a company, and admins can add a new company. Isolation is covered by dedicated tests.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:3000
```

With no `DATABASE_URL`, the app uses an embedded Postgres stored in your home folder and seeds two demo companies on first run. Sign in as `employee@techlio.co`, `manager@techlio.co`, `hr@techlio.co` or `admin@techlio.co` with password `Techlio@123`. These demo accounts exist only locally; production never gets them.

## Tests

```bash
npm test           # 124 logic tests, in-memory Postgres
npm run test:e2e   # 40+ browser tests in Edge: every module, every role, and a design audit at three screen widths
npm run smoke      # loads every page as every role against a running dev server
```

The design audit freezes all animations on their first frame and checks that nothing is invisible, nothing scrolls sideways, every control has a name, and the phone layout holds together.

## Deploy

1. Create a Neon database and set `DATABASE_URL` (see `.env.example`) and a long random `AUTH_SECRET` in Vercel.
2. Create the schema and your first company and admin once:

   ```bash
   DATABASE_URL=... ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='at least 12 characters' COMPANY_NAME='Acme' npm run db:setup
   ```

3. `npm run deploy` builds, deploys to production and points the public address at the new deployment.

## How it's organised

- `src/server/` business logic, one file per area, each function takes the signed-in person and enforces its own permissions and company boundary
- `src/db/` schema, migrations runner, demo seed
- `src/app/` pages (server components) and a small JSON API: `/api/rpc` for actions, `/api/login`, `/api/switch`
- `tests/` logic tests, `e2e/` browser tests, `scripts/` smoke, deploy and production setup
- Sessions are a signed cookie that only identifies who you are; your role and company are re-read from the database on every request, so deactivation and role changes apply immediately.
