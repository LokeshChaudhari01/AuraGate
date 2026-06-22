import "dotenv/config";
import { telemetryWorker } from "./telemetry-worker";
import { scheduleCleanupJob, processCleanupJob } from "./cleanup-job";
import { telemetryQueue } from "./telemetry-queue";

console.log("🚀 [Worker] AuraGate telemetry worker started.");

// Also handle the cleanup job if it's picked up by this worker
telemetryWorker.on("active", (job) => {
  if (job.name === "cleanup") {
    processCleanupJob();
  }
});

// Schedule the daily cleanup job
scheduleCleanupJob().catch(console.error);
