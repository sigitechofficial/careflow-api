import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { JOBS_TRIGGER_SECRET_HEADER } from './jobs.constants';

/** Constant-time comparison (hashing first so lengths never leak). */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b) && provided.length === expected.length;
}

/**
 * Shared-secret auth for POST /internal/jobs/:name (Azure Functions → API).
 * Unset JOBS_TRIGGER_SECRET ⇒ 503 (endpoint disabled); wrong/missing header ⇒ 401.
 */
@Injectable()
export class JobsTriggerSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = (
      this.config.get<string>('jobs.triggerSecret') ?? ''
    ).trim();
    if (!expected) {
      throw new ServiceUnavailableException(
        'Job trigger disabled (JOBS_TRIGGER_SECRET is not set)',
      );
    }
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const raw = req.headers[JOBS_TRIGGER_SECRET_HEADER];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!provided || !secretsMatch(provided, expected)) {
      throw new UnauthorizedException('Invalid job trigger secret');
    }
    return true;
  }
}
