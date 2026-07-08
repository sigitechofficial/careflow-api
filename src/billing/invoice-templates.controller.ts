import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { InvoiceTemplatesService } from './invoice-templates.service';
import {
  CreateInvoiceTemplateDto,
  InvoiceTemplatesQueryDto,
  UpdateInvoiceTemplateDto,
  ValidateInvoiceTemplateDto,
} from './dto/invoice-templates.dto';

@ApiTags('Billing — Invoice templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/invoice-templates')
export class InvoiceTemplatesController {
  constructor(private readonly service: InvoiceTemplatesService) {}

  @Get('system-fields')
  @Permissions('billing.invoice_templates.read')
  @ApiOperation({ summary: 'List mappable system fields for invoice templates' })
  listSystemFields() {
    return this.service.listSystemFields();
  }

  @Get('funding-contract-options')
  @Permissions('billing.invoice_templates.read')
  @ApiOperation({ summary: 'List funding contracts for template attachment' })
  fundingContractOptions(@Query('search') search?: string) {
    return this.service.listFundingContractOptions(search);
  }

  @Get('summary')
  @Permissions('billing.invoice_templates.read')
  @ApiOperation({ summary: 'Invoice template setup summary' })
  summary() {
    return this.service.getSummary();
  }

  @Get()
  @Permissions('billing.invoice_templates.read')
  @ApiOperation({ summary: 'List invoice templates' })
  list(@Query() query: InvoiceTemplatesQueryDto) {
    return this.service.list(query);
  }

  @Get('resolve/:serviceUserId')
  @Permissions('billing.invoice_templates.read')
  @ApiOperation({ summary: 'Resolve invoice template for a service user' })
  resolve(
    @Param('serviceUserId') serviceUserId: string,
    @Query('fundingId') fundingId?: string,
  ) {
    return this.service.resolveForServiceUser(serviceUserId, fundingId);
  }

  @Get(':id')
  @Permissions('billing.invoice_templates.read')
  @ApiOperation({ summary: 'Get invoice template by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post(':id/validate')
  @Permissions('billing.invoice_templates.read')
  @ApiOperation({ summary: 'Validate required template fields for a service user' })
  validate(@Param('id') id: string, @Body() dto: ValidateInvoiceTemplateDto) {
    return this.service.validateForServiceUser(id, dto.serviceUserId, dto.fundingId);
  }

  @Post()
  @Permissions('billing.invoice_templates.manage')
  @ApiOperation({ summary: 'Create invoice template' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateInvoiceTemplateDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('billing.invoice_templates.manage')
  @ApiOperation({ summary: 'Update invoice template' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceTemplateDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('billing.invoice_templates.manage')
  @ApiOperation({ summary: 'Soft-delete invoice template' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
