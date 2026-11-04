import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { HOLIDAY_PAY_METHODS, LEAVE_ENTITLEMENT_TYPES, LEAVE_ENTRY_TYPES, WORKER_CATEGORIES } from '../leave.util';

export class CreateLeaveTermsDto {
  @ApiProperty({ enum: WORKER_CATEGORIES })
  @IsIn(WORKER_CATEGORIES as unknown as string[])
  workerCategory!: string;

  @ApiProperty({ example: 4, description: 'Month the leave year starts in' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  leaveYearStartMonth!: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  leaveYearStartDay?: number;

  @ApiPropertyOptional({ description: 'Leave beyond the statutory 5.6 weeks, in hours a year' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  contractualExtraHours?: number | null;

  @ApiProperty({ enum: HOLIDAY_PAY_METHODS })
  @IsIn(HOLIDAY_PAY_METHODS as unknown as string[])
  payMethod!: string;

  @ApiPropertyOptional({ description: 'Hours of untaken leave that may be carried into the next leave year' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  carryOverMaxHours?: number | null;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RecordLeaveEntryDto {
  @ApiProperty({ enum: LEAVE_ENTRY_TYPES })
  @IsIn(LEAVE_ENTRY_TYPES as unknown as string[])
  entryType!: string;

  @ApiPropertyOptional({ enum: LEAVE_ENTITLEMENT_TYPES, default: 'STATUTORY' })
  @IsOptional()
  @IsIn(LEAVE_ENTITLEMENT_TYPES as unknown as string[])
  entitlementType?: string;

  @ApiProperty({ description: 'Hours. An adjustment or a carry-over may be negative.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-1000)
  @Max(1000)
  hours!: number;

  @ApiProperty({ example: '2026-11-03' })
  @IsDateString()
  date!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}
