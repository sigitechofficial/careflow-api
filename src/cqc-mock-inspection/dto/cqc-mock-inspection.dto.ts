import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CqcMockActionStatus, CqcMockInspectionStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === undefined || (typeof value === 'string' && value.trim() === '')
    ? undefined
    : value;

export class ListCqcMockInspectionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CqcMockInspectionStatus })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(CqcMockInspectionStatus)
  status?: CqcMockInspectionStatus;

  @ApiPropertyOptional({
    description: 'Inspections of this branch (plus whole-organisation ones)',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;
}

export class CreateCqcMockInspectionDto {
  @ApiProperty({ example: 'Mock inspection, November 2026' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({
    description: 'Branch inspected; leave out for the whole organisation',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    description: 'User leading the inspection (defaults to you)',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  leadReviewerId?: string;

  @ApiPropertyOptional({
    example: 'MI-006',
    description:
      'Ready-made inspection to start from; leave out for every quality statement',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(/^MI-\d{3}$/)
  templateCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class UpdateCqcMockInspectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  leadReviewerId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export const CHECK_PARTS = ['lookAt', 'askPeople', 'askStaff'] as const;
export const CHECK_ANSWERS = ['MET', 'PARTIALLY_MET', 'NOT_MET'] as const;

/** One answered check of a statement ("Look at …", "Ask staff …"). */
export class StatementCheckDto {
  @ApiProperty({ enum: CHECK_PARTS })
  @IsIn(CHECK_PARTS)
  part!: (typeof CHECK_PARTS)[number];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;

  @ApiProperty({ enum: CHECK_ANSWERS })
  @IsIn(CHECK_ANSWERS)
  answer!: (typeof CHECK_ANSWERS)[number];

  @ApiPropertyOptional({
    description: 'What was found; required when not met or partially met',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ScoreStatementDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Score on the framework scale (1–4); null clears it',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  score?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  strengths?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  concerns?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({
    type: [StatementCheckDto],
    description:
      'Every answered check of the statement; replaces the saved answers (unanswered checks are left out)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StatementCheckDto)
  checks?: StatementCheckDto[];
}

export class CreateCqcMockActionDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  detail?: string;

  @ApiPropertyOptional({
    description: 'Quality statement (id) the action is for',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  statementId?: string;

  @ApiPropertyOptional({
    description:
      "The statement's check (its text) the action came from; needs statementId",
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(1000)
  checkText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    description: 'Staff member (employee id) who should do it',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  assignedEmployeeId?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  dueAt?: string;
}

export class UpdateCqcMockActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  detail?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  ownerId?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-12-31' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  dueAt?: string | null;

  @ApiPropertyOptional({ enum: CqcMockActionStatus })
  @IsOptional()
  @IsEnum(CqcMockActionStatus)
  status?: CqcMockActionStatus;
}

/** Governance → Mock CQC inspection → Settings: points for each check answer and the % for each score. */
export class UpdateCqcMockInspectionSettingsDto {
  @ApiProperty({ description: 'Points for Met', minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  metPoints!: number;

  @ApiProperty({
    description: 'Points for Partially met',
    minimum: 0,
    maximum: 10,
  })
  @IsInt()
  @Min(0)
  @Max(10)
  partlyMetPoints!: number;

  @ApiProperty({ description: 'Points for Not met', minimum: 0, maximum: 10 })
  @IsInt()
  @Min(0)
  @Max(10)
  notMetPoints!: number;

  @ApiProperty({
    description: '% of the most points needed for a score of 4',
    minimum: 1,
    maximum: 100,
  })
  @IsInt()
  @Min(1)
  @Max(100)
  score4Percent!: number;

  @ApiProperty({
    description: '% needed for a score of 3',
    minimum: 1,
    maximum: 100,
  })
  @IsInt()
  @Min(1)
  @Max(100)
  score3Percent!: number;

  @ApiProperty({
    description: '% needed for a score of 2 (less gives 1)',
    minimum: 1,
    maximum: 100,
  })
  @IsInt()
  @Min(1)
  @Max(100)
  score2Percent!: number;
}
