-- Part-11-oriented control: audit records are append-only at the database layer.
-- UPDATE and DELETE on audit tables raise an exception regardless of the caller.
CREATE OR REPLACE FUNCTION trialguard_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TrialGuard audit records are append-only: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION trialguard_forbid_mutation();

CREATE TRIGGER audit_root_append_only
  BEFORE UPDATE OR DELETE ON "AuditRoot"
  FOR EACH ROW EXECUTE FUNCTION trialguard_forbid_mutation();

CREATE TRIGGER review_decision_append_only
  BEFORE UPDATE OR DELETE ON "ReviewDecision"
  FOR EACH ROW EXECUTE FUNCTION trialguard_forbid_mutation();

-- Human-readable screening reference numbers (SCR-00001).
CREATE SEQUENCE IF NOT EXISTS screening_ref_seq START 1;
