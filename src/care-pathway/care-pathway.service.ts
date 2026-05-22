import { Injectable } from '@nestjs/common';
import { DataAccessType } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';

@Injectable()
export class CarePathwayService {
  constructor(private readonly audit: AuditLogsService) {}

  getOverview(userId: string, meta?: RequestAuditMeta) {
    void this.audit.logDataAccess({
      userId,
      module: AuditModule.CARE_PATHWAY,
      recordType: 'CarePathwayOverview',
      recordId: 'overview',
      accessType: DataAccessType.VIEW,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: { route: 'care_pathway.overview' },
    }).catch(() => undefined);

    return {
      data: {
        tabs: [
          { id: 'wizard', label: 'Wizard' },
          { id: 'form-builder', label: 'Form Builder' },
          { id: 'form-selection', label: 'Form Selection' },
          { id: 'care-plan-text', label: 'Care Plan Text' },
          { id: 'checklists', label: 'Checklists' },
          { id: 'actions', label: 'Actions' },
          { id: 'gallery', label: 'Gallery' },
        ],
        purpose:
          'Configure care plans, assessments, actions (with checklists), and other forms for your service. Setting up these resources saves time and provides consistency throughout the care planning journey.',
        wizardSteps: [
          'Configure care plans, assessments, actions, and forms.',
          'Build customised forms if optional Form Builder is used.',
          'Select default forms where required.',
          'Build default care-plan text.',
          'Write care plans using selected/default forms.',
          'Create pre-set checklists.',
          'Create pre-set actions/visits.',
          'Personalise actions/visits for service users.',
          'Deliver consistent care through configured resources.',
        ],
        implementationStatus: {
          overview: true,
          formBuilder: true,
          formSelection: true,
          carePlanText: true,
          checklists: true,
          actions: true,
          gallery: true,
        },
      },
    };
  }
}
