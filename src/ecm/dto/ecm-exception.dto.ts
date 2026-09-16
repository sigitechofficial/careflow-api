import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { MANUAL_REJECT_REASON_CODES } from '../manual-reject-reasons';

export enum EcmExceptionLifecycleDto {
  DETECTED = 'DETECTED',
  ALERT_GENERATED = 'ALERT_GENERATED',
  ASSIGNED = 'ASSIGNED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  INVESTIGATING = 'INVESTIGATING',
  ACTION_TAKEN = 'ACTION_TAKEN',
  RESOLVED = 'RESOLVED',
  MANAGER_REVIEWED = 'MANAGER_REVIEWED',
  CLOSED = 'CLOSED',
}

export class AcknowledgeEcmExceptionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ResolveEcmExceptionDto {
  @ApiProperty({ description: 'Structured reason code key' })
  @IsString()
  @MaxLength(80)
  reasonCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class AllowVisitContinueDto {
  @ApiProperty({ description: 'Catalog id of the selected left-area allow reason' })
  @IsUUID()
  reasonId!: string;

  @ApiPropertyOptional({
    description: 'Required when the selected reason needs a custom note (Other reason)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class DecideCheckInMethodGrantDto {
  @ApiProperty({ description: 'Selected reject reason code' })
  @IsString()
  @IsIn(MANUAL_REJECT_REASON_CODES)
  reasonCode!: string;

  @ApiPropertyOptional({
    description: 'Required when the selected reason is Other',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class AuthoriseCheckInMethodGrantDto {
  @ApiProperty({ description: 'Catalog id of the selected authorisation reason' })
  @IsUUID()
  reasonId!: string;

  @ApiPropertyOptional({
    description: 'Required when the selected reason needs a custom note (Other reason)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CloseEcmExceptionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CloseSosEcmExceptionDto {
  @ApiProperty({ description: 'What the office did' })
  @IsString()
  @MaxLength(80)
  actionCode!: string;

  @ApiProperty({ description: 'What resulted after that action' })
  @IsString()
  @MaxLength(80)
  outcomeCode!: string;

  @ApiPropertyOptional({ description: 'Required when the action is Other' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  actionNote?: string;

  @ApiPropertyOptional({ description: 'Required when the outcome is Other' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}
