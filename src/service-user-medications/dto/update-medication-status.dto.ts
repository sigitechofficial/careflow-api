import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { MedicationRecordStatus } from '@prisma/client';

export class UpdateMedicationStatusDto {
  @ApiProperty({ enum: MedicationRecordStatus })
  @IsEnum(MedicationRecordStatus)
  status!: MedicationRecordStatus;
}
