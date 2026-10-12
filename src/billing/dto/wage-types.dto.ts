import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CALENDAR_REGIONS, HOLIDAY_PREMIUM_BASES } from '../holiday-calendar.util';

export class UpdateWageTypeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BankHolidayQueryDto {
  @ApiPropertyOptional({ enum: CALENDAR_REGIONS })
  @IsOptional()
  @IsIn(CALENDAR_REGIONS as unknown as string[])
  region?: string;

  @ApiPropertyOptional({ description: 'Calendar year, e.g. 2027' })
  @IsOptional()
  @IsString()
  year?: string;
}

export class CreateBankHolidayDto {
  @ApiProperty({ description: 'YYYY-MM-DD' })
  @IsDateString()
  holidayDate!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: CALENDAR_REGIONS, description: 'A nation, or ORGANISATION for an organisation special day' })
  @IsIn(CALENDAR_REGIONS as unknown as string[])
  region!: string;

  @ApiPropertyOptional({ description: 'For a substitute day: the date the holiday fell on (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  substituteForDate?: string;
}

/** PC-24: which day carries the pay card's holiday rate when a holiday falls on a weekend. */
export class SetHolidayPremiumBasisDto {
  @ApiProperty({ enum: HOLIDAY_PREMIUM_BASES })
  @IsIn(HOLIDAY_PREMIUM_BASES as unknown as string[])
  basis!: string;

  @ApiProperty({ description: 'Who decided this and why (kept in the audit log)' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

export class UpdateBankHolidayDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'For a substitute day: the date the holiday fell on; null clears it' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  substituteForDate?: string | null;
}
