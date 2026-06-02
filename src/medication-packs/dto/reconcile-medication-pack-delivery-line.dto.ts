import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicationPackDeliveryLineState } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReconcileMedicationPackDeliveryLineDto {
  @ApiProperty({ description: 'Whether the medicine was confirmed present in the tray' })
  @IsBoolean()
  confirmedPresent!: boolean;

  @ApiPropertyOptional({ enum: MedicationPackDeliveryLineState })
  @IsOptional()
  @IsEnum(MedicationPackDeliveryLineState)
  state?: MedicationPackDeliveryLineState;

  @ApiPropertyOptional({ maxLength: 500, description: 'Discrepancy note if not matching' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
