import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { ApiMedicationStandardResponses } from '../common/decorators/api-standard-responses.decorator';
import { MedicationSchedulesService } from './medication-schedules.service';
import { MedicationSchedulePreviewDto } from './dto/medication-schedule-preview.dto';
import { MedicationSchedulePreviewResponseDto } from './dto/medication-schedule-preview-response.dto';

@ApiTags('Medication Schedules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-schedule-preview')
export class MedicationSchedulePreviewController {
  constructor(private readonly service: MedicationSchedulesService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.medications.read', 'service_users.medications.create', 'service_users.read')
  @ApiOperation({
    summary: 'Preview how many due administrations a proposed schedule would generate',
  })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiOkResponse({ type: MedicationSchedulePreviewResponseDto })
  @ApiMedicationStandardResponses()
  preview(@Param('id') serviceUserId: string, @Body() dto: MedicationSchedulePreviewDto) {
    return this.service.preview(serviceUserId, dto);
  }
}
