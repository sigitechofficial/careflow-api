import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SetLeadCarerDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;
}
