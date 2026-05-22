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
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PathwayActionsService } from './pathway-actions.service';
import { PathwayActionQueryDto } from './dto/pathway-action-query.dto';
import { CreatePathwayActionDto } from './dto/create-pathway-action.dto';
import { UpdatePathwayActionDto } from './dto/update-pathway-action.dto';
import { LinkActionChecklistDto } from './dto/link-action-checklist.dto';

@ApiTags('Pathway Actions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pathway-actions')
export class PathwayActionsController {
  constructor(private readonly service: PathwayActionsService) {}

  @Get()
  @Permissions('pathway_actions.read')
  list(@Query() query: PathwayActionQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('pathway_actions.read')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('pathway_actions.create')
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePathwayActionDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('pathway_actions.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePathwayActionDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('pathway_actions.delete')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/checklists')
  @Permissions('pathway_actions.checklists.manage')
  linkChecklist(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: LinkActionChecklistDto,
    @Req() req: Request,
  ) {
    return this.service.linkChecklist(user.id, id, dto.checklistId, getRequestAuditMeta(req));
  }

  @Delete(':id/checklists/:checklistId')
  @Permissions('pathway_actions.checklists.manage')
  unlinkChecklist(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('checklistId') checklistId: string,
    @Req() req: Request,
  ) {
    return this.service.unlinkChecklist(user.id, id, checklistId, getRequestAuditMeta(req));
  }
}
