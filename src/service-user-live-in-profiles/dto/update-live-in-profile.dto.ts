import { PartialType } from '@nestjs/swagger';
import { CreateLiveInProfileDto } from './create-live-in-profile.dto';

export class UpdateLiveInProfileDto extends PartialType(CreateLiveInProfileDto) {}
