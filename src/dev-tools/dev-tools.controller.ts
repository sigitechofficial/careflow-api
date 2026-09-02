import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { DevToolsGuard } from '../common/guards/dev-tools.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { GenerateIaSectionDto } from './dto/generate-ia-section.dto';
import { DevToolsService } from './dev-tools.service';

@ApiTags('dev-tools')
@ApiBearerAuth()
@Controller('dev')
// DevToolsGuard: non-production only (or ENABLE_DEV_TOOLS=true) — never fabricate data in prod.
@UseGuards(JwtAuthGuard, PermissionsGuard, DevToolsGuard)
export class DevToolsController {
  constructor(private readonly devTools: DevToolsService) {}

  /**
   * Generate (no-save) demo values for ONE holistic tab/section by severity (dev/QA).
   * Nothing is persisted — no submission, no answers saved, no submit. The frontend merges the
   * returned values into the editable form draft, and the user saves/submits themselves.
   */
  @Post('generate-ia-section')
  @Permissions('service_users.initial_assessment.update')
  @ApiOperation({ summary: 'Generate (no-save) demo values for a single initial-assessment section (dev/QA)' })
  async generateIaSection(@Body() body: GenerateIaSectionDto) {
    const data = await this.devTools.generateIaSection(body.level, body.tabId, body.questionIds, body.identity);
    return { data };
  }
}
