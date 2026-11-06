import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailClient, type EmailMessage } from '@azure/communication-email';
import { DefaultAzureCredential } from '@azure/identity';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

export type MailAttachment = {
  filename: string;
  content: string | Buffer;
  contentType?: string;
};

export type SendMailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
};

export type MailSendMode = 'acs' | 'api' | 'smtp' | 'log';

type ParsedFrom = { address: string; name?: string };

function parseFromHeader(from: string): ParsedFrom {
  const trimmed = from.trim();
  const angled = trimmed.match(/^(.*)<([^>]+)>$/);
  if (angled) {
    const name = angled[1].trim().replace(/^["']|["']$/g, '');
    const address = angled[2].trim();
    return name ? { address, name } : { address };
  }
  return { address: trimmed };
}

function normalizeApiAuthHeader(token: string): string {
  const t = token.trim();
  if (/^zoho-enczapikey\s+/i.test(t)) return t;
  return `Zoho-enczapikey ${t}`;
}

function toBase64(content: string | Buffer): string {
  if (Buffer.isBuffer(content)) return content.toString('base64');
  return Buffer.from(content, 'utf8').toString('base64');
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private acsClient: EmailClient | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const mode = this.config.get<MailSendMode>('mail.mode', 'log');
    if (mode === 'log') return true;
    if (mode === 'acs') return Boolean(this.config.get<string>('mail.acsEndpoint'));
    if (mode === 'api') return Boolean(this.config.get<string>('mail.apiToken'));
    return Boolean(this.config.get<string>('mail.host'));
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const host = this.config.get<string>('mail.host', '');
    if (!host) {
      throw new ServiceUnavailableException(
        'Email is not configured. Set MAIL_MODE=api with MAIL_API_TOKEN, or SMTP_HOST, or MAIL_MODE=log.',
      );
    }
    const options: SMTPTransport.Options = {
      host,
      port: this.config.get<number>('mail.port', 587),
      secure: this.config.get<boolean>('mail.secure', false),
    };
    const user = this.config.get<string | undefined>('mail.user');
    const pass = this.config.get<string | undefined>('mail.pass');
    if (user && pass) {
      options.auth = { user, pass };
    }
    this.transporter = nodemailer.createTransport(options);
    return this.transporter;
  }

  private async sendViaApi(input: SendMailInput): Promise<{ messageId: string }> {
    const apiUrl = this.config.get<string>(
      'mail.apiUrl',
      'https://api.zeptomail.com/v1.1/email',
    );
    const token = this.config.get<string>('mail.apiToken', '');
    if (!token) {
      throw new ServiceUnavailableException(
        'Email API is not configured. Set MAIL_API_TOKEN (ZeptoMail Send Mail Token).',
      );
    }

    const from = parseFromHeader(this.requireFrom());
    const recipients = (Array.isArray(input.to) ? input.to : [input.to])
      .map((addr) => addr.trim())
      .filter(Boolean);

    const body: Record<string, unknown> = {
      from: from.name ? { address: from.address, name: from.name } : { address: from.address },
      to: recipients.map((address) => ({
        email_address: { address },
      })),
      subject: input.subject,
      htmlbody: input.html ?? `<pre>${escapeHtml(input.text)}</pre>`,
      textbody: input.text,
    };

    if (input.attachments?.length) {
      body.attachments = input.attachments.map((a) => ({
        name: a.filename,
        content: toBase64(a.content),
        mime_type: a.contentType ?? 'application/octet-stream',
      }));
    }

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: normalizeApiAuthHeader(token),
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const errObj =
        parsed && typeof parsed.error === 'object' && parsed.error
          ? (parsed.error as Record<string, unknown>)
          : null;
      const message =
        (typeof errObj?.message === 'string' && errObj.message) ||
        (typeof parsed?.message === 'string' && parsed.message) ||
        raw.slice(0, 300) ||
        `ZeptoMail API error HTTP ${res.status}`;
      this.logger.warn(`ZeptoMail API send failed (${res.status}): ${message}`);
      throw new ServiceUnavailableException(message);
    }

    const data =
      parsed && typeof parsed.data === 'object' && parsed.data
        ? (parsed.data as Record<string, unknown>)
        : parsed;
    const messageId =
      (data && typeof data === 'object' && typeof (data as { request_id?: unknown }).request_id === 'string'
        ? (data as { request_id: string }).request_id
        : null) ||
      (typeof parsed?.request_id === 'string' ? parsed.request_id : null) ||
      `zepto-${Date.now()}`;

    return { messageId };
  }

  /**
   * Azure Communication Services Email via Microsoft Entra ID (DefaultAzureCredential):
   * managed identity on Azure (AZURE_CLIENT_ID selects the user-assigned one), `az login`
   * on a developer machine. The sender must be a MailFrom address on a domain linked to
   * the ACS resource; ACS ignores a display name in MAIL_FROM.
   */
  private async sendViaAcs(input: SendMailInput): Promise<{ messageId: string }> {
    const endpoint = this.config.get<string>('mail.acsEndpoint', '');
    if (!endpoint) {
      throw new ServiceUnavailableException(
        'Azure email is not configured. Set ACS_ENDPOINT (e.g. https://<name>.uk.communication.azure.com).',
      );
    }
    this.acsClient ??= new EmailClient(endpoint, new DefaultAzureCredential());

    const from = parseFromHeader(this.requireFrom());
    const recipients = (Array.isArray(input.to) ? input.to : [input.to])
      .map((address) => address.trim())
      .filter(Boolean);

    const message: EmailMessage = {
      senderAddress: from.address,
      content: {
        subject: input.subject,
        plainText: input.text,
        html: input.html ?? `<pre>${escapeHtml(input.text)}</pre>`,
      },
      recipients: { to: recipients.map((address) => ({ address })) },
      attachments: input.attachments?.map((a) => ({
        name: a.filename,
        contentType: a.contentType ?? 'application/octet-stream',
        contentInBase64: toBase64(a.content),
      })),
    };

    const poller = await this.acsClient.beginSend(message);
    const result = await poller.pollUntilDone();
    if (result.status !== 'Succeeded') {
      const reason = result.error?.message ?? result.status;
      this.logger.warn(`Azure email send ${result.id} did not succeed: ${reason}`);
      throw new ServiceUnavailableException(`Email could not be sent (${reason})`);
    }
    return { messageId: result.id };
  }

  /** Sender from MAIL_FROM only — never a hard-coded address. */
  private requireFrom(): string {
    const from = (this.config.get<string>('mail.from') ?? '').trim();
    if (!from) {
      throw new ServiceUnavailableException(
        'Email sender is not configured. Set MAIL_FROM (e.g. "Allfor Care <noreply@allforcare.co.uk>").',
      );
    }
    return from;
  }

  async send(
    input: SendMailInput,
  ): Promise<{ messageId: string; mode: MailSendMode }> {
    const mode = this.config.get<MailSendMode>('mail.mode', 'log');
    const redirectTo = this.config.get<string | undefined>('mail.redirectTo');
    if (redirectTo) {
      const original = (Array.isArray(input.to) ? input.to : [input.to]).join(', ');
      // MAIL_REDIRECT_TO may list several inboxes, comma-separated.
      const redirectList = redirectTo.split(',').map((a) => a.trim()).filter(Boolean);
      input = { ...input, to: redirectList, subject: `[to: ${original}] ${input.subject}` };
    }
    const toList = Array.isArray(input.to) ? input.to : [input.to];
    const to = toList.join(', ');

    if (mode === 'log') {
      this.logger.log(
        `[MAIL log] to=${to} subject=${input.subject} attachments=${input.attachments?.length ?? 0}`,
      );
      if (input.text) this.logger.debug(input.text.slice(0, 500));
      return { messageId: `log-${Date.now()}`, mode: 'log' };
    }

    if (mode === 'acs') {
      const result = await this.sendViaAcs(input);
      return { messageId: result.messageId, mode: 'acs' };
    }

    if (mode === 'api') {
      const result = await this.sendViaApi(input);
      return { messageId: result.messageId, mode: 'api' };
    }

    const info = await this.getTransporter().sendMail({
      from: this.requireFrom(),
      to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    return { messageId: String(info.messageId ?? ''), mode: 'smtp' };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
