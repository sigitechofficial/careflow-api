import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { IaApiAutofillService } from './ia-api-autofill.service';
import { isDesignatedIaQaDemoServiceUserNumber } from './ia-qa-demo-allowlist';
import type { AnswerInput, IaAutofillLevel } from './ia-autofill-build.util';

@Injectable()
export class DevToolsService {
  constructor(
    private readonly iaApiAutofill: IaApiAutofillService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Generate (no-save) demo values for one holistic tab. Returns the answers + worksheet
   * metadata for the frontend to merge into the editable form draft — nothing is persisted.
   */
  async generateIaSection(
    level: IaAutofillLevel,
    tabId: number,
    questionIds: string[],
    identity?: import('./ia-autofill-build.util').IaDemoIdentity | null,
    serviceUserId?: string,
  ): Promise<{
    answers: AnswerInput[];
    metadata: Record<string, unknown>;
    profilePatch: import('./ia-autofill-build.util').IaDemoProfilePatch;
  }> {
    if (!['low', 'normal', 'critical'].includes(level)) {
      throw new BadRequestException('level must be low, normal, or critical');
    }

    await this.assertDesignatedQaDemoServiceUser(serviceUserId);

    return this.iaApiAutofill.generateSection(
      level,
      tabId,
      Array.isArray(questionIds) ? questionIds : [],
      identity,
    );
  }

  /**
   * Production: only designated QA Service Users (SU-1042). Non-production keeps the
   * existing any-SU behaviour so local/e2e still work.
   */
  private async assertDesignatedQaDemoServiceUser(serviceUserId?: string): Promise<void> {
    const nodeEnv = this.config.get<string>('app.nodeEnv') ?? 'development';
    if (nodeEnv !== 'production') return;

    if (!serviceUserId) {
      throw new ForbiddenException(
        'QA Demo Data is only allowed for designated QA Service Users.',
      );
    }

    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { serviceUserNumber: true },
    });

    if (!isDesignatedIaQaDemoServiceUserNumber(su?.serviceUserNumber)) {
      throw new ForbiddenException(
        'QA Demo Data is only allowed for designated QA Service Users.',
      );
    }
  }
}
