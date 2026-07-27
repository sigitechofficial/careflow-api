import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  CreateExternalTrainingDto,
  LearningListQueryDto,
  RejectExternalTrainingDto,
  UpdateExternalTrainingDto,
  VerifyExternalTrainingDto,
} from './dto/learning.dto';
import { LearningExternalTrainingService } from './learning-external-training.service';

@ApiTags('Learning — External training')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/external-training')
export class LearningExternalTrainingController {
  constructor(private readonly service: LearningExternalTrainingService) {}

  @Get()
  @Permissions('learning.external_training.read')
  list(@Query() query: LearningListQueryDto & { employeeId?: string }) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('learning.external_training.read')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('learning.external_training.manage')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateExternalTrainingDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @Permissions('learning.external_training.manage')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateExternalTrainingDto) {
    return this.service.update(id, user.id, dto);
  }

  @Delete(':id')
  @Permissions('learning.external_training.manage')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.softDelete(id, user.id);
  }

  @Post(':id/verify')
  @Permissions('learning.external_training.manage')
  verify(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: VerifyExternalTrainingDto) {
    return this.service.verify(id, user.id, dto);
  }

  @Post(':id/reject')
  @Permissions('learning.external_training.manage')
  reject(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: RejectExternalTrainingDto) {
    return this.service.reject(id, user.id, dto);
  }
}
