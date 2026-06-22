// =============================================================================
// AuraGate — Drizzle Kit Configuration
// =============================================================================
// Purpose:
//   Configures drizzle-kit for migration generation, schema push, and studio.
//   This is the single source of truth for Drizzle's CLI tooling.
//
// Interactions:
//   - `npx drizzle-kit generate` reads this to generate SQL migrations.
//   - `npx drizzle-kit migrate` reads this to apply migrations.
//   - `npx drizzle-kit studio` reads this to connect to the DB for browsing.
//   - Schema path points to src/lib/db/schema.ts.
//   - Migrations are output to ./drizzle/ directory.
//
// Dependencies:
//   - DATABASE_URL environment variable (from .env)
// =============================================================================

import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env");
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Verbose output during migration generation for debugging.
  verbose: true,
  // Strict mode: prompts for confirmation before destructive changes.
  strict: true,
});
