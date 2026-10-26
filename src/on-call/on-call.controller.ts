import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { OnCallService } from './on-call.service';
import {
  CloseOnCallCallDto,
  CreateOnCallCallDto,
  CreateOnCallShiftDto,
  ListOnCallCallsQueryDto,
  ListOnCallShiftsQueryDto,
  UpdateOnCallCallDto,
  UpdateOnCallShiftDto,
} from './dto/on-call.dto';

@ApiTags('On-call')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('on-call')
export class OnCallController {
  constructor(private readonly service: OnCallService) {}

  @Get('now')
  @Permissions('on_call.read')
  @ApiOperation({ summary: 'Who is on call right now' })
  now(@CurrentUser() user: RequestUser) {
    return this.service.now(user);
  }

  @Get('shifts')
  @Permissions('on_call.read')
  @ApiOperation({ summary: 'On-call shifts overlapping a period' })
  listShifts(
    @CurrentUser() user: RequestUser,
    @Query() q: ListOnCallShiftsQueryDto,
  ) {
    return this.service.listShifts(user, q);
  }

  @Post('shifts')
  @Permissions('on_call.manage')
  @ApiOperation({ summary: 'Add an on-call shift' })
  createShift(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateOnCallShiftDto,
    @Req() req: Request,
  ) {
    return this.service.createShift(user, dto, getRequestAuditMeta(req));
  }

  @Patch('shifts/:id')
  @Permissions('on_call.manage')
  @ApiOperation({ summary: 'Change an on-call shift' })
  updateShift(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOnCallShiftDto,
    @Req() req: Request,
  ) {
    return this.service.updateShift(user, id, dto, getRequestAuditMeta(req));
  }

  @Delete('shifts/:id')
  @Permissions('on_call.manage')
  @ApiOperation({ summary: 'Remove an on-call shift' })
  deleteShift(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.service.deleteShift(user, id, getRequestAuditMeta(req));
  }

  @Get('calls')
  @Permissions('on_call.read')
  @ApiOperation({
    summary:
      'Out-of-hours calls, newest first (status=OPEN for the morning handover)',
  })
  listCalls(
    @CurrentUser() user: RequestUser,
    @Query() q: ListOnCallCallsQueryDto,
  ) {
    return this.service.listCalls(user, q);
  }

  @Post('calls')
  @Permissions('on_call.log')
  @ApiOperation({ summary: 'Record an out-of-hours call' })
  createCall(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateOnCallCallDto,
    @Req() req: Request,
  ) {
    return this.service.createCall(user, dto, getRequestAuditMeta(req));
  }

  @Patch('calls/:id')
  @Permissions('on_call.log')
  @ApiOperation({ summary: 'Change an open call' })
  updateCall(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOnCallCallDto,
    @Req() req: Request,
  ) {
    return this.service.updateCall(user, id, dto, getRequestAuditMeta(req));
  }

  @Post('calls/:id/close')
  @Permissions('on_call.log')
  @ApiOperation({ summary: 'Close a call with a note of what was done' })
  closeCall(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseOnCallCallDto,
    @Req() req: Request,
  ) {
    return this.service.closeCall(user, id, dto, getRequestAuditMeta(req));
  }
}
