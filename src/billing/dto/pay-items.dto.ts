import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const PAY_ITEM_WAGE_TYPES = [
  'ON_CALL',
  'LIVE_IN',
  'TRAINING',
  'HOLIDAY_PAY',
  'SICK_PAY',
  'BONUS',
  'MANUAL_ADJUSTMENT',
] as const;
export const PAY_ITEM_UNITS = ['PERIOD', 'DAY', 'WEEK', 'HOUR', 'AMOUNT'] as const;
export const PAY_ITEM_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

export class PayItemQueryDto {
  @ApiPropertyOptional({ enum: PAY_ITEM_STATUSES })
  @IsOptional()
  @IsIn(PAY_ITEM_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: PAY_ITEM_WAGE_TYPES })
  @IsOptional()
  @IsIn(PAY_ITEM_WAGE_TYPES as unknown as string[])
  wageTypeCode?: string;
}

export class PayItemSuggestionQueryDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ enum: PAY_ITEM_WAGE_TYPES })
  @IsIn(PAY_ITEM_WAGE_TYPES as unknown as string[])
  wageTypeCode!: string;

  @ApiProperty({ enum: PAY_ITEM_UNITS })
  @IsIn(PAY_ITEM_UNITS as unknown as string[])
  unit!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  @IsDateString()
  date!: string;
}

export class CreatePayItemDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ enum: PAY_ITEM_WAGE_TYPES })
  @IsIn(PAY_ITEM_WAGE_TYPES as unknown as string[])
  wageTypeCode!: string;

  @ApiProperty({ description: 'Date the earning relates to (YYYY-MM-DD). Paid in the next visit pay run covering it.' })
  @IsDateString()
  workDate!: string;

  @ApiProperty({ enum: PAY_ITEM_UNITS })
  @IsIn(PAY_ITEM_UNITS as unknown as string[])
  unit!: string;

  @ApiPropertyOptional({ description: 'Number of units (hours, days, weeks, periods). Not used for AMOUNT.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  quantity?: number;

  @ApiPropertyOptional({ description: '£ per unit. Defaults to the pay card rate where one exists.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  rate?: number;

  @ApiPropertyOptional({ description: '£ amount when unit is AMOUNT (negative allowed for manual adjustments).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount?: number;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ enum: ['EMPLOYEE_HOLIDAY', 'EMPLOYEE_ABSENCE'] })
  @IsOptional()
  @IsIn(['EMPLOYEE_HOLIDAY', 'EMPLOYEE_ABSENCE'])
  sourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceId?: string;
}

export class RejectPayItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class RecordVisitPayCorrectionDto {
  @ApiProperty({ description: 'Visit reconciliation whose pay is already in a locked payroll run' })
  @IsUUID()
  visitReconciliationId!: string;

  @ApiProperty({ description: 'What the carer should have been paid for this visit in total (£)' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  correctedAmount!: number;

  @ApiProperty({ description: 'Why the paid amount was wrong' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class ReversePayItemDto {
  @ApiProperty({ description: 'Why this paid item is being reversed' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
