CREATE TABLE `concept_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`tenant_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`prompt` text NOT NULL,
	`design_brief` text NOT NULL,
	`model` text,
	`lovart_project_id` text,
	`lovart_thread_id` text,
	`pending_confirmation` text,
	`artifacts` text,
	`public_token` text NOT NULL,
	`error` text,
	`created_at` real NOT NULL,
	`updated_at` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `concept_images_run_idx` ON `concept_images` (`run_id`,`id`);--> statement-breakpoint
CREATE INDEX `concept_images_tenant_idx` ON `concept_images` (`tenant_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `concept_images_public_token_unique` ON `concept_images` (`public_token`);