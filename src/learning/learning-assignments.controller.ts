import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  BulkLearningAssignmentDto,
  CancelAssignmentDto,
  CreateLearningAssignmentDto,
  ExemptAssignmentDto,
  ExtendDueDateDto,
  LearningListQueryDto,
  ReassignAssignmentDto,
} from './dto/learning.dto';
import { LearningAssignmentsService } from './learning-assignments.service';

@ApiTags('Learning — Assignments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/assignments')
export class LearningAssignmentsController {
  constructor(private readonly service: LearningAssignmentsService) {}

  @Get()
  @Permissions('learning.assignments.read')
  @ApiOperation({ summary: 'List learning assignments' })
  list(@Query() query: LearningListQueryDto) {
    return this.service.list(query);
  }

  @Post('bulk')
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'Bulk assign by employees/roles/locations/work areas' })
  bulk(
    @CurrentUser() user: RequestUser,
    @Body() dto: BulkLearningAssignmentDto,
    @Req() req: Request,
  ) {
    return this.service.bulkCreate(user.id, dto, getRequestAuditMeta(req));
  }

  @Post()
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'Create individual assignment' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateLearningAssignmentDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('learning.assignments.read')
  @ApiOperation({ summary: 'Get assignment detail' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post(':id/cancel')
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'Cancel assignment' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CancelAssignmentDto,
    @Req() req: Request,
  ) {
    return this.service.cancel(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/exempt')
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'Exempt assignment' })
  exempt(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ExemptAssignmentDto,
    @Req() req: Request,
  ) {
    return this.service.exempt(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/extend-due-date')
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'Extend assignment due date' })
  extendDueDate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ExtendDueDateDto,
    @Req() req: Request,
  ) {
    return this.service.extendDueDate(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/reassign')
  @Permissions('learning.assignments.manage')
  @ApiOperation({ summary: 'Reassign assignment to another employee' })
  reassign(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReassignAssignmentDto,
    @Req() req: Request,
  ) {
    return this.service.reassign(id, user.id, dto, getRequestAuditMeta(req));
  }
}
