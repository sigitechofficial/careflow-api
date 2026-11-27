import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CqcNotificationPolicySource,
  CqcNotificationStatus,
  CqcNotificationType,
  CqcSubmissionMethod,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CQC_OTHERS_INFORMED } from '../cqc-notification-types.util';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === undefined || (typeof value === 'string' && value.trim() === '')
    ? undefined
    : value;

const OTHERS_INFORMED_KEYS = CQC_OTHERS_INFORMED.map((o) => o.value);

export class ListCqcNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CqcNotificationStatus })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(CqcNotificationStatus)
  status?: CqcNotificationStatus;

  @ApiPropertyOptional({ enum: CqcNotificationType })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(CqcNotificationType)
  type?: CqcNotificationType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    description: 'Draft or ready, past the internal target',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : undefined,
  )
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional({
    description: 'Reference, summary or CQC reference contains',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Notifications linked to this incident' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  incidentId?: string;

  @ApiPropertyOptional({
    description: 'Notifications linked to this safeguarding case',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  safeguardingCaseId?: string;
}

/** Fields that can be set on create and changed while draft or ready. */
class CqcNotificationFieldsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  serviceUserId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  incidentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  safeguardingCaseId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  eventOccurredAt?: string | null;

  @ApiPropertyOptional({
    description: 'When the service became aware (defaults to now)',
  })
  @IsOptional()
  @IsDateString()
  becameAwareAt?: string;

  @ApiPropertyOptional({ description: 'What happened' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  summary?: string;

  @ApiPropertyOptional({ description: 'Action taken so far' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  actionsTaken?: string;

  @ApiPropertyOptional({ isArray: true, enum: OTHERS_INFORMED_KEYS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(OTHERS_INFORMED_KEYS.length)
  @IsIn(OTHERS_INFORMED_KEYS, { each: true })
  othersInformed?: string[];

  @ApiPropertyOptional({
    description:
      'Type-specific answers (GET /cqc-notifications/types lists the fields)',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}

export class CreateCqcNotificationDto extends CqcNotificationFieldsDto {
  @ApiProperty({ enum: CqcNotificationType })
  @IsEnum(CqcNotificationType)
  type!: CqcNotificationType;

  @ApiPropertyOptional({
    description: 'Branch; can be left out when you have one branch',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;
}

export class UpdateCqcNotificationDto extends CqcNotificationFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    description:
      'Why "became aware" is being changed. Required when it changes, because it moves the 24-hour deadline.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  becameAwareAtReason?: string;
}

export class SubmitCqcNotificationDto {
  @ApiProperty({ description: 'When it was sent to CQC' })
  @IsDateString()
  submittedAt!: string;

  @ApiProperty({ enum: CqcSubmissionMethod })
  @IsEnum(CqcSubmissionMethod)
  method!: CqcSubmissionMethod;

  @ApiPropertyOptional({ description: 'Reference shown by the CQC portal' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cqcReference?: string;
}

export class AcknowledgeCqcNotificationDto {
  @ApiPropertyOptional({
    description: 'When CQC acknowledged it (defaults to now)',
  })
  @IsOptional()
  @IsDateString()
  acknowledgedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cqcReference?: string;
}

export class CloseCqcNotificationDto {
  @ApiProperty({
    description: 'Why it is not required, or why it is cancelled',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  reason!: string;
}

export class AddCqcNotificationPolicyDto {
  @ApiProperty({ description: 'A published organisation policy' })
  @IsUUID()
  policyDocumentId!: string;

  @ApiPropertyOptional({
    enum: CqcNotificationPolicySource,
    description: 'SUGGESTED when added from the suggestions',
  })
  @IsOptional()
  @IsEnum(CqcNotificationPolicySource)
  source?: CqcNotificationPolicySource;
}
