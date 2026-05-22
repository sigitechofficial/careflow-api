import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class PreviewCarePlanTextDto {
  @ApiProperty({ description: 'Service user name used to replace @ placeholders' })
  @IsString()
  @MaxLength(200)
  serviceUserName!: string;
}
