import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Gates the `/dev/*` QA/demo tooling. Allowed in any non-production environment, or in
 * production only when `ENABLE_DEV_TOOLS=true` is explicitly set. Otherwise the routes behave
 * as if they do not exist (404) so production users can never fabricate assessment data.
 *
 * `ENABLE_IA_QA_DEMO` does **not** enable this guard. IA QA Demo uses `IaQaDemoGuard` on
 * `POST /dev/generate-ia-section` only.
 */
@Injectable()
export class DevToolsGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    const nodeEnv = this.config.get<string>('app.nodeEnv') ?? 'development';
    const enableDevTools = this.config.get<boolean>('app.enableDevTools') === true;
    if (nodeEnv !== 'production' || enableDevTools) {
      return true;
    }
    throw new NotFoundException();
  }
}
