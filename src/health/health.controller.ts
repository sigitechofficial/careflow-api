import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from './health.service';

/**
 * Liveness / readiness probes for the hosting platform (Azure Container Apps).
 * Unauthenticated by design (the platform cannot log in) and never rate-limited;
 * responses carry no versions, hostnames or error detail.
 */
@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** The process is up. Deliberately checks nothing else, so a database blip never triggers restarts. */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'ok' };
  }

  /**
   * Ready for traffic: the database answers within the timeout. External services
   * (mail, push) are not checked, so their outages never take the API out of rotation.
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (database reachable)' })
  async ready() {
    if (!(await this.health.isDatabaseReachable())) {
      throw new ServiceUnavailableException('unavailable');
    }
    return { status: 'ok' };
  }
}
