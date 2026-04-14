CREATE TABLE `kanban_tag` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`project_id` text,
	`card_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`position` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_kanban_tag_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_kanban_tag_card_id_kanban_card_id_fk` FOREIGN KEY (`card_id`) REFERENCES `kanban_card`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `kanban_card` ADD `color` text;--> statement-breakpoint
ALTER TABLE `kanban_column` ADD `color` text;--> statement-breakpoint
CREATE INDEX `kanban_tag_scope_idx` ON `kanban_tag` (`scope`);--> statement-breakpoint
CREATE INDEX `kanban_tag_project_idx` ON `kanban_tag` (`project_id`);--> statement-breakpoint
CREATE INDEX `kanban_tag_card_idx` ON `kanban_tag` (`card_id`);--> statement-breakpoint
CREATE INDEX `kanban_tag_scope_position_idx` ON `kanban_tag` (`scope`,`position`);