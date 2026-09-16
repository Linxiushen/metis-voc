CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`title` text,
	`input_mode` text,
	`input_payload` text,
	`marketplace` text,
	`view_profile` text DEFAULT 'P1',
	`data_scope` text DEFAULT 'public_ok',
	`status` text DEFAULT 'await_clarify',
	`verdict` text,
	`research_plan` text,
	`report` text,
	`decision_outcome` text,
	`outcome_note` text,
	`reviewed` integer DEFAULT 0,
	`created_at` real NOT NULL,
	`updated_at` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_tenant_id_idx` ON `runs` (`tenant_id`,`id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`tenant_id` integer NOT NULL,
	`expires_at` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`plan` text DEFAULT 'trial' NOT NULL,
	`settings` text,
	`created_at` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`email` text NOT NULL,
	`pw_hash` text NOT NULL,
	`name` text,
	`created_at` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_tenant_idx` ON `users` (`tenant_id`);