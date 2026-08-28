import { BadRequestException, Injectable } from '@nestjs/common';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { IaApiAutofillService } from './ia-api-autofill.service';
import type { IaAutofillLevel } from './ia-autofill-build.util';

@Injectable()
export class DevToolsService {
  constructor(private readonly iaApiAutofill: IaApiAutofillService) {}

  async runIaSectionAutofill(
    userId: string,
    serviceUserId: string,
    level: IaAutofillLevel,
    tabId: number,
    questionIds: string[],
    meta?: RequestAuditMeta,
  ): Promise<{ message: string; tabId: number; answersWritten: number }> {
    if (!['low', 'normal', 'critical'].includes(level)) {
      throw new BadRequestException('level must be low, normal, or critical');
    }
    if (!serviceUserId?.trim()) {
      throw new BadRequestException('serviceUserId is required');
    }

    return this.iaApiAutofill.runSection(
      userId,
      serviceUserId.trim(),
      level,
      tabId,
      Array.isArray(questionIds) ? questionIds : [],
      meta,
    );
  }
}
