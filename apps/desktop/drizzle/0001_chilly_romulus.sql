CREATE TABLE `session_names` (
	`session_id` text NOT NULL,
	`agent` text NOT NULL,
	`name` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `agent`)
);
