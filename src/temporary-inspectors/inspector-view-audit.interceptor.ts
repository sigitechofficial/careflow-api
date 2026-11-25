import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { DataAccessType } from '@prisma/client';
import { Observable, tap } from 'rxjs';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { InspectorDecision } from './inspector-access';

/** One record view logged per inspector, service user and area in this window (a screen loads many parts at once). */
const DEDUPE_MS = 10 * 60_000;

/**
 * Data access log (VIEW) for each part of a service user's record a temporary inspector opens: who (the inspector's
 * name and username), which service user, which area, when. Only successful reads are logged.
 */
@Injectable()
export class InspectorViewAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(InspectorViewAuditInterceptor.name);
  private readonly seen = new Map<string, number>();

  constructor(private readonly auditLogs: AuditLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const user = req?.user as RequestUser | undefined;
    const view = req?.inspectorView as InspectorDecision | undefined;
    if (user?.accountKind !== 'temporary_inspector' || !view?.allowed || !view.serviceUserId) return next.handle();
    return next.handle().pipe(tap(() => this.record(user, view.serviceUserId!, view.area, req)));
  }

  private record(user: RequestUser, serviceUserId: string, area: string | null, req: { ip?: string; headers?: Record<string, unknown>; originalUrl?: string }) {
    const key = `${user.id}:${serviceUserId}:${area ?? 'record'}`;
    const now = Date.now();
    if ((this.seen.get(key) ?? 0) > now - DEDUPE_MS) return;
    this.seen.set(key, now);
    if (this.seen.size > 5000) {
      for (const [k, at] of this.seen) if (at <= now - DEDUPE_MS) this.seen.delete(k);
    }
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || user.id;
    void this.auditLogs
      .logDataAccess({
        userId: null,
        module: 'SERVICE_USERS',
        recordType: 'ServiceUser',
        recordId: serviceUserId,
        accessType: DataAccessType.VIEW,
        reason: `Temporary inspector ${name} viewed ${area ?? 'the record'}`,
        ipAddress: req.ip ?? null,
        userAgent: typeof req.headers?.['user-agent'] === 'string' ? (req.headers['user-agent'] as string) : null,
        metadata: { temporaryInspectorId: user.id, username: user.username, area: area ?? 'record', path: req.originalUrl },
      })
      .catch((e: unknown) => this.logger.warn(`Inspector view audit failed: ${(e as Error)?.message ?? e}`));
  }
}
