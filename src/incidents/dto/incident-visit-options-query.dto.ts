import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

export class IncidentVisitOptionsQueryDto {
  @ApiProperty({
    description: 'Incident date (YYYY-MM-DD, organisation timezone)',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @ApiPropertyOptional({ description: 'Service user whose visits to list' })
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional({
    description:
      'Staff member whose visits to list (used when no service user)',
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
