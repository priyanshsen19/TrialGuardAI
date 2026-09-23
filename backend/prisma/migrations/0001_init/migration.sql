-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ScreeningStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('ELIGIBLE', 'INELIGIBLE', 'REQUIRES_HUMAN_REVIEW');

-- CreateEnum
CREATE TYPE "ReviewTaskStatus" AS ENUM ('OPEN', 'AWAITING_INFORMATION', 'ESCALATED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('APPROVE_ELIGIBLE', 'APPROVE_INELIGIBLE', 'REQUEST_MORE_INFORMATION', 'REQUIRE_ADDITIONAL_REVIEW');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "permissions" TEXT[],

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trial" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "sponsor" TEXT NOT NULL,
    "indication" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Protocol" (
    "id" TEXT NOT NULL,
    "trialId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Protocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolVersion" (
    "id" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "contentHash" TEXT NOT NULL,
    "redactedHash" TEXT,
    "documentId" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "phiSummary" JSONB,
    "extractionNotes" JSONB,
    "groundingRejections" JSONB,
    "injectionFindings" JSONB,
    "agentExecutionId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractedAt" TIMESTAMP(3),

    CONSTRAINT "ProtocolVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolCriterion" (
    "id" TEXT NOT NULL,
    "protocolVersionId" TEXT NOT NULL,
    "criterionKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL,
    "requiresHumanReview" BOOLEAN NOT NULL,
    "ambiguity" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,

    CONSTRAINT "ProtocolCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "patientRef" TEXT NOT NULL,
    "sex" TEXT,
    "phiScope" TEXT NOT NULL,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientVersion" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "phiSummary" JSONB,
    "injectionFindings" JSONB,
    "groundingRejections" JSONB,
    "extractionNotes" JSONB,
    "agentExecutionId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractedAt" TIMESTAMP(3),

    CONSTRAINT "PatientVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalFact" (
    "id" TEXT NOT NULL,
    "patientVersionId" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "value" JSONB,
    "unit" TEXT,
    "observedAt" TEXT,
    "datePrecision" TEXT NOT NULL,
    "sourceDocument" TEXT NOT NULL,
    "sourcePage" INTEGER NOT NULL,
    "mappingStatus" TEXT NOT NULL,
    "ontologyMappingId" TEXT,
    "data" JSONB NOT NULL,

    CONSTRAINT "ClinicalFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OntologyMapping" (
    "id" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "proposedSystem" TEXT,
    "proposedCode" TEXT,
    "system" TEXT,
    "code" TEXT,
    "display" TEXT,
    "status" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "ontologyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OntologyMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "redactedPages" JSONB NOT NULL,
    "patientVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhiVaultEntry" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhiVaultEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Screening" (
    "id" TEXT NOT NULL,
    "screeningRef" TEXT NOT NULL,
    "trialId" TEXT NOT NULL,
    "protocolVersionId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "patientVersionId" TEXT NOT NULL,
    "screeningDate" TEXT NOT NULL,
    "status" "ScreeningStatus" NOT NULL DEFAULT 'QUEUED',
    "decision" "Decision",
    "finalDecision" "Decision",
    "confidence" DOUBLE PRECISION,
    "decisionReasons" JSONB,
    "confidenceBreakdown" JSONB,
    "pipelineState" JSONB NOT NULL,
    "narrative" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT,
    "requestedById" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Screening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionEvaluation" (
    "id" TEXT NOT NULL,
    "screeningId" TEXT NOT NULL,
    "criterionKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL,
    "requirement" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "conditionMet" BOOLEAN,
    "operator" TEXT NOT NULL,
    "expectedValue" TEXT NOT NULL,
    "actualValue" TEXT,
    "ruleExpression" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reviewReasons" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sourcePage" INTEGER NOT NULL,
    "sourceSection" TEXT NOT NULL,

    CONSTRAINT "CriterionEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyFlag" (
    "id" TEXT NOT NULL,
    "screeningId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "factIds" TEXT[],
    "criterionIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewTask" (
    "id" TEXT NOT NULL,
    "screeningId" TEXT NOT NULL,
    "status" "ReviewTaskStatus" NOT NULL DEFAULT 'OPEN',
    "reasons" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL,
    "reviewTaskId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerRole" TEXT NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "resultingDecision" "Decision",
    "signatureHash" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "screeningId" TEXT,
    "timestamp" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "component" TEXT NOT NULL,
    "componentVersion" TEXT NOT NULL,
    "inputHash" TEXT,
    "outputHash" TEXT,
    "payload" JSONB NOT NULL,
    "previousEventHash" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "correlationId" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRoot" (
    "id" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "screeningId" TEXT,
    "rootHash" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRoot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditDossier" (
    "id" TEXT NOT NULL,
    "screeningId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "jsonHash" TEXT NOT NULL,
    "pdfHash" TEXT NOT NULL,
    "jsonStorageKey" TEXT NOT NULL,
    "pdfStorageKey" TEXT NOT NULL,
    "auditRootHash" TEXT NOT NULL,
    "chainValid" BOOLEAN NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditDossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LyzrExecution" (
    "id" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "agentId" TEXT,
    "provider" TEXT NOT NULL,
    "environmentId" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT,
    "injectionDetected" BOOLEAN NOT NULL,
    "safeAiFindings" JSONB NOT NULL,
    "correlationId" TEXT,
    "aimsExport" BOOLEAN NOT NULL,
    "chainId" TEXT NOT NULL,
    "screeningId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LyzrExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Trial_code_key" ON "Trial"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProtocolVersion_documentId_key" ON "ProtocolVersion"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProtocolVersion_protocolId_contentHash_key" ON "ProtocolVersion"("protocolId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProtocolCriterion_protocolVersionId_criterionKey_key" ON "ProtocolCriterion"("protocolVersionId", "criterionKey");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_patientRef_key" ON "Patient"("patientRef");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_phiScope_key" ON "Patient"("phiScope");

-- CreateIndex
CREATE UNIQUE INDEX "PatientVersion_patientId_snapshotHash_key" ON "PatientVersion"("patientId", "snapshotHash");

-- CreateIndex
CREATE UNIQUE INDEX "PatientVersion_patientId_versionNumber_key" ON "PatientVersion"("patientId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalFact_patientVersionId_factKey_key" ON "ClinicalFact"("patientVersionId", "factKey");

-- CreateIndex
CREATE UNIQUE INDEX "OntologyMapping_sourceText_proposedSystem_proposedCode_onto_key" ON "OntologyMapping"("sourceText", "proposedSystem", "proposedCode", "ontologyVersion");

-- CreateIndex
CREATE INDEX "PhiVaultEntry_scope_idx" ON "PhiVaultEntry"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "PhiVaultEntry_scope_alias_key" ON "PhiVaultEntry"("scope", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "Screening_screeningRef_key" ON "Screening"("screeningRef");

-- CreateIndex
CREATE UNIQUE INDEX "Screening_idempotencyKey_key" ON "Screening"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Screening_decision_idx" ON "Screening"("decision");

-- CreateIndex
CREATE INDEX "Screening_status_idx" ON "Screening"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CriterionEvaluation_screeningId_criterionKey_key" ON "CriterionEvaluation"("screeningId", "criterionKey");

-- CreateIndex
CREATE INDEX "ReviewTask_status_idx" ON "ReviewTask"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewDecision_idempotencyKey_key" ON "ReviewDecision"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_eventHash_key" ON "AuditEvent"("eventHash");

-- CreateIndex
CREATE INDEX "AuditEvent_screeningId_idx" ON "AuditEvent"("screeningId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_chainId_sequence_key" ON "AuditEvent"("chainId", "sequence");

-- CreateIndex
CREATE INDEX "AuditRoot_chainId_idx" ON "AuditRoot"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditDossier_screeningId_version_key" ON "AuditDossier"("screeningId", "version");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "Trial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolVersion" ADD CONSTRAINT "ProtocolVersion_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Protocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolVersion" ADD CONSTRAINT "ProtocolVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolCriterion" ADD CONSTRAINT "ProtocolCriterion_protocolVersionId_fkey" FOREIGN KEY ("protocolVersionId") REFERENCES "ProtocolVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientVersion" ADD CONSTRAINT "PatientVersion_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalFact" ADD CONSTRAINT "ClinicalFact_patientVersionId_fkey" FOREIGN KEY ("patientVersionId") REFERENCES "PatientVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalFact" ADD CONSTRAINT "ClinicalFact_ontologyMappingId_fkey" FOREIGN KEY ("ontologyMappingId") REFERENCES "OntologyMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_patientVersionId_fkey" FOREIGN KEY ("patientVersionId") REFERENCES "PatientVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening" ADD CONSTRAINT "Screening_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "Trial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening" ADD CONSTRAINT "Screening_protocolVersionId_fkey" FOREIGN KEY ("protocolVersionId") REFERENCES "ProtocolVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening" ADD CONSTRAINT "Screening_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening" ADD CONSTRAINT "Screening_patientVersionId_fkey" FOREIGN KEY ("patientVersionId") REFERENCES "PatientVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionEvaluation" ADD CONSTRAINT "CriterionEvaluation_screeningId_fkey" FOREIGN KEY ("screeningId") REFERENCES "Screening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyFlag" ADD CONSTRAINT "SafetyFlag_screeningId_fkey" FOREIGN KEY ("screeningId") REFERENCES "Screening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_screeningId_fkey" FOREIGN KEY ("screeningId") REFERENCES "Screening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_reviewTaskId_fkey" FOREIGN KEY ("reviewTaskId") REFERENCES "ReviewTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditDossier" ADD CONSTRAINT "AuditDossier_screeningId_fkey" FOREIGN KEY ("screeningId") REFERENCES "Screening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LyzrExecution" ADD CONSTRAINT "LyzrExecution_screeningId_fkey" FOREIGN KEY ("screeningId") REFERENCES "Screening"("id") ON DELETE SET NULL ON UPDATE CASCADE;

