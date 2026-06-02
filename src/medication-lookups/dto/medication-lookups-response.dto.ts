import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LookupItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  code?: string;

  @ApiPropertyOptional({
    description: 'When true, chart lines using this type or route should link a body map medication site',
  })
  requiresBodyMapSite?: boolean;
}

export class MedicationLookupsBundleDto {
  @ApiProperty({ description: 'types, routes, categories, frequencies, rounds, notGivenReasons, statusCodes' })
  types!: unknown[];

  @ApiProperty()
  routes!: unknown[];

  @ApiProperty()
  categories!: unknown[];

  @ApiProperty()
  frequencies!: unknown[];

  @ApiProperty()
  rounds!: unknown[];

  @ApiProperty()
  notGivenReasons!: unknown[];

  @ApiProperty()
  statusCodes!: unknown[];
}

export class MedicationLookupsBundleResponseDto {
  @ApiProperty({ type: MedicationLookupsBundleDto })
  data!: MedicationLookupsBundleDto;

  @ApiProperty({ example: 'Medication lookups loaded' })
  message!: string;
}

export class MedicationLookupListResponseDto {
  @ApiProperty({ type: [LookupItemDto], description: 'Lookup rows for the requested table' })
  data!: LookupItemDto[];
}
