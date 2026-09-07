import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const mode = this.config.get<'smtp' | 'log'>('mail.mode', 'log');
    if (mode === 'log') return true;
    return Boolean(this.config.get<string>('mail.host'));
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const host = this.config.get<string>('mail.host', '');
    if (!host) {
      throw new ServiceUnavailableException(
        'Email is not configured. Set SMTP_HOST (and SMTP_USER / SMTP_PASS) or MAIL_MODE=log for local testing.',
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

  async send(input: SendMailInput): Promise<{ messageId: string; mode: 'smtp' | 'log' }> {
    const mode = this.config.get<'smtp' | 'log'>('mail.mode', 'log');
    const from = this.config.get<string>('mail.from', 'CareAdmin <noreply@careadmin.local>');
    const to = Array.isArray(input.to) ? input.to.join(', ') : input.to;

    if (mode === 'log') {
      this.logger.log(
        `[MAIL log] to=${to} subject=${input.subject} attachments=${input.attachments?.length ?? 0}`,
      );
      if (input.text) this.logger.debug(input.text.slice(0, 500));
      return { messageId: `log-${Date.now()}`, mode: 'log' };
    }

    const info = await this.getTransporter().sendMail({
      from,
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
