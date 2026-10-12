import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  AnyPermission,
  Permissions,
} from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { InvoiceRunsService } from './invoice-runs.service';
import {
  CreateBillingRunDto,
  BillingRunsQueryDto,
} from './dto/billing-runs.dto';
import { EmailInvoiceToServiceUserDto } from './dto/email-invoice-service-user.dto';

@ApiTags('Billing — Invoice runs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/invoice-runs')
export class InvoiceRunsController {
  constructor(private readonly service: InvoiceRunsService) {}

  @Get('summary')
  @Permissions('billing.invoice_runs.read')
  @ApiOperation({ summary: 'Invoice run draft summary for dashboard' })
  summary(@Query('locationId') locationId?: string) {
    return this.service.getSummary(locationId);
  }

  @Get('service-user/:serviceUserId')
  @AnyPermission(
    'billing.invoice_runs.read',
    'service_users.read',
    'service_users.update',
  )
  @ApiOperation({
    summary: 'Invoice runs and funder totals for one service user',
  })
  forServiceUser(@Param('serviceUserId') serviceUserId: string) {
    return this.service.getForServiceUser(serviceUserId);
  }

  @Get('service-users')
  @Permissions('billing.invoice_runs.read')
  @ApiOperation({
    summary:
      'Per-service-user invoice status across periods (sent vs outstanding)',
  })
  serviceUsersOverview(
    @Query('month') month?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.service.getServiceUserInvoicesOverview({ month, locationId });
  }

  @Get()
  @Permissions('billing.invoice_runs.read')
  @ApiOperation({ summary: 'List invoice runs' })
  list(@Query() query: BillingRunsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('billing.invoice_runs.read')
  @ApiOperation({ summary: 'Get invoice run with lines' })
  getById(
    @Param('id') id: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.service.getById(id, locationId);
  }

  @Get(':id/export')
  @Permissions('billing.invoice_runs.read')
  @ApiProduces(
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOperation({
    summary:
      'Download invoice run lines as CSV or Excel (?format=csv|xlsx&serviceUserId=&funderId=optional)',
  })
  async export(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Query('serviceUserId') serviceUserId: string | undefined,
    @Query('funderId') funderId: string | undefined,
    @Res() res: Response,
  ) {
    const fmt = format === 'xlsx' ? 'xlsx' : 'csv';
    const { filename, mime, body } = await this.service.exportRun(
      id,
      fmt,
      {
        serviceUserId: serviceUserId?.trim() || undefined,
        ...(funderId?.trim()
          ? {
              funderId:
                funderId.trim() === 'direct' ? null : funderId.trim(),
            }
          : {}),
      },
      user.id,
    );
    res
      .type(mime)
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(body);
  }

  @Post()
  @Permissions('billing.invoice_runs.manage')
  @ApiOperation({ summary: 'Create invoice run draft' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBillingRunDto) {
    return this.service.create(user.id, dto);
  }

  @Delete()
  @Permissions('billing.financial_reset')
  @ApiOperation({ summary: 'Test reset (disabled in production): delete ALL invoice runs' })
  deleteAll() {
    return this.service.deleteAll();
  }

  @Post(':id/calculate')
  @Permissions('billing.invoice_runs.manage')
  @ApiOperation({ summary: 'Calculate invoice lines from approved visits' })
  calculate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.calculate(user.id, id);
  }

  @Post(':id/approve')
  @Permissions('billing.invoice_runs.manage')
  @ApiOperation({ summary: 'Approve invoice run for locking' })
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.approve(user.id, id);
  }

  @Post(':id/lock')
  @Permissions('billing.invoice_runs.manage')
  @ApiOperation({ summary: 'Lock invoice run and mark visits as invoiced' })
  lock(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.lock(user.id, id);
  }

  @Post(':id/send')
  @Permissions('billing.invoice_runs.manage')
  @ApiOperation({ summary: 'Mark invoice run as sent to funders' })
  send(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.markSent(user.id, id);
  }

  @Get(':id/service-user-email-preview')
  @Permissions('billing.invoice_runs.manage')
  @ApiOperation({
    summary: 'Preview recipient emails for sending a service user invoice',
  })
  serviceUserEmailPreview(
    @Param('id') id: string,
    @Query('serviceUserId') serviceUserId: string | undefined,
  ) {
    if (!serviceUserId?.trim()) {
      throw new BadRequestException('serviceUserId is required');
    }
    return this.service.getServiceUserEmailPreview(id, serviceUserId.trim());
  }

  @Post(':id/email-service-user')
  @Permissions('billing.invoice_runs.manage')
  @ApiOperation({
    summary: 'Email a service user invoice (CSV attachment) to a billing contact',
  })
  emailServiceUser(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: EmailInvoiceToServiceUserDto,
  ) {
    return this.service.emailToServiceUser(user.id, id, dto);
  }
}
