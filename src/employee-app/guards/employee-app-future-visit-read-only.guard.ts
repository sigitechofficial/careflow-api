import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../../organisation-general-settings/organisation-general-settings.service';
import {
  dayKeyInTimeZone,
  operationalTodayIso,
} from '../../common/utils/operational-day.util';

/**
 * Carer app: a visit whose scheduled day is after today (organisation operational
 * day) is read-only. Reads (GET/HEAD/OPTIONS) pass through. SOS is exempt so a
 * carer can always raise an emergency. Requests for an unknown job are passed on
 * so the service returns its usual not-found response.
 */
@Injectable()
export class EmployeeAppFutureVisitReadOnlyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
    if (/\/sos$/.test(req.path)) return true;

    const jobId = req.params?.jobId;
    if (!jobId) return true;

    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null },
      select: { scheduledStartDateTime: true },
    });
    if (!job) return true;

    const timeZone = await this.orgSettings.getOperationalTimezone();
    const visitDay = dayKeyInTimeZone(job.scheduledStartDateTime, timeZone);
    const today = operationalTodayIso(new Date(), timeZone);
    if (visitDay > today) {
      throw new ForbiddenException({
        code: 'VISIT_FUTURE_READ_ONLY',
        message:
          'This visit is in the future. You can view it, but you cannot make changes until its day.',
      });
    }
    return true;
  }
}
