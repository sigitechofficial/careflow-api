import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CallOffVisitsService } from './call-off-visits.service';
import { CreateCallOffVisitDto } from './dto/create-call-off-visit.dto';
import { UpdateCallOffVisitDto } from './dto/update-call-off-visit.dto';
import { CallOffVisitQueryDto } from './dto/call-off-visit-query.dto';

@ApiTags('Call-off Visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('call-off-visits')
export class CallOffVisitsController {
  constructor(private readonly service: CallOffVisitsService) {}

  @Get()
  @Permissions('call_off_visits.read')
  @ApiOperation({ summary: 'List call-off visits' })
  list(@CurrentUser() user: RequestUser, @Query() query: CallOffVisitQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @Permissions('call_off_visits.read')
  @ApiOperation({ summary: 'Get call-off visit by id' })
  getById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getById(user, id);
  }

  @Post()
  @Permissions('call_off_visits.create')
  @ApiOperation({ summary: 'Create call-off visit request' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCallOffVisitDto,
    @Req() req: Request,
  ) {
    return this.service.create(user, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('call_off_visits.update')
  @ApiOperation({ summary: 'Update call-off visit' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateCallOffVisitDto,
    @Req() req: Request,
  ) {
    return this.service.update(user, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('call_off_visits.delete')
  @ApiOperation({ summary: 'Soft-delete call-off visit' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user, id, getRequestAuditMeta(req));
  }

  @Patch(':id/approve')
  @Permissions('call_off_visits.approve')
  @ApiOperation({ summary: 'Approve call-off and mark schedule as called off' })
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.approve(user, id, getRequestAuditMeta(req));
  }

  @Patch(':id/reject')
  @Permissions('call_off_visits.reject')
  @ApiOperation({ summary: 'Reject call-off request' })
  reject(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.reject(user, id, getRequestAuditMeta(req));
  }
}
