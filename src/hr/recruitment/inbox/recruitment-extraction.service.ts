import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { planAttachments, type ExtractionAttachment } from '../../../referral-mailbox/referral-extraction.service';
import type { ApplicationExtraction } from './recruitment-inbox.util';

/** Reading job applications and CVs: a lighter task than referrals, so Sonnet (cheaper than Opus). */
const MODEL = 'claude-sonnet-5-5';
/** Claude Sonnet 5.5 list price, $ per million tokens. */
const PRICE = { input: 2, output: 10 };
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const str = (description: string) => ({ type: 'string', description }) as const;
const yesNo = (description: string) => ({ type: 'string', enum: ['YES', 'NO', 'UNKNOWN'], description }) as const;
const obj = (properties: Record<string, unknown>) =>
  ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false }) as const;

const SCHEMA = obj({
  isApplication: { type: 'boolean', description: 'True when someone is applying for a job (or sending their CV to work here).' },
  summary: str('One short sentence for staff, e.g. "Applies for Care Worker, 3 years in domiciliary care, drives".'),
  firstName: str("The applicant's first name, or empty."),
  lastName: str("The applicant's last name, or empty."),
  email: str("The applicant's own email address (from the CV or signature, else the sender), or empty."),
  phone: str("The applicant's phone number, or empty."),
  address: str("The applicant's home address with postcode, or empty."),
  vacancyId: str('The id of the vacancy they apply for, chosen only from the list of open vacancies given; empty when unclear.'),
  vacancyReason: str('Why that vacancy was chosen (job title in the subject, reference quoted…), or why none could be chosen.'),
  rightToWork: yesNo('Do they say they have the right to work in the UK? UNKNOWN when not stated.'),
  drivesForWork: yesNo('Do they say they drive / have a licence and car for work? UNKNOWN when not stated.'),
  coverLetter: str("The applicant's message to us in their own words (the email body or a cover letter), trimmed of signatures; empty when none."),
  employmentHistory: {
    type: 'array',
    description: 'Every job from the CV, newest first. Gaps only when the CV itself explains a period without work (study, caring, travel).',
    items: obj({
      kind: { type: 'string', enum: ['JOB', 'GAP'] },
      from: str('Start month as YYYY-MM; empty when not given. Use the first month of a year when only the year is given.'),
      to: str('End month as YYYY-MM; empty when it is their current job or not given.'),
      ongoing: { type: 'boolean', description: 'True when this is their current job.' },
      employer: str('Employer name (JOB), or empty.'),
      jobTitle: str('Job title (JOB), or empty.'),
      reasonForLeaving: str('Reason for leaving when stated, or empty.'),
      careRole: { type: 'boolean', description: 'True when the job was care or support work with adults or children.' },
      explanation: str('For a GAP: what they were doing. Empty for a JOB.'),
    }),
  },
  cvFileName: str('File name of the attachment that is the CV, or empty when there is none.'),
  checkNotes: {
    type: 'array',
    items: { type: 'string' },
    description: 'Short notes staff should check: dates that are unclear or estimated, missing contact details, attachments that could not be read.',
  },
});

const SYSTEM = `You read emails sent to a UK home care provider's recruitment mailbox and record the applicant's details for the
hiring team. Record only what the email and attachments say; never guess a phone number, email, date or employer. When a date
is only partly given, record what is given and add a check note. Personal data is used only to process the job application.`;

@Injectable()
export class RecruitmentExtractionService {
  private readonly logger = new Logger(RecruitmentExtractionService.name);
  private client?: Anthropic;

  private getClient() {
    const apiKey = process.env.AI_API_KEY?.trim();
    if (!apiKey) throw new ServiceUnavailableException('AI is not set up. Add AI_API_KEY to the API .env file and restart the API.');
    this.client ??= new Anthropic({ apiKey });
    return this.client;
  }

  async extract(input: {
    subject: string | null;
    fromName: string | null;
    fromEmail: string | null;
    receivedAt: Date;
    bodyText: string;
    attachments: ExtractionAttachment[];
    vacancies: { id: string; reference: string; title: string; location: string | null }[];
  }): Promise<{ extraction: ApplicationExtraction; model: string; costUsd: number }> {
    const { send, notRead } = planAttachments(input.attachments);
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    const skipped = notRead.map((n) => `${n.fileName} (${n.reason})`);
    for (const a of send) {
      if (a.mimeType === 'application/pdf') {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: a.data.toString('base64') },
          title: a.fileName,
        });
      } else if (IMAGE_TYPES.includes(a.mimeType)) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: a.mimeType as 'image/png', data: a.data.toString('base64') },
        });
        content.push({ type: 'text', text: `(The image above is the attachment "${a.fileName}".)` });
      } else if (a.text?.trim()) {
        content.push({ type: 'text', text: `<attachment name="${a.fileName}">\n${a.text.slice(0, 200_000)}\n</attachment>` });
      } else {
        skipped.push(a.fileName);
      }
    }
    content.push({
      type: 'text',
      text: [
        '<open_vacancies>',
        ...(input.vacancies.length
          ? input.vacancies.map((v) => `id=${v.id} | ${v.reference} | ${v.title}${v.location ? ` | ${v.location}` : ''}`)
          : ['(none open)']),
        '</open_vacancies>',
        '',
        '<email>',
        `From: ${[input.fromName, input.fromEmail ? `<${input.fromEmail}>` : ''].filter(Boolean).join(' ') || 'unknown'}`,
        `Received: ${input.receivedAt.toISOString()}`,
        `Subject: ${input.subject ?? ''}`,
        '',
        input.bodyText || '(no text in the email body)',
        '</email>',
        skipped.length ? `\nAttachments that could not be read (add a check note): ${skipped.join(', ')}` : '',
        '',
        "Record the applicant's details.",
      ].join('\n'),
    });

    const message = await this.getClient()
      .beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: betaJSONSchemaOutputFormat(SCHEMA as Parameters<typeof betaJSONSchemaOutputFormat>[0]) },
        system: SYSTEM,
        messages: [{ role: 'user', content }],
      })
      .finalMessage();

    if (message.stop_reason === 'refusal') throw new Error('The AI declined to read this email.');
    if (message.stop_reason === 'max_tokens') throw new Error('The AI ran out of room reading this email.');
    const parsed = message.parsed_output as ApplicationExtraction | null | undefined;
    if (!parsed) throw new Error('The AI returned an answer that could not be read.');

    const u = message.usage;
    const costUsd =
      (u.input_tokens * PRICE.input +
        (u.cache_creation_input_tokens ?? 0) * PRICE.input * 1.25 +
        (u.cache_read_input_tokens ?? 0) * PRICE.input * 0.1 +
        u.output_tokens * PRICE.output) /
      1_000_000;
    this.logger.log(`Application read: ${message.model} ${u.input_tokens} in / ${u.output_tokens} out ≈ $${costUsd.toFixed(4)}`);
    // Only an id from the list given counts (the model must not invent one).
    if (parsed.vacancyId && !input.vacancies.some((v) => v.id === parsed.vacancyId)) parsed.vacancyId = '';
    return { extraction: parsed, model: message.model, costUsd };
  }
}
