CREATE TABLE `auth_attempts` (
	`attempt_key` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`first_failed_at` real NOT NULL,
	`blocked_until` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_attempts_blocked_idx` ON `auth_attempts` (`blocked_until`);