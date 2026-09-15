import type {
  ServiceUserDocumentRecord,
  ServiceUserDocumentTypeCatalog,
  ServiceUserLegalDocument,
} from '@prisma/client';

export type DocumentComplianceTone = 'green' | 'red' | 'amber';

export type DocumentComplianceGroup = 'required' | 'legal' | 'clinical' | 'recommended';

export type DocumentComplianceItem = {
  key: string;
  label: string;
  tone: DocumentComplianceTone;
  statusLabel: string;
  blocksCarePlanApproval: boolean;
  group: DocumentComplianceGroup;
  /** Document-store folder to open / upload into when applicable. */
  documentTypeCode: string | null;
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

function documentPresenceItem(input: {
  key: string;
  label: string;
  typeCode: string;
  documents: DocumentRecordWithType[];
  blocksCarePlanApproval: boolean;
  group: DocumentComplianceGroup;
  detailMissing?: string;
  detailExpired?: string;
}): DocumentComplianceItem {
  const present = hasValidActiveDocument(input.documents, input.typeCode);
  const expired = hasExpiredOnly(input.documents, input.typeCode);
  return {
    key: input.key,
    label: input.label,
    tone: present ? 'green' : 'red',
    statusLabel: present ? 'Present' : expired ? 'EXPIRED' : 'MISSING',
    blocksCarePlanApproval: input.blocksCarePlanApproval,
    group: input.group,
    documentTypeCode: input.typeCode,
    detail: present
      ? undefined
      : expired
        ? (input.detailExpired ?? 'Upload a current copy — the existing file has expired.')
        : input.detailMissing,
  };
}

/**
 * Service-user compliance checklist (CQC Reg 9 / 11 / 12 / 17 oriented).
 * Only tracks items that matter for clients — not workforce docs (DBS, RTW, etc.).
 */
export function buildDocumentStoreCompliance(input: {
  documents: DocumentRecordWithType[];
  legal: ServiceUserLegalDocument | null;
  mcaAssessmentComplete: boolean;
  medicationSupportRequired: boolean;
  hasActiveDols?: boolean;
}): DocumentComplianceItem[] {
  const {
    documents,
    legal,
    mcaAssessmentComplete,
    medicationSupportRequired,
    hasActiveDols = false,
  } = input;

  const dnacprConfirmation = legal?.dnacprStatusConfirmation ?? 'UNKNOWN';
  const lpaConfirmation = legal?.lpaStatusConfirmation ?? 'UNKNOWN';

  const items: DocumentComplianceItem[] = [
    documentPresenceItem({
      key: 'service_agreement',
      label: 'Service agreement (signed)',
      typeCode: 'SERVICE_AGREEMENT',
      documents,
      blocksCarePlanApproval: true,
      group: 'required',
      detailMissing: 'Signed service agreement / contract is required before care starts.',
    }),
    documentPresenceItem({
      key: 'consent_care',
      label: 'Consent to care (signed)',
      typeCode: 'CONSENT_FORMS',
      documents,
      blocksCarePlanApproval: true,
      group: 'required',
      detailMissing: 'Consent to care, photography, and information-sharing must be on file.',
    }),
    {
      key: 'mca_assessment',
      label: 'MCA assessment (ASS-03) or capacity assumed',
      tone: mcaAssessmentComplete ? 'green' : 'red',
      statusLabel: mcaAssessmentComplete ? 'Present' : 'MISSING',
      blocksCarePlanApproval: true,
      group: 'required',
      documentTypeCode: null,
      detail: mcaAssessmentComplete
        ? undefined
        : 'Complete MCA screening assessment or document that capacity is assumed.',
    },
    {
      key: 'dnar_status',
      label: 'DNAR / DNACPR status confirmed',
      tone: dnacprConfirmation === 'UNKNOWN' ? 'amber' : 'green',
      statusLabel:
        dnacprConfirmation === 'UNKNOWN'
          ? 'UNKNOWN'
          : dnacprConfirmation === 'IN_PLACE'
            ? 'In place'
            : 'Not in place',
      blocksCarePlanApproval: false,
      group: 'legal',
      documentTypeCode: null,
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
      group: 'legal',
      documentTypeCode: null,
      detail:
        lpaConfirmation === 'UNKNOWN'
          ? 'Confirm LPA status — in force, not in force, or none.'
          : undefined,
    },
  ];

  // When DNAR is in place, the physical order must be on file (CQC checks accessibility).
  if (dnacprConfirmation === 'IN_PLACE') {
    items.push(
      documentPresenceItem({
        key: 'dnar_document',
        label: 'DNAR / DNACPR order (copy)',
        typeCode: 'DNAR_DNACPR',
        documents,
        blocksCarePlanApproval: true,
        group: 'legal',
        detailMissing: 'DNAR is marked in place — upload the order and note its location in the home.',
      }),
    );
  }

  // When LPA is in force, keep Health & Welfare paperwork on file.
  if (lpaConfirmation === 'IN_FORCE') {
    items.push(
      documentPresenceItem({
        key: 'lpa_health_document',
        label: 'LPA — Health & Welfare (copy)',
        typeCode: 'LPA_HEALTH_WELFARE',
        documents,
        blocksCarePlanApproval: true,
        group: 'legal',
        detailMissing: 'LPA is in force — upload the Health & Welfare lasting power of attorney.',
      }),
    );
  }

  // Active DoLS/LPS authorisation needs the authorisation document with expiry.
  if (hasActiveDols) {
    items.push(
      documentPresenceItem({
        key: 'dols_document',
        label: 'DoLS / LPS authorisation',
        typeCode: 'DOLS_LPS',
        documents,
        blocksCarePlanApproval: true,
        group: 'legal',
        detailMissing: 'An active DoLS/LPS is recorded — upload the current authorisation.',
        detailExpired: 'DoLS/LPS authorisation has expired — upload the renewed authorisation.',
      }),
    );
  }

  if (medicationSupportRequired) {
    items.push(
      documentPresenceItem({
        key: 'prescription',
        label: 'Prescription / medication list',
        typeCode: 'GP_PRESCRIPTION',
        documents,
        blocksCarePlanApproval: true,
        group: 'clinical',
        detailMissing: 'Required because medication support is recorded for this service user.',
      }),
    );
  }

  // Recommended (never block care-plan approval): end-of-life planning + ID verification.
  items.push(
    (() => {
      const present = hasValidActiveDocument(documents, 'RESPECT_FORM');
      return {
        key: 'respect_form',
        label: 'ReSPECT form',
        tone: present ? 'green' : 'amber',
        statusLabel: present ? 'Present' : 'Recommended',
        blocksCarePlanApproval: false,
        group: 'recommended' as const,
        documentTypeCode: 'RESPECT_FORM',
        detail: present
          ? undefined
          : 'Recommended for people with complex or end-of-life needs (NICE NG142).',
      };
    })(),
    (() => {
      const present = hasValidActiveDocument(documents, 'IDENTITY_DOCUMENTS');
      const expired = hasExpiredOnly(documents, 'IDENTITY_DOCUMENTS');
      return {
        key: 'identity_documents',
        label: 'Identity documents',
        tone: present ? 'green' : expired ? 'amber' : 'amber',
        statusLabel: present ? 'Present' : expired ? 'EXPIRED' : 'Recommended',
        blocksCarePlanApproval: false,
        group: 'recommended' as const,
        documentTypeCode: 'IDENTITY_DOCUMENTS',
        detail: present
          ? undefined
          : 'Passport, photo ID, or NHS card — useful for verification and continuity.',
      };
    })(),
  );

  return items;
}

export function carePlanApprovalBlockedByDocuments(compliance: DocumentComplianceItem[]): boolean {
  return compliance.some((item) => item.blocksCarePlanApproval && item.tone !== 'green');
}
