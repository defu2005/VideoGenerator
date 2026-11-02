import type { ScriptData } from "@vg/shared";

type StoredResearch = NonNullable<ScriptData["research"]>;

export function ResearchPanel({ research }: { research: StoredResearch | null }) {
  return (
    <details className="panel research-panel" open>
      <summary>
        <span><span className="eyebrow">RESEARCH NOTES</span><strong>Model knowledge · verify before publishing</strong></span>
        {research && <small>{research.provider} · {research.model}{research.cached ? " · Cached" : ""}</small>}
      </summary>
      {!research ? <p className="field-hint">Research notes will appear after the Research stage completes.</p> : (
        <div className="research-content">
          <p>{research.data.summary}</p>
          <h3>Key facts</h3>
          <ul className="research-facts">
            {research.data.keyFacts.map((fact, index) => (
              <li key={`${fact.fact}-${index}`}>
                <span className={`confidence-badge confidence-${fact.confidence}`}>{fact.confidence}</span>
                <span>{fact.fact}{fact.sourceHint && <small> · {fact.sourceHint}</small>}</span>
              </li>
            ))}
          </ul>
          {research.data.timeline.length > 0 && <>
            <h3>Timeline</h3>
            <ul>{research.data.timeline.map((item, index) => <li key={`${item.date}-${index}`}><strong>{item.date}</strong> — {item.event}</li>)}</ul>
          </>}
          {research.data.cautions.length > 0 && <>
            <h3>Claims to double-check</h3>
            <ul>{research.data.cautions.map((caution, index) => <li key={`${caution}-${index}`}>{caution}</li>)}</ul>
          </>}
        </div>
      )}
    </details>
  );
}
