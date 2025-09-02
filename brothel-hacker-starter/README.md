# Brothel Hacker — Starter Monorepo

Metallic pink + gold, neon SSM suite. Frontend (Vite + React + Tailwind). Backend (Express + real endpoints).

## Structure
```
apps/
  api/        # Express API (real endpoints + adapters)
  frontend/   # React app (Writer, Calendar, Agent, Scheduler, Ads)
.github/
  workflows/ci.yml  # CI: lint, build
```

## Quick start
### API
```bash
cd apps/api
npm i
cp .env.example .env
npm run dev
```

### Frontend
```bash
cd apps/frontend
npm i
npm run dev
```

## Environment variables (API)
Copy `.env.example` to `.env` and fill as needed.

## Deploy
- Dockerfiles included in both apps.
- Render/Fly/Railway/Vercel supported.
