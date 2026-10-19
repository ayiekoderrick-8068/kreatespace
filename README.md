# KreateSpace

**Discover. Connect. Create.**

A Pinterest-inspired platform where customers discover Kenyan creative businesses, explore their creations, and contact sellers directly through their websites or WhatsApp.

## Structure

| Path              | Purpose                                         |
| ----------------- | ----------------------------------------------- |
| `apps/web`        | React + Vite + TypeScript frontend              |
| `apps/api`        | Express + TypeScript + Prisma backend           |
| `packages/shared` | Zod validation schemas and types shared by both |

## Requirements

- Node.js 22+
- pnpm 9+

## Getting started

```bash
pnpm install
pnpm dev
```

Environment variables are documented in each app's `.env.example`. Never commit real credentials.
