CREATE TABLE `workflow` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text,
	`last_session_id` text,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer NOT NULL,
	`schedule` text NOT NULL,
	`action` text NOT NULL,
	`run_count` integer NOT NULL,
	`time_next_run` integer,
	`time_last_run` integer,
	`time_last_success` integer,
	`time_last_error` integer,
	`last_error` text,
	`claim_owner` text,
	`time_claimed` integer,
	`claim_until` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_workflow_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workflow_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_project_idx` ON `workflow` (`project_id`);--> statement-breakpoint
CREATE INDEX `workflow_project_enabled_next_idx` ON `workflow` (`project_id`,`enabled`,`time_next_run`);--> statement-breakpoint
CREATE INDEX `workflow_project_claim_idx` ON `workflow` (`project_id`,`claim_until`);
