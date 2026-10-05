import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class AssignResponsibilityDto {
  @ApiProperty({
    type: [String],
    description: 'Roles responsible for the job (admins are always included)',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  roleIds!: string[];
}
