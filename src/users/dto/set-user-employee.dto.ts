import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, ValidateIf } from 'class-validator';

export class SetUserEmployeeDto {
  @ApiProperty({
    nullable: true,
    description: 'Employee record to link this office user to (for payroll), or null to unlink',
  })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  employeeId!: string | null;
}
