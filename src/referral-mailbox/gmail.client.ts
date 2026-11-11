/**
 * Minimal Gmail REST client for the referrals mailbox (testing with a personal Gmail).
 * Uses plain fetch against Google's OAuth and Gmail endpoints; no extra SDK.
 *
 * Settings (API .env): GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Read the mailbox, add/remove labels, send replies. Nothing broader. */
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

export type GmailOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function gmailOAuthConfig(): GmailOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function gmailAuthUrl(cfg: GmailOAuthConfig, state: string): string {
  const qs = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${qs}`;
}

export class GmailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

/** Exchange the sign-in code for tokens. The refresh token is what CareFlow keeps. */
export async function gmailExchangeCode(cfg: GmailOAuthConfig, code: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new GmailError(`Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`, res.status);
  return { accessToken: body.access_token as string, refreshToken: (body.refresh_token as string | undefined) ?? null };
}

export async function gmailRefreshAccessToken(cfg: GmailOAuthConfig, refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new GmailError(
      body.error === 'invalid_grant'
        ? 'Gmail access has expired or was removed. Connect the mailbox again.'
        : `Could not refresh Gmail access: ${body.error_description ?? body.error ?? res.status}`,
      res.status,
    );
  }
  return body.access_token as string;
}

/** A Gmail API session for one mailbox, holding a short-lived access token. */
export class GmailSession {
  constructor(private readonly accessToken: string) {}

  private async call(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(`${GMAIL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = await readJson(res);
    if (!res.ok) throw new GmailError(`Gmail ${path.split('?')[0]}: ${body.error?.message ?? res.status}`, res.status);
    return body;
  }

  async profileEmail(): Promise<string> {
    const p = await this.call('/profile');
    return p.emailAddress as string;
  }

  async labels(): Promise<Array<{ id: string; name: string; type?: 'system' | 'user' }>> {
    const r = await this.call('/labels');
    return (r.labels ?? []) as Array<{ id: string; name: string; type?: 'system' | 'user' }>;
  }

  /** The label's id, creating the label when it does not exist yet. */
  async ensureLabel(name: string): Promise<string> {
    const found = (await this.labels()).find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const created = await this.call('/labels', {
      method: 'POST',
      body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    });
    return created.id as string;
  }

  async listMessageIds(query: string, max = 20): Promise<string[]> {
    const r = await this.call(`/messages?${new URLSearchParams({ q: query, maxResults: String(max) })}`);
    return ((r.messages ?? []) as Array<{ id: string }>).map((m) => m.id);
  }

  async getMessage(id: string): Promise<GmailMessage> {
    return (await this.call(`/messages/${encodeURIComponent(id)}?format=full`)) as GmailMessage;
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const r = await this.call(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    return Buffer.from(String(r.data ?? ''), 'base64url');
  }

  /** Message-ID and References of a message, to reply in its thread. */
  async threadHeaders(
    messageId: string,
  ): Promise<{ messageIdHeader: string | null; references: string | null; replyTo: string | null }> {
    const m = await this.call(
      `/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Reply-To`,
    );
    const h = (name: string) =>
      ((m.payload?.headers ?? []) as Array<{ name: string; value: string }>).find((x) => x.name.toLowerCase() === name.toLowerCase())
        ?.value ?? null;
    return { messageIdHeader: h('Message-ID'), references: h('References'), replyTo: h('Reply-To') };
  }

  /** Send an email (base64url RFC 822) in a thread. */
  async sendMessage(raw: string, threadId?: string | null): Promise<string> {
    const r = await this.call('/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
    });
    return r.id as string;
  }

  /** Put a message straight into the mailbox without sending it (used for made-up test referrals). */
  async insertMessage(raw: string, labelIds: string[]): Promise<string> {
    const r = await this.call('/messages?internalDateSource=dateHeader', {
      method: 'POST',
      body: JSON.stringify({ raw, labelIds }),
    });
    return r.id as string;
  }

  async addLabel(messageId: string, labelId: string): Promise<void> {
    await this.call(`/messages/${encodeURIComponent(messageId)}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds: [labelId] }),
    });
  }
}

export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailPart;
};
