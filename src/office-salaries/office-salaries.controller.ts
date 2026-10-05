import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OfficeSalariesService } from './office-salaries.service';
import {
  ListOfficeSalariesQueryDto,
  RecordOfficeSalaryPaymentDto,
  UpsertOfficeSalaryDto,
} from './dto/office-salary.dto';

@ApiTags('Office salaries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('office_salaries.manage')
@Controller('office-salaries')
export class OfficeSalariesController {
  constructor(private readonly service: OfficeSalariesService) {}

  @Get()
  @ApiOperation({ summary: 'Office users with salary and payment status for a month' })
  list(@Query() query: ListOfficeSalariesQueryDto) {
    return this.service.list(query.month);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'One office user: salary details and payment history' })
  detail(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.service.detail(userId);
  }

  @Put(':userId')
  @ApiOperation({ summary: 'Set up or update an office user salary' })
  upsert(
    @CurrentUser() actor: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpsertOfficeSalaryDto,
  ) {
    return this.service.upsertSalary(actor.id, userId, dto);
  }

  @Post(':userId/payments')
  @ApiOperation({ summary: 'Record (or update) the salary payment for a month' })
  recordPayment(
    @CurrentUser() actor: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: RecordOfficeSalaryPaymentDto,
  ) {
    return this.service.recordPayment(actor.id, userId, dto);
  }

  @Delete(':userId/payments/:month')
  @ApiOperation({ summary: 'Remove a recorded payment (undo "mark as paid")' })
  removePayment(
    @CurrentUser() actor: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('month') month: string,
  ) {
    return this.service.removePayment(actor.id, userId, month);
  }
}
