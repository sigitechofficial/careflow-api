import { NotificationsGateway } from './notifications.gateway';
import { INDEPENDENT_REVIEWER_ROLE } from '../common/auth/independent-reviewer';

/**
 * The notifications socket handshake. An independent reviewer's account (only role
 * "Independent reviewer") is refused at connection, fail-closed, and never joins a room.
 */
describe('NotificationsGateway.handleConnection', () => {
  const make = (ctx: unknown, payload: Record<string, unknown> = { sub: 'u1' }) => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
    const config = { get: jest.fn().mockReturnValue('secret') };
    const usersService = { getAuthContext: jest.fn().mockResolvedValue(ctx) };
    const auditLogs = { logAudit: jest.fn().mockResolvedValue(undefined) };
    const gateway = new NotificationsGateway(
      jwt as never,
      config as never,
      usersService as never,
      auditLogs as never,
      {} as never,
    );
    const client = {
      id: 'sock1',
      handshake: { auth: { token: 'tok' }, headers: {} },
      data: {} as Record<string, unknown>,
      join: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };
    return { gateway, client, usersService, auditLogs };
  };

  it('connects a staff account and joins its user and role rooms', async () => {
    const { gateway, client, auditLogs } = make({ id: 'u1', roles: ['Manager'] });
    await gateway.handleConnection(client as never);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join).toHaveBeenCalledWith('user:u1');
    expect(client.join).toHaveBeenCalledWith('role:Manager');
    expect(client.data.userId).toBe('u1');
    expect(auditLogs.logAudit).toHaveBeenCalled();
  });

  it('refuses an independent reviewer account before joining any room', async () => {
    const { gateway, client, auditLogs } = make({ id: 'r1', roles: [INDEPENDENT_REVIEWER_ROLE] });
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
    expect(client.data.userId).toBeUndefined();
    expect(auditLogs.logAudit).not.toHaveBeenCalled();
  });

  it('refuses a reviewer account even while it holds a live review grant', async () => {
    const { gateway, client } = make({
      id: 'r1',
      roles: [INDEPENDENT_REVIEWER_ROLE],
      permissions: ['surveys.review.record'],
    });
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('fails closed when the account roles cannot be read', async () => {
    const { gateway, client } = make({ id: 'u1', roles: undefined });
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('fails closed when the account lookup throws', async () => {
    const { gateway, client, usersService } = make(null);
    usersService.getAuthContext.mockRejectedValue(new Error('db down'));
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('refuses a missing token and an unknown account', async () => {
    const noToken = make({ id: 'u1', roles: ['Manager'] });
    noToken.client.handshake.auth = {} as never;
    await noToken.gateway.handleConnection(noToken.client as never);
    expect(noToken.client.disconnect).toHaveBeenCalledWith(true);

    const unknown = make(null);
    await unknown.gateway.handleConnection(unknown.client as never);
    expect(unknown.client.disconnect).toHaveBeenCalledWith(true);
    expect(unknown.client.join).not.toHaveBeenCalled();
  });
});
