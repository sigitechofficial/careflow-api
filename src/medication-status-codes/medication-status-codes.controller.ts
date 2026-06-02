import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
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
import { Permissions } from '../common/decorators/permissions.decorator';
import { ApiMedicationStandardResponses } from '../common/decorators/api-standard-responses.decorator';
import { MedicationStatusCodesService } from './medication-status-codes.service';
import { MedicationStatusCodeQueryDto } from './dto/medication-status-code-query.dto';
import { UpdateMedicationStatusCodeDto } from './dto/update-medication-status-code.dto';
import {
  MedicationStatusCodeActiveListResponseDto,
  MedicationStatusCodeListResponseDto,
  MedicationStatusCodeSingleResponseDto,
} from './dto/medication-status-code-response.dto';

@ApiTags('Medication Status Codes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('medication-status-codes')
export class MedicationStatusCodesController {
  constructor(private readonly service: MedicationStatusCodesService) {}

  @Get()
  @AnyPermission('service_users.medications.lookups.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'List medication MAR status codes (configurable colors and rules)' })
  @ApiOkResponse({ type: MedicationStatusCodeListResponseDto })
  @ApiMedicationStandardResponses()
  list(@Query() query: MedicationStatusCodeQueryDto) {
    return this.service.list(query);
  }

  @Get('active')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'List active medication status codes for MAR display' })
  @ApiOkResponse({ type: MedicationStatusCodeActiveListResponseDto })
  @ApiMedicationStandardResponses()
  listActive() {
    return this.service.listActive().then((data) => ({ data }));
  }

  @Get('by-code/:code')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'Get medication status code by short code (e.g. G, R, PCI)' })
  @ApiParam({ name: 'code', example: 'G' })
  @ApiOkResponse({ type: MedicationStatusCodeSingleResponseDto })
  @ApiMedicationStandardResponses()
  getByCode(@Param('code') code: string) {
    return this.service.getByCode(code);
  }

  @Get(':id')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'Get medication status code by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MedicationStatusCodeSingleResponseDto })
  @ApiMedicationStandardResponses()
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Patch(':id')
  @Permissions('service_users.medications.update')
  @ApiOperation({ summary: 'Update medication MAR status code (label, colours, rules)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MedicationStatusCodeSingleResponseDto })
  @ApiMedicationStandardResponses()
  update(@Param('id') id: string, @Body() dto: UpdateMedicationStatusCodeDto) {
    return this.service.update(id, dto);
  }
}
