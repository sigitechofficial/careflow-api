import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PathwayActionType } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreatePathwayActionDto {
  @ApiProperty({ maxLength: 45 })
  @IsString()
  @MaxLength(45)
  actionName!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  actionIcon!: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  instruction?: string;

  @ApiProperty({ enum: PathwayActionType })
  @IsEnum(PathwayActionType)
  actionType!: PathwayActionType;

  @ApiPropertyOptional({ minimum: 1, maximum: 9 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  carersCount?: number;

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ example: '10:30' })
  @IsOptional()
  @IsString()
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  durationMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notesMandatory?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  photoAllowed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowFamilyShare?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  analysisAreaId?: string;

  @ApiPropertyOptional({ maximum: 999 })
  @IsOptional()
  @IsInt()
  @Max(999)
  approxDurationMinutes?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  checklistIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  observationTypeId?: string;
}
