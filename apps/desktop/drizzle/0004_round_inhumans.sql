CREATE TABLE `project_monitored_commands` (
	`project_id` text NOT NULL,
	`command` text NOT NULL,
	PRIMARY KEY(`project_id`, `command`)
);
--> statement-breakpoint
CREATE INDEX `idx_project_monitored_commands_project` ON `project_monitored_commands` (`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `artifacts_enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `selected_agents` text DEFAULT '[]' NOT NULL;