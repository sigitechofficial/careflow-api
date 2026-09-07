import { BadRequestException, Injectable } from '@nestjs/common';
import { IaApiAutofillService } from './ia-api-autofill.service';
import type { AnswerInput, IaAutofillLevel } from './ia-autofill-build.util';

@Injectable()
export class DevToolsService {
  constructor(private readonly iaApiAutofill: IaApiAutofillService) {}

  /**
   * Generate (no-save) demo values for one holistic tab. Returns the answers + worksheet
   * metadata for the frontend to merge into the editable form draft — nothing is persisted.
   * Operates on the currently opened Service User context supplied as identity / questionIds.
   * `serviceUserId` is accepted for the client profile-patch path and is not used as authorization.
   */
  async generateIaSection(
    level: IaAutofillLevel,
    tabId: number,
    questionIds: string[],
    identity?: import('./ia-autofill-build.util').IaDemoIdentity | null,
    _serviceUserId?: string,
  ): Promise<{
    answers: AnswerInput[];
    metadata: Record<string, unknown>;
    profilePatch: import('./ia-autofill-build.util').IaDemoProfilePatch;
  }> {
    if (!['low', 'normal', 'critical'].includes(level)) {
      throw new BadRequestException('level must be low, normal, or critical');
    }

    return this.iaApiAutofill.generateSection(
      level,
      tabId,
      Array.isArray(questionIds) ? questionIds : [],
      identity,
    );
  }
}
