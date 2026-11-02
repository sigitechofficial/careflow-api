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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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
import { CrmService } from './crm.service';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { UpdateEnquiryDto } from './dto/update-enquiry.dto';
import { MoveEnquiryDto } from './dto/move-enquiry.dto';
import { EnquiryNoteDto } from './dto/note-enquiry.dto';
import { ListEnquiriesQueryDto } from './dto/list-enquiries-query.dto';
import { EnquiryDuplicatesQueryDto } from './dto/duplicates-query.dto';
import { LinkServiceUserDto } from './dto/link-service-user.dto';

@ApiTags('CRM / Enquiries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('crm/enquiries')
export class CrmController {
  constructor(private readonly service: CrmService) {}

  @Get()
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'List enquiries (branch-scoped)' })
  list(@CurrentUser() user: RequestUser, @Query() query: ListEnquiriesQueryDto) {
    return this.service.list(user, query);
  }

  @Get('summary')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'Enquiry funnel counts, win rate, follow-ups due, lost reasons' })
  @ApiQuery({ name: 'locationId', required: false })
  summary(@CurrentUser() user: RequestUser, @Query() query: ListEnquiriesQueryDto) {
    return this.service.summary(user, query.locationId);
  }

  @Get('funding-types')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'Funding types (shared lookup) for the enquiry form' })
  fundingTypes() {
    return this.service.fundingTypes();
  }

  @Get('funders')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'Active funders (shared lookup) for the funders on a quote' })
  funders() {
    return this.service.funders();
  }

  @Get('care-plans')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'Published care plans the enquiry form can list under care needs' })
  carePlans() {
    return this.service.carePlans();
  }

  @Get('owners')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'Office users an enquiry can be assigned to' })
  owners() {
    return this.service.owners();
  }

  @Get('duplicates')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'Possible duplicate enquiries / service users for a person' })
  duplicates(@CurrentUser() user: RequestUser, @Query() query: EnquiryDuplicatesQueryDto) {
    return this.service.duplicates(user, query);
  }

  @Get(':id')
  @AnyPermission('crm.read', 'crm.manage')
  @ApiOperation({ summary: 'Get an enquiry with its timeline' })
  getById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getById(user, id);
  }

  @Post()
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Capture a new enquiry' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateEnquiryDto,
    @Req() req: Request,
  ) {
    return this.service.create(user, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Update enquiry details' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateEnquiryDto,
    @Req() req: Request,
  ) {
    return this.service.update(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/move')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Move an enquiry to another pipeline stage (LOST needs a reason)' })
  move(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: MoveEnquiryDto,
    @Req() req: Request,
  ) {
    return this.service.move(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/link-service-user')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Link the service user created from this enquiry and mark it Won' })
  linkServiceUser(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: LinkServiceUserDto,
    @Req() req: Request,
  ) {
    return this.service.linkServiceUser(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/initial-assessment')
  @Permissions('crm.manage', 'service_users.create')
  @AnyPermission('service_users.initial_assessment.create', 'service_users.update')
  @ApiOperation({
    summary: 'Link a Pre-admission service user (made from the enquiry if needed) for the full initial assessment',
  })
  startInitialAssessment(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.startInitialAssessment(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/pre-admission')
  @Permissions('crm.manage', 'service_users.create')
  @ApiOperation({
    summary: 'Link a Pre-admission service user made from the enquiry (no assessment), to add its details',
  })
  createPreAdmission(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.createPreAdmissionServiceUser(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/notes')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Add a timeline note to an enquiry' })
  addNote(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: EnquiryNoteDto,
    @Req() req: Request,
  ) {
    return this.service.addNote(user, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('crm.manage')
  @ApiOperation({ summary: 'Soft-delete an enquiry' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user, id, getRequestAuditMeta(req));
  }
}
