import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { UpsertLearningSettingsDto } from './dto/learning.dto';
import { LearningSettingsService } from './learning-settings.service';

@ApiTags('Learning — Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/settings')
export class LearningSettingsController {
  constructor(private readonly service: LearningSettingsService) {}

  @Get()
  @Permissions('learning.settings.manage')
  @ApiOperation({ summary: 'Get learning settings' })
  get() {
    return this.service.get();
  }

  @Patch()
  @Permissions('learning.settings.manage')
  @ApiOperation({ summary: 'Upsert learning settings' })
  upsert(@CurrentUser() user: RequestUser, @Body() dto: UpsertLearningSettingsDto) {
    return this.service.upsert(user.id, dto);
  }
}
