CREATE TABLE `kanban_card` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`project_id` text,
	`column_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`position` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_kanban_card_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_kanban_card_column_id_kanban_column_id_fk` FOREIGN KEY (`column_id`) REFERENCES `kanban_column`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `kanban_column` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_kanban_column_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `kanban_card_scope_idx` ON `kanban_card` (`scope`);--> statement-breakpoint
CREATE INDEX `kanban_card_project_idx` ON `kanban_card` (`project_id`);--> statement-breakpoint
CREATE INDEX `kanban_card_column_idx` ON `kanban_card` (`column_id`);--> statement-breakpoint
CREATE INDEX `kanban_card_scope_position_idx` ON `kanban_card` (`scope`,`position`);--> statement-breakpoint
CREATE INDEX `kanban_column_scope_idx` ON `kanban_column` (`scope`);--> statement-breakpoint
CREATE INDEX `kanban_column_project_idx` ON `kanban_column` (`project_id`);--> statement-breakpoint
CREATE INDEX `kanban_column_scope_position_idx` ON `kanban_column` (`scope`,`position`);