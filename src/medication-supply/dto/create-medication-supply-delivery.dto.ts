import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateMedicationSupplyDeliveryDto {
  @ApiProperty()
  @IsUUID()
  serviceUserMedicationId!: string;

  @ApiProperty({ description: 'ISO date YYYY-MM-DD' })
  @IsDateString()
  deliveredAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  cycleEndDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  openedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  runsOutDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pharmacyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  receivedById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  witnessById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
