import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class SetUserRolesDto {
  @ApiProperty({ type: [String], example: ['Branch Admin'] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleNames!: string[];
}
