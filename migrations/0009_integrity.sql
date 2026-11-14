ALTER TABLE tasks ADD predecessor_id text REFERENCES tasks(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE tasks ADD recurrence_untouched integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE tasks ADD mutation_id text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX tasks_predecessor_uq ON tasks(predecessor_id);
--> statement-breakpoint
ALTER TABLE transactions ADD repayment_override integer;
--> statement-breakpoint
-- Manuelle Buchungen sind nicht Teil der automatischen Erkennung. Bestehende importierte
-- Werte lassen sich nicht verlässlich als manuell oder automatisch unterscheiden.
UPDATE transactions SET repayment_override = is_repayment WHERE hash IS NULL;
--> statement-breakpoint
ALTER TABLE health_connection ADD sync_through text;
