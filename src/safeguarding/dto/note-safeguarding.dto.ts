import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class SafeguardingNoteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  note!: string;
}
