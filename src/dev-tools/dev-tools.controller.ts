import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { RunIaPlaywrightDto } from './dto/run-ia-playwright.dto';
import { DevToolsService } from './dev-tools.service';

@ApiTags('dev-tools')
@ApiBearerAuth()
@Controller('dev')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DevToolsController {
  constructor(private readonly devTools: DevToolsService) {}

  /** Runs Playwright IA autofill on the API host (requires Playwright + care-admin on the server). */
  @Post('run-ia-playwright')
  @Permissions('service_users.initial_assessment.update')
  async runIaPlaywright(@Body() body: RunIaPlaywrightDto) {
    const data = await this.devTools.runIaPlaywrightAutofill(
      body.serviceUserId,
      body.level,
    );
    return { data };
  }
}
