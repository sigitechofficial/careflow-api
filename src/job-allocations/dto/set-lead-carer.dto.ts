import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SetLeadCarerDto {
  @ApiProperty({ description: 'Employee id of the active allocation to mark as lead carer' })
  @IsUUID()
  employeeId!: string;
}
