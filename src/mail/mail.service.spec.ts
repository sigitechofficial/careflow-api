import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const beginSend = jest.fn();
jest.mock('@azure/communication-email', () => ({
  EmailClient: jest.fn().mockImplementation(() => ({ beginSend })),
}));
jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
  ClientSecretCredential: jest.fn(),
}));
import {
  ClientSecretCredential,
  DefaultAzureCredential,
} from '@azure/identity';

const makeService = (mail: Record<string, unknown>) =>
  new MailService({
    get: (key: string, fallback?: unknown) => {
      const k = key.replace(/^mail\./, '');
      return k in mail ? mail[k] : fallback;
    },
  } as unknown as ConfigService);

const acsOk = (id = 'acs-op-1') =>
  beginSend.mockResolvedValue({
    pollUntilDone: () => Promise.resolve({ id, status: 'Succeeded' }),
  });

describe('MailService — Azure Communication Services (acs)', () => {
  beforeEach(() => beginSend.mockReset());

  it('sends through ACS with the MAIL_FROM address and returns the operation id', async () => {
    acsOk('op-123');
    const svc = makeService({
      mode: 'acs',
      acsEndpoint: 'https://x.uk.communication.azure.com',
      from: 'Careflow <DoNotReply@example.azurecomm.net>',
    });
    const res = await svc.send({
      to: ['a@example.test', ' b@example.test '],
      subject: 'Hello',
      text: 'Body',
      attachments: [
        {
          filename: 'r.pdf',
          content: Buffer.from('pdf'),
          contentType: 'application/pdf',
        },
      ],
    });
    expect(res).toEqual({ messageId: 'op-123', mode: 'acs' });
    const msg = beginSend.mock.calls[0][0];
    expect(msg.senderAddress).toBe('DoNotReply@example.azurecomm.net');
    expect(msg.recipients.to).toEqual([
      { address: 'a@example.test' },
      { address: 'b@example.test' },
    ]);
    expect(msg.content).toMatchObject({ subject: 'Hello', plainText: 'Body' });
    expect(msg.attachments[0]).toEqual({
      name: 'r.pdf',
      contentType: 'application/pdf',
      contentInBase64: Buffer.from('pdf').toString('base64'),
    });
  });

  it('uses the email-only Entra app when ACS_TENANT_ID, ACS_CLIENT_ID and ACS_CLIENT_SECRET are set', async () => {
    acsOk();
    (ClientSecretCredential as unknown as jest.Mock).mockClear();
    (DefaultAzureCredential as unknown as jest.Mock).mockClear();
    const svc = makeService({
      mode: 'acs',
      acsEndpoint: 'https://x',
      from: 'noreply@example.test',
      acsTenantId: 'tenant',
      acsClientId: 'client',
      acsClientSecret: 'secret',
    });
    await svc.send({ to: 'a@example.test', subject: 'S', text: 'T' });
    expect(ClientSecretCredential).toHaveBeenCalledWith(
      'tenant',
      'client',
      'secret',
    );
    expect(DefaultAzureCredential).not.toHaveBeenCalled();
  });

  it('falls back to DefaultAzureCredential when the email-only app is not fully set', async () => {
    acsOk();
    (ClientSecretCredential as unknown as jest.Mock).mockClear();
    (DefaultAzureCredential as unknown as jest.Mock).mockClear();
    const svc = makeService({
      mode: 'acs',
      acsEndpoint: 'https://x',
      from: 'noreply@example.test',
      acsClientId: 'client',
    });
    await svc.send({ to: 'a@example.test', subject: 'S', text: 'T' });
    expect(DefaultAzureCredential).toHaveBeenCalled();
    expect(ClientSecretCredential).not.toHaveBeenCalled();
  });

  it('copies every email to MAIL_BCC, skipping addresses already in to', async () => {
    acsOk();
    const svc = makeService({
      mode: 'acs',
      acsEndpoint: 'https://x',
      from: 'noreply@example.test',
      bcc: ['office@example.test', 'a@example.test'],
    });
    await svc.send({ to: 'A@example.test', subject: 'S', text: 'T' });
    const msg = beginSend.mock.calls[0][0] as {
      recipients: { to: unknown[]; bcc?: unknown[] };
    };
    expect(msg.recipients.to).toEqual([{ address: 'A@example.test' }]);
    expect(msg.recipients.bcc).toEqual([{ address: 'office@example.test' }]);
  });

  it('sends no MAIL_BCC copy when the email opts out (password reset)', async () => {
    acsOk();
    const svc = makeService({
      mode: 'acs',
      acsEndpoint: 'https://x',
      from: 'noreply@example.test',
      bcc: ['office@example.test'],
    });
    await svc.send({
      to: 'a@example.test',
      subject: 'Reset',
      text: 'T',
      skipBcc: true,
    });
    const msg = beginSend.mock.calls[0][0] as {
      recipients: { bcc?: unknown[] };
    };
    expect(msg.recipients.bcc).toBeUndefined();
  });

  it('fails clearly when ACS reports the send did not succeed', async () => {
    beginSend.mockResolvedValue({
      pollUntilDone: () =>
        Promise.resolve({
          id: 'op-9',
          status: 'Failed',
          error: { message: 'DomainNotLinked' },
        }),
    });
    const svc = makeService({
      mode: 'acs',
      acsEndpoint: 'https://x',
      from: 'a@b.test',
    });
    await expect(
      svc.send({ to: 'c@d.test', subject: 's', text: 't' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('is not configured without ACS_ENDPOINT', () => {
    expect(makeService({ mode: 'acs' }).isConfigured()).toBe(false);
    expect(
      makeService({ mode: 'acs', acsEndpoint: 'https://x' }).isConfigured(),
    ).toBe(true);
  });
});

describe('MailService — MAIL_REDIRECT_TO safety net', () => {
  beforeEach(() => beginSend.mockReset());

  it('sends every email to the redirect inbox and keeps the original recipients in the subject', async () => {
    acsOk();
    const svc = makeService({
      mode: 'acs',
      acsEndpoint: 'https://x',
      from: 'a@b.test',
      redirectTo: 'dev@example.test',
    });
    await svc.send({
      to: ['carer@real.test', 'client@real.test'],
      subject: 'Rota',
      text: 't',
    });
    const msg = beginSend.mock.calls[0][0];
    expect(msg.recipients.to).toEqual([{ address: 'dev@example.test' }]);
    expect(msg.content.subject).toBe(
      '[to: carer@real.test, client@real.test] Rota',
    );
  });

  it('sends to every inbox in a comma-separated redirect, and only those', async () => {
    acsOk();
    const svc = makeService({
      mode: 'acs',
      acsEndpoint: 'https://x',
      from: 'a@b.test',
      redirectTo: ' one@example.test , two@example.test ,',
    });
    await svc.send({ to: 'client@real.test', subject: 'Survey', text: 't' });
    const msg = beginSend.mock.calls[0][0];
    expect(msg.recipients.to).toEqual([{ address: 'one@example.test' }, { address: 'two@example.test' }]);
    expect(msg.content.subject).toBe('[to: client@real.test] Survey');
  });

  it('leaves recipients alone when no redirect is configured (production)', async () => {
    acsOk();
    const svc = makeService({
      mode: 'acs',
      acsEndpoint: 'https://x',
      from: 'a@b.test',
    });
    await svc.send({ to: 'carer@real.test', subject: 'Rota', text: 't' });
    expect(beginSend.mock.calls[0][0].recipients.to).toEqual([
      { address: 'carer@real.test' },
    ]);
  });
});

describe('MailService — sender comes only from MAIL_FROM', () => {
  beforeEach(() => beginSend.mockReset());

  it('refuses to send through ACS when MAIL_FROM is empty (no made-up sender)', async () => {
    const svc = makeService({ mode: 'acs', acsEndpoint: 'https://x', from: '' });
    await expect(
      svc.send({ to: 'a@b.test', subject: 's', text: 't' }),
    ).rejects.toThrow(/MAIL_FROM/);
    expect(beginSend).not.toHaveBeenCalled();
  });

  it('sends from the configured Allfor Care address', async () => {
    acsOk();
    const svc = makeService({
      mode: 'acs',
      acsEndpoint: 'https://x',
      from: 'Allfor Care <noreply@allforcare.co.uk>',
    });
    await svc.send({ to: 'a@b.test', subject: 's', text: 't' });
    expect(beginSend.mock.calls[0][0].senderAddress).toBe('noreply@allforcare.co.uk');
  });
});

describe('MailService — message delivery settings', () => {
  const delivery = (rules: Partial<import('../message-delivery/message-delivery.rules').DeliveryRules>) => {
    const { DEFAULT_DELIVERY_RULES, decideDelivery, HOLD_REASON_TEXT } = jest.requireActual('../message-delivery/message-delivery.rules');
    const r = { ...DEFAULT_DELIVERY_RULES, ...rules };
    const recorded: unknown[] = [];
    const svc = {
      decide: async (c: string, k: string | undefined, to: string[]) => ({ ...decideDelivery(r, c, k, to), heldEmailsTo: r.heldEmailsTo }),
      record: async (_c: string, _k: string, rows: unknown[]) => void recorded.push(...rows),
      heldRows: (d: { held: Array<{ recipient: string; reason: string }> }) =>
        d.held.map((h) => ({ recipient: h.recipient, outcome: 'HELD', reason: HOLD_REASON_TEXT[h.reason] })),
    };
    return { svc, recorded };
  };
  const make = (d: unknown) =>
    new MailService({ get: (key: string, fallback?: unknown) => (key === 'mail.mode' ? 'log' : fallback) } as unknown as ConfigService, d as never);

  it('sends only to allowed recipients and logs the rest as held', async () => {
    const { svc, recorded } = delivery({ emailAudience: 'ALLOWED_ONLY', allowedEmails: ['@allforcare.co.uk'] });
    const mail = make(svc);
    const spy = jest.spyOn(mail as never as { deliver: (i: unknown) => Promise<unknown> }, 'deliver');
    await mail.send({ kind: 'quotes', to: ['sam@allforcare.co.uk', 'gp@nhs.net'], subject: 'Quote', text: 'x' });
    expect((spy.mock.calls[0][0] as { to: string[] }).to).toEqual(['sam@allforcare.co.uk']);
    expect(recorded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recipient: 'sam@allforcare.co.uk', outcome: 'SENT' }),
        expect.objectContaining({ recipient: 'gp@nhs.net', outcome: 'HELD' }),
      ]),
    );
  });

  it('throws a clear "not sent" error when nobody is left, so staff are told', async () => {
    const { svc } = delivery({ disabledKinds: ['EMAIL:invoices'] });
    await expect(make(svc).send({ kind: 'invoices', to: 'funder@council.gov.uk', subject: 'Invoice', text: 'x' })).rejects.toThrow(
      /Not sent: this type of message is switched off/,
    );
  });

  it('sends held emails to the held-emails inbox instead, with who they were for', async () => {
    const { svc, recorded } = delivery({ emailAudience: 'ALLOWED_ONLY', allowedEmails: ['@allforcare.co.uk'], heldEmailsTo: 'testing@allforcare.co.uk' });
    const mail = make(svc);
    const spy = jest.spyOn(mail as never as { deliver: (i: unknown) => Promise<unknown> }, 'deliver');
    await mail.send({ kind: 'quotes', to: 'family@gmail.com', subject: 'Your quote', text: 'x' });
    const sent = spy.mock.calls[0][0] as { to: string; subject: string; skipBcc: boolean };
    expect(sent).toMatchObject({ to: 'testing@allforcare.co.uk', subject: '[Held – for family@gmail.com] Your quote', skipBcc: true });
    expect(recorded).toEqual([expect.objectContaining({ recipient: 'family@gmail.com', outcome: 'REDIRECTED' })]);
  });
});
