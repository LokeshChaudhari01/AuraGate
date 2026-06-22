// =============================================================================
// AuraGate — Partition Creation CLI Script
// =============================================================================
// Purpose:
//   CLI entry point that creates monthly partitions for the usage_logs table.
//   Run this after migrations to ensure partitions exist for the current and
//   upcoming months.
//
// Usage:
//   npx tsx scripts/create-partitions.ts                  # Default: 1 month behind, 6 ahead
//   npx tsx scripts/create-partitions.ts --months-ahead 12 # Create 12 months ahead
//
// Interactions:
//   - Connects directly to PostgreSQL via DATABASE_URL.
//   - Calls partition-manager.ts to generate partition DDL.
//   - Safe to run repeatedly (idempotent).
//
// Dependencies:
//   - dotenv (loads .env)
//   - pg (database connection)
//   - src/lib/db/partition-manager.ts (partition logic)
// =============================================================================

import "dotenv/config";
import { Pool } from "pg";
import { createMonthlyPartitions } from "../src/lib/db/partition-manager";

async function main(): Promise<void> {
  console.log("\n🗂️  AuraGate — Partition Manager\n");

  // Parse CLI arguments
  const args = process.argv.slice(2);
  const monthsAheadIdx = args.indexOf("--months-ahead");
  const monthsBehindIdx = args.indexOf("--months-behind");

  const monthsAhead =
    monthsAheadIdx !== -1 ? parseInt(args[monthsAheadIdx + 1], 10) : 6;
  const monthsBehind =
    monthsBehindIdx !== -1 ? parseInt(args[monthsBehindIdx + 1], 10) : 1;

  if (isNaN(monthsAhead) || isNaN(monthsBehind)) {
    console.error("❌ Invalid arguments. Usage:");
    console.error(
      "   npx tsx scripts/create-partitions.ts --months-ahead 6 --months-behind 1"
    );
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL is not set. Add it to your .env file.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2, // Minimal pool for a CLI script
  });

  try {
    console.log(`📊 Creating partitions: ${monthsBehind} months behind, ${monthsAhead} months ahead\n`);

    const partitions = await createMonthlyPartitions(
      pool,
      monthsAhead,
      monthsBehind
    );

    console.log(`\n✅ Done. ${partitions.length} partitions processed.\n`);
  } catch (error) {
    console.error("\n❌ Partition creation failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
