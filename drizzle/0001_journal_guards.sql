-- These protections are part of the schema: use versioned migrations, not db push.
CREATE FUNCTION public.timeteknika_reject_journal_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Journal append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.audit
FOR EACH STATEMENT EXECUTE FUNCTION public.timeteknika_reject_journal_mutation();
--> statement-breakpoint
CREATE TRIGGER event_log_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.event_log
FOR EACH STATEMENT EXECUTE FUNCTION public.timeteknika_reject_journal_mutation();
--> statement-breakpoint
CREATE FUNCTION public.timeteknika_check_journal_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_seq bigint;
  previous_digest text;
BEGIN
  -- The future writer must acquire this SAME transaction lock BEFORE reading the
  -- head and computing the hash, using the same connection until commit/rollback:
  -- SELECT pg_advisory_xact_lock(1414808906, 1);
  -- The trigger also locks to protect direct inserts. Conflicting/stale appends
  -- must be retried as a whole transaction; this never rewrites a supplied hash.
  PERFORM pg_advisory_xact_lock(1414808906, 1);
  SELECT seq, hash INTO previous_seq, previous_digest
    FROM public.event_log ORDER BY seq DESC LIMIT 1;
  IF NEW.seq <> COALESCE(previous_seq, 0) + 1
    OR NEW.previous_hash <> COALESCE(previous_digest, repeat('0', 64)) THEN
    RAISE EXCEPTION 'Invalid journal chain'
      USING ERRCODE = '23514', CONSTRAINT = 'event_log_chain';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER event_log_chain
BEFORE INSERT ON public.event_log
FOR EACH ROW EXECUTE FUNCTION public.timeteknika_check_journal_chain();
