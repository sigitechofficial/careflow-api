import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const beginSend = jest.fn();
jest.mock('@azure/communication-email', () => ({
  EmailClient: jest.fn().mockImplementation(() => ({ beginSend })),
}));
jest.mock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));

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
