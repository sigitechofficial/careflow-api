import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateCallOffVisitDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduledJobId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduledVisitId?: string;

  @ApiProperty()
  @IsUUID()
  serviceUserId!: string;

  @ApiProperty({ example: '2026-05-05' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  callOffDate!: string;

  @ApiProperty({ example: 'Service user unavailable' })
  @IsString()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ example: 'Family cancelled visit' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
