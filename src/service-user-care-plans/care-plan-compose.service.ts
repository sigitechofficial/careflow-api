import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  loadCarePlanComposeContext,
  loadCarePlanFormFields,
  runCarePlanCompose,
} from './compose/compose-context.loader';
import { computeComposeDeltas } from './compose/compose-delta.util';
import { resolveCarePlanFactsheets } from './compose/resolve-care-plan-factsheets.util';
import {
  isSuggestionGatedComposeMode,
  normalizeComposePlanResult,
} from './compose/compose-provenance.util';

@Injectable()
export class CarePlanComposeService {
  constructor(private readonly prisma: PrismaService) {}

  async compose(serviceUserId: string, carePathwayFormId: string) {
    const [{ formName, fields, reviewFrequencyMonths }, ctx, instance] = await Promise.all([
      loadCarePlanFormFields(this.prisma, carePathwayFormId),
      loadCarePlanComposeContext(this.prisma, serviceUserId),
      this.prisma.serviceUserCarePlanInstance.findUnique({
        where: {
          serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId },
        },
        select: {
          publishedVersions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            select: { valuesJson: true, versionNumber: true },
          },
        },
      }),
    ]);

    const result = normalizeComposePlanResult(
      runCarePlanCompose(formName, { ...ctx, reviewFrequencyMonths }, fields),
    );
    const factsheets = resolveCarePlanFactsheets(formName, ctx.personalisation);
    const latestPublished = instance?.publishedVersions[0]?.valuesJson as
      | Record<string, string | boolean>
      | undefined;
    const fieldLabels = Object.fromEntries(fields.map((f) => [f.key, f.label]));
    const deltas = isSuggestionGatedComposeMode(result.suggestionMode)
      ? []
      : computeComposeDeltas(result.values, latestPublished, fieldLabels);

    return {
      data: {
        carePathwayFormId,
        formName,
        ...result,
        factsheets,
        deltas,
        lastPublishedVersionNumber: instance?.publishedVersions[0]?.versionNumber ?? null,
      },
    };
  }
}
