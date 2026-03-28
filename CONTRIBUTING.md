# Contributing to @open-quran/api

Thank you for your interest in contributing! This guide will help you set up a local development environment.

## Prerequisites

- Node.js 18+
- npm or yarn
- Git

## Quick Start

### 0. Verify Your Setup (Optional)

```bash
git clone https://github.com/quran-th/open-quran.git
cd open-quran/quran-api
npm install
npm run verify  # Check if everything is ready
```

### 1. Clone and Install

```bash
git clone https://github.com/quran-th/open-quran.git
cd open-quran/quran-api
npm install
```

### 2. Initialize Local Database

```bash
# Apply migrations to local D1 (creates .wrangler/state/v3/d1/miniflare-D1.sqlite3)
npm run db:migrate:local
```

### 3. Seed Sample Data (Optional but Recommended)

```bash
# Populate local database with sample verses for testing
npm run db:seed
```

This adds:

- Al-Fatihah (7 verses) and Al-Baqarah (first 5 verses)
- Test admin account: `admin@local.dev` / `password123`
- Sample contribution for testing approval workflow

### 4. Start Development Server

```bash
npm run dev
```

The API will be available at:

- **API**: http://localhost:8787
- **Swagger UI**: http://localhost:8787/ui
- **OpenAPI Spec**: http://localhost:8787/doc

## Available Scripts

| Command                                       | Description                                     |
| --------------------------------------------- | ----------------------------------------------- |
| `npm run dev`                                 | Start local development server with local D1/KV |
| `npm run db:seed`                             | Seed local database with sample data            |
| `npm run db:generate`                         | Generate migrations from schema changes         |
| `npx wrangler d1 migrations apply DB --local` | Apply migrations to local D1                    |
| `npm run lint`                                | Run ESLint                                      |
| `npm run typecheck`                           | Run TypeScript type checking                    |

## Testing Your Changes

### Public Endpoints (No Auth Required)

```bash
# Health check
curl http://localhost:8787/

# Get all 114 surahs (static data)
curl http://localhost:8787/surahs

# Get specific surah with verses (requires seeded DB)
curl http://localhost:8787/surahs/1

# Get translation sources
curl http://localhost:8787/translation-sources
```

### Authentication Endpoints

```bash
# Create first admin (only works on empty contributors table)
curl -X POST http://localhost:8787/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password123","display_name":"Admin"}'

# Login
curl -X POST http://localhost:8787/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password123"}'
```

### Authenticated Endpoints

```bash
# Get your contributor info (requires JWT token)
curl http://localhost:8787/auth/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Project Structure

```
quran-api/
├── src/
│   ├── db/
│   │   └── schema.ts          # Drizzle ORM schema
│   ├── routes/
│   │   ├── auth.ts            # Authentication endpoints
│   │   ├── admin.ts           # Admin approval queues
│   │   ├── contributor.ts     # Contributor CRUD operations
│   │   └── public.ts          # Public API endpoints
│   ├── middleware/
│   │   └── auth.ts            # JWT validation middleware
│   ├── utils/
│   │   ├── crypto.ts          # PBKDF2 password hashing
│   │   └── jwt.ts             # JWT sign/verify
│   ├── data/
│   │   └── surahs.ts          # Static surah metadata
│   └── index.ts               # Hono app entry point
├── database/
│   └── migrations/            # SQL migration files
├── scripts/
│   └── seed-local-db.ts       # Local database seeding script
└── wrangler.toml              # Cloudflare Workers config
```

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

### 2. Make Your Changes

- Edit source files in `src/`
- If you change the database schema:
  ```bash
  npm run db:generate        # Generate migration
  npx wrangler d1 migrations apply DB --local  # Apply to local DB
  ```

### 3. Test Locally

```bash
npm run dev
# Test your changes in another terminal
```

### 4. Run Quality Checks

```bash
npm run lint
npm run typecheck
```

### 5. Commit and Push

```bash
git add .
git commit -m "feat: add your feature description"
git push origin feature/your-feature-name
```

### 6. Create Pull Request

- Go to GitHub and create a PR
- Describe your changes clearly
- Reference related issues if any

## Common Development Tasks

### Adding a New API Endpoint

1. Create route handler in appropriate `src/routes/*.ts` file
2. Add OpenAPI documentation using `@hono/zod-openapi`
3. Add authentication if needed using `requireAuth` middleware
4. Test locally with `npm run dev`

### Modifying Database Schema

1. Edit `src/db/schema.ts`
2. Generate migration: `npm run db:generate`
3. Review generated SQL in `database/migrations/`
4. Apply to local DB: `npx wrangler d1 migrations apply DB --local`
5. Update code to use new schema

### Adding New Dependencies

```bash
npm install package-name
# or for dev dependencies
npm install -D package-name
```

## Troubleshooting

### Database Issues

If you encounter database errors, reset your local database:

```bash
# Remove local database
rm -rf .wrangler/state/v3/d1/

# Re-apply migrations
npx wrangler d1 migrations apply DB --local

# Re-seed data
npm run db:seed
```

### Port Already in Use

If port 8787 is already in use:

```bash
# Kill existing process
lsof -ti:8787 | xargs kill -9

# Or use a different port
wrangler dev --port 8788
```

### Type Errors

If you see TypeScript errors after pulling changes:

```bash
npm run typecheck
# Fix reported errors before committing
```

## Local Development Notes

### Cloudflare Bindings

When running `npm run dev`, Wrangler provides local equivalents for all Cloudflare services:

- **D1 Database**: Local SQLite database (`.wrangler/state/v3/d1/miniflare-D1.sqlite3`)
- **KV Namespace**: In-memory key-value store (data lost on restart)
- **R2 Bucket**: Not available locally (use `ASSETS_BASE_URL` env var)
- **Secrets**: Uses values from `wrangler.toml` [vars] section

### Performance Considerations

- Local D1 uses SQLite, which is fast for development
- KV namespace is in-memory, so cache clears on server restart
- No need for optimization in local development

### Data Persistence

- Database persists in `.wrangler/state/v3/d1/`
- KV cache is ephemeral (cleared on restart)
- Static surah data is in-memory from `src/data/surahs.ts`

## Code Style

- Use TypeScript for all new code
- Follow ESLint rules (`npm run lint` to check)
- Use Prettier for formatting (`npm run format` to fix)
- Keep functions small and focused
- Add JSDoc comments for complex functions

## Questions?

- Check existing issues on GitHub
- Read the main [README.md](./README.md)
- Review API docs at http://localhost:8787/ui (when running)

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
