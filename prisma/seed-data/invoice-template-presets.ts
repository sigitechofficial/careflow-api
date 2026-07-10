import type {
  BillingCardStatus,
  BillingFrequency,
  InvoiceTemplateLayoutPreset,
  InvoiceTemplateScope,
  InvoiceTemplateType,
} from '@prisma/client';

export type InvoiceTemplatePresetField = {
  systemFieldKey: string;
  label: string;
  isRequired: boolean;
};

export type InvoiceTemplateLayoutPresetDefinition = {
  key: InvoiceTemplateLayoutPreset;
  name: string;
  description: string;
  usedBy: string;
  templateType: InvoiceTemplateType;
  billingFrequency: BillingFrequency;
  deliveryMethod: string;
  groupingRule: string;
  fileNamePattern: string;
  includeRemittance: boolean;
  scope: InvoiceTemplateScope;
  status: BillingCardStatus;
  fields: InvoiceTemplatePresetField[];
};

const PROVIDER_HEADER: InvoiceTemplatePresetField[] = [
  { systemFieldKey: 'PROVIDER_NAME', label: 'Provider name', isRequired: true },
  { systemFieldKey: 'PROVIDER_ADDRESS', label: 'Provider address', isRequired: true },
  { systemFieldKey: 'PROVIDER_PHONE', label: 'Provider telephone', isRequired: false },
  { systemFieldKey: 'PROVIDER_EMAIL', label: 'Provider email', isRequired: false },
  { systemFieldKey: 'PROVIDER_VAT_NUMBER', label: 'VAT number', isRequired: false },
];

const INVOICE_META: InvoiceTemplatePresetField[] = [
  { systemFieldKey: 'INVOICE_NUMBER', label: 'Invoice number', isRequired: true },
  { systemFieldKey: 'INVOICE_DATE', label: 'Invoice date', isRequired: true },
  { systemFieldKey: 'INVOICE_PERIOD_START', label: 'Period start', isRequired: true },
  { systemFieldKey: 'INVOICE_PERIOD_END', label: 'Period end', isRequired: true },
  { systemFieldKey: 'INVOICE_DUE_DATE', label: 'Due date', isRequired: true },
];

const CLIENT_FUNDER: InvoiceTemplatePresetField[] = [
  { systemFieldKey: 'FUNDER_NAME', label: 'Bill to / funder', isRequired: true },
  { systemFieldKey: 'BILL_TO_ADDRESS', label: 'Bill-to address', isRequired: true },
  { systemFieldKey: 'SERVICE_USER_FULL_NAME', label: 'Client name', isRequired: true },
  { systemFieldKey: 'SERVICE_USER_NUMBER', label: 'Client ID', isRequired: true },
  { systemFieldKey: 'SERVICE_USER_FUNDER_REF', label: 'Council / funder reference', isRequired: false },
  { systemFieldKey: 'PO_NUMBER', label: 'Purchase order', isRequired: false },
];

const VISIT_LINES: InvoiceTemplatePresetField[] = [
  { systemFieldKey: 'VISIT_DATE', label: 'Visit date', isRequired: true },
  { systemFieldKey: 'VISIT_START_TIME', label: 'Start time', isRequired: true },
  { systemFieldKey: 'VISIT_END_TIME', label: 'End time', isRequired: true },
  { systemFieldKey: 'VISIT_DURATION_UNITS', label: 'Hours', isRequired: true },
  { systemFieldKey: 'SERVICE_TYPE', label: 'Service type', isRequired: true },
  { systemFieldKey: 'RATE_AMOUNT', label: 'Rate', isRequired: true },
  { systemFieldKey: 'LINE_TOTAL', label: 'Line total', isRequired: true },
];

const TOTALS: InvoiceTemplatePresetField[] = [
  { systemFieldKey: 'SUBTOTAL', label: 'Subtotal', isRequired: true },
  { systemFieldKey: 'VAT_AMOUNT', label: 'VAT', isRequired: false },
  { systemFieldKey: 'INVOICE_TOTAL', label: 'Total due', isRequired: true },
  { systemFieldKey: 'PAYMENT_TERMS', label: 'Payment terms', isRequired: false },
];

const LA_SHEET_COLUMNS: InvoiceTemplatePresetField[] = [
  { systemFieldKey: 'SERVICE_USER_FULL_NAME', label: 'Client Name', isRequired: true },
  { systemFieldKey: 'SERVICE_USER_NUMBER', label: 'Client ID', isRequired: true },
  { systemFieldKey: 'SERVICE_USER_DOB', label: 'Date of Birth', isRequired: true },
  { systemFieldKey: 'SERVICE_USER_FUNDER_REF', label: 'Council Reference', isRequired: true },
  { systemFieldKey: 'PO_NUMBER', label: 'PO Number', isRequired: true },
  { systemFieldKey: 'PACKAGE_NAME', label: 'Package', isRequired: false },
  { systemFieldKey: 'COST_CENTRE', label: 'Cost Centre', isRequired: false },
  { systemFieldKey: 'INVOICE_PERIOD_START', label: 'Period Start', isRequired: true },
  { systemFieldKey: 'INVOICE_PERIOD_END', label: 'Period End', isRequired: true },
  { systemFieldKey: 'VISIT_DATE', label: 'Visit Date', isRequired: true },
  { systemFieldKey: 'VISIT_START_TIME', label: 'Start Time', isRequired: true },
  { systemFieldKey: 'VISIT_END_TIME', label: 'End Time', isRequired: true },
  { systemFieldKey: 'VISIT_DURATION_UNITS', label: 'Hours', isRequired: true },
  { systemFieldKey: 'SERVICE_CODE', label: 'Service Code', isRequired: false },
  { systemFieldKey: 'SERVICE_TYPE', label: 'Service Type', isRequired: true },
  { systemFieldKey: 'RATE_AMOUNT', label: 'Rate', isRequired: true },
  { systemFieldKey: 'LINE_TOTAL', label: 'Amount', isRequired: true },
  { systemFieldKey: 'INVOICE_NUMBER', label: 'Invoice Number', isRequired: true },
];

