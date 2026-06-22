// =============================================================================
// AuraGate — Database Seed Script
// =============================================================================
// Purpose:
//   Seeds the database with sample tenants, API keys, and (optionally) a few
//   usage log entries for development and testing.
//
// Usage:
//   npx tsx scripts/seed.ts
//
// Interactions:
//   - Inserts into tenants, api_keys tables.
//   - Logs raw (unhashed) API keys to console for use in Phase 4 proxy testing.
//   - Idempotent: uses ON CONFLICT DO NOTHING to skip existing records.
//
// Dependencies:
//   - dotenv (loads .env)
//   - pg (database connection)
//   - crypto (SHA-256 hashing)
//
// Security Note:
//   Raw API keys are generated and displayed ONCE in the console output.
//   Only SHA-256 hashes are stored in the database. In production, keys
//   would be generated via a secure admin API and delivered to tenants
//   through a secure channel.
// =============================================================================

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createHash, randomBytes } from "crypto";
import { tenants, apiKeys } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates a random API key with the format: ag_<32 random hex chars>
 * The "ag_" prefix makes AuraGate keys easily identifiable in logs.
 */
function generateApiKey(): string {
  return `ag_${randomBytes(16).toString("hex")}`;
}

/**
 * Computes SHA-256 hash of a raw API key for secure storage.
 * This is the same hashing function used by the Phase 4 proxy.
 */
function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

// ---------------------------------------------------------------------------
// Seed Data
// ---------------------------------------------------------------------------

interface TenantSeed {
  name: string;
  budgetUsd: string;
  isActive: boolean;
}

const TENANT_SEEDS: TenantSeed[] = [
  {
    name: "Acme Corp Engineering",
    budgetUsd: "500.0000",
    isActive: true,
  },
  {
    name: "Globex Analytics",
    budgetUsd: "1000.0000",
    isActive: true,
  },
  {
    name: "Initech Legacy Systems",
    budgetUsd: "100.0000",
    isActive: false, // Deliberately inactive for testing auth rejection
  },
];

// ---------------------------------------------------------------------------
// Main Seed Function
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n🌱 AuraGate — Database Seeder\n");

  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL is not set. Add it to your .env file.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
  });

  const db = drizzle(pool);

  try {
    // ----- Seed Tenants -----
    console.log("📦 Seeding tenants...\n");

    const insertedTenants = await db
      .insert(tenants)
      .values(
        TENANT_SEEDS.map((t) => ({
          name: t.name,
          budgetUsd: t.budgetUsd,
          isActive: t.isActive,
        }))
      )
      .onConflictDoNothing({ target: tenants.name })
      .returning();

    if (insertedTenants.length === 0) {
      console.log("  ⏭️  Tenants already exist, fetching existing...\n");
    }

    // Fetch all tenants (whether just inserted or pre-existing)
    const allTenants = await db
      .select()
      .from(tenants)
      .orderBy(tenants.name);

    for (const t of allTenants) {
      const status = t.isActive ? "🟢 Active" : "🔴 Inactive";
      console.log(
        `  ${status} | ${t.name} | Budget: $${t.budgetUsd} | ID: ${t.id}`
      );
    }

    // ----- Seed API Keys -----
    console.log("\n🔑 Seeding API keys...\n");
    console.log("  ┌──────────────────────────────────────────────────────────────────────────┐");
    console.log("  │ ⚠️  SAVE THESE KEYS — they are shown ONCE and never stored in plaintext │");
    console.log("  └──────────────────────────────────────────────────────────────────────────┘\n");

    for (const tenant of allTenants) {
      // Generate 2 keys per tenant
      for (let i = 1; i <= 2; i++) {
        const rawKey = generateApiKey();
        const keyHash = hashApiKey(rawKey);
        const description = `${tenant.name} - Key ${i}`;

        await db
          .insert(apiKeys)
          .values({
            tenantId: tenant.id,
            keyHash,
            description,
            isActive: true,
          })
          .onConflictDoNothing({ target: apiKeys.keyHash });

        console.log(`  Tenant:  ${tenant.name}`);
        console.log(`  Key ${i}:   ${rawKey}`);
        console.log(`  Hash:    ${keyHash}`);
        console.log(`  Desc:    ${description}`);
        console.log("");
      }
    }

    // ----- Summary -----
    const tenantCount = await db.select({ count: sql<number>`count(*)` }).from(tenants);
    const keyCount = await db.select({ count: sql<number>`count(*)` }).from(apiKeys);

    console.log("📊 Seed Summary:");
    console.log(`   Tenants:  ${tenantCount[0].count}`);
    console.log(`   API Keys: ${keyCount[0].count}`);
    console.log("\n✅ Seeding complete.\n");
  } catch (error) {
    console.error("\n❌ Seeding failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
