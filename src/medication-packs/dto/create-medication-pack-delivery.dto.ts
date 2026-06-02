import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicationPackCondition } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateMedicationPackDeliveryDto {
  @ApiProperty({ description: 'Date/time the pack physically arrived' })
  @IsDateString()
  receivedAt!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Staff member who received the pack' })
  @IsOptional()
  @IsUUID()
  receivedById?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Pharmacy courier / collected / relative' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deliveredBy?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchReference?: string;

  @ApiPropertyOptional({ enum: MedicationPackCondition, default: MedicationPackCondition.INTACT })
  @IsOptional()
  @IsEnum(MedicationPackCondition)
  condition?: MedicationPackCondition;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  conditionNotes?: string;
}
