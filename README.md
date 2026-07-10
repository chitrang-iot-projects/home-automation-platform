# Home Automation Platform

Production-oriented IoT home automation platform (Phase 1 — initial scaffold).

## Structure

```
home-automation-platform/
├── apps/
│   ├── customer-pwa/        # Next.js customer-facing PWA
│   └── admin-portal/        # Next.js admin portal
├── backend/
│   └── HomeAutomation.Api/  # ASP.NET Core Web API (.NET 9)
├── shared/
│   ├── types/               # Shared TypeScript types (future)
│   ├── ui/                  # Shared UI components (future)
│   └── utils/               # Shared utilities (future)
├── database/
│   ├── migrations/          # PostgreSQL migrations (future)
│   └── docs/                # Database documentation (future)
├── docs/                    # Project documentation
├── scripts/                 # Dev/ops scripts
└── .github/                 # GitHub workflows (future)
```

## Tech Stack

- **Customer PWA** — Next.js 15, TypeScript, Tailwind CSS 4
- **Admin Portal** — Next.js 15, TypeScript, Tailwind CSS 4
- **API** — ASP.NET Core Web API (.NET 9)
- **Database** — PostgreSQL (planned)

## Prerequisites

- Node.js 22+
- .NET SDK 9+

## Running Locally

### Customer PWA (http://localhost:3000)

```bash
cd apps/customer-pwa
npm install
npm run dev
```

### Admin Portal (http://localhost:3001)

```bash
cd apps/admin-portal
npm install
npm run dev
```

### API (http://localhost:5000)

```bash
cd backend/HomeAutomation.Api
dotnet run
```

`GET /` returns `Shree Ganeshay nammh:`

## Branches

- `main` — stable
- `develop` — active development

## Roadmap (later phases)

- Authentication (Firebase)
- PostgreSQL schema (Neon)
- CI/CD (GitHub Actions)
- Deployment (Vercel, Render/Azure)
