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
import { PathwayChecklistsService } from './pathway-checklists.service';
import { PathwayChecklistQueryDto } from './dto/pathway-checklist-query.dto';
import { CreatePathwayChecklistDto } from './dto/create-pathway-checklist.dto';
import { UpdatePathwayChecklistDto } from './dto/update-pathway-checklist.dto';
import { CreatePathwayChecklistItemBodyDto } from './dto/create-pathway-checklist-item.dto';
import { UpdatePathwayChecklistItemDto } from './dto/update-pathway-checklist-item.dto';

@ApiTags('Pathway Checklists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pathway-checklists')
export class PathwayChecklistsController {
  constructor(private readonly service: PathwayChecklistsService) {}

  @Get()
  @Permissions('pathway_checklists.read')
  @ApiOperation({ summary: 'List pathway checklists' })
  list(@Query() query: PathwayChecklistQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('pathway_checklists.read')
  @ApiOperation({ summary: 'Get pathway checklist' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('pathway_checklists.create')
  @ApiOperation({ summary: 'Create pathway checklist' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePathwayChecklistDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('pathway_checklists.update')
  @ApiOperation({ summary: 'Update pathway checklist' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePathwayChecklistDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('pathway_checklists.delete')
  @ApiOperation({ summary: 'Delete pathway checklist' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/items')
  @Permissions('pathway_checklists.items.manage')
  @ApiOperation({ summary: 'Add checklist item' })
  addItem(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreatePathwayChecklistItemBodyDto,
    @Req() req: Request,
  ) {
    return this.service.addItem(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/items/:itemId')
  @Permissions('pathway_checklists.items.manage')
  @ApiOperation({ summary: 'Update checklist item' })
  updateItem(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdatePathwayChecklistItemDto,
    @Req() req: Request,
  ) {
    return this.service.updateItem(user.id, id, itemId, dto, getRequestAuditMeta(req));
  }

  @Delete(':id/items/:itemId')
  @Permissions('pathway_checklists.items.manage')
  @ApiOperation({ summary: 'Delete checklist item' })
  removeItem(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ) {
    return this.service.removeItem(user.id, id, itemId, getRequestAuditMeta(req));
  }
}
