CREATE TABLE `project_paths` (
	`project_id` text PRIMARY KEY NOT NULL,
	`local_path` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_local` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`local_status` text DEFAULT 'open' NOT NULL,
	`broken_reason` text,
	`last_opened_at` integer,
	`is_pinned` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`label` text NOT NULL,
	`display_order` integer NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`panel_status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_terminals_workspace` ON `workspace_terminals` (`workspace_id`);