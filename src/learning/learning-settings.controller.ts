import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { UpsertLearningSettingsDto } from './dto/learning.dto';
import { LearningSettingsService } from './learning-settings.service';

import { LearningTasksService } from './learning-tasks.service';
@ApiTags('Learning — Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/settings')
export class LearningSettingsController {
  constructor(
    private readonly service: LearningSettingsService,
    private readonly tasks: LearningTasksService,
  ) {}

  @Get()
  @Permissions('learning.settings.manage')
  @ApiOperation({ summary: 'Get learning settings' })
  get() {
    return this.service.get();
  }

  @Patch()
  @Permissions('learning.settings.manage')
  @ApiOperation({ summary: 'Upsert learning settings' })
  async upsert(@CurrentUser() user: RequestUser, @Body() dto: UpsertLearningSettingsDto) {
    const before = (await this.service.getOrCreate()).taskRoleId;
    const result = await this.service.upsert(user.id, dto);
    // New task role: move the open Learning tasks to it (18 Nov 2026).
    if (dto.taskRoleId !== undefined && dto.taskRoleId !== before) await this.tasks.reconcileAll();
    return result;
  }
}
