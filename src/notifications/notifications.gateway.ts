import { Logger, forwardRef, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { NotificationsService } from './notifications.service';
import { corsOrigin } from '../config/cors-origins.util';

@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: corsOrigin(), credentials: true },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly auditLogs: AuditLogsService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {}

  emitNotificationNew(userId: string, payload: Record<string, unknown>) {
    this.server.to(`user:${userId}`).emit('notification:new', payload);
  }

  emitNotificationRead(userId: string, payload: { id: string; readAt: string }) {
    this.server.to(`user:${userId}`).emit('notification:read', payload);
  }

  emitNotificationReadAll(userId: string, payload: { readAt: string }) {
    this.server.to(`user:${userId}`).emit('notification:read-all', payload);
  }

  emitNotificationDismissed(userId: string, payload: { id: string; dismissedAt: string }) {
    this.server.to(`user:${userId}`).emit('notification:dismissed', payload);
  }

  emitUnreadCount(userId: string, count: number) {
    this.server.to(`user:${userId}`).emit('notification:unread-count', { count });
  }

  async handleConnection(client: Socket) {
    const raw =
      (typeof client.handshake.auth?.token === 'string' && client.handshake.auth.token) ||
      (typeof client.handshake.headers?.authorization === 'string'
        ? client.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
        : null);
    if (!raw) {
      this.logger.warn('Socket connect rejected: missing token');
      client.disconnect(true);
      return;
    }
    try {
      const secret = this.config.get<string>('JWT_ACCESS_TOKEN_SECRET');
      const payload = await this.jwt.verifyAsync<{ sub: string; typ?: string }>(raw, { secret });
      if (payload.typ === 'ti') {
        client.disconnect(true);
        return;
      }
      const ctx = await this.usersService.getAuthContext(payload.sub);
      if (!ctx) {
        client.disconnect(true);
        return;
      }
      client.data.userId = ctx.id;
      client.data.roles = ctx.roles ?? [];
      await client.join(`user:${ctx.id}`);
      for (const role of ctx.roles ?? []) {
        await client.join(`role:${role}`);
      }
      await this.auditLogs.logAudit({
        userId: ctx.id,
        module: AuditModule.NOTIFICATION,
        action: AuditAction.NOTIFICATION_SOCKET_CONNECTED,
        metadata: { socketId: client.id },
      });
    } catch (e) {
      this.logger.warn(`Socket connect rejected: ${e instanceof Error ? e.message : 'invalid token'}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId as string | undefined;
    if (userId) {
      void this.auditLogs.logAudit({
        userId,
        module: AuditModule.NOTIFICATION,
        action: AuditAction.NOTIFICATION_SOCKET_DISCONNECTED,
        metadata: { socketId: client.id },
      });
    }
  }

  @SubscribeMessage('notification:subscribe')
  handleSubscribe(@ConnectedSocket() client: Socket) {
    const userId = client.data?.userId as string | undefined;
    if (!userId) throw new WsException('Unauthorized');
    return { ok: true };
  }

  @SubscribeMessage('notification:unsubscribe')
  handleUnsubscribe(@ConnectedSocket() client: Socket) {
    const userId = client.data?.userId as string | undefined;
    if (!userId) throw new WsException('Unauthorized');
    return { ok: true };
  }

  @SubscribeMessage('notification:mark-read')
  async handleMarkRead(@ConnectedSocket() client: Socket, @MessageBody() body: { id?: string }) {
    const userId = client.data?.userId as string | undefined;
    if (!userId || !body?.id) throw new WsException('Unauthorized');
    try {
      return await this.notificationsService.markAsRead(userId, body.id);
    } catch (e) {
      throw new WsException(e instanceof Error ? e.message : 'Failed to mark read');
    }
  }

  @SubscribeMessage('notification:mark-all-read')
  async handleMarkAllRead(@ConnectedSocket() client: Socket) {
    const userId = client.data?.userId as string | undefined;
    if (!userId) throw new WsException('Unauthorized');
    try {
      return await this.notificationsService.markAllAsRead(userId);
    } catch (e) {
      throw new WsException(e instanceof Error ? e.message : 'Failed to mark all read');
    }
  }

  @SubscribeMessage('notification:dismiss')
  async handleDismiss(@ConnectedSocket() client: Socket, @MessageBody() body: { id?: string }) {
    const userId = client.data?.userId as string | undefined;
    if (!userId || !body?.id) throw new WsException('Unauthorized');
    try {
      return await this.notificationsService.dismiss(userId, body.id);
    } catch (e) {
      throw new WsException(e instanceof Error ? e.message : 'Failed to dismiss');
    }
  }
}
