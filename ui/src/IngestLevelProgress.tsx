import type { IngestJob } from "../../core/types";
import marioRunSprite from "./assets/mario-run.svg";
import marioVictorySprite from "./assets/mario-victory.svg";

const LEVEL_MARKERS = 9;

export function IngestLevelProgress({ job }: { job: IngestJob }) {
  const percent = getProgressPercent(job);
  const displayPercent = Math.round(percent);
  const changedFiles = job.changedFiles ?? 0;
  const skippedFiles = job.skippedFiles ?? 0;
  const hazards = job.errors.length;
  const stateLabel = job.status === "completed" ? "Castle clear" : job.status === "failed" ? "Level failed" : "Running level";
  const ariaLabel = `Ingest ${job.status}, ${job.phase}, ${job.processedFiles} of ${job.totalFiles} files processed, ${displayPercent} percent`;
  const marioSprite = job.status === "completed" ? marioVictorySprite : marioRunSprite;

  return (
    <section className={`ingest-level-progress ingest-level-progress--${job.status}`} role="status" aria-live="polite" aria-label={ariaLabel}>
      <div className="ingest-level-header">
        <div>
          <span className="ingest-level-kicker">Ingest level</span>
          <strong>{stateLabel}</strong>
        </div>
        <div className="ingest-level-score">
          <strong>{job.processedFiles}/{job.totalFiles} files</strong>
          <span>{displayPercent}%</span>
        </div>
      </div>

      <div className="ingest-level-stage">
        <div className="ingest-level-skyline" aria-hidden="true">
          {Array.from({ length: LEVEL_MARKERS }, (_, index) => {
            const isCleared = skippedFiles > index;
            const hasCoin = changedFiles > index;
            const hasHazard = hazards > index;
            return (
              <span className={`ingest-level-block ${isCleared ? "ingest-level-block--cleared" : ""}`} key={index}>
                {hasHazard ? <span className="ingest-level-hazard">!</span> : hasCoin ? <span className="ingest-level-coin">$</span> : null}
              </span>
            );
          })}
        </div>
        <div className="ingest-level-track">
          <span className="ingest-level-ground" style={{ width: `${percent}%` }} />
          <img className="ingest-level-avatar" src={marioSprite} alt={job.status === "completed" ? "Pixel Mario victory" : "Pixel Mario running"} style={{ left: `clamp(0px, calc(${percent}% - 16px), calc(100% - 32px))` }} />
          <span className="ingest-level-flag" aria-hidden="true">F</span>
        </div>
      </div>

      <div className="ingest-level-meta">
        <span>Phase: {job.phase}</span>
        <span>Current: {job.currentFile || "Waiting for next file"}</span>
      </div>

      <div className="ingest-level-counters">
        <span>Coins {changedFiles}</span>
        <span>Cleared blocks {skippedFiles}</span>
        <span>Hazards {hazards}</span>
        <span>Events {job.totalEvents}</span>
      </div>

      {hazards > 0 ? (
        <ul className="ingest-level-errors">
          {job.errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
        </ul>
      ) : null}
    </section>
  );
}

function getProgressPercent(job: IngestJob) {
  if (job.status === "completed") return 100;
  if (job.totalFiles <= 0) return 0;
  return Math.min(100, Math.max(0, (job.processedFiles / job.totalFiles) * 100));
}
