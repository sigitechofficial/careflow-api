import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ANOMALY_STATUSES,
  GROUP_BY_VALUES,
  type CostGroupBy,
} from '../platform-costs.constants';
import { DB_SKUS, type DbSku } from '../platform-costs-estimator';

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Query-string booleans: only "true"/"1" are true (implicit conversion would make "false" true). */
const toBool = ({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}) => {
  // Read the raw value: implicit conversion has already turned "false" into true.
  const value = obj[key];
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return value;
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return value;
};

export class CostBreakdownQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ enum: GROUP_BY_VALUES, default: 'service' })
  @IsOptional()
  @IsIn([...GROUP_BY_VALUES], {
    message: `groupBy must be one of: ${GROUP_BY_VALUES.join(', ')}`,
  })
  groupBy?: CostGroupBy;
}

export class CostExportQueryDto extends CostBreakdownQueryDto {
  @ApiPropertyOptional({ enum: ['csv'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv'], { message: 'format must be csv' })
  format?: 'csv';
}

export class PricesQueryDto {
  @ApiPropertyOptional({ description: 'Exact Azure serviceName' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  service?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean({ message: 'usedOnly must be true or false' })
  usedOnly?: boolean;
}

export class UnitEconomicsQueryDto {
  @ApiPropertyOptional({ example: '2026-09' })
  @IsOptional()
  @Matches(ISO_MONTH, { message: 'month must be YYYY-MM' })
  month?: string;
}

export class AnomaliesQueryDto {
  @ApiPropertyOptional({ enum: [...ANOMALY_STATUSES, 'all'], default: 'open' })
  @IsOptional()
  @IsIn([...ANOMALY_STATUSES, 'all'], {
    message: 'status must be open, acknowledged or all',
  })
  status?: 'open' | 'acknowledged' | 'all';
}

export class SyncRunsQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UpdatePlatformCostSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 1000, example: 50 })
  @IsOptional()
  @IsInt({ message: 'anomalyThresholdPercent must be a whole number' })
  @Min(1)
  @Max(1000)
  anomalyThresholdPercent?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100000, example: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100000)
  anomalyMinDailyIncrease?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  monthlyReportEnabled?: boolean;

  @ApiPropertyOptional({ type: [String], example: ['finance@example.com'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsEmail(
    {},
    {
      each: true,
      message: 'monthlyReportRecipients must contain valid e-mail addresses',
    },
  )
  @MaxLength(254, { each: true })
  monthlyReportRecipients?: string[];
}

export class EstimateRequestDto {
  @ApiPropertyOptional({ default: 1, minimum: 0, maximum: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  apiReplicas?: number;

  @ApiPropertyOptional({ default: 0.5, minimum: 0.25, maximum: 4 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.25)
  @Max(4)
  apiVcpu?: number;

  @ApiPropertyOptional({ default: 1, minimum: 0.5, maximum: 8 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.5)
  @Max(8)
  apiMemoryGiB?: number;

  @ApiPropertyOptional({ enum: DB_SKUS, default: 'B1ms' })
  @IsOptional()
  @IsIn([...DB_SKUS], {
    message: `dbSku must be one of: ${DB_SKUS.join(', ')}`,
  })
  dbSku?: DbSku;

  @ApiPropertyOptional({ default: 32, minimum: 32, maximum: 16384 })
  @IsOptional()
  @IsInt()
  @Min(32)
  @Max(16384)
  dbStorageGiB?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  dbHighAvailability?: boolean;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  privateEndpoints?: number;

  @ApiPropertyOptional({ default: 0.5, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  logGbPerDay?: number;

  @ApiPropertyOptional({ default: 100, minimum: 0, maximum: 102400 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(102400)
  storageGiB?: number;

  @ApiPropertyOptional({ default: 2000, minimum: 0, maximum: 10000000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  emailsPerMonth?: number;
}
