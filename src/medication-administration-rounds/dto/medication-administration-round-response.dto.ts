import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MedicationAdministrationRoundDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Morning' })
  name!: string;

  @ApiProperty({ example: 'MORNING' })
  code!: string;

  @ApiProperty({ example: '08:00' })
  time!: string;

  @ApiPropertyOptional({ example: '07:30', nullable: true })
  windowStart!: string | null;

  @ApiPropertyOptional({ example: '09:30', nullable: true })
  windowEnd!: string | null;

  @ApiProperty({ example: 1 })
  sortOrder!: number;

  @ApiProperty({ example: true })
  isActive!: boolean;
}

export class MedicationAdministrationRoundListResponseDto {
  @ApiProperty({ type: [MedicationAdministrationRoundDto] })
  data!: MedicationAdministrationRoundDto[];
}

export class MedicationAdministrationRoundSingleResponseDto {
  @ApiProperty({ type: MedicationAdministrationRoundDto })
  data!: MedicationAdministrationRoundDto;
}
