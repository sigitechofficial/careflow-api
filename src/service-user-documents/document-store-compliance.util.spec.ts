import {
  buildDocumentStoreCompliance,
  carePlanApprovalBlockedByDocuments,
} from './document-store-compliance.util';

describe('document store compliance', () => {
  const baseType = {
    id: 'type-1',
    code: 'SERVICE_AGREEMENT',
    name: 'Service agreement',
    physicalLocationInHomeRequired: false,
    expiryTrackingRequired: false,
    defaultAccessLevel: 'COORDINATOR_MANAGER' as const,
    requiredBeforeFirstVisit: true,
    blocksCarePlanApprovalIfMissing: true,
    expiryAlertDays: null,
    cqcLegalStandard: null,
    sortOrder: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  it('flags missing mandatory documents as blocking', () => {
    const compliance = buildDocumentStoreCompliance({
      documents: [],
      legal: null,
      mcaAssessmentComplete: false,
      medicationSupportRequired: false,
    });

    expect(compliance.find((c) => c.key === 'service_agreement')?.tone).toBe('red');
    expect(compliance.find((c) => c.key === 'service_agreement')?.group).toBe('required');
    expect(compliance.find((c) => c.key === 'dnar_status')?.tone).toBe('amber');
    expect(compliance.find((c) => c.key === 'respect_form')?.tone).toBe('amber');
    expect(compliance.find((c) => c.key === 'dnar_document')).toBeUndefined();
    expect(carePlanApprovalBlockedByDocuments(compliance)).toBe(true);
  });

  it('requires DNAR paperwork when status is in place', () => {
    const compliance = buildDocumentStoreCompliance({
      documents: [],
      legal: {
        id: 'legal-1',
        serviceUserId: 'su-1',
        dnacprInPlace: true,
        dnacprStatusConfirmation: 'IN_PLACE',
        dnacprPhysicalLocation: null,
        dnacprCertificateUrl: null,
        dnacprStartDate: null,
        lpaStatusConfirmation: 'UNKNOWN',
        lpaHealthCertificateUrl: null,
        lpaFinanceCertificateUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: null,
        updatedById: null,
      },
      mcaAssessmentComplete: true,
      medicationSupportRequired: false,
    });

    expect(compliance.find((c) => c.key === 'dnar_document')?.tone).toBe('red');
    expect(carePlanApprovalBlockedByDocuments(compliance)).toBe(true);
  });

  it('requires DoLS authorisation when an active DoLS exists', () => {
    const compliance = buildDocumentStoreCompliance({
      documents: [],
      legal: null,
      mcaAssessmentComplete: true,
      medicationSupportRequired: false,
      hasActiveDols: true,
    });

    expect(compliance.find((c) => c.key === 'dols_document')?.tone).toBe('red');
    expect(compliance.find((c) => c.key === 'dols_document')?.group).toBe('legal');
  });

  it('clears blocking when mandatory documents are present', () => {
    const compliance = buildDocumentStoreCompliance({
      documents: [
        {
          id: 'doc-1',
          serviceUserId: 'su-1',
          documentTypeId: baseType.id,
          title: 'Signed agreement',
          documentDate: new Date(),
          uploadedAt: new Date(),
          uploadedById: null,
          supersedesDocumentId: null,
          expiryDate: null,
          physicalLocationInHome: null,
          accessLevel: 'COORDINATOR_MANAGER',
          status: 'ACTIVE',
          linkedRecordType: null,
          linkedRecordId: null,
          notes: null,
          fileUrl: '/file.pdf',
          fileName: 'file.pdf',
          fileSize: 100,
          mimeType: 'application/pdf',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          createdById: null,
          updatedById: null,
          deletedById: null,
          documentType: { ...baseType, code: 'SERVICE_AGREEMENT' },
        },
        {
          id: 'doc-2',
          serviceUserId: 'su-1',
          documentTypeId: 'type-2',
          title: 'Consent',
          documentDate: new Date(),
          uploadedAt: new Date(),
          uploadedById: null,
          supersedesDocumentId: null,
          expiryDate: null,
          physicalLocationInHome: null,
          accessLevel: 'COORDINATOR_MANAGER',
          status: 'ACTIVE',
          linkedRecordType: null,
          linkedRecordId: null,
          notes: null,
          fileUrl: '/consent.pdf',
          fileName: 'consent.pdf',
          fileSize: 100,
          mimeType: 'application/pdf',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          createdById: null,
          updatedById: null,
          deletedById: null,
          documentType: { ...baseType, id: 'type-2', code: 'CONSENT_FORMS' },
        },
      ],
      legal: {
        id: 'legal-1',
        serviceUserId: 'su-1',
        dnacprInPlace: false,
        dnacprStatusConfirmation: 'NOT_IN_PLACE',
        dnacprPhysicalLocation: null,
        dnacprCertificateUrl: null,
        dnacprStartDate: null,
        lpaStatusConfirmation: 'NONE',
        lpaHealthCertificateUrl: null,
        lpaFinanceCertificateUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: null,
        updatedById: null,
      },
      mcaAssessmentComplete: true,
      medicationSupportRequired: false,
    });

    expect(compliance.find((c) => c.key === 'service_agreement')?.tone).toBe('green');
    expect(compliance.find((c) => c.key === 'dnar_status')?.tone).toBe('green');
    expect(carePlanApprovalBlockedByDocuments(compliance)).toBe(false);
  });
});
