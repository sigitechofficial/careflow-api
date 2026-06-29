import { BadRequestException, Injectable } from '@nestjs/common';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { IaApiAutofillService } from './ia-api-autofill.service';
import type { IaAutofillLevel } from './ia-autofill-build.util';

@Injectable()
export class DevToolsService {
  constructor(private readonly iaApiAutofill: IaApiAutofillService) {}

  async runIaPlaywrightAutofill(
    userId: string,
    serviceUserId: string,
    level: IaAutofillLevel,
    meta?: RequestAuditMeta,
  ): Promise<{ message: string }> {
    if (!['low', 'normal', 'critical'].includes(level)) {
      throw new BadRequestException('level must be low, normal, or critical');
    }
    if (!serviceUserId?.trim()) {
      throw new BadRequestException('serviceUserId is required');
    }

    return this.iaApiAutofill.run(userId, serviceUserId.trim(), level, meta);
  }
}
