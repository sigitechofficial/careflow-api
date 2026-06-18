import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisitPlanSlotCarerRole, VisitPlanSlotExceptionType, VisitPlanSlotKind } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VisitPlanSlotCarerAssignmentDto {
  @ApiPropertyOptional({ description: '0=Sun … 6=Sat; omit for all days on this slot' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number | null;

  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiPropertyOptional({ enum: VisitPlanSlotCarerRole })
  @IsOptional()
  @IsEnum(VisitPlanSlotCarerRole)
  role?: VisitPlanSlotCarerRole;

  @ApiPropertyOptional({ minimum: 1, maximum: 480 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(480)
  durationMinutes?: number | null;

  @ApiPropertyOptional({ example: '07:00' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  plannedStartTime?: string | null;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  plannedEndTime?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class VisitPlanSlotExceptionDto {
  @ApiProperty({ example: '2026-08-15' })
  @IsDateString()
  exceptionDate!: string;

  @ApiProperty({ enum: VisitPlanSlotExceptionType })
  @IsEnum(VisitPlanSlotExceptionType)
  exceptionType!: VisitPlanSlotExceptionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  plannedStartTime?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  plannedEndTime?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(480)
  durationMinutes?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  requiredCarers?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
