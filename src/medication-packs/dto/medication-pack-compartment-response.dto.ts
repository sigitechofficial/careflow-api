import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MedicationPackCompartmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  medicationPackId!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ example: '08:00' })
  dueTime!: string;

  @ApiPropertyOptional({ nullable: true })
  windowStart!: string | null;

  @ApiPropertyOptional({ nullable: true })
  windowEnd!: string | null;

  @ApiProperty()
  lateThresholdMinutes!: number;

  @ApiProperty()
  witnessRequired!: boolean;

  @ApiProperty()
  sortOrder!: number;
}
