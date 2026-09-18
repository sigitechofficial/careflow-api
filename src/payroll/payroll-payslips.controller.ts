import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { RequestUser } from '../common/decorators/current-user.decorator'
import { Permissions } from '../common/decorators/permissions.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util'
import { PayrollRunsService } from './payroll-runs.service'

@ApiTags('UK Payroll — Payslips')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('payroll/payslips')
export class PayrollPayslipsController {
  constructor(private readonly runs: PayrollRunsService) {}

  @Get()
  @Permissions('payroll.runs.read')
  @ApiOperation({
    summary:
      'List itemised payslips available from CLOSED UK payroll runs (ERA 1996 s.8 download index)',
  })
  list(@Query('locationId') locationId?: string) {
    return this.runs.listPayslips(locationId)
  }

  @Get(':runEmployeeId/pdf')
  @Permissions('payroll.runs.read')
  @ApiOperation({
    summary: 'Download payslip PDF by run-employee id (must belong to a CLOSED run)',
  })
  async downloadByRunEmployee(
    @CurrentUser() user: RequestUser,
    @Param('runEmployeeId') runEmployeeId: string,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ) {
    const { buffer, filename } = await this.runs.exportPayslipByRunEmployeeId(
      runEmployeeId,
      user.id,
      getRequestAuditMeta(req),
    )
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer)
  }
}
