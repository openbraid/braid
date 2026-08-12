// ─── Prisma CLI config ───────────────────────────────────────────────────────
// Loads .env so `npx prisma …` works without a wrapper. The connection strings
// are deliberately NOT set here: schema.prisma reads DATABASE_URL and
// DIRECT_URL via env(), which keeps the pooled/direct split (Supabase, Neon)
// working for both the CLI and the runtime client.
import "dotenv/config";
import { defineConfig } from "prisma/config";

// Plain Postgres — which is what `docker compose up` gives you, and what most
// self-hosters run — has no pooled/direct split, so requiring both variables
// would be a pointless extra step that only fails at migrate time. Default
// DIRECT_URL to DATABASE_URL and let hosted-Postgres users override it.
// Empty-string, not just undefined: docker compose passes unset variables
// through as "", which `??=` would happily keep.
if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
});
