-- Search index (FTS5). Text is folded by the app (foldPolish) before insert and before query,
-- because FTS5 remove_diacritics does not fold "ł".
CREATE VIRTUAL TABLE `search_index` USING fts5(
	entity_type UNINDEXED,
	entity_id UNINDEXED,
	location_id UNINDEXED,
	title,
	body,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
-- The first location (decision D14).
INSERT INTO `locations` (`id`, `name`, `slug`) VALUES ('loc_senator', 'Senator', 'senator');
--> statement-breakpoint
-- The 14 EU allergens (Regulation (EU) No 1169/2011, Annex II).
INSERT INTO `allergens` (`id`, `name_pl`, `sort_order`) VALUES
	('gluten', 'Gluten', 1),
	('crustaceans', 'Skorupiaki', 2),
	('eggs', 'Jaja', 3),
	('fish', 'Ryby', 4),
	('peanuts', 'Orzeszki ziemne', 5),
	('soy', 'Soja', 6),
	('milk', 'Mleko', 7),
	('nuts', 'Orzechy', 8),
	('celery', 'Seler', 9),
	('mustard', 'Gorczyca', 10),
	('sesame', 'Sezam', 11),
	('sulphites', 'Dwutlenek siarki i siarczyny', 12),
	('lupin', 'Łubin', 13),
	('molluscs', 'Mięczaki', 14);
