// =============================================================================
// AuraGate — Drizzle ORM Schema Definition
// =============================================================================
// Purpose:
//   Defines the relational schema for the AuraGate multi-tenant AI gateway.
//   Three core tables: tenants, api_keys, usage_logs.
//
// Interactions:
//   - This file is the single source of truth for all database table shapes.
//   - drizzle-kit reads this file to generate SQL migrations.
//   - The Drizzle client uses these exports for type-safe queries.
//   - usage_logs is defined here for type inference but its CREATE TABLE
//     is overridden in a custom migration to add PARTITION BY RANGE.
//
// Note on Partitioning:
//   Drizzle does not natively support PostgreSQL table partitioning.
//   The usage_logs table is defined here as a standard table so that
//   Drizzle can generate types and query builders. The actual DDL is
//   replaced in a custom migration with PARTITION BY RANGE (created_at).
//   The composite primary key (id, created_at) satisfies PostgreSQL's
//   requirement that the partition key be included in the PK.
// =============================================================================

import {
  pgTable,
  uuid,
  varchar,
  decimal,
  boolean,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// =============================================================================
// TENANTS — Multi-Tenant Organization Registry
// =============================================================================
// Each tenant represents a team/department/organization that consumes LLM
// services through AuraGate. Budget tracking is enforced at this level.
//
// Failure Scenarios:
//   - Budget exhaustion: Phase 5 worker checks budget_usd before processing.
//   - Tenant deactivation: is_active = false blocks all API key validation.
//
// Scaling Considerations:
//   - Expected cardinality: 10s to 100s of tenants (not millions).
//   - No partitioning needed; simple B-tree index on id is sufficient.
// =============================================================================
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  budgetUsd: decimal("budget_usd", { precision: 19, scale: 4 })
    .notNull()
    .default("0.0000"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// =============================================================================
// API_KEYS — Hashed API Key Registry
// =============================================================================
// Stores SHA-256 hashes of API keys issued to tenants. Raw keys are never
// persisted — they are shown once at creation time and discarded.
//
// Interactions:
//   - Phase 4 proxy: hashes the incoming bearer token and looks up this table.
//   - Phase 3 cache: validated key_hash → tenant_id mapping is cached in Redis.
//
// Failure Scenarios:
//   - Key revocation: is_active = false immediately blocks the key.
//   - Tenant cascade: deleting a tenant removes all associated keys.
//
// Scaling Considerations:
//   - Expected cardinality: 100s to 1000s of keys.
//   - Unique index on key_hash ensures O(1) lookups.
// =============================================================================
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  description: varchar("description", { length: 255 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// =============================================================================
// USAGE_LOGS — Time-Partitioned Telemetry Ledger
// =============================================================================
// Records every LLM request processed by the proxy. This is the highest-volume
// table and is partitioned by month on created_at for query performance.
//
// Additional fields per user request:
//   - request_id: Correlation ID for tracing a request across proxy → queue → worker.
//   - cache_hit: Whether this request was served from Redis cache.
//   - failover_used: Whether the primary provider failed and we fell back.
//   - provider_status_code: HTTP status code from the upstream LLM provider.
//   - status: Overall request outcome (SUCCESS, FAILED, CACHED).
//
// Interactions:
//   - Phase 5 BullMQ worker inserts rows after stream completion.
//   - Phase 6 dashboard queries this table for cost/throughput analytics.
//
// Failure Scenarios:
//   - Missing partition: INSERT fails if no partition covers the created_at value.
//     Mitigated by partition-manager creating 6 months ahead.
//   - Budget race condition: Phase 5 uses SELECT ... FOR UPDATE on tenants.
//
// Scaling Considerations:
//   - Expected cardinality: millions of rows.
//   - Monthly partitions enable partition pruning on time-range queries.
//   - Composite index (tenant_id, created_at DESC) accelerates dashboard queries.
//
// IMPORTANT: The actual CREATE TABLE in the migration uses PARTITION BY RANGE.
//   This pgTable definition exists for Drizzle's type system and query builder.
//   The composite primary key (id, created_at) satisfies PostgreSQL's constraint
//   that the partition key must be part of the PK.
// =============================================================================
export const usageLogs = pgTable(
  "usage_logs",
  {
    id: uuid("id").defaultRandom().notNull(),
    requestId: uuid("request_id").defaultRandom().notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 50 }).notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    latencyMs: integer("latency_ms").notNull().default(0),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    costUsd: decimal("cost_usd", { precision: 19, scale: 4 })
      .notNull()
      .default("0.0000"),
    cacheHit: boolean("cache_hit").notNull().default(false),
    failoverUsed: boolean("failover_used").notNull().default(false),
    providerStatusCode: integer("provider_status_code"),
    status: varchar("status", { length: 20 }).notNull().default("SUCCESS"),
    routingReason: varchar("routing_reason", { length: 30 }),
    queryType: varchar("query_type", { length: 20 }),
    complexityScore: integer("complexity_score"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Composite index for hyper-fast dashboard queries:
    //   "Show me all usage for tenant X in the last 30 days, newest first"
    // PostgreSQL will use this index for both:
    //   WHERE tenant_id = ? AND created_at > ?
    //   WHERE tenant_id = ? ORDER BY created_at DESC
    index("idx_usage_logs_tenant_created").on(
      table.tenantId,
      table.createdAt
    ),
  ]
);

// =============================================================================
// PROCESSED_JOBS — Transactional Idempotency Gate
// =============================================================================
// Prevents duplicate BullMQ job execution.
// =============================================================================
export const processedJobs = pgTable("processed_jobs", {
  requestId: uuid("request_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// =============================================================================
// Relations — Drizzle Relational Query API
// =============================================================================
// These relation definitions enable Drizzle's relational query builder
// (db.query.tenants.findMany({ with: { apiKeys: true } })) without
// affecting the database schema. They are purely application-level metadata.
// =============================================================================
export const tenantsRelations = relations(tenants, ({ many }) => ({
  apiKeys: many(apiKeys),
  usageLogs: many(usageLogs),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  tenant: one(tenants, {
    fields: [apiKeys.tenantId],
    references: [tenants.id],
  }),
}));

export const usageLogsRelations = relations(usageLogs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [usageLogs.tenantId],
    references: [tenants.id],
  }),
}));
