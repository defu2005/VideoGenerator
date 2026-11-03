export function DurationBar({ totalSec, targetSec }: { totalSec: number; targetSec: number }) {
  const withinRange = totalSec >= targetSec * 0.8 && totalSec <= targetSec * 1.2;
  const percent = Math.max(0, Math.min(100, totalSec / targetSec * 100));
  return (
    <div className="scene-duration-bar" aria-label={`Total duration ${totalSec.toFixed(1)} seconds of ${targetSec} second target`}>
      <div className={`scene-duration-track ${withinRange ? "is-within-range" : "is-outside-range"}`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <small>{totalSec.toFixed(1)}s / {targetSec}s target</small>
    </div>
  );
}
