import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DevicePushPlatform } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EmployeeAppDeviceTokenDto {
  @ApiProperty({ example: 'fcm-device-token' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ enum: DevicePushPlatform, example: DevicePushPlatform.ANDROID })
  @IsEnum(DevicePushPlatform)
  platform!: DevicePushPlatform;
}

export class EmployeeAppDeleteDeviceTokenDto {
  @ApiProperty({ example: 'fcm-device-token' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class EmployeeAppLogoutDto {
  @ApiPropertyOptional({ description: 'FCM token to unregister on logout' })
  @IsOptional()
  @IsString()
  token?: string;
}
