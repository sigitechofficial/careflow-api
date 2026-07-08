import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const INVOICE_TEMPLATE_SYSTEM_FIELDS = [
  { key: 'SERVICE_USER_FULL_NAME', label: 'Service user full name' },
  { key: 'SERVICE_USER_NUMBER', label: 'Service user number' },
  { key: 'SERVICE_USER_DOB', label: 'Date of birth' },
  { key: 'SERVICE_USER_NHS_NUMBER', label: 'NHS number' },
  { key: 'SERVICE_USER_FUNDER_REF', label: 'Funder / council reference' },
  { key: 'FUNDING_REFERENCE', label: 'Funding reference' },
  { key: 'PACKAGE_NAME', label: 'Care package name' },
  { key: 'PO_NUMBER', label: 'Purchase order number' },
  { key: 'VISIT_DATE', label: 'Visit date' },
  { key: 'VISIT_START_TIME', label: 'Visit start time' },
  { key: 'VISIT_END_TIME', label: 'Visit end time' },
  { key: 'VISIT_DURATION_UNITS', label: 'Duration / units' },
  { key: 'SERVICE_CODE', label: 'Service code' },
  { key: 'SERVICE_TYPE', label: 'Service type' },
  { key: 'RATE_AMOUNT', label: 'Rate amount' },
  { key: 'LINE_TOTAL', label: 'Line total' },
  { key: 'BILLING_CONTACT_NAME', label: 'Billing contact name' },
  { key: 'BILLING_CONTACT_EMAIL', label: 'Billing contact email' },
  { key: 'BILL_TO_ADDRESS', label: 'Bill-to address' },
  { key: 'PAYMENT_TERMS', label: 'Payment terms' },
  { key: 'FUNDER_NAME', label: 'Funder name' },
] as const;

export type InvoiceTemplateSystemFieldKey =
  (typeof INVOICE_TEMPLATE_SYSTEM_FIELDS)[number]['key'];

const SYSTEM_FIELD_SET = new Set<string>(INVOICE_TEMPLATE_SYSTEM_FIELDS.map((f) => f.key));

export function isValidSystemFieldKey(key: string): boolean {
  return SYSTEM_FIELD_SET.has(key);
}

export function systemFieldLabel(key: string): string {
  return INVOICE_TEMPLATE_SYSTEM_FIELDS.find((f) => f.key === key)?.label ?? key;
}

export type InvoiceTemplateValidationIssue = {
  fieldKey: string;
  label: string;
  message: string;
};

export function validateInvoiceTemplateFields(input: {
  fields: Array<{ systemFieldKey: string; label: string; isRequired: boolean }>;
  context: {
    serviceUserName?: string | null;
    serviceUserNumber?: string | null;
    dateOfBirth?: Date | null;
    nhsNumber?: string | null;
    fundingReference?: string | null;
    packageName?: string | null;
    purchaseOrderNumber?: string | null;
    billingContactName?: string | null;
    billingContactEmail?: string | null;
    funderName?: string | null;
  };
}): { isValid: boolean; issues: InvoiceTemplateValidationIssue[] } {
  const issues: InvoiceTemplateValidationIssue[] = [];
  const ctx = input.context;

  const checks: Record<string, () => string | Date | null | undefined> = {
    SERVICE_USER_FULL_NAME: () => ctx.serviceUserName,
    SERVICE_USER_NUMBER: () => ctx.serviceUserNumber,
    SERVICE_USER_DOB: () => ctx.dateOfBirth,
    SERVICE_USER_NHS_NUMBER: () => ctx.nhsNumber,
    SERVICE_USER_FUNDER_REF: () => ctx.fundingReference,
    FUNDING_REFERENCE: () => ctx.fundingReference,
    PACKAGE_NAME: () => ctx.packageName,
    PO_NUMBER: () => ctx.purchaseOrderNumber,
    BILLING_CONTACT_NAME: () => ctx.billingContactName,
    BILLING_CONTACT_EMAIL: () => ctx.billingContactEmail,
    FUNDER_NAME: () => ctx.funderName,
  };

  for (const field of input.fields) {
    if (!field.isRequired) continue;
    const resolver = checks[field.systemFieldKey];
    if (!resolver) continue;
    const value = resolver();
    const empty =
      value == null ||
      (typeof value === 'string' && !value.trim()) ||
      (value instanceof Date && Number.isNaN(value.getTime()));
    if (empty) {
      issues.push({
        fieldKey: field.systemFieldKey,
        label: field.label,
        message: `Required field "${field.label}" is missing on the service user or funding record`,
      });
    }
  }

  return { isValid: issues.length === 0, issues };
}

export function pickOrganisationDefaultTemplate<
  T extends {
    scope: string;
    status: string;
    deletedAt: Date | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  },
>(templates: T[], asOf: Date = new Date()): T | null {
  const day = new Date(asOf);
  day.setUTCHours(0, 0, 0, 0);
  const active = templates.filter(
    (t) =>
      t.deletedAt == null &&
      t.status === 'ACTIVE' &&
      t.scope === 'ORGANISATION_DEFAULT' &&
      t.effectiveFrom <= day &&
      (t.effectiveTo == null || t.effectiveTo >= day),
  );
  return active.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null;
}

export type InvoiceTemplateResolveSource =
  | 'EXPLICIT_FUNDING'
  | 'EXPLICIT_FUNDER'
  | 'ORGANISATION_DEFAULT'
  | 'MATCHED_SCOPE'
  | 'NONE';

export async function assertDefaultInvoiceTemplate(
  tx: Prisma.TransactionClient,
  templateId: string | null | undefined,
) {
  if (!templateId) return;
  const row = await tx.invoiceTemplate.findFirst({
    where: { id: templateId, deletedAt: null },
  });
  if (!row) throw new BadRequestException('Invoice template not found');
}
