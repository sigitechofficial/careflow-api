/**
 * Microsoft 365 / Outlook.com mailboxes through Microsoft Graph (Microsoft sign-in, no password stored).
 * Also GoDaddy's "Microsoft 365" email. Plain fetch; no SDK.
 *
 * Settings (API .env): MICROSOFT_OAUTH_CLIENT_ID, MICROSOFT_OAUTH_CLIENT_SECRET, MICROSOFT_OAUTH_REDIRECT_URI,
 * optional MICROSOFT_OAUTH_TENANT ("common" by default: work, school and personal accounts).
 */
import type { ReplyMime } from '../referral-reply-mime.util';
import { MailboxError, PROCESSED_MARK, parseRawEmail, type FetchedEmail, type MailboxConnector, type ReplyContext } from './connector.types';

const GRAPH = 'https://graph.microsoft.com/v1.0/me';
export const MICROSOFT_SCOPES = ['offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send'];
/** Category CareFlow puts on emails it has saved (shown in Outlook). */
export const MICROSOFT_CATEGORY = PROCESSED_MARK.replace('-', ' ');

export type MicrosoftOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string; tenant: string };

export function microsoftOAuthConfig(): MicrosoftOAuthConfig | null {
  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.MICROSOFT_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri, tenant: process.env.MICROSOFT_OAUTH_TENANT?.trim() || 'common' };
}

const tokenUrl = (cfg: MicrosoftOAuthConfig) => `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`;

export function microsoftAuthUrl(cfg: MicrosoftOAuthConfig, state: string): string {
  const qs = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: MICROSOFT_SCOPES.join(' '),
    prompt: 'select_account',
    state,
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/authorize?${qs}`;
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function token(cfg: MicrosoftOAuthConfig, params: Record<string, string>) {
  const res = await fetch(tokenUrl(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: MICROSOFT_SCOPES.join(' '), ...params }),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new MailboxError(
      body.error === 'invalid_grant'
        ? 'Microsoft access has expired or was removed. Connect the mailbox again.'
        : `Microsoft sign-in failed: ${body.error_description?.split('\r\n')[0] ?? body.error ?? res.status}`,
    );
  }
  return { accessToken: body.access_token as string, refreshToken: (body.refresh_token as string | undefined) ?? null };
}

export const microsoftExchangeCode = (cfg: MicrosoftOAuthConfig, code: string) =>
  token(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri });

/** A new access token; Microsoft may also hand back a new refresh token, which replaces the old one. */
export const microsoftRefresh = (cfg: MicrosoftOAuthConfig, refreshToken: string) =>
  token(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken });

/** Graph calls for one signed-in mailbox. */
export class GraphSession {
  constructor(private readonly accessToken: string) {}

  async call(path: string, init?: RequestInit & { raw?: boolean }): Promise<any> {
    const url = path.startsWith('https://') ? path : `${GRAPH}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (init?.raw && res.ok) return Buffer.from(await res.arrayBuffer());
    const body = res.status === 202 || res.status === 204 ? {} : await readJson(res);
    if (!res.ok) throw new MailboxError(`Microsoft ${path.split('?')[0]}: ${body.error?.message ?? res.status}`);
    return body;
  }

  async me(): Promise<{ email: string; name: string | null }> {
    const r = await this.call('/?$select=mail,userPrincipalName,displayName');
    return { email: String(r.mail || r.userPrincipalName || '').toLowerCase(), name: r.displayName ?? null };
  }
}

type MicrosoftMailbox = { folder: string; refreshToken: string; since: Date; onNewRefreshToken?: (t: string) => Promise<void> };

