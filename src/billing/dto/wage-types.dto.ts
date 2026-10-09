import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BANK_HOLIDAY_REGIONS } from '../bank-holiday-regions.util';

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
  @ApiPropertyOptional({ enum: BANK_HOLIDAY_REGIONS })
  @IsOptional()
  @IsIn(BANK_HOLIDAY_REGIONS as unknown as string[])
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

  @ApiProperty({ enum: BANK_HOLIDAY_REGIONS })
  @IsIn(BANK_HOLIDAY_REGIONS as unknown as string[])
  region!: string;
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
}
