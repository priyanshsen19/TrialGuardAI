-- Rename Decision.REQUIRES_HUMAN_REVIEW -> REQUIRES_HUMAN_OVERVIEW to match the
-- HiDevs Agent Arena problem statement's exact terminology (meaning unchanged).
ALTER TYPE "Decision" RENAME VALUE 'REQUIRES_HUMAN_REVIEW' TO 'REQUIRES_HUMAN_OVERVIEW';
