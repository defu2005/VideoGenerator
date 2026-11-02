import { useEffect, useRef, useState } from "react";
import { STAGE_ORDER, type Job, type Project, type Script } from "@vg/shared";
import { usePipeline } from "../../hooks/usePipeline";
import { useScript } from "../../hooks/useScript";
import { getProjectJobs } from "../../services/pipelineApi";
import { useQuery } from "@tanstack/react-query";
import { Spinner } from "../../components/Spinner";
import { ErrorState } from "../../components/ErrorState";
import { ApiRequestError } from "../../services/apiClient";
import { ResearchPanel } from "./ResearchPanel";
import { ScriptEditor } from "./ScriptEditor";

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
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const confirmNavigation = (event: MouseEvent) => {
      if (!dirtyRef.current || !(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]") as HTMLAnchorElement | null;
      if (!link || link.origin !== window.location.origin || link.pathname === window.location.pathname) return;
      if (!window.confirm("You have unsaved script changes. Leave without saving?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", confirmNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", confirmNavigation, true);
    };
  }, []);

  if (scriptQuery.isPending || pipeline.isPending) return <Spinner label="Loading script workspace" />;
  if (scriptQuery.isError) return <ErrorState message={scriptQuery.error instanceof Error ? scriptQuery.error.message : "Unable to load script"} onRetry={() => void scriptQuery.refetch()} />;
  if (pipeline.isError) return <ErrorState message={pipeline.error instanceof Error ? pipeline.error.message : "Unable to load pipeline"} onRetry={() => void pipeline.refetch()} />;

  const data = scriptQuery.data;
  const stages = pipeline.data.stages;
  const scriptRecord = stages.find((stage) => stage.stage === "SCRIPT");
  const researchRecord = stages.find((stage) => stage.stage === "RESEARCH");
  const waitingForScript = [researchRecord, scriptRecord].find((stage) => stage?.state === "WAITING_USER");
  const scriptPosition = STAGE_ORDER.indexOf("SCRIPT");
  const earlierIncomplete = stages.find((stage) =>
    STAGE_ORDER.indexOf(stage.stage) < scriptPosition && stage.state !== "DONE" && stage.state !== "SKIPPED");
  const canGenerateScript = !earlierIncomplete && !pipeline.data.activeJob && !pipeline.isMutating;
  const active = pipeline.data.activeJob !== null;
  const scriptJobs = jobsQuery.data?.filter((job) => job.stage === "RESEARCH" || job.stage === "SCRIPT") ?? [];
  const lastResearchJob = scriptJobs.find((job) => job.stage === "RESEARCH");
  const lastScriptJob = scriptJobs.find((job) => job.stage === "SCRIPT");

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

  return (
    <div className="script-workspace">
      <ResearchPanel research={data.research} />
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
      <section className="panel script-usage">
        <p className="eyebrow">LATEST STAGE USAGE</p>
        <span>{runUsageLabel(lastResearchJob, lastScriptJob)}</span>
        <span>Research: {usageLabel(lastResearchJob)}</span>
        <span>Script: {usageLabel(lastScriptJob)}</span>
      </section>
      {researchRecord?.state === "FAILED" && <p className="request-error">Research failed: {researchRecord.error?.message}</p>}
      {scriptRecord?.state === "FAILED" && <p className="request-error">Script failed: {scriptRecord.error?.message}</p>}
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
  return `${callLabel} · ${usage.inputTokens + usage.outputTokens} tokens${cost}`;
}

function runUsageLabel(researchJob: Job | undefined, scriptJob: Job | undefined): string {
  const jobs = [researchJob, scriptJob].filter((job): job is Job => Boolean(job));
  if (jobs.length === 0) return "LLM calls this run: 0 · No usage yet";
  const usage = jobs.reduce((total, job) => ({
    calls: total.calls + (job.usage?.llmCalls ?? 0),
    tokens: total.tokens + (job.usage?.inputTokens ?? 0) + (job.usage?.outputTokens ?? 0),
  }), { calls: 0, tokens: 0 });
  const cached = usage.calls === 0 && usage.tokens === 0 && jobs.some((job) => job.message?.toLowerCase().includes("cache"));
  return `LLM calls this run: ${usage.calls} · ${usage.tokens} tokens${cached ? " (cached)" : ""}`;
}