const odata = (s: string) => s.replace(/'/g, "''");

export class MicrosoftConnector implements MailboxConnector {
  private session: GraphSession | null = null;
  private folderId: string | null = null;

  constructor(private readonly mb: MicrosoftMailbox) {}

  private async s(): Promise<GraphSession> {
    if (this.session) return this.session;
    const cfg = microsoftOAuthConfig();
    if (!cfg) throw new MailboxError('Microsoft 365 is not set up on the server (MICROSOFT_OAUTH_* settings).');
    const t = await microsoftRefresh(cfg, this.mb.refreshToken);
    if (t.refreshToken && t.refreshToken !== this.mb.refreshToken) await this.mb.onNewRefreshToken?.(t.refreshToken);
    this.session = new GraphSession(t.accessToken);
    return this.session;
  }

  /** The folder to read, by name: the Inbox itself, a top-level folder, or a folder inside the Inbox. */
  async folder(): Promise<string> {
    if (this.folderId) return this.folderId;
    const s = await this.s();
    const name = this.mb.folder.trim();
    if (/^inbox$/i.test(name)) return (this.folderId = 'inbox');
    const filter = `$filter=${encodeURIComponent(`displayName eq '${odata(name)}'`)}&$select=id`;
    const top = await s.call(`/mailFolders?${filter}`);
    const inInbox = top.value?.[0] ? null : await s.call(`/mailFolders/inbox/childFolders?${filter}`);
    const id = top.value?.[0]?.id ?? inInbox?.value?.[0]?.id;
    if (!id) throw new MailboxError(`The folder "${name}" was not found in this mailbox. Create it in Outlook (or choose Inbox).`);
    return (this.folderId = id as string);
  }

  async listNew(max: number) {
    const s = await this.s();
    const filter = `receivedDateTime ge ${this.mb.since.toISOString()} and not(categories/any(c:c eq '${odata(MICROSOFT_CATEGORY)}'))`;
    const r = await s.call(
      `/mailFolders/${encodeURIComponent(await this.folder())}/messages?$filter=${encodeURIComponent(filter)}&$select=id,receivedDateTime&$top=${max}`,
    );
    return ((r.value ?? []) as Array<{ id: string; receivedDateTime: string }>)
      .sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime))
      .map((m) => m.id);
  }

  async fetch(id: string): Promise<FetchedEmail> {
    const s = await this.s();
    const meta = await s.call(`/messages/${encodeURIComponent(id)}?$select=conversationId,receivedDateTime`);
    const raw = (await s.call(`/messages/${encodeURIComponent(id)}/$value`, { raw: true })) as Buffer;
    const email = await parseRawEmail(raw, id, meta.conversationId ?? null);
    if (meta.receivedDateTime) email.receivedAt = new Date(meta.receivedDateTime);
    return email;
  }

  async markRead(id: string) {
    const s = await this.s();
    const m = await s.call(`/messages/${encodeURIComponent(id)}?$select=categories`);
    const categories = [...new Set([...((m.categories as string[]) ?? []), MICROSOFT_CATEGORY])];
    await s.call(`/messages/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ categories }) });
  }

  /**
   * Reply in Outlook's conversation: create a reply draft to the email, set our text, recipients and the quote
   * PDF, then send it. Outlook keeps it in Sent Items. The sender is always the signed-in mailbox.
   */
  async send(reply: ReplyMime, ctx: ReplyContext) {
    const s = await this.s();
    const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address: address.replace(/^.*<([^>]+)>.*$/, '$1') } }));
    const draft = await s.call(`/messages/${encodeURIComponent(ctx.providerMessageId)}/createReply`, { method: 'POST', body: '{}' });
    const htmlDoc = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${reply.html}</body></html>`;
    await s.call(`/messages/${encodeURIComponent(draft.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        subject: reply.subject,
        body: { contentType: 'HTML', content: htmlDoc },
        toRecipients: recipients([reply.to]),
        ccRecipients: recipients(reply.cc),
        bccRecipients: recipients(reply.bcc),
      }),
    });
    for (const a of reply.attachments) {
      await s.call(`/messages/${encodeURIComponent(draft.id)}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.filename,
          contentType: a.contentType,
          contentBytes: a.content.toString('base64'),
        }),
      });
    }
    await s.call(`/messages/${encodeURIComponent(draft.id)}/send`, { method: 'POST', body: '{}' });
    return draft.id as string;
  }

  async test() {
    await (await this.s()).me();
    await this.folder();
  }

  async createFolder(name: string) {
    await (await this.s()).call('/mailFolders', { method: 'POST', body: JSON.stringify({ displayName: name }) });
  }

  /** Inbox, the top-level folders and the folders inside the Inbox (Sent, Drafts, Junk and Deleted left out). */
  async listFolders() {
    const s = await this.s();
    const top = await s.call('/mailFolders?$top=100&$select=displayName');
    const inInbox = await s.call('/mailFolders/inbox/childFolders?$top=100&$select=displayName').catch(() => ({ value: [] }));
    const skip = /^(sent items|drafts|junk email|deleted items|outbox|conversation history|archive|inbox)$/i;
    const names = [...(top.value ?? []), ...(inInbox.value ?? [])]
      .map((f: { displayName?: string }) => f.displayName?.trim() ?? '')
      .filter((n: string) => n && !skip.test(n));
    return [{ name: 'Inbox', hint: 'Every email that arrives' }, ...[...new Set<string>(names)].sort().map((name) => ({ name }))];
  }

  async close() {}
}
