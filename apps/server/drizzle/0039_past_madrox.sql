CREATE TABLE `model_eval_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`suite_id` text NOT NULL,
	`case_id` text NOT NULL,
	`model_id` text NOT NULL,
	`output_json` text NOT NULL,
	`grades_json` text NOT NULL,
	`judge_score` text,
	`cached` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_eval_results_run_idx` ON `model_eval_results` (`run_id`);--> statement-breakpoint
CREATE TABLE `model_eval_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`suite_ids` text NOT NULL,
	`model_ids` text NOT NULL,
	`status` text NOT NULL,
	`calls_used` integer NOT NULL,
	`max_calls` integer NOT NULL,
	`pending_action_id` text,
	`summary_vi` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `model_task_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`task_id` text NOT NULL,
	`day` text NOT NULL,
	`calls` integer NOT NULL,
	`success_rate` text NOT NULL,
	`schema_valid_rate` text NOT NULL,
	`retries` integer NOT NULL,
	`fallback_rate` text NOT NULL,
	`fallback_reasons` text NOT NULL,
	`p50_latency_ms` integer,
	`p95_latency_ms` integer,
	`p50_tokens` integer,
	`p95_tokens` integer,
	`p50_cost_usd` text,
	`p95_cost_usd` text,
	`quality` text NOT NULL,
	`confidence` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_task_stats_task_idx` ON `model_task_stats` (`task_id`,`day`);--> statement-breakpoint
CREATE TABLE `provider_intel_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`what` text NOT NULL,
	`old_summary` text NOT NULL,
	`new_summary` text NOT NULL,
	`needs_review` integer NOT NULL,
	`reviewed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_intel_changes_review_idx` ON `provider_intel_changes` (`needs_review`,`created_at`);--> statement-breakpoint
CREATE TABLE `provider_intel_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`provider_id` text NOT NULL,
	`page_kind` text NOT NULL,
	`content_hash` text NOT NULL,
	`body_text` text NOT NULL,
	`last_fetched_at` text NOT NULL,
	`last_changed_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_intel_pages_url_idx` ON `provider_intel_pages` (`url`);--> statement-breakpoint
CREATE INDEX `provider_intel_pages_provider_idx` ON `provider_intel_pages` (`provider_id`);--> statement-breakpoint
CREATE TABLE `provider_intel_probes` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model` text NOT NULL,
	`at` text NOT NULL,
	`ok` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`error_kind` text
);
--> statement-breakpoint
CREATE INDEX `provider_intel_probes_model_idx` ON `provider_intel_probes` (`provider_id`,`model`,`at`);--> statement-breakpoint
CREATE TABLE `provider_intel_records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`json` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`superseded_at` text
);
--> statement-breakpoint
CREATE INDEX `provider_intel_records_current_idx` ON `provider_intel_records` (`kind`,`key`,`superseded_at`);--> statement-breakpoint
CREATE TABLE `provider_intel_research_queue` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_run_at` text,
	`note` text
);
