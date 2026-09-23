-- Persist the LLM-vs-deterministic cross-validation report for each extraction.
ALTER TABLE "ProtocolVersion" ADD COLUMN "crossValidation" JSONB;
ALTER TABLE "PatientVersion" ADD COLUMN "crossValidation" JSONB;
