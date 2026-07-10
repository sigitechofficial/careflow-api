import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const INVOICE_TEMPLATE_FIELD_GROUPS = [
  { id: 'PROVIDER', label: 'Care provider (letterhead)' },
  { id: 'INVOICE', label: 'Invoice details' },
  { id: 'CLIENT', label: 'Client / service user' },
  { id: 'FUNDER', label: 'Funder / bill-to' },
  { id: 'VISIT', label: 'Visit lines' },
  { id: 'TOTALS', label: 'Totals & payment' },
] as const;

export type InvoiceTemplateFieldGroupId =
  (typeof INVOICE_TEMPLATE_FIELD_GROUPS)[number]['id'];

export const INVOICE_TEMPLATE_SYSTEM_FIELDS: Array<{
  key: string;
  label: string;
  group: InvoiceTemplateFieldGroupId;
}> = [
  { key: 'PROVIDER_NAME', label: 'Provider / agency name', group: 'PROVIDER' },
  { key: 'PROVIDER_ADDRESS', label: 'Provider address', group: 'PROVIDER' },
  { key: 'PROVIDER_PHONE', label: 'Provider telephone', group: 'PROVIDER' },
  { key: 'PROVIDER_EMAIL', label: 'Provider email', group: 'PROVIDER' },
  { key: 'PROVIDER_VAT_NUMBER', label: 'VAT registration number', group: 'PROVIDER' },
  { key: 'PROVIDER_COMPANY_NUMBER', label: 'Company registration number', group: 'PROVIDER' },
  { key: 'INVOICE_NUMBER', label: 'Invoice number', group: 'INVOICE' },
  { key: 'INVOICE_DATE', label: 'Invoice date', group: 'INVOICE' },
  { key: 'INVOICE_PERIOD_START', label: 'Billing period start', group: 'INVOICE' },
  { key: 'INVOICE_PERIOD_END', label: 'Billing period end', group: 'INVOICE' },
  { key: 'INVOICE_DUE_DATE', label: 'Payment due date', group: 'INVOICE' },
  { key: 'SERVICE_USER_FULL_NAME', label: 'Service user full name', group: 'CLIENT' },
  { key: 'SERVICE_USER_NUMBER', label: 'Service user number', group: 'CLIENT' },
  { key: 'SERVICE_USER_DOB', label: 'Date of birth', group: 'CLIENT' },
  { key: 'SERVICE_USER_NHS_NUMBER', label: 'NHS number', group: 'CLIENT' },
  { key: 'SERVICE_USER_FUNDER_REF', label: 'Funder / council reference', group: 'CLIENT' },
  { key: 'FUNDING_REFERENCE', label: 'Funding reference', group: 'CLIENT' },
  { key: 'PACKAGE_NAME', label: 'Care package name', group: 'CLIENT' },
  { key: 'PO_NUMBER', label: 'Purchase order number', group: 'CLIENT' },
  { key: 'CONTRACT_REFERENCE', label: 'Contract reference', group: 'CLIENT' },
  { key: 'COST_CENTRE', label: 'Cost centre', group: 'CLIENT' },
  { key: 'FUNDER_NAME', label: 'Funder name', group: 'FUNDER' },
  { key: 'BILLING_CONTACT_NAME', label: 'Billing contact name', group: 'FUNDER' },
  { key: 'BILLING_CONTACT_EMAIL', label: 'Billing contact email', group: 'FUNDER' },
  { key: 'BILL_TO_ADDRESS', label: 'Bill-to address', group: 'FUNDER' },
  { key: 'VISIT_DATE', label: 'Visit date', group: 'VISIT' },
  { key: 'VISIT_START_TIME', label: 'Visit start time', group: 'VISIT' },
  { key: 'VISIT_END_TIME', label: 'Visit end time', group: 'VISIT' },
  { key: 'VISIT_DURATION_UNITS', label: 'Duration / hours', group: 'VISIT' },
  { key: 'SERVICE_CODE', label: 'Service code', group: 'VISIT' },
  { key: 'SERVICE_TYPE', label: 'Service type', group: 'VISIT' },
  { key: 'RATE_AMOUNT', label: 'Rate amount', group: 'VISIT' },
  { key: 'LINE_TOTAL', label: 'Line total', group: 'VISIT' },
  { key: 'SUBTOTAL', label: 'Subtotal', group: 'TOTALS' },
  { key: 'VAT_AMOUNT', label: 'VAT amount', group: 'TOTALS' },
  { key: 'INVOICE_TOTAL', label: 'Invoice total', group: 'TOTALS' },
  { key: 'PAYMENT_TERMS', label: 'Payment terms', group: 'TOTALS' },
  { key: 'REMITTANCE_NOTE', label: 'Remittance / payment instructions', group: 'TOTALS' },
];

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
    billToAddress?: string | null;
    contractReference?: string | null;
    costCentre?: string | null;
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
    CONTRACT_REFERENCE: () => ctx.contractReference,
    COST_CENTRE: () => ctx.costCentre,
    BILLING_CONTACT_NAME: () => ctx.billingContactName,
    BILLING_CONTACT_EMAIL: () => ctx.billingContactEmail,
    FUNDER_NAME: () => ctx.funderName,
    BILL_TO_ADDRESS: () => ctx.billToAddress,
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
