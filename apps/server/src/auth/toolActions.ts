import type { Action, PolicyResource } from "./policy.js";

type Group = readonly [Action, readonly string[]];

const GROUPS: readonly Group[] = [
  ["project.read", [
    "list_profiles", "get_profile", "list_projects", "get_project", "get_pipeline", "list_topics",
    "get_stage_timeouts", "get_market_pack", "list_clips", "trend_ideas", "get_events", "list_goals",
    "get_goal_progress", "compose_plan_preview", "get_originality_report", "search_profile_context",
    "list_overdue_jobs", "get_overdue_checks",
  ]],
  ["project.write", [
    "create_project", "add_topic", "suggest_topics", "approve_topics", "reject_topics", "delete_topic",
    "add_trend_topic", "research_scene_visuals", "crop_scene_images", "dedupe_scene_visuals",
    "undo_timeline_edit", "apply_review_proposal",
  ]],
  ["stage.run", [
    "run_pipeline", "decide_overdue", "repair_script", "repair_scene", "repair_render_stage", "make_shorts", "make_translation", "run_insight",
  ]],
  ["gate.approve", ["approve_gate"]],
  ["publish", ["publish_project", "cancel_publication"]],
  ["channel.read", [
    "list_accounts", "list_connections", "list_platform_accounts", "list_comments", "list_publications", "get_style_pack",
  ]],
  ["channel.manage", ["delete_project", "update_profile_direction", "propose_style_pack", "set_style_pack"]],
  ["comments.reply", ["reply_comment", "hide_comment"]],
  ["analytics.read", [
    "analytics_overview", "video_metrics", "usage_summary", "dashboard_stats", "publish_calendar",
    "profile_insights", "get_account_health", "get_metric_series",
  ]],
  ["finance.read", ["finance_summary", "monthly_report"]],
  ["finance.write", ["add_revenue_entry"]],
  ["settings.read", [
    "get_llm_settings", "notification_settings", "automation_status", "get_autonomy_status", "get_llm_quota_status", "get_llm_health",
    "search_user_guide", "find_skills", "read_skill", "find_tools", "get_agent_context", "list_skill_reports",
    "knowledge_status", "list_knowledge", "get_knowledge", "list_stale_knowledge", "list_change_catalog",
    "list_change_events", "computer_use_status", "get_provider_intel_summary", "get_provider", "get_billing_risk",
    "list_intel_changes", "list_offers", "get_omniroute_audit", "get_routing_proposals", "get_model_abilities",
    "get_model_scorecard", "compare_models", "get_model_task_stats", "list_eval_suites", "get_eval_run",
    "omniroute_health", "omniroute_list_providers", "omniroute_list_combos", "list_nodes",
    "hermes_duty_heartbeat", "supervision_snapshot", "operator_runs_list", "operator_run_get", "operator_orders_list",
    "escalation_list", "agent_events_poll",
  ]],
  ["settings.write", [
    "update_stage_timeouts", "update_notification_toggles", "propose_models", "apply_models", "update_llm_settings",
    "clear_llm_cooldown", "apply_insight", "propose_knowledge_change", "import_knowledge", "resolve_change_event",
    "report_change", "mark_change_reviewed", "propose_missing_tool", "propose_route_change", "apply_routing_proposal",
    "update_omniroute_combos", "intel_fetch_page", "intel_submit_assessment", "intel_add_provider_stub",
    "intel_set_offer", "intel_run_job", "intel_write_report", "intel_extract_page", "intel_submit_benchmark",
    "intel_next_research_batch", "intel_mark_researched", "run_model_eval", "set_node_drain",
  ]],
  ["secrets.write", ["omniroute_test_provider", "omniroute_set_provider_state", "omniroute_upsert_combo", "omniroute_delete_combo"]],
  ["automation.manage", [
    "set_profile_automation", "pause_automation_all", "resume_automation_all", "claim_skill_run",
    "save_skill_report", "complete_skill_report", "import_skill_reports", "propose_skill",
    "operator_pause", "operator_resume", "operator_stop_run", "operator_new_session", "operator_enqueue",
    "operator_order_upsert", "operator_order_disable", "operator_override", "escalation_claim", "escalation_resolve",
    "escalation_forward_to_user", "notify_user",
  ]],
  ["operator.use", ["save_standing_order", "request_user_action", "computer_observe", "computer_act"]],
];

/** Which workspace action each registry tool needs. A test keeps this in step with ASSISTANT_TOOLS. */
export const TOOL_ACTIONS: Readonly<Record<string, Action>> = Object.freeze(
  Object.fromEntries(GROUPS.flatMap(([action, names]) => names.map((name) => [name, action] as const))),
);

export function toolAction(name: string): Action | undefined {
  return TOOL_ACTIONS[name];
}

type DbLike = { prepare(sql: string): { get(...args: unknown[]): unknown } };

/** The channel and workspace a tool call touches, read from its arguments. */
export function toolResource(sqlite: DbLike, args: unknown): PolicyResource {
  const a = (args ?? {}) as { projectId?: unknown; profileId?: unknown; jobId?: unknown };
  if (typeof a.jobId === "string" && typeof a.projectId !== "string") {
    // TASK-125: overdue tools name a job, not a project.
    const row = sqlite.prepare("SELECT p.profile_id AS profile_id, p.workspace_id AS workspace_id FROM jobs j JOIN projects p ON p.id = j.project_id WHERE j.id = ?").get(a.jobId) as
      { profile_id: string | null; workspace_id: string | null } | undefined;
    if (row) return { profileId: row.profile_id, workspaceId: row.workspace_id };
  }
  if (typeof a.projectId === "string") {
    const row = sqlite.prepare("SELECT profile_id, workspace_id FROM projects WHERE id = ?").get(a.projectId) as
      { profile_id: string | null; workspace_id: string | null } | undefined;
    if (row) return { profileId: row.profile_id, workspaceId: row.workspace_id };
  }
  if (typeof a.profileId === "string") {
    const row = sqlite.prepare("SELECT workspace_id FROM profiles WHERE id = ?").get(a.profileId) as
      { workspace_id: string | null } | undefined;
    if (row) return { profileId: a.profileId, workspaceId: row.workspace_id };
  }
  return {};
}
