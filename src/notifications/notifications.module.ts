import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { UsersModule } from '../users/users.module';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsController, NotificationPreferencesController } from './notifications.controller';
import { FcmPushService } from './fcm-push.service';
import { CarerVisitPushHook } from './carer-visit-push.hook';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    UsersModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_TOKEN_SECRET'),
      }),
    }),
  ],
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [NotificationsService, NotificationsGateway, FcmPushService, CarerVisitPushHook],
  exports: [NotificationsService, FcmPushService, CarerVisitPushHook],
})
export class NotificationsModule {}
