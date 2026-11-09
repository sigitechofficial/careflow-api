import { parseRawEmail, stripBccHeader, threadRoot } from './connector.types';
import { hashWebhookToken, newWebhookToken, parseInboundPost, webhookTokenMatches } from './inbound-webhook';
import { MICROSOFT_CATEGORY, MicrosoftConnector } from './microsoft.connector';
import { buildReplyMime, type ReplyMime } from '../referral-reply-mime.util';

const RAW = [
  'From: "Jane Smith" <Jane.Smith@council.test>',
  'To: referrals@careflow.test',
  'Reply-To: brokerage@council.test',
  'Subject: Referral for Mr Test',
  'Message-ID: <reply-2@council.test>',
  'In-Reply-To: <root-1@careflow.test>',
  'References: <root-1@careflow.test> <mid-1@council.test>',
  'Date: Mon, 09 Nov 2026 10:00:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Please see the attached care plan.',
  '--b1',
  'Content-Type: application/octet-stream; name="care-plan.pdf"',
  'Content-Disposition: attachment; filename="care-plan.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 test').toString('base64'),
  '--b1--',
  '',
].join('\r\n');

const reply: ReplyMime = {
  from: '"Referrals" <referrals@careflow.test>',
  to: 'jane@council.test',
  cc: ['manager@careflow.test'],
  bcc: ['secret@careflow.test'],
  subject: 'Re: Referral',
  inReplyTo: '<reply-2@council.test>',
  references: '<root-1@careflow.test> <reply-2@council.test>',
  text: 'Thank you',
  html: '<p>Thank you</p>',
  attachments: [{ filename: 'quote.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF quote') }],
};

