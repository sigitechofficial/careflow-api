import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { ApiMedicationStandardResponses } from '../common/decorators/api-standard-responses.decorator';
import { OpenFdaService } from './openfda.service';
import {
  OpenFdaDrugLabelSearchQueryDto,
  OpenFdaDrugLabelSearchResponseDto,
} from './dto/openfda-drug-label-search.dto';

@ApiTags('openFDA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('openfda')
export class OpenFdaController {
  constructor(private readonly openFda: OpenFdaService) {}

  @Get('drug-labels/search')
  @AnyPermission('service_users.medications.lookups.read', 'service_users.read')
  @ApiOperation({ summary: 'Search drug labels via openFDA (medication name autocomplete)' })
  @ApiOkResponse({ type: OpenFdaDrugLabelSearchResponseDto })
  @ApiMedicationStandardResponses()
  async searchDrugLabels(@Query() query: OpenFdaDrugLabelSearchQueryDto) {
    const data = await this.openFda.searchDrugLabels(query.q, query.limit ?? 8);
    return {
      data,
      message: data.length ? 'Drug labels found' : 'No matching drug labels',
    };
  }
}
