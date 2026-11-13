import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import {
  CandidateCheckStatus,
  CandidateInterviewMode,
  CandidateInterviewOutcome,
  CandidateInterviewStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateCandidateDto } from './create-candidate.dto';

/** Edit the candidate's details (the vacancy and source stay as applied). */
export class UpdateCandidateDto extends PartialType(OmitType(CreateCandidateDto, ['vacancyId', 'source'] as const)) {}

export class UpdateScreeningDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsBoolean()
  hasRightToWork?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsBoolean()
  needsSponsorship?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsBoolean()
  drivesForWork?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsBoolean()
  livedOverseas?: boolean | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  screeningNotes?: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class EmploymentHistoryEntryDto {
  @ApiProperty({ enum: ['JOB', 'GAP'] })
  @IsIn(['JOB', 'GAP'])
  kind!: 'JOB' | 'GAP';

  @ApiProperty({ example: '2021-03' })
  @Matches(MONTH, { message: 'from must be YYYY-MM' })
  from!: string;

  @ApiPropertyOptional({ example: '2023-08', nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(MONTH, { message: 'to must be YYYY-MM' })
  to?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  employer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  jobTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reasonForLeaving?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  careRole?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  explanation?: string;
}

export class UpdateEmploymentHistoryDto {
  @ApiProperty({ type: [EmploymentHistoryEntryDto] })
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => EmploymentHistoryEntryDto)
  entries!: EmploymentHistoryEntryDto[];
}

export class CreateInterviewDto {
  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  scheduledAt!: Date;

  @ApiPropertyOptional({ enum: CandidateInterviewMode })
  @IsOptional()
  @IsIn(Object.values(CandidateInterviewMode))
  mode?: CandidateInterviewMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  interviewers?: string;

  @ApiPropertyOptional({
    description:
      'Email the candidate (invitation with a calendar file; on changes: the new details; on cancelling: a cancellation). Default: true when arranging, false on updates.',
  })
  @IsOptional()
  @IsBoolean()
  notifyCandidate?: boolean;
}

export class InterviewAnswerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  question!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(5)
  score?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateInterviewDto extends PartialType(CreateInterviewDto) {
  @ApiPropertyOptional({ enum: CandidateInterviewStatus })
  @IsOptional()
  @IsIn(Object.values(CandidateInterviewStatus))
  status?: CandidateInterviewStatus;

  @ApiPropertyOptional({ type: [InterviewAnswerDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => InterviewAnswerDto)
  answers?: InterviewAnswerDto[];

  @ApiPropertyOptional({ enum: CandidateInterviewOutcome, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(Object.values(CandidateInterviewOutcome))
  recommendation?: CandidateInterviewOutcome | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  gapsDiscussed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class SaveOfferDto {
  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  startDate!: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  hoursPerWeek?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  payRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Email the offer to the candidate. Default: true when making the offer, false when changing it.',
  })
  @IsOptional()
  @IsBoolean()
  notifyCandidate?: boolean;
}

export class OfferResponseDto {
  @ApiProperty()
  @IsBoolean()
  accepted!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateCheckDto {
  @ApiPropertyOptional({ enum: CandidateCheckStatus })
  @IsOptional()
  @IsIn(Object.values(CandidateCheckStatus))
  status?: CandidateCheckStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  referenceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  provider?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Date)
  @IsDate()
  issueDate?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Date)
  @IsDate()
  expiryDate?: Date | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class ClearCandidateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class ConvertCandidateDto {
  @ApiPropertyOptional({ description: 'First day of work. Defaults to the offer start date.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional({
    description: "Email for the new employee record, when the candidate's email is already used by another employee.",
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
