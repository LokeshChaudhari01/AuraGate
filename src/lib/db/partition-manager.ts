// =============================================================================
// AuraGate — Monthly Partition Manager for usage_logs
// =============================================================================
// Purpose:
//   Generates and executes CREATE TABLE statements for monthly partitions
//   of the usage_logs table. Partitions follow the naming convention:
//     usage_logs_YYYY_MM (e.g., usage_logs_2026_06)
//
// Interactions:
//   - Called by scripts/create-partitions.ts (CLI entry point).
//   - Executes raw SQL against PostgreSQL via the node-postgres pool.
//   - Idempotent: uses IF NOT EXISTS to safely re-run.
//
// Dependencies:
//   - pg Pool (from src/lib/db/index.ts)
//
// Failure Scenarios:
//   - Pool connection failure: throws with clear error message.
//   - Parent table doesn't exist: SQL will fail with a descriptive PG error.
//
// Scaling Considerations:
//   - Creating 12 partitions takes < 100ms. No performance concern.
//   - In production, this would be replaced by pg_partman or a daily cron.
// =============================================================================

import { Pool } from "pg";

/**
 * Generates the partition table name for a given year and month.
 * Format: usage_logs_YYYY_MM (e.g., usage_logs_2026_06)
 */
function getPartitionName(year: number, month: number): string {
  const monthStr = String(month).padStart(2, "0");
  return `usage_logs_${year}_${monthStr}`;
}

/**
 * Calculates the start and end date boundaries for a monthly partition.
 * Uses UTC to avoid timezone issues with partition boundaries.
 *
 * @returns [startDate, endDate] as ISO date strings (YYYY-MM-DD)
 */
function getPartitionBounds(
  year: number,
  month: number
): [string, string] {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;

  // Calculate the first day of the next month
  let endYear = year;
  let endMonth = month + 1;
  if (endMonth > 12) {
    endMonth = 1;
    endYear += 1;
  }
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  return [startDate, endDate];
}

/**
 * Creates monthly partitions for the usage_logs table.
 *
 * @param pool - node-postgres Pool instance
 * @param monthsAhead - Number of future months to create partitions for (default: 6)
 * @param monthsBehind - Number of past months to create partitions for (default: 1)
 * @returns Array of partition names that were created or already existed
 */
export async function createMonthlyPartitions(
  pool: Pool,
  monthsAhead: number = 6,
  monthsBehind: number = 1
): Promise<string[]> {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1; // 1-indexed

  const partitionsProcessed: string[] = [];

  // Calculate the full range: [current - monthsBehind, current + monthsAhead]
  for (let offset = -monthsBehind; offset <= monthsAhead; offset++) {
    let targetMonth = currentMonth + offset;
    let targetYear = currentYear;

    // Handle year boundary wrapping
    while (targetMonth > 12) {
      targetMonth -= 12;
      targetYear += 1;
    }
    while (targetMonth < 1) {
      targetMonth += 12;
      targetYear -= 1;
    }

    const partitionName = getPartitionName(targetYear, targetMonth);
    const [startDate, endDate] = getPartitionBounds(targetYear, targetMonth);

    const sql = `
      CREATE TABLE IF NOT EXISTS "${partitionName}"
      PARTITION OF "usage_logs"
      FOR VALUES FROM ('${startDate}') TO ('${endDate}');
    `;

    try {
      await pool.query(sql);
      partitionsProcessed.push(partitionName);
      console.log(`  ✅ ${partitionName} (${startDate} → ${endDate})`);
    } catch (error) {
      const pgError = error as { code?: string; message?: string };
      // 42P07 = relation already exists (shouldn't happen with IF NOT EXISTS, but just in case)
      if (pgError.code === "42P07") {
        console.log(`  ⏭️  ${partitionName} already exists, skipping.`);
        partitionsProcessed.push(partitionName);
      } else {
        console.error(`  ❌ Failed to create ${partitionName}:`, pgError.message);
        throw error;
      }
    }
  }

  return partitionsProcessed;
}
