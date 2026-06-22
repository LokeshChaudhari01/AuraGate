// =============================================================================
// AuraGate — Database Client Singleton
// =============================================================================
// Purpose:
//   Creates and exports a singleton Drizzle ORM client backed by a node-postgres
//   connection pool. Uses the globalThis caching pattern to prevent connection
//   pool exhaustion during Next.js hot-module-replacement in development.
//
// Interactions:
//   - Every server-side module that needs database access imports `db` from here.
//   - The Pool connects to PostgreSQL using DATABASE_URL from .env.
//   - In production, a fresh client is created per cold start (serverless-safe).
//   - In development, the client is cached on globalThis to survive HMR.
//
// Dependencies:
//   - drizzle-orm (query builder + type inference)
//   - pg (node-postgres connection pool)
//   - ./schema.ts (table definitions for type-safe queries)
//
// Failure Scenarios:
//   - DATABASE_URL not set: throws immediately at import time with a clear error.
//   - PostgreSQL unreachable: Pool handles retry logic; queries will throw on timeout.
//
// Scaling Considerations:
//   - Default pool size: 10 connections (sufficient for dev).
//   - Production: tune via PGPOOL_SIZE env var or add PgBouncer.
// =============================================================================

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Validate DATABASE_URL at import time to fail fast with a clear error.
if (!process.env.DATABASE_URL) {
  throw new Error(
    "❌ DATABASE_URL environment variable is not set.\n" +
      "   Please add it to your .env file:\n" +
      '   DATABASE_URL="postgresql://auragate_user:auragate_pg_dev_password@localhost:5432/auragate"'
  );
}

// ---------------------------------------------------------------------------
// Connection Pool Configuration
// ---------------------------------------------------------------------------
// The Pool manages a set of persistent TCP connections to PostgreSQL.
// - max: Maximum number of connections in the pool.
// - idleTimeoutMillis: How long a connection can sit idle before being closed.
// - connectionTimeoutMillis: How long to wait for a connection from the pool.
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_SIZE || "10", 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Log pool errors to prevent unhandled rejections from crashing the process.
pool.on("error", (err) => {
  console.error("🔴 [DB Pool] Unexpected error on idle client:", err.message);
});

// ---------------------------------------------------------------------------
// Drizzle Client
// ---------------------------------------------------------------------------
// Passing the full schema enables the relational query API:
//   db.query.tenants.findMany({ with: { apiKeys: true } })
// ---------------------------------------------------------------------------
const drizzleClient = drizzle(pool, {
  schema,
  logger: process.env.NODE_ENV === "development",
});

// ---------------------------------------------------------------------------
// Singleton Pattern (Development HMR Safety)
// ---------------------------------------------------------------------------
// In development, Next.js hot-reloads modules on every save. Without this
// pattern, each reload creates a new Pool → new connections → exhausts
// PostgreSQL's max_connections (default: 100).
//
// globalThis persists across HMR cycles, so we cache the client there.
// In production, there is no HMR, so this is a no-op.
// ---------------------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __db: typeof drizzleClient | undefined;
}

let db: typeof drizzleClient;

if (process.env.NODE_ENV === "production") {
  db = drizzleClient;
} else {
  if (!globalThis.__db) {
    globalThis.__db = drizzleClient;
  }
  db = globalThis.__db;
}

export { db, pool };
