import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { JobRunner } from './job-runner.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobsTriggerController } from './jobs-trigger.controller';
import { JobsTriggerSecretGuard } from './jobs-trigger.guard';
import { SystemJobsController } from './system-jobs.controller';
import { SystemJobsService } from './system-jobs.service';

/**
 * Scheduled jobs runtime: JobRunner (exactly-once per period + JobRun history), the
 * @JobHandler registry, POST /internal/jobs/:name (Azure Functions), the System jobs admin
 * API and the CLI (`node dist/src/jobs/run-job.js <name>`). Global so every job class can
 * inject JobRunner without importing this module.
 */
@Global()
@Module({
  imports: [
    DiscoveryModule,
    PrismaModule,
    AuditLogsModule,
    OrganisationGeneralSettingsModule,
  ],
  controllers: [JobsTriggerController, SystemJobsController],
  providers: [
    JobRunner,
    JobHandlerRegistry,
    JobsTriggerSecretGuard,
    SystemJobsService,
  ],
  exports: [JobRunner],
})
export class JobsModule {}