export const INVOICE_TEMPLATE_LAYOUT_PRESETS: InvoiceTemplateLayoutPresetDefinition[] = [
  {
    key: 'STANDARD',
    name: 'Standard UK invoice',
    description:
      'Weekly PDF invoice with provider letterhead, bill-to block, client details, and visit line table.',
    usedBy: 'Birdie, Access Group, Nourish — general funder billing',
    templateType: 'PDF',
    billingFrequency: 'WEEKLY',
    deliveryMethod: 'Email',
    groupingRule: 'One invoice per service user',
    fileNamePattern: 'INV-{funder}-{week}.pdf',
    includeRemittance: false,
    scope: 'ORGANISATION_DEFAULT',
    status: 'ACTIVE',
    fields: [
      ...PROVIDER_HEADER,
      ...INVOICE_META,
      ...CLIENT_FUNDER,
      ...VISIT_LINES,
      ...TOTALS,
    ],
  },
  {
    key: 'LOCAL_AUTHORITY',
    name: 'Local authority Excel',
    description:
      'Council commissioning upload sheet with fixed column headers for LA portals and batch invoicing.',
    usedBy: 'Birdie LA export, Access Group council billing, Nourish LA templates',
    templateType: 'XLSX',
    billingFrequency: 'WEEKLY',
    deliveryMethod: 'Council portal upload',
    groupingRule: 'One consolidated council file',
    fileNamePattern: 'LA-{funder}-{week}.xlsx',
    includeRemittance: false,
    scope: 'ORGANISATION_DEFAULT',
    status: 'ACTIVE',
    fields: LA_SHEET_COLUMNS,
  },
  {
    key: 'NHS',
    name: 'NHS / CHC invoice',
    description:
      'NHS and continuing healthcare billing with NHS number, contract reference, and monthly period totals.',
    usedBy: 'Birdie NHS, Access Group CHC, Nourish NHS billing',
    templateType: 'PDF',
    billingFrequency: 'MONTHLY',
    deliveryMethod: 'Secure upload',
    groupingRule: 'One invoice per care package',
    fileNamePattern: 'NHS-{code}-{week}.pdf',
    includeRemittance: false,
    scope: 'ORGANISATION_DEFAULT',
    status: 'ACTIVE',
    fields: [
      ...PROVIDER_HEADER,
      ...INVOICE_META,
      { systemFieldKey: 'FUNDER_NAME', label: 'CCG / ICB name', isRequired: true },
      { systemFieldKey: 'BILL_TO_ADDRESS', label: 'Bill-to address', isRequired: true },
      { systemFieldKey: 'SERVICE_USER_FULL_NAME', label: 'Patient name', isRequired: true },
      { systemFieldKey: 'SERVICE_USER_NHS_NUMBER', label: 'NHS number', isRequired: true },
      { systemFieldKey: 'CONTRACT_REFERENCE', label: 'Contract reference', isRequired: true },
      { systemFieldKey: 'PACKAGE_NAME', label: 'Care package', isRequired: true },
      ...VISIT_LINES,
      ...TOTALS,
    ],
  },
  {
    key: 'PRIVATE_CLIENT',
    name: 'Private client invoice',
    description:
      'Family or self-funder PDF with payment terms and detachable remittance advice slip.',
    usedBy: 'Birdie private billing, Access Group self-funder, Nourish family invoices',
    templateType: 'PDF',
    billingFrequency: 'MONTHLY',
    deliveryMethod: 'Email',
    groupingRule: 'One invoice per billing contact',
    fileNamePattern: 'PVT-{code}-{week}.pdf',
    includeRemittance: true,
    scope: 'ORGANISATION_DEFAULT',
    status: 'ACTIVE',
    fields: [
      ...PROVIDER_HEADER,
      ...INVOICE_META,
      { systemFieldKey: 'BILLING_CONTACT_NAME', label: 'Bill to', isRequired: true },
      { systemFieldKey: 'BILL_TO_ADDRESS', label: 'Billing address', isRequired: true },
      { systemFieldKey: 'SERVICE_USER_FULL_NAME', label: 'Client name', isRequired: true },
      { systemFieldKey: 'SERVICE_USER_NUMBER', label: 'Client ID', isRequired: false },
      ...VISIT_LINES,
      ...TOTALS,
      { systemFieldKey: 'REMITTANCE_NOTE', label: 'Payment instructions', isRequired: true },
    ],
  },
];

export function presetCodeForLayout(key: InvoiceTemplateLayoutPreset): string {
  switch (key) {
    case 'STANDARD':
      return 'INV-STD-UK';
    case 'LOCAL_AUTHORITY':
      return 'INV-LA-XLSX';
    case 'NHS':
      return 'INV-NHS-UK';
    case 'PRIVATE_CLIENT':
      return 'INV-PVT-UK';
    default:
      return `INV-${key}`;
  }
}

export function getInvoiceTemplateLayoutPreset(
  key: InvoiceTemplateLayoutPreset,
): InvoiceTemplateLayoutPresetDefinition | undefined {
  return INVOICE_TEMPLATE_LAYOUT_PRESETS.find(preset => preset.key === key);
}
