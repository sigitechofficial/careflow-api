import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Narrow gate for `POST /dev/generate-ia-section` only.
 *
 * Allowed in any non-production environment, or in production when
 * `ENABLE_IA_QA_DEMO=true`. Does **not** honour `ENABLE_DEV_TOOLS` and does not
 * unlock any other `/dev/*` route. When blocked, the route behaves as if it
 * does not exist (404).
 */
@Injectable()
export class IaQaDemoGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    const nodeEnv = this.config.get<string>('app.nodeEnv') ?? 'development';
    const enableIaQaDemo = this.config.get<boolean>('app.enableIaQaDemo') === true;
    if (nodeEnv !== 'production' || enableIaQaDemo) {
      return true;
    }
    throw new NotFoundException();
  }
}
