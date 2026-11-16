-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('PUPIL_CHARGE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('ONLINE', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MOBILE_MONEY', 'BANK_TRANSFER', 'CARD', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentVerificationDecision" AS ENUM ('VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'GHS',
    "amountMinor" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolInvoice" (
    "id" UUID NOT NULL,
    "invoiceNumber" VARCHAR(64) NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "academicTermId" UUID NOT NULL,
    "pricingRuleId" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'GHS',
    "unitAmountMinor" INTEGER NOT NULL,
    "billablePupilCount" INTEGER NOT NULL,
    "subtotalMinor" INTEGER NOT NULL,
    "adjustmentMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "outstandingMinor" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATE,
    "issuedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "snapshot" JSONB NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "kind" "InvoiceLineKind" NOT NULL,
    "description" VARCHAR(400) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmountMinor" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePupil" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "academicTermId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "pupilId" UUID NOT NULL,
    "reportCardId" UUID,
    "pupilName" VARCHAR(240) NOT NULL,
    "admissionNumber" VARCHAR(40) NOT NULL,
    "reportVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePupil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "source" "PaymentSource" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountMinor" INTEGER NOT NULL,
    "appliedMinor" INTEGER NOT NULL DEFAULT 0,
    "overpaymentMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL,
    "paymentReference" VARCHAR(120) NOT NULL,
    "provider" VARCHAR(40),
    "providerReference" VARCHAR(160),
    "idempotencyKey" VARCHAR(120),
    "payerName" VARCHAR(160),
    "paidAt" DATE NOT NULL,
    "notes" VARCHAR(1000),
    "submittedByMembershipId" UUID,
    "initiatedByUserId" UUID,
    "verifiedByUserId" UUID,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvidence" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "uploadedByMembershipId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentVerification" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "decision" "PaymentVerificationDecision" NOT NULL,
    "fromStatus" "PaymentStatus" NOT NULL,
    "toStatus" "PaymentStatus" NOT NULL,
    "reason" VARCHAR(1000),
    "verifiedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAuditHistory" (
    "id" UUID NOT NULL,
    "schoolId" UUID,
    "invoiceId" UUID,
    "paymentId" UUID,
    "actorUserId" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" VARCHAR(80),
    "beforeState" JSONB,
    "afterState" JSONB,
    "metadata" JSONB,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingAuditHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProviderEvent" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "providerEventId" VARCHAR(160) NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "providerReference" VARCHAR(160),
    "schoolId" UUID,
    "paymentId" UUID,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "outcome" VARCHAR(40) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PricingRule_currency_isActive_effectiveFrom_idx" ON "PricingRule"("currency", "isActive", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PricingRule_createdByUserId_idx" ON "PricingRule"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_currency_version_key" ON "PricingRule"("currency", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_currency_effectiveFrom_key" ON "PricingRule"("currency", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolInvoice_invoiceNumber_key" ON "SchoolInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "SchoolInvoice_schoolId_issueDate_idx" ON "SchoolInvoice"("schoolId", "issueDate");

-- CreateIndex
CREATE INDEX "SchoolInvoice_schoolId_status_idx" ON "SchoolInvoice"("schoolId", "status");

-- CreateIndex
CREATE INDEX "SchoolInvoice_status_outstandingMinor_idx" ON "SchoolInvoice"("status", "outstandingMinor");

-- CreateIndex
CREATE INDEX "SchoolInvoice_academicTermId_idx" ON "SchoolInvoice"("academicTermId");

-- CreateIndex
CREATE INDEX "SchoolInvoice_pricingRuleId_idx" ON "SchoolInvoice"("pricingRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolInvoice_schoolId_academicYearId_academicTermId_key" ON "SchoolInvoice"("schoolId", "academicYearId", "academicTermId");

-- CreateIndex
CREATE INDEX "InvoiceLine_schoolId_invoiceId_sortOrder_idx" ON "InvoiceLine"("schoolId", "invoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "InvoicePupil_schoolId_academicYearId_academicTermId_idx" ON "InvoicePupil"("schoolId", "academicYearId", "academicTermId");

-- CreateIndex
CREATE INDEX "InvoicePupil_pupilId_idx" ON "InvoicePupil"("pupilId");

-- CreateIndex
CREATE INDEX "InvoicePupil_reportCardId_idx" ON "InvoicePupil"("reportCardId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePupil_invoiceId_pupilId_key" ON "InvoicePupil"("invoiceId", "pupilId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePupil_invoiceId_reportCardId_key" ON "InvoicePupil"("invoiceId", "reportCardId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerReference_key" ON "Payment"("providerReference");

-- CreateIndex
CREATE INDEX "Payment_schoolId_status_submittedAt_idx" ON "Payment"("schoolId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_status_idx" ON "Payment"("invoiceId", "status");

-- CreateIndex
CREATE INDEX "Payment_verifiedByUserId_idx" ON "Payment"("verifiedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_schoolId_paymentReference_key" ON "Payment"("schoolId", "paymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_schoolId_idempotencyKey_key" ON "Payment"("schoolId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvidence_storageKey_key" ON "PaymentEvidence"("storageKey");

-- CreateIndex
CREATE INDEX "PaymentEvidence_schoolId_paymentId_idx" ON "PaymentEvidence"("schoolId", "paymentId");

-- CreateIndex
CREATE INDEX "PaymentEvidence_uploadedByMembershipId_idx" ON "PaymentEvidence"("uploadedByMembershipId");

-- CreateIndex
CREATE INDEX "PaymentVerification_schoolId_createdAt_idx" ON "PaymentVerification"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentVerification_paymentId_createdAt_idx" ON "PaymentVerification"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentVerification_verifiedByUserId_idx" ON "PaymentVerification"("verifiedByUserId");

-- CreateIndex
CREATE INDEX "BillingAuditHistory_schoolId_createdAt_idx" ON "BillingAuditHistory"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAuditHistory_invoiceId_createdAt_idx" ON "BillingAuditHistory"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAuditHistory_paymentId_createdAt_idx" ON "BillingAuditHistory"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAuditHistory_actorUserId_createdAt_idx" ON "BillingAuditHistory"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAuditHistory_action_createdAt_idx" ON "BillingAuditHistory"("action", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentProviderEvent_paymentId_receivedAt_idx" ON "PaymentProviderEvent"("paymentId", "receivedAt");

-- CreateIndex
CREATE INDEX "PaymentProviderEvent_schoolId_receivedAt_idx" ON "PaymentProviderEvent"("schoolId", "receivedAt");

-- CreateIndex
CREATE INDEX "PaymentProviderEvent_providerReference_idx" ON "PaymentProviderEvent"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderEvent_provider_providerEventId_key" ON "PaymentProviderEvent"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolInvoice" ADD CONSTRAINT "SchoolInvoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolInvoice" ADD CONSTRAINT "SchoolInvoice_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolInvoice" ADD CONSTRAINT "SchoolInvoice_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolInvoice" ADD CONSTRAINT "SchoolInvoice_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "PricingRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolInvoice" ADD CONSTRAINT "SchoolInvoice_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SchoolInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePupil" ADD CONSTRAINT "InvoicePupil_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SchoolInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePupil" ADD CONSTRAINT "InvoicePupil_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePupil" ADD CONSTRAINT "InvoicePupil_pupilId_fkey" FOREIGN KEY ("pupilId") REFERENCES "Pupil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePupil" ADD CONSTRAINT "InvoicePupil_reportCardId_fkey" FOREIGN KEY ("reportCardId") REFERENCES "ReportCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SchoolInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_submittedByMembershipId_fkey" FOREIGN KEY ("submittedByMembershipId") REFERENCES "SchoolMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvidence" ADD CONSTRAINT "PaymentEvidence_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvidence" ADD CONSTRAINT "PaymentEvidence_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvidence" ADD CONSTRAINT "PaymentEvidence_uploadedByMembershipId_fkey" FOREIGN KEY ("uploadedByMembershipId") REFERENCES "SchoolMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SchoolInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAuditHistory" ADD CONSTRAINT "BillingAuditHistory_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAuditHistory" ADD CONSTRAINT "BillingAuditHistory_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SchoolInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAuditHistory" ADD CONSTRAINT "BillingAuditHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 6A integrity constraints. These enforce monetary invariants even if application code regresses.
ALTER TABLE "PricingRule"
  ADD CONSTRAINT "PricingRule_amount_positive_check" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "PricingRule_effective_range_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  ADD CONSTRAINT "PricingRule_version_positive_check" CHECK ("version" > 0);

ALTER TABLE "SchoolInvoice"
  ADD CONSTRAINT "SchoolInvoice_money_check" CHECK (
    "unitAmountMinor" > 0 AND "billablePupilCount" >= 0 AND "subtotalMinor" >= 0 AND
    "subtotalMinor" = "unitAmountMinor" * "billablePupilCount" AND
    "totalMinor" = "subtotalMinor" + "adjustmentMinor" AND
    "totalMinor" >= 0 AND "paidMinor" >= 0 AND "paidMinor" <= "totalMinor" AND
    "outstandingMinor" = "totalMinor" - "paidMinor"
  ),
  ADD CONSTRAINT "SchoolInvoice_status_money_check" CHECK (
    ("status" = 'DRAFT' AND "paidMinor" = 0) OR
    ("status" = 'ISSUED' AND "paidMinor" = 0) OR
    ("status" = 'PARTIALLY_PAID' AND "paidMinor" > 0 AND "paidMinor" < "totalMinor") OR
    ("status" = 'PAID' AND "paidMinor" = "totalMinor") OR
    ("status" = 'CANCELLED')
  );

ALTER TABLE "InvoiceLine"
  ADD CONSTRAINT "InvoiceLine_amount_check" CHECK ("quantity" > 0 AND "amountMinor" = "unitAmountMinor" * "quantity");

ALTER TABLE "InvoicePupil"
  ADD CONSTRAINT "InvoicePupil_version_check" CHECK ("reportVersion" > 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_check" CHECK (
    "amountMinor" > 0 AND "appliedMinor" >= 0 AND "overpaymentMinor" >= 0 AND
    "appliedMinor" <= "amountMinor" AND (
      ("status" <> 'VERIFIED' AND "appliedMinor" = 0 AND "overpaymentMinor" = 0) OR
      ("status" = 'VERIFIED' AND "overpaymentMinor" = "amountMinor" - "appliedMinor")
    )
  ),
  ADD CONSTRAINT "Payment_status_verification_check" CHECK (
    ("status" NOT IN ('VERIFIED', 'REJECTED') OR "verifiedAt" IS NOT NULL) AND
    ("status" <> 'REJECTED' OR "rejectionReason" IS NOT NULL)
  ),
  ADD CONSTRAINT "Payment_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "PaymentEvidence"
  ADD CONSTRAINT "PaymentEvidence_size_check" CHECK ("byteSize" > 0);

