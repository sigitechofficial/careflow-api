/**
 * Runs only with REFERRAL_MAIL_TEST=1, against local test mail servers (IMAP 3143, SMTP 3025, relay SMTP 3026,
 * built-in test logins). Nothing leaves the machine. See docs/REFERRAL_MAILBOXES_PLAN.md → Testing.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ImapConnector, type ImapConfig } from './imap.connector';
import { sendReplyOverSmtp } from './smtp.sender';
import { IMAP_PROCESSED_KEYWORD } from './connector.types';
import type { ReplyMime } from '../referral-reply-mime.util';

const run = process.env.REFERRAL_MAIL_TEST === '1' ? describe : describe.skip;

const config: ImapConfig = {
  imapHost: '127.0.0.1',
  imapPort: 3143,
  imapSecure: false,
  smtpHost: '127.0.0.1',
  smtpPort: 3025,
  smtpSecure: false,
  username: 'testuser',
};
const password = 'testpass';
const mailbox = (folder = 'Referrals') =>
  new ImapConnector({ emailAddress: 'referrals@careflow.test', folder, config, password, since: new Date(Date.now() - 86_400_000) });

const referral = (id: string, extra: string[] = []) =>
  [
    'From: "Lena Okafor" <lena@council.test>',
    'To: referrals@careflow.test',
    `Subject: Referral ${id}`,
    `Message-ID: <${id}@council.test>`,
    ...extra,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b"',
    '',
    '--b',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Please see the support plan.',
    '--b',
    'Content-Type: application/pdf; name="plan.pdf"',
    'Content-Disposition: attachment; filename="plan.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('%PDF-1.4 plan').toString('base64'),
    '--b--',
    '',
  ].join('\r\n');

async function folderMessages(folder: string) {
  const c = new ImapFlow({ host: '127.0.0.1', port: 3143, secure: false, auth: { user: 'testuser', pass: password }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock(folder);
  const out: Array<{ uid: number; flags: string[]; source: Buffer }> = [];
  try {
    for await (const m of c.fetch('1:*', { uid: true, flags: true, source: true })) {
      out.push({ uid: m.uid, flags: [...(m.flags ?? [])], source: m.source! });
    }
  } catch {
    /* empty folder */
  } finally {
    lock.release();
    await c.logout();
  }
  return out;
}

const reply = (to: string): ReplyMime => ({
  from: '"Referrals" <referrals@careflow.test>',
  to,
  cc: ['manager@careflow.test'],
  bcc: ['hidden@careflow.test'],
  subject: 'Re: Referral',
  inReplyTo: '<root@council.test>',
  references: '<root@council.test>',
  text: 'Thank you for the referral.',
  html: '<p>Thank you for the referral.</p>',
  attachments: [{ filename: 'quote.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF quote') }],
});

run('IMAP / SMTP connector against local test servers', () => {
  jest.setTimeout(30_000);
  const stamp = Date.now();

  it('signs in to IMAP and SMTP, and says plainly when the password is wrong', async () => {
    const ok = mailbox();
    await expect(ok.test()).resolves.toBeUndefined();
    await ok.close();
    const bad = new ImapConnector({ emailAddress: 'x@careflow.test', folder: 'INBOX', config, password: 'wrong', since: new Date() });
    await expect(bad.test()).rejects.toThrow('did not accept the username or password');
    await bad.close();
    const noFolder = mailbox('Nope');
    await expect(noFolder.test()).rejects.toThrow('The folder "Nope" was not found');
    await noFolder.close();
  });

  it('lists a new email, reads it with its attachment, and does not list it again once marked', async () => {
    const c = mailbox();
    await c.appendTest(referral(`r1-${stamp}`));
    const ids = await c.listNew(20);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    const id = ids[ids.length - 1];
    const e = await c.fetch(id);
    expect(e).toMatchObject({ subject: `Referral r1-${stamp}`, fromEmail: 'lena@council.test', threadKey: `<r1-${stamp}@council.test>` });
    expect(e.attachments[0]).toMatchObject({ fileName: 'plan.pdf', mimeType: 'application/pdf' });
    for (const x of ids) await c.markRead(x);
    expect(await c.listNew(20)).toEqual([]);
    const flagged = (await folderMessages('Referrals')).find((m) => m.source.toString().includes(`r1-${stamp}`));
    expect(flagged?.flags).toContain(IMAP_PROCESSED_KEYWORD);
    await c.close();
  });

  it('a referrer’s answer to our reply joins the same conversation', async () => {
    const c = mailbox();
    await c.appendTest(referral(`r2-${stamp}`, [`In-Reply-To: <ours@careflow.test>`, `References: <r1-${stamp}@council.test> <ours@careflow.test>`]));
    const [id] = await c.listNew(20);
    expect((await c.fetch(id)).threadKey).toBe(`<r1-${stamp}@council.test>`);
    await c.markRead(id);
    await c.close();
  });

  it('sends a reply over SMTP: Bcc only in the envelope, quote attached, copy in Sent', async () => {
    const c = mailbox();
    const before = (await folderMessages('Sent')).length;
    const id = await c.send(reply('referrals@careflow.test'));
    expect(id).toBeTruthy();
    const sent = await folderMessages('Sent');
    expect(sent.length).toBe(before + 1);
    const copy = await simpleParser(sent[sent.length - 1].source);
    expect(copy.subject).toBe('Re: Referral');
    expect(copy.inReplyTo).toBe('<root@council.test>');
    expect(copy.attachments.map((a) => a.filename)).toEqual(['quote.pdf']);
    // Test mode sends to the mailbox itself: it arrives in the Inbox without a Bcc line.
    const inbox = await folderMessages('INBOX');
    const delivered = inbox.map((m) => m.source.toString()).find((s) => s.includes(String(copy.messageId)));
    expect(delivered).toBeDefined();
    expect(delivered).not.toMatch(/^Bcc:/im);
    await c.close();
  });

  it('sends through a relay (ZeptoMail / Brevo SMTP stand-in) with its own sender address', async () => {
    const sent = await sendReplyOverSmtp(
      { host: '127.0.0.1', port: 3026, secure: false, username: 'relayuser', password: 'relaypass', fromAddress: 'noreply@relay.test' },
      reply('someone@council.test'),
    );
    expect(sent.raw).toMatch(/^From: "Referrals" <noreply@relay\.test>/m);
    expect(sent.raw).toMatch(/^Reply-To: referrals@careflow\.test/m);
    await expect(
      sendReplyOverSmtp({ host: '127.0.0.1', port: 3026, secure: false, username: 'relayuser', password: 'nope' }, reply('a@b.test')),
    ).rejects.toThrow('did not accept the username or password');
  });
});
