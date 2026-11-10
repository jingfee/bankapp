CREATE TABLE `banks` (
	`name` text PRIMARY KEY NOT NULL,
	`country` text NOT NULL,
	`logo_url` text,
	`beta` integer DEFAULT false NOT NULL
);
