import { KnowledgeUsesPanel } from "../profiles/KnowledgeUsesPanel";
import { useEffect, useRef, useState } from "react";
import { resolveBudget, STAGE_ORDER, type Job, type Project, type Script } from "@vg/shared";
import { usePipeline } from "../../hooks/usePipeline";
import { useScript } from "../../hooks/useScript";
import { getProjectJobs } from "../../services/pipelineApi";
import { useQuery } from "@tanstack/react-query";
import { guardDirtyNavigation, useConfirm } from "../../components/useConfirm";
import { Spinner } from "../../components/Spinner";
import { ErrorState } from "../../components/ErrorState";
import { ApiRequestError } from "../../services/apiClient";
import { ResearchPanel } from "./ResearchPanel";
import { ScriptEditor } from "./ScriptEditor";
import { GuidelineFindings } from "../guidelines/GuidelineFindings";

function emptyScript(title: string): Script {
  return {
    title,
    hook: "",
    sections: [{
      id: "section-1",
      heading: "Opening",
      narration: "",
      visualQueries: { primary: "", alternatives: [] },
      visualNotes: "",
      musicMood: "",
      energy: "medium",
      estDurationSec: 0,
    }],
    outro: "",
    music: { mood: "", energy: "medium", keywords: [] },
  };
}

