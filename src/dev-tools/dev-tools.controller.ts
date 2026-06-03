import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RunIaPlaywrightDto } from './dto/run-ia-playwright.dto';
import { DevToolsService } from './dev-tools.service';

@ApiTags('dev-tools')
@Controller('dev')
export class DevToolsController {
  constructor(private readonly devTools: DevToolsService) {}

  /** Dev only — runs Playwright IA autofill in care-admin (see DevToolsModule). */
  @Post('run-ia-playwright')
  async runIaPlaywright(@Body() body: RunIaPlaywrightDto) {
    const data = await this.devTools.runIaPlaywrightAutofill(
      body.serviceUserId,
      body.level,
    );
    return { data };
  }
}
