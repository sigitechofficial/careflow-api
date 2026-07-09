import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { VisitReconciliationStatus } from '@prisma/client';

export class VisitReconciliationsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: VisitReconciliationStatus })
  @IsOptional()
  @IsEnum(VisitReconciliationStatus)
  status?: VisitReconciliationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasExceptions?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class UpdateVisitReconciliationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  approvedPayStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  approvedPayEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  approvedBillStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  approvedBillEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  approvalNotes?: string;
}

export class ApproveVisitReconciliationDto {
  @ApiProperty({ enum: ['PAY', 'INVOICE', 'BOTH'] })
  @IsEnum(['PAY', 'INVOICE', 'BOTH'])
  scope!: 'PAY' | 'INVOICE' | 'BOTH';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  approvalNotes?: string;

  @ApiPropertyOptional({ description: 'Allow approval despite blocking exceptions' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  managerOverride?: boolean;
}

export class RejectVisitReconciliationDto {
  @ApiProperty({ enum: ['PAY', 'INVOICE', 'BOTH'] })
  @IsEnum(['PAY', 'INVOICE', 'BOTH'])
  scope!: 'PAY' | 'INVOICE' | 'BOTH';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  approvalNotes?: string;
}

export class BulkApproveVisitReconciliationsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[];

  @ApiProperty({ enum: ['PAY', 'INVOICE', 'BOTH'] })
  @IsEnum(['PAY', 'INVOICE', 'BOTH'])
  scope!: 'PAY' | 'INVOICE' | 'BOTH';
}

export class BackfillVisitReconciliationsDto {
  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