export function ScriptTab({ project }: { project: Project }) {
  const scriptQuery = useScript(project.id);
  const pipeline = usePipeline(project.id);
  const jobsQuery = useQuery({
    queryKey: ["project-jobs", project.id],
    queryFn: () => getProjectJobs(project.id, 100),
    enabled: Boolean(project.id),
  });
  const [editing, setEditing] = useState(false);
  const [draftKey, setDraftKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [actionError, setActionError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const { ask, dialog: leaveDialog } = useConfirm();

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const confirmNavigation = (event: MouseEvent) => {
      guardDirtyNavigation(event, dirtyRef.current, ask, {
        title: "Bỏ thay đổi chưa lưu?",
        message: "Kịch bản đang sửa sẽ mất nếu bạn rời trang.",
        confirmLabel: "Rời trang",
        cancelLabel: "Ở lại",
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", confirmNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", confirmNavigation, true);
    };
  }, [ask]);

  if (scriptQuery.isPending || pipeline.isPending) return <Spinner label="Đang tải kịch bản" />;
  if (scriptQuery.isError) return <ErrorState message={scriptQuery.error instanceof Error ? scriptQuery.error.message : "Unable to load script"} onRetry={() => void scriptQuery.refetch()} />;
  if (pipeline.isError) return <ErrorState message={pipeline.error instanceof Error ? pipeline.error.message : "Unable to load pipeline"} onRetry={() => void pipeline.refetch()} />;

  const data = scriptQuery.data;
  const stages = pipeline.data.stages;
  const scriptRecord = stages.find((stage) => stage.stage === "SCRIPT");
  const researchRecord = stages.find((stage) => stage.stage === "RESEARCH");
  const waitingForScript = [researchRecord, scriptRecord].find((stage) => stage?.state === "WAITING_USER");
  const showClaudeHint = project.settings.stageExecutors.script === "USER" || waitingForScript !== undefined;
  const claudePrompt = `Viết script cho project "${project.title}" (id ${project.id}) bằng Video Agent`;
  const scriptPosition = STAGE_ORDER.indexOf("SCRIPT");
  const earlierIncomplete = stages.find((stage) =>
    STAGE_ORDER.indexOf(stage.stage) < scriptPosition && stage.state !== "DONE" && stage.state !== "SKIPPED");
  const canGenerateScript = !earlierIncomplete && !pipeline.data.activeJob && !pipeline.isMutating;
  const active = pipeline.data.activeJob !== null;
  const scriptJobs = jobsQuery.data?.filter((job) => job.stage === "RESEARCH" || job.stage === "SCRIPT") ?? [];
  const lastResearchJob = scriptJobs.find((job) => job.stage === "RESEARCH");
  const lastScriptJob = scriptJobs.find((job) => job.stage === "SCRIPT");
  const scriptReviewEnabled = resolveBudget(project).scriptReview;

  const run = async (stage?: "RESEARCH" | "SCRIPT") => {
    setActionError("");
    try {
      await pipeline.action({ type: "run", ...(stage ? { stage } : {}) });
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : "Pipeline action failed");
    }
  };
  const save = async (script: Script) => {
    try {
      await scriptQuery.save(script);
      setDirty(false);
      setEditing(false);
      setActionError("");
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Unable to save script");
    }
  };
  const copyClaudePrompt = async () => {
    try {
      await navigator.clipboard.writeText(claudePrompt);
      setCopyStatus("Copied");
    } catch (error) {
      setCopyStatus(error instanceof Error ? `Copy failed: ${error.message}` : "Copy failed");
    }
  };

  return (
    <div className="script-workspace">
      <ResearchPanel research={data.research} />
      <KnowledgeUsesPanel projectId={project.id} tasks={["research"]} />
      <KnowledgeUsesPanel projectId={project.id} tasks={["script","scriptReview","factCheck","guidelineCheck"]} />
      {project.settings.treatment && (
        <section className="panel" aria-label="Bản đề xuất">
          <p className="eyebrow">BẢN ĐỀ XUẤT</p>
          <h2>{project.settings.treatment.title}</h2>
          <p>{project.settings.treatment.formatNameVi} · {project.settings.treatment.angle}</p>
          <ol>
            {project.settings.treatment.sections.map((section) => (
              <li key={section.key}>{section.nameVi} · {section.estSec} giây</li>
            ))}
          </ol>
          <p>{project.settings.treatment.estimatedSceneCount} cảnh · {project.settings.treatment.estimatedDurationSec} giây · {project.settings.treatment.renderNoteVi}</p>
          <p>Ước tính phần còn lại: {project.settings.treatment.cost.inputTokens} token vào, {project.settings.treatment.cost.outputTokens} token ra, {project.settings.treatment.cost.ttsCharacters} ký tự đọc{project.settings.treatment.cost.usd === null ? "" : `, khoảng $${project.settings.treatment.cost.usd.toFixed(2)}`}. Chi phí thật nằm ở tab Token.</p>
        </section>
      )}
      {showClaudeHint && (
        <section className="panel claude-desktop-hint">
          <div>
            <p className="eyebrow">WRITE WITH CLAUDE DESKTOP</p>
            <p>Use your Claude Desktop subscription to draft this project without an API key.</p>
            <code>{claudePrompt}</code>
          </div>
          <div className="claude-desktop-actions">
            <button className="button button-secondary" type="button" onClick={() => void copyClaudePrompt()}>Copy</button>
            <a href="/docs/CLAUDE_DESKTOP.md" target="_blank" rel="noreferrer">Setup instructions</a>
            {copyStatus && <small role="status">{copyStatus}</small>}
          </div>
        </section>
      )}
      {actionError && <p className="request-error" role="alert">{actionError}</p>}
      {!data.script && !editing && (
        <section className="panel script-empty-state">
          <p className="eyebrow">YOUR VIDEO SCRIPT</p>
          <h2>Choose how to create your script</h2>
          <p>Let the AI research the topic and draft a script, or write your own and use zero LLM tokens.</p>
          <div className="script-empty-actions">
            <button className="button button-primary" type="button" disabled={active || pipeline.isMutating} onClick={() => void run()}>
              Let the AI write it
            </button>
            <button className="button button-secondary" type="button" onClick={() => {
              setDraftKey((value) => value + 1);
              setEditing(true);
              setDirty(false);
            }}>Write my own script</button>
          </div>
          <button
            className="text-button"
            type="button"
            disabled={active || pipeline.isMutating || project.settings.stageExecutors.script === "USER"}
            onClick={() => void run("RESEARCH")}
          >
            Generate research
          </button>
          {waitingForScript?.message && <p className="pipeline-mode-hint" role="status">{waitingForScript.message}</p>}
        </section>
      )}
      {(data.script || editing) && (
        <>
          {scriptReviewEnabled && data.script?.reviewNotes !== null && data.script?.reviewNotes !== undefined && (
            <section className="panel script-review-notes">
              <span className="script-review-badge">Revised by AI review</span>
              <details>
                <summary>AI review notes ({data.script.reviewNotes.length})</summary>
                {data.script.reviewNotes.length > 0
                  ? <ul>{data.script.reviewNotes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
                  : <p>No review notes.</p>}
              </details>
            </section>
          )}
          <div className="script-actions">
            <button className="button button-secondary" type="button" disabled={active || pipeline.isMutating || project.settings.stageExecutors.script === "USER"} onClick={() => void run("RESEARCH")}>Generate research</button>
            <button className="button button-primary" type="button" disabled={!canGenerateScript || project.settings.stageExecutors.script === "USER"} onClick={() => void run("SCRIPT")}>
              {data.script ? "Regenerate script" : "Generate script"}
            </button>
            {earlierIncomplete && <small role="status">Complete {earlierIncomplete.stage.replaceAll("_", " ")} before generating the script.</small>}
            {project.settings.stageExecutors.script === "USER" && <small>AI research and script generation are disabled for the USER executor.</small>}
            {data.stale && <span className="stale-note">Script inputs have changed; regenerate or review the script.</span>}
          </div>
          <ScriptEditor
            key={`${data.script?.version ?? "empty"}-${draftKey}`}
            initialValue={data.script?.data ?? emptyScript(project.title)}
            targetDurationSec={project.settings.targetDurationSec}
            disabled={scriptQuery.isSaving}
            onChange={() => { setDirty(true); setEditing(true); }}
            onSave={save}
          />
        </>
      )}
      <GuidelineFindings project={project} stage="SCRIPT" />
      <section className="panel script-usage">
        <p className="eyebrow">LATEST STAGE USAGE</p>
        <span>{runUsageLabel(lastResearchJob, lastScriptJob)}</span>
        <span>Research: {usageLabel(lastResearchJob)}</span>
        <span>Script: {usageLabel(lastScriptJob)}</span>
      </section>
      {researchRecord?.state === "FAILED" && <p className="request-error">Research failed: {researchRecord.error?.message}</p>}
      {scriptRecord?.state === "FAILED" && <p className="request-error">Script failed: {scriptRecord.error?.message}</p>}
      {leaveDialog}
    </div>
  );
}

function usageLabel(job: Job | undefined): string {
  if (!job) return "No job yet";
  if (!job.usage) return "No usage recorded";
  const usage = job.usage;
  if (usage.llmCalls === 0 && usage.inputTokens + usage.outputTokens === 0) {
    if (job.message?.toLowerCase().includes("cache")) return "0 tokens (cached)";
    if (job.message?.includes("merged call")) return "0 tokens (merged call)";
  }
  const cost = usage.costUsd > 0 ? ` · $${usage.costUsd.toFixed(6)}` : "";
  const callLabel = `${usage.llmCalls} ${usage.llmCalls === 1 ? "call" : "calls"}`;
  const tokenLabel = usage.tokensUnknown
    ? "token count unknown"
    : `${usage.inputTokens + usage.outputTokens} tokens`;
  return `${callLabel} · ${tokenLabel}${cost}`;
}

function runUsageLabel(researchJob: Job | undefined, scriptJob: Job | undefined): string {
  const jobs = [researchJob, scriptJob].filter((job): job is Job => Boolean(job));
  if (jobs.length === 0) return "LLM calls this run: 0 · No usage yet";
  const usage = jobs.reduce((total, job) => ({
    calls: total.calls + (job.usage?.llmCalls ?? 0),
    tokens: total.tokens + (job.usage?.inputTokens ?? 0) + (job.usage?.outputTokens ?? 0),
    tokensUnknown: total.tokensUnknown || job.usage?.tokensUnknown === true,
  }), { calls: 0, tokens: 0, tokensUnknown: false });
  const cached = usage.calls === 0 && usage.tokens === 0 && jobs.some((job) => job.message?.toLowerCase().includes("cache"));
  const tokenLabel = usage.tokensUnknown ? "token count unknown" : `${usage.tokens} tokens`;
  return `LLM calls this run: ${usage.calls} · ${tokenLabel}${cached ? " (cached)" : ""}`;
}
