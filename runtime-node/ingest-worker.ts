import { CCFlightDatabase } from "../storage/database";
import { parseIngestOptions, runIngestJob } from "./ingest";

const [jobId, encodedOptions] = process.argv.slice(2);

if (!jobId) {
  throw new Error("Missing ingest job id");
}

const db = new CCFlightDatabase();

try {
  if (process.env.SUPERVIEW_TEST_INGEST_WORKER_FAIL === "1") {
    markFailed(db, jobId, "Forced ingest worker failure");
    process.exitCode = 1;
  } else {
    await runIngestJob(db, jobId, parseIngestOptions(encodedOptions), { workerPid: process.pid });
  }
} finally {
  db.close();
}

function markFailed(database: CCFlightDatabase, id: string, message: string) {
  const job = database.getJob(id);
  if (!job) return;
  job.status = "failed";
  job.phase = "failed";
  job.finishedAt = new Date().toISOString();
  job.currentFile = null;
  job.errors.push(message);
  database.upsertJob(job);
}
