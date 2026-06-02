import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
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
import { MedicationAdministrationRoundsService } from './medication-administration-rounds.service';
import { UpdateMedicationAdministrationRoundDto } from './dto/update-medication-administration-round.dto';
import {
  MedicationAdministrationRoundListResponseDto,
  MedicationAdministrationRoundSingleResponseDto,
} from './dto/medication-administration-round-response.dto';

@ApiTags('Medication Time Slots')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('medication-administration-rounds')
export class MedicationAdministrationRoundsController {
  constructor(private readonly service: MedicationAdministrationRoundsService) {}

  @Get()
  @AnyPermission(
    'service_users.medications.lookups.read',
    'service_users.medications.read',
    'service_users.read',
    'lookups.manage',
  )
  @ApiOperation({ summary: 'List medication administration time slots (rounds)' })
  @ApiOkResponse({ type: MedicationAdministrationRoundListResponseDto })
  @ApiMedicationStandardResponses()
  list() {
    return this.service.listForAdmin();
  }

  @Get(':id')
  @AnyPermission(
    'service_users.medications.lookups.read',
    'service_users.medications.read',
    'service_users.read',
    'lookups.manage',
  )
  @ApiOperation({ summary: 'Get medication time slot by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MedicationAdministrationRoundSingleResponseDto })
  @ApiMedicationStandardResponses()
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Patch(':id')
  @AnyPermission('lookups.manage', 'service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Update medication time slot (name, times, windows, order)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MedicationAdministrationRoundSingleResponseDto })
  @ApiMedicationStandardResponses()
  update(@Param('id') id: string, @Body() dto: UpdateMedicationAdministrationRoundDto) {
    return this.service.update(id, dto);
  }
}
