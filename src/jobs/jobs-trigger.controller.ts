import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsOptional, IsString, Matches } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { getJobDefinition, PERIOD_KEY_PATTERN } from './job-catalogue';
import { JobRunner } from './job-runner.service';
import { JobsTriggerSecretGuard } from './jobs-trigger.guard';

export class TriggerJobDto {
  /** Optional explicit period key (default: the scheduled bucket for "now"). */
  @IsOptional()
  @IsString()
  @Matches(PERIOD_KEY_PATTERN, { message: 'periodKey has an invalid format' })
  periodKey?: string;
}

/**
 * Machine-to-machine trigger for the Azure Functions timer jobs. Not a user endpoint:
 * no JWT (shared secret header instead), not rate limited, hidden from Swagger.
 * Runs synchronously; JobRun is the record (no audit row per call).
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@UseGuards(JobsTriggerSecretGuard)
@Controller('internal/jobs')
export class JobsTriggerController {
  private readonly logger = new Logger(JobsTriggerController.name);

  constructor(private readonly runner: JobRunner) {}

  @Post(':name')
  @HttpCode(200)
  async trigger(@Param('name') name: string, @Body() body?: TriggerJobDto) {
    const def = getJobDefinition(name);
    if (!def) throw new NotFoundException(`Unknown job ${name}`);
    if (def.trigger !== 'function') {
      throw new BadRequestException(
        `Job ${name} runs as a Container Apps Job (node dist/src/jobs/run-job.js ${name}), not via this endpoint`,
      );
    }
    const result = await this.runner.runByName(def.name, {
      source: 'function',
      periodKey: body?.periodKey,
    });
    if (result.outcome === 'failed') {
      this.logger.warn(
        `Triggered job ${name} failed: ${result.error ?? 'unknown error'}`,
      );
    }
    // `success` keeps the standard response envelope from wrapping this machine response.
    return {
      success: result.outcome !== 'failed',
      name: result.name,
      outcome: result.outcome,
      runId: result.runId,
      status: result.status,
      durationMs: result.durationMs,
      summary: result.summary,
      periodKey: result.periodKey,
      error: result.error,
    };
  }
}
