import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FundingStatus } from '../enums/funding-status.enum';

export class CreateServiceUserFundingDto {
  @ApiProperty()
  @IsUUID()
  fundingTypeId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  funderId?: string;

  @ApiPropertyOptional({ description: 'How this line is funded (a funding route that comes under the line type).' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  fundingRouteId?: string | null;

  @ApiPropertyOptional({ enum: FundingStatus })
  @IsOptional()
  @IsEnum(FundingStatus)
  status?: FundingStatus;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  fundingReference?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  approvalReference?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  packageName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weeklyBudget?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  contributionAmount?: number;

  @ApiPropertyOptional({ description: 'Invoice split percentage for this funder (0–100)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  splitPercent?: number | null;

  @ApiPropertyOptional({ description: 'Billing priority when multiple funders apply (1 = highest)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  splitPriority?: number;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  purchaseOrderNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  purchaseOrderExpiresAt?: string | null;

  @ApiPropertyOptional({ description: 'Authorised weekly care hours for this contract' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  authorisedWeeklyHours?: number | null;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  billingContactName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  billingContactEmail?: string | null;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  billingContactPhone?: string | null;

  @ApiPropertyOptional({ maxLength: 200, description: 'Invoice billing address line 1' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  billingAddressLine1?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  billingAddressLine2?: string | null;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  billingTown?: string | null;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  billingCounty?: string | null;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  billingCountry?: string | null;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  billingPostcode?: string | null;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  invoiceGroupingRule?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  reviewDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  defaultChargeCardId?: string | null;
}
