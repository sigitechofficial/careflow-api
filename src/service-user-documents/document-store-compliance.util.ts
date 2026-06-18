import type {
  ServiceUserDocumentRecord,
  ServiceUserDocumentTypeCatalog,
  ServiceUserLegalDocument,
} from '@prisma/client';

export type DocumentComplianceTone = 'green' | 'red' | 'amber';

export type DocumentComplianceItem = {
  key: string;
  label: string;
  tone: DocumentComplianceTone;
  statusLabel: string;
  blocksCarePlanApproval: boolean;
  detail?: string;
};

type DocumentRecordWithType = ServiceUserDocumentRecord & {
  documentType: ServiceUserDocumentTypeCatalog;
};

function isExpired(doc: ServiceUserDocumentRecord): boolean {
  if (!doc.expiryDate) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expiry = new Date(doc.expiryDate);
  expiry.setUTCHours(0, 0, 0, 0);
  return expiry.getTime() < today.getTime();
}

function activeDocumentsOfType(
  documents: DocumentRecordWithType[],
  typeCode: string,
): DocumentRecordWithType[] {
  return documents.filter(
    (d) =>
      d.documentType.code === typeCode &&
      d.deletedAt === null &&
      d.status === 'ACTIVE' &&
      Boolean(d.fileUrl),
  );
}

function hasValidActiveDocument(documents: DocumentRecordWithType[], typeCode: string): boolean {
  const rows = activeDocumentsOfType(documents, typeCode);
  return rows.some((d) => !isExpired(d));
}

function hasExpiredOnly(documents: DocumentRecordWithType[], typeCode: string): boolean {
  const rows = activeDocumentsOfType(documents, typeCode);
  return rows.length > 0 && rows.every((d) => isExpired(d));
}

export function buildDocumentStoreCompliance(input: {
  documents: DocumentRecordWithType[];
  legal: ServiceUserLegalDocument | null;
  mcaAssessmentComplete: boolean;
  medicationSupportRequired: boolean;
}): DocumentComplianceItem[] {
  const { documents, legal, mcaAssessmentComplete, medicationSupportRequired } = input;

  const serviceAgreementPresent = hasValidActiveDocument(documents, 'SERVICE_AGREEMENT');
  const serviceAgreementExpired = hasExpiredOnly(documents, 'SERVICE_AGREEMENT');

  const consentPresent = hasValidActiveDocument(documents, 'CONSENT_FORMS');
  const consentExpired = hasExpiredOnly(documents, 'CONSENT_FORMS');

  const prescriptionPresent = hasValidActiveDocument(documents, 'GP_PRESCRIPTION');
  const prescriptionExpired = hasExpiredOnly(documents, 'GP_PRESCRIPTION');

  const dnacprConfirmation = legal?.dnacprStatusConfirmation ?? 'UNKNOWN';
  const lpaConfirmation = legal?.lpaStatusConfirmation ?? 'UNKNOWN';

  const items: DocumentComplianceItem[] = [
    {
      key: 'service_agreement',
      label: 'Service agreement (signed)',
      tone: serviceAgreementPresent ? 'green' : serviceAgreementExpired ? 'red' : 'red',
      statusLabel: serviceAgreementPresent
        ? 'Present'
        : serviceAgreementExpired
          ? 'EXPIRED'
          : 'MISSING',
      blocksCarePlanApproval: true,
    },
    {
      key: 'consent_care',
      label: 'Consent to care (signed)',
      tone: consentPresent ? 'green' : consentExpired ? 'red' : 'red',
      statusLabel: consentPresent ? 'Present' : consentExpired ? 'EXPIRED' : 'MISSING',
      blocksCarePlanApproval: true,
    },
    {
      key: 'mca_assessment',
      label: 'MCA assessment (ASS-03) or capacity assumed',
      tone: mcaAssessmentComplete ? 'green' : 'red',
      statusLabel: mcaAssessmentComplete ? 'Present' : 'MISSING',
      blocksCarePlanApproval: true,
      detail: mcaAssessmentComplete
        ? undefined
        : 'Complete MCA screening assessment or document capacity assumed.',
    },
    {
      key: 'dnar_status',
      label: 'DNAR status confirmed',
      tone:
        dnacprConfirmation === 'UNKNOWN'
          ? 'amber'
          : dnacprConfirmation === 'IN_PLACE'
            ? 'green'
            : 'green',
      statusLabel:
        dnacprConfirmation === 'UNKNOWN'
          ? 'UNKNOWN'
          : dnacprConfirmation === 'IN_PLACE'
            ? 'In place'
            : 'Not in place',
      blocksCarePlanApproval: false,
      detail:
        dnacprConfirmation === 'UNKNOWN'
          ? 'Confirm whether a DNAR/DNACPR order is in place — even if none exists.'
          : undefined,
    },
    {
      key: 'lpa_status',
      label: 'LPA status confirmed',
      tone: lpaConfirmation === 'UNKNOWN' ? 'amber' : 'green',
      statusLabel:
        lpaConfirmation === 'UNKNOWN'
          ? 'UNKNOWN'
          : lpaConfirmation === 'IN_FORCE'
            ? 'In force'
            : lpaConfirmation === 'NONE'
              ? 'None'
              : 'Not in force',
      blocksCarePlanApproval: false,
      detail:
        lpaConfirmation === 'UNKNOWN'
          ? 'Confirm LPA status — in force, not in force, or none.'
          : undefined,
    },
  ];

  if (medicationSupportRequired) {
    items.push({
      key: 'prescription',
      label: 'Prescription / medication list',
      tone: prescriptionPresent ? 'green' : prescriptionExpired ? 'red' : 'red',
      statusLabel: prescriptionPresent ? 'Present' : prescriptionExpired ? 'EXPIRED' : 'MISSING',
      blocksCarePlanApproval: true,
      detail: 'Required because medication support is recorded for this service user.',
    });
  }

  return items;
}

export function carePlanApprovalBlockedByDocuments(compliance: DocumentComplianceItem[]): boolean {
  return compliance.some((item) => item.blocksCarePlanApproval && item.tone !== 'green');
}