describe('referral mailbox connectors', () => {
  it('finds the first email of a conversation', () => {
    expect(threadRoot('<a@x> <b@x>', '<b@x>', '<c@x>')).toBe('<a@x>');
    expect(threadRoot(['<a@x>', '<b@x>'], null, '<c@x>')).toBe('<a@x>');
    expect(threadRoot(null, '<b@x>', '<c@x>')).toBe('<b@x>');
    expect(threadRoot(null, null, '<c@x>')).toBe('<c@x>');
    expect(threadRoot(null, null, null)).toBeNull();
  });

  it('reads a raw email: sender, reply-to, thread, body and attachments', async () => {
    const e = await parseRawEmail(RAW, '7:12');
    expect(e.fromEmail).toBe('jane.smith@council.test');
    expect(e.fromName).toBe('Jane Smith');
    expect(e.replyToEmail).toBe('brokerage@council.test');
    expect(e.threadKey).toBe('<root-1@careflow.test>');
    expect(e.messageIdHeader).toBe('<reply-2@council.test>');
    expect(e.bodyText).toContain('attached care plan');
    expect(e.attachments).toHaveLength(1);
    expect(e.attachments[0]).toMatchObject({ fileName: 'care-plan.pdf', mimeType: 'application/pdf' });
    expect(e.attachments[0].data?.toString()).toBe('%PDF-1.4 test');
  });

  it('takes the Bcc line out of a message sent over SMTP, and only from the headers', () => {
    const raw = buildReplyMime(reply);
    expect(raw).toMatch(/^Bcc: secret@careflow\.test/m);
    const stripped = stripBccHeader(raw);
    expect(stripped).not.toMatch(/^Bcc:/im);
    expect(stripped).toMatch(/^Cc: manager@careflow\.test/m);
    expect(stripped).toMatch(/^Message-ID: <[^>]+@careflow\.test>/m);
    expect(stripped.length).toBe(raw.length - 'Bcc: secret@careflow.test\r\n'.length);
  });

  describe('inbound webhook', () => {
    afterEach(() => jest.restoreAllMocks());

    it('checks the secret in the address against its hash', () => {
      const t = newWebhookToken();
      expect(webhookTokenMatches(t, hashWebhookToken(t))).toBe(true);
      expect(webhookTokenMatches(`${t}x`, hashWebhookToken(t))).toBe(false);
      expect(webhookTokenMatches(t, null)).toBe(false);
    });

    it('reads a Brevo inbound post and downloads its attachments with the API key', async () => {
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(Buffer.from('docx bytes')));
      const [e] = await parseInboundPost(
        {
          items: [
            {
              Uuid: ['u-1'],
              MessageId: '<m-1@council.test>',
              InReplyTo: null,
              From: { Name: 'Lena Okafor', Address: 'Lena@Council.test' },
              ReplyTo: null,
              Subject: 'Package of care request',
              SentAtDate: 'Mon, 09 Nov 2026 10:00:00 +0000',
              RawTextBody: 'Please find the support plan attached.',
              Headers: { References: '' },
              Attachments: [{ Name: 'plan.docx', ContentType: 'application/octet-stream', ContentLength: 10, DownloadToken: 'tok-1' }],
            },
          ],
        },
        'application/json',
        'brevo-key',
      );
      expect(e).toMatchObject({ providerMessageId: '<m-1@council.test>', fromEmail: 'lena@council.test', threadKey: '<m-1@council.test>' });
      expect(e.attachments[0].mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect((await e.attachments[0].load!()).toString()).toBe('docx bytes');
      expect(fetchMock).toHaveBeenCalledWith('https://api.brevo.com/v3/inbound/attachments/tok-1', { headers: { 'api-key': 'brevo-key' } });
    });

    it('reads a raw email posted as bytes or as {"raw": base64}', async () => {
      const [a] = await parseInboundPost(Buffer.from(RAW), 'message/rfc822', null);
      const [b] = await parseInboundPost({ raw: Buffer.from(RAW).toString('base64') }, 'application/json', null);
      for (const e of [a, b]) {
        expect(e.providerMessageId).toBe('<reply-2@council.test>');
        expect(e.attachments[0].fileName).toBe('care-plan.pdf');
      }
    });

    it('refuses a post it does not understand', async () => {
      await expect(parseInboundPost({ hello: 1 }, 'application/json', null)).rejects.toThrow('Unsupported post');
    });
  });

  describe('Microsoft 365', () => {
    const env = { ...process.env };
    let calls: Array<{ url: string; method: string; body?: unknown }>;

    beforeEach(() => {
      process.env.MICROSOFT_OAUTH_CLIENT_ID = 'client';
      process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'secret';
      process.env.MICROSOFT_OAUTH_REDIRECT_URI = 'http://localhost/cb';
      calls = [];
      jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : undefined });
        const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
        if (url.includes('/oauth2/v2.0/token')) return json({ access_token: 'at', refresh_token: 'rt-new' });
        if (url.includes('/mailFolders?')) return json({ value: [] });
        if (url.includes('/mailFolders/inbox/childFolders')) return json({ value: [{ id: 'F1' }] });
        if (url.includes('/mailFolders/F1/messages')) {
          return json({ value: [{ id: 'M2', receivedDateTime: '2026-11-09T11:00:00Z' }, { id: 'M1', receivedDateTime: '2026-11-09T10:00:00Z' }] });
        }
        if (url.endsWith('/messages/M1/$value')) return new Response(RAW);
        if (url.includes('/messages/M1?$select=conversationId')) return json({ conversationId: 'CONV-1', receivedDateTime: '2026-11-09T10:00:05Z' });
        if (url.includes('/messages/M1?$select=categories')) return json({ categories: ['Blue'] });
        if (url.endsWith('/messages/M1/createReply')) return json({ id: 'D1' }, 201);
        if (url.endsWith('/messages/M1') && method === 'PATCH') return json({});
        if (url.endsWith('/messages/D1') && method === 'PATCH') return json({});
        if (url.endsWith('/messages/D1/attachments')) return json({ id: 'A1' }, 201);
        if (url.endsWith('/messages/D1/send')) return new Response(null, { status: 202 });
        return json({ error: { message: `unexpected ${method} ${url}` } }, 404);
      });
    });
    afterEach(() => {
      jest.restoreAllMocks();
      process.env = { ...env };
    });

    it('lists new emails in the folder inside the Inbox, oldest first, skipping ones already marked', async () => {
      const saved: string[] = [];
      const c = new MicrosoftConnector({ folder: 'Referrals', refreshToken: 'rt', since: new Date('2026-11-01T00:00:00Z'), onNewRefreshToken: async (t) => void saved.push(t) });
      expect(await c.listNew(20)).toEqual(['M1', 'M2']);
      const list = calls.find((x) => x.url.includes('/mailFolders/F1/messages'))!;
      expect(decodeURIComponent(list.url)).toContain(`not(categories/any(c:c eq '${MICROSOFT_CATEGORY}'))`);
      expect(decodeURIComponent(list.url)).toContain('receivedDateTime ge 2026-11-01T00:00:00.000Z');
      expect(saved).toEqual(['rt-new']);
    });

    it('reads the raw email with Outlook’s conversation as the thread, and marks it with the category', async () => {
      const c = new MicrosoftConnector({ folder: 'Inbox', refreshToken: 'rt', since: new Date() });
      const e = await c.fetch('M1');
      expect(e.threadKey).toBe('CONV-1');
      expect(e.receivedAt.toISOString()).toBe('2026-11-09T10:00:05.000Z');
      expect(e.attachments[0].fileName).toBe('care-plan.pdf');
      await c.markRead('M1');
      expect(calls.find((x) => x.method === 'PATCH' && x.url.endsWith('/messages/M1'))?.body).toEqual({ categories: ['Blue', MICROSOFT_CATEGORY] });
    });

    it('replies in the conversation: reply draft, our text and recipients, the quote PDF, then send', async () => {
      const c = new MicrosoftConnector({ folder: 'Inbox', refreshToken: 'rt', since: new Date() });
      expect(await c.send(reply, { providerMessageId: 'M1', providerThreadId: 'CONV-1' })).toBe('D1');
      const graph = calls.filter((x) => !x.url.includes('oauth2'));
      expect(graph.map((x) => `${x.method} ${x.url.replace('https://graph.microsoft.com/v1.0/me', '')}`)).toEqual([
        'POST /messages/M1/createReply',
        'PATCH /messages/D1',
        'POST /messages/D1/attachments',
        'POST /messages/D1/send',
      ]);
      expect(graph[1].body).toMatchObject({
        subject: 'Re: Referral',
        toRecipients: [{ emailAddress: { address: 'jane@council.test' } }],
        ccRecipients: [{ emailAddress: { address: 'manager@careflow.test' } }],
        bccRecipients: [{ emailAddress: { address: 'secret@careflow.test' } }],
      });
      expect(graph[2].body).toMatchObject({ name: 'quote.pdf', contentBytes: Buffer.from('%PDF quote').toString('base64') });
    });

    it('says when the folder does not exist', async () => {
      const c = new MicrosoftConnector({ folder: 'Missing', refreshToken: 'rt', since: new Date() });
      (global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo) =>
        String(input).includes('oauth2') ? new Response(JSON.stringify({ access_token: 'at' })) : new Response(JSON.stringify({ value: [] })),
      );
      await expect(c.test()).rejects.toThrow('The folder "Missing" was not found');
    });
  });
});
