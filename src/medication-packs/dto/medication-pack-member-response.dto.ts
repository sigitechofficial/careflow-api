import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicationPackMemberStatus } from '@prisma/client';

export class MedicationPackMemberMedicationSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Amlodipine' })
  medicationName!: string;

  @ApiPropertyOptional({ nullable: true, example: '5mg' })
  strength!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '1 tablet' })
  dose!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Oral' })
  routeName!: string | null;
}

export class MedicationPackMemberDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  medicationPackId!: string;

  @ApiProperty({ format: 'uuid' })
  serviceUserMedicationId!: string;

  @ApiProperty({ enum: MedicationPackMemberStatus, example: MedicationPackMemberStatus.ACTIVE })
  status!: MedicationPackMemberStatus;

  @ApiProperty()
  linkedAt!: Date;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  linkedById!: string | null;

  @ApiPropertyOptional({ nullable: true })
  endedAt!: Date | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  endedById!: string | null;

  @ApiPropertyOptional({ type: MedicationPackMemberMedicationSummaryDto })
  serviceUserMedication?: MedicationPackMemberMedicationSummaryDto;
}
