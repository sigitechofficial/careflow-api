import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class EcmVisitsTableQueryDto {
  @ApiProperty({
    description: 'Inclusive operational-day range start (YYYY-MM-DD)',
  })
  @IsDateString()
  dateFrom!: string;

  @ApiProperty({
    description: 'Inclusive operational-day range end (YYYY-MM-DD)',
  })
  @IsDateString()
  dateTo!: string;

  @ApiPropertyOptional({ description: 'Visits for this service user' })
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional({ description: 'Visits this employee is allocated to' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
