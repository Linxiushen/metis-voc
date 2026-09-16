-- Schema migration only. Administrators are provisioned from deployment
-- secrets on an empty installation; migrations never install credentials.
ALTER TABLE `users` ADD `role` text DEFAULT 'member' NOT NULL;
