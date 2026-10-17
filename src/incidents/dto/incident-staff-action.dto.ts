import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { STAFF_ACTION_TYPES } from '../incident-staff-action.util';

export class CreateIncidentStaffActionDto {
  @ApiProperty({ description: 'Staff member the decision is about' })
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ enum: STAFF_ACTION_TYPES })
  @IsIn(STAFF_ACTION_TYPES)
  actionType!: string;

  @ApiProperty({ description: 'Why this action was decided' })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  reason!: string;

  @ApiPropertyOptional({ description: 'Day the staff member was told (YYYY-MM-DD); omit if not yet' })
  @IsOptional()
  @IsISO8601()
  staffInformedOn?: string | null;

  @ApiPropertyOptional({ description: 'FINE: amount in GBP' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  fineAmount?: number | null;

  @ApiPropertyOptional({ description: 'FINE: salary month it is deducted from (YYYY-MM)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  fineSalaryMonth?: string | null;

  @ApiPropertyOptional({
    description: 'FINE: the contract or written consent allows the deduction (ERA 1996 s13)',
  })
  @IsOptional()
  @IsBoolean()
  deductionAllowedConfirmed?: boolean;
}

export class UpdateIncidentStaffActionDto {
  @ApiPropertyOptional({ enum: STAFF_ACTION_TYPES })
  @IsOptional()
  @IsIn(STAFF_ACTION_TYPES)
  actionType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  reason?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD, or null = not told yet' })
  @IsOptional()
  @IsISO8601()
  staffInformedOn?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  fineAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  fineSalaryMonth?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  deductionAllowedConfirmed?: boolean;

  @ApiProperty({ description: 'Why the decision changed' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  changeReason!: string;
}

export class RemoveIncidentStaffActionDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}
