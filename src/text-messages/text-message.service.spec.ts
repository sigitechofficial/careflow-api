import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MAX_TEXT_MESSAGE_LENGTH, TextMessageService } from './text-message.service';

const config = (mode?: string, replyUrl: string | undefined = 'https://api.care.example/api/text-messages/replies') =>
  ({ get: (key: string) => (key === 'TEXT_MESSAGE_MODE' ? mode : key === 'TEXT_MESSAGE_REPLY_URL' ? replyUrl : undefined) }) as unknown as ConfigService;

describe('TextMessageService', () => {
  it('log mode is the default and sends nothing, logging only a masked number and the length', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const svc = new TextMessageService(config(undefined));
    expect(svc.mode).toBe('log');
    expect(svc.supportsReplies()).toBe(false);
    const result = await svc.send({ to: '07700 900123', body: 'Your survey link: https://x/survey/secret-token' });
    expect(result.sent).toBe(true);
    const lines = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(lines).toContain('07*** ***123');
    expect(lines).not.toContain('900123');
    expect(lines).not.toContain('secret-token');
    log.mockRestore();
  });

  it('off mode sends nothing', async () => {
    const svc = new TextMessageService(config('off'));
    expect(svc.isEnabled()).toBe(false);
    expect(await svc.send({ to: '07700900123', body: 'x' })).toEqual({ sent: false, reason: 'OFF' });
  });

  it('refuses numbers that are not UK mobiles, and over-long messages', async () => {
    const svc = new TextMessageService(config('log'));
    expect(await svc.send({ to: '01632 960001', body: 'x' })).toEqual({ sent: false, reason: 'INVALID_NUMBER' });
    expect(await svc.send({ to: '07700900123', body: 'x'.repeat(MAX_TEXT_MESSAGE_LENGTH + 1) })).toEqual({
      sent: false,
      reason: 'TOO_LONG',
    });
  });
});

describe('TextMessageService — replies (STOP)', () => {
  const provider = (signed = true) => ({
    name: 'test',
    supportsReplies: true,
    send: jest.fn(async () => ({ messageId: 'm1' })),
    inbound: {
      verify: jest.fn(() => signed),
      parse: jest.fn((body: any) => body.messages),
    },
  });
  const req = (messages: Array<{ from: string; text: string }>) => ({ headers: {}, rawBody: Buffer.from('x'), body: { messages } });

  it('log mode receives no replies at all, and live mode without a provider falls back to the log', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = new TextMessageService(config('log'), provider() as any);
    expect(log.receivesReplies()).toBe(false);
    expect((await log.receiveReplies(req([{ from: '07700900123', text: 'STOP' }]))).accepted).toBe(false);
    expect(new TextMessageService(config('live')).mode).toBe('log');
  });

  it('acts only on stop and start words from a signed request, never passing on any other reply', async () => {
    const svc = new TextMessageService(config('live'), provider() as any);
    const handler = jest.fn(async () => 1);
    svc.onReply(handler);
    const r = await svc.receiveReplies(
      req([
        { from: '07700 900123', text: 'Stop' },
        { from: '+447700900456', text: 'start' },
        { from: '07700900789', text: 'Cancel my visit tomorrow please' },
        { from: '01632 960001', text: 'STOP' },
      ]),
    );
    expect(r).toEqual({ accepted: true, stops: 1, starts: 1, ignored: 2, changed: 2 });
    expect(handler.mock.calls).toEqual([[{ kind: 'STOP', from: '+447700900123' }], [{ kind: 'START', from: '+447700900456' }]]);
  });

  it('checks signatures against the configured reply address, and receives nothing without one', async () => {
    const p = provider();
    const svc = new TextMessageService(config('live'), p as any);
    await svc.receiveReplies({ headers: { host: 'internal:3000' }, rawBody: Buffer.from('x'), body: { messages: [] } });
    expect(p.inbound.verify).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.care.example/api/text-messages/replies' }));
    expect(new TextMessageService(config('live', ''), provider() as any).receivesReplies()).toBe(false);
    expect(new TextMessageService(config('live', 'http://plain.example/x'), provider() as any).receivesReplies()).toBe(false);
  });

  it('refuses requests the provider did not sign', async () => {
    const svc = new TextMessageService(config('live'), provider(false) as any);
    const handler = jest.fn(async () => 1);
    svc.onReply(handler);
    expect((await svc.receiveReplies(req([{ from: '07700900123', text: 'STOP' }]))).accepted).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});
