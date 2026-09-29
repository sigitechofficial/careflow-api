import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/** Platform health probes: GET /health/live and GET /health/ready. */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
