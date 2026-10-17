import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const VEHICLE_TYPES = ['CAR_VAN', 'MOTORCYCLE', 'BICYCLE', 'COMPANY_VEHICLE'] as const;
/** A rate per mile above this is a typing mistake, not a rate. */
const MAX_RATE_PER_MILE = 5;

export class CreateMileageRateDto {
  @ApiProperty({ description: 'First day the rates apply (YYYY-MM-DD)' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiProperty({ enum: VEHICLE_TYPES })
  @IsIn(VEHICLE_TYPES as unknown as string[])
  vehicleType!: string;

  @ApiProperty({ description: 'Pounds per mile up to the threshold' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_RATE_PER_MILE)
  rateFirst!: number;

  @ApiProperty({ description: 'Pounds per mile above the threshold' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_RATE_PER_MILE)
  rateAfter!: number;

  @ApiPropertyOptional({ description: 'Business miles in a tax year after which the second rate applies' })
  @IsOptional()
  @IsInt()
  @Min(1)
  thresholdMiles?: number;

  @ApiPropertyOptional({ description: 'Pounds per passenger mile' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_RATE_PER_MILE)
  passengerRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiProperty({ description: 'Who authorised the rates and why (kept in the audit log)' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

export class VerifyApprovedMileageAmountsDto {
  @ApiProperty({ description: 'HMRC approved pounds per mile up to the threshold' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_RATE_PER_MILE)
  approvedRateFirst!: number;

  @ApiPropertyOptional({ description: 'HMRC approved pounds per mile above the threshold' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_RATE_PER_MILE)
  approvedRateAfter?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  approvedThresholdMiles?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_RATE_PER_MILE)
  approvedPassengerRate?: number;

  @ApiProperty({ description: 'Where the amounts were checked: the HMRC publication and the date it was read' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  source!: string;
}
