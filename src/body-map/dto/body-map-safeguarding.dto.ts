import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class BodyMapSafeguardingCheckDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  causeKnown?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  explanationConsistent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  happenedBefore?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(20)
  immediateRisk!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(20)
  managerInformed!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  incidentRequired?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(40)
  referralRequired!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  referralReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  managerReviewRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  managerNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  checklistData?: Record<string, unknown>;
}
