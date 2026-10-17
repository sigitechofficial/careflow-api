import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { SpecialVisitsService } from './special-visits.service';
import { CreateSpecialVisitDto, SpecialVisitQueryDto } from './dto/special-visit.dto';

@ApiTags('Special Visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('special-visits')
export class SpecialVisitsController {
  constructor(private readonly service: SpecialVisitsService) {}

  @Get()
  @Permissions('employees.read')
  @ApiOperation({ summary: 'List a carer special visits for a week' })
  list(@Query() q: SpecialVisitQueryDto) {
    return this.service.list(q.employeeId, q.weekStart);
  }

  @Get('summary')
  @Permissions('employees.read')
  @ApiOperation({ summary: 'Contracted vs booked vs special hours for a carer that week' })
  summary(@Query() q: SpecialVisitQueryDto) {
    return this.service.summary(q.employeeId, q.weekStart);
  }

  @Post()
  @Permissions('employees.update')
  @ApiOperation({ summary: 'Record a special visit against a carer remaining hours' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateSpecialVisitDto) {
    return this.service.create(user.id, dto);
  }

  @Delete(':id')
  @Permissions('employees.update')
  @ApiOperation({ summary: 'Remove a special visit' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }
}
