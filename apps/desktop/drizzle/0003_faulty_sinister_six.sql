CREATE TABLE `project_repositories` (
	`project_id` text NOT NULL,
	`repo_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `repo_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_project_repositories_project` ON `project_repositories` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`remote_url` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_remote_url_unique` ON `repositories` (`remote_url`);--> statement-breakpoint
CREATE TABLE `workspace_repos` (
	`workspace_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`source_branch` text,
	PRIMARY KEY(`workspace_id`, `repo_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_repos_workspace` ON `workspace_repos` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`sanitized_name` text NOT NULL,
	`branch_name` text NOT NULL,
	`source_branch` text NOT NULL,
	`created_by` text NOT NULL,
	`owner_name` text NOT NULL,
	`lifecycle_status` text DEFAULT 'in_progress' NOT NULL,
	`lifecycle_status_changed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workspaces_project` ON `workspaces` (`project_id`);