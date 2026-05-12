import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateJobTitleDto {
  @ApiProperty({ example: 'Senior Care Assistant' })
  @IsString()
  @MinLength(1, { message: 'Job title name is required' })
  @MaxLength(120, { message: 'Job title is too long' })
  name!: string;
}
