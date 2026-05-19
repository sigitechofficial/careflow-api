import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLookupNameDto {
  @ApiProperty({ example: 'Manual Handling' })
  @IsString()
  @MinLength(1, { message: 'Name is required' })
  @MaxLength(120, { message: 'Name is too long' })
  name!: string;
}
