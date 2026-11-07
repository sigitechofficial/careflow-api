import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CqcEvidenceSourceType, CqcEvidenceStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? undefined : value;

/** Evidence a person adds by hand. SURVEY_RESULT is only made from a survey. */
export const MANUAL_SOURCE_TYPES = [
  CqcEvidenceSourceType.MANUAL,
  CqcEvidenceSourceType.POLICY,
  CqcEvidenceSourceType.AUDIT,
  CqcEvidenceSourceType.INCIDENT_LEARNING,
  CqcEvidenceSourceType.TRAINING,
  CqcEvidenceSourceType.COMPLAINT,
  CqcEvidenceSourceType.COMPLIMENT,
] as const;

export class YouSaidWeDidDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  youSaid!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  weDid!: string;
}

export class CreateCqcEvidenceDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @ApiProperty({ type: [String], description: 'Quality statements (ids) of the active framework' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one quality statement' })
  @ArrayMaxSize(34)
  @IsUUID('all', { each: true })
  statementIds!: string[];

  @ApiProperty({ description: 'Evidence category code, e.g. PEOPLES_EXPERIENCE' })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]*$/)
  categoryCode!: string;

  @ApiPropertyOptional({ enum: MANUAL_SOURCE_TYPES })
  @IsOptional()
  @IsIn(MANUAL_SOURCE_TYPES)
  sourceType?: (typeof MANUAL_SOURCE_TYPES)[number];

  @ApiPropertyOptional({ description: 'Where it came from, e.g. "Medication audit, October 2026"' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  sourceLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  periodStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  periodEnd?: string;

  @ApiPropertyOptional({ type: [String], description: 'Branches; empty = the whole organisation' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  reviewDueAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ type: [YouSaidWeDidDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => YouSaidWeDidDto)
  actions?: YouSaidWeDidDto[];
}

export class UpdateCqcEvidenceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one quality statement' })
  @ArrayMaxSize(34)
  @IsUUID('all', { each: true })
  statementIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]*$/)
  categoryCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  sourceLabel?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  periodStart?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  periodEnd?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  reviewDueAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ type: [YouSaidWeDidDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => YouSaidWeDidDto)
  actions?: YouSaidWeDidDto[];

  @ApiPropertyOptional({ enum: CqcEvidenceStatus })
  @IsOptional()
  @IsEnum(CqcEvidenceStatus)
  status?: CqcEvidenceStatus;
}

export class ListCqcEvidenceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  statementId?: string;

  @ApiPropertyOptional({ description: 'Key question code, e.g. SAFE' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(/^[A-Z_]+$/)
  keyQuestion?: string;

  @ApiPropertyOptional({ enum: CqcEvidenceStatus, description: 'Default: current only' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn([...Object.values(CqcEvidenceStatus), 'ALL'])
  status?: CqcEvidenceStatus | 'ALL';

  @ApiPropertyOptional({ enum: CqcEvidenceSourceType })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(CqcEvidenceSourceType)
  sourceType?: CqcEvidenceSourceType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(/^[A-Z][A-Z0-9_]*$/)
  categoryCode?: string;

  @ApiPropertyOptional({ description: 'Branch filter' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Covers a period ending on or after this date' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Covers a period starting on or before this date' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class OverviewQueryDto {
  @ApiPropertyOptional({ description: 'Branch filter' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;
}

export class ExportCqcEvidenceQueryDto {
  @ApiProperty({ enum: ['pdf', 'csv'] })
  @IsIn(['pdf', 'csv'])
  format!: 'pdf' | 'csv';

  @ApiPropertyOptional({ description: 'One quality statement; omit for every statement' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  statementId?: string;

  @ApiPropertyOptional({ description: 'Branch filter' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;
}

export class CaptureSurveyEvidenceDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Quality statements to use when the survey has no ready-made statements (saved for its later periods too). Ignored for ready-made surveys unless given.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(34)
  @IsUUID('all', { each: true })
  statementIds?: string[];

  @ApiPropertyOptional({ description: 'Evidence category code (default from the survey audience)' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]*$/)
  categoryCode?: string;
}
