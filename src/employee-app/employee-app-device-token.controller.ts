import { Body, Controller, Delete, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { FcmPushService } from '../notifications/fcm-push.service';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import {
  EmployeeAppDeleteDeviceTokenDto,
  EmployeeAppDeviceTokenDto,
} from './dto/employee-app-device-token.dto';

@ApiTags('Employee App Push')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app/device-token')
export class EmployeeAppDeviceTokenController {
  constructor(private readonly fcm: FcmPushService) {}

  @Put()
  @ApiOperation({ summary: 'Register or refresh this device FCM token' })
  async upsert(
    @CurrentUser() user: RequestUser,
    @Body() dto: EmployeeAppDeviceTokenDto,
  ) {
    const data = await this.fcm.upsertToken({
      employeeId: user.employeeId!,
      token: dto.token,
      platform: dto.platform,
    });
    return { data, message: 'Device token saved' };
  }

  @Delete()
  @ApiOperation({ summary: 'Remove this device FCM token' })
  async remove(
    @CurrentUser() user: RequestUser,
    @Body() dto: EmployeeAppDeleteDeviceTokenDto,
  ) {
    const data = await this.fcm.deleteToken(user.employeeId!, dto.token);
    return { data, message: 'Device token removed' };
  }
}
