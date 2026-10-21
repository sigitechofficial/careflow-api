import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import {
  AnyPermission,
  Permissions,
} from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SafeguardingService } from './safeguarding.service';
import { CreateSafeguardingDto } from './dto/create-safeguarding.dto';
import { UpdateSafeguardingDto } from './dto/update-safeguarding.dto';
import { TransitionSafeguardingDto } from './dto/transition-safeguarding.dto';
import { SafeguardingNoteDto } from './dto/note-safeguarding.dto';
import { ListSafeguardingQueryDto } from './dto/list-safeguarding-query.dto';

@ApiTags('Safeguarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('safeguarding')
export class SafeguardingController {
  constructor(private readonly service: SafeguardingService) {}

  @Get()
  @AnyPermission('safeguarding.read', 'safeguarding.manage')
  @ApiOperation({ summary: 'List safeguarding cases' })
  list(@CurrentUser() user: RequestUser, @Query() query: ListSafeguardingQueryDto) {
    return this.service.list(user, query);
  }

  @Get('summary')
  @AnyPermission('safeguarding.read', 'safeguarding.manage')
  @ApiOperation({ summary: 'Safeguarding counts, attention list and records-audit score (branch-scoped)' })
  summary(@CurrentUser() user: RequestUser, @Query() query: ListSafeguardingQueryDto) {
    return this.service.summary(user, query.locationId);
  }

  @Get('leads')
  @AnyPermission('safeguarding.read', 'safeguarding.manage')
  @ApiOperation({ summary: 'Office users who can be allocated as case lead' })
  leads() {
    return this.service.leads();
  }

  @Get(':id')
  @AnyPermission('safeguarding.read', 'safeguarding.manage')
  @ApiOperation({ summary: 'Get a safeguarding case with its timeline' })
  getById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getById(user, id);
  }

  @Post()
  @Permissions('safeguarding.manage')
  @ApiOperation({ summary: 'Raise a safeguarding concern' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSafeguardingDto,
    @Req() req: Request,
  ) {
    return this.service.create(user, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('safeguarding.manage')
  @ApiOperation({ summary: 'Update a safeguarding case' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateSafeguardingDto,
    @Req() req: Request,
  ) {
    return this.service.update(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/transition')
  @Permissions('safeguarding.manage')
  @ApiOperation({ summary: 'Move a case through the safeguarding workflow' })
  transition(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: TransitionSafeguardingDto,
    @Req() req: Request,
  ) {
    return this.service.transition(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/notes')
  @Permissions('safeguarding.manage')
  @ApiOperation({ summary: 'Add a timeline note to a safeguarding case' })
  addNote(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SafeguardingNoteDto,
    @Req() req: Request,
  ) {
    return this.service.addNote(user, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('safeguarding.manage')
  @ApiOperation({ summary: 'Soft-delete a safeguarding case' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user, id, getRequestAuditMeta(req));
  }
}
