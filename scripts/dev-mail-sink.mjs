/**
 * Local test mail server (development only).
 *
 *   node scripts/dev-mail-sink.mjs            (SMTP on localhost:1025, inbox on http://localhost:1080)
 *
 * Accepts every email the API sends over SMTP and keeps it in tmp/dev-mail/*.eml. Nothing is
 * delivered to real inboxes. Point the API at it with MAIL_MODE=smtp, SMTP_HOST=localhost,
 * SMTP_PORT=1025, SMTP_SECURE=false and no SMTP_USER / SMTP_PASS.
 * Only listens on 127.0.0.1 and uses Node built-ins (no packages, no network access).
 */
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tmp', 'dev-mail');
const smtpPort = Number(process.env.DEV_MAIL_SMTP_PORT ?? 1025);
const httpPort = Number(process.env.DEV_MAIL_HTTP_PORT ?? 1080);
mkdirSync(outDir, { recursive: true });

const smtp = createServer((socket) => {
  let buffer = '';
  let inData = false;
  let from = '';
  let to = [];
  const reply = (line) => socket.write(`${line}\r\n`);
  reply('220 localhost CareFlow test mail ready');

  socket.on('data', (chunk) => {
    buffer += chunk.toString('binary');
    for (;;) {
      if (inData) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end < 0) return;
        const message = buffer.slice(0, end).replace(/^\.\./gm, '.');
        buffer = buffer.slice(end + 5);
        inData = false;
        const file = join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.eml`);
        writeFileSync(file, Buffer.from(message, 'binary'));
        console.log(`[dev-mail] ${from} -> ${to.join(', ')}  saved ${file}`);
        reply('250 OK: message saved');
        from = '';
        to = [];
        continue;
      }
      const eol = buffer.indexOf('\r\n');
      if (eol < 0) return;
      const line = buffer.slice(0, eol);
      buffer = buffer.slice(eol + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') {
        reply('250-localhost');
        reply('250-SIZE 52428800');
        reply('250 8BITMIME');
      } else if (cmd === 'HELO') reply('250 localhost');
      else if (cmd === 'MAIL') {
        from = line.replace(/^MAIL FROM:\s*/i, '');
        reply('250 OK');
      } else if (cmd === 'RCPT') {
        to.push(line.replace(/^RCPT TO:\s*/i, ''));
        reply('250 OK');
      } else if (cmd === 'DATA') {
        inData = true;
        reply('354 End data with <CR><LF>.<CR><LF>');
      } else if (cmd === 'QUIT') {
        reply('221 Bye');
        socket.end();
        return;
      } else if (cmd === 'RSET' || cmd === 'NOOP') reply('250 OK');
      else reply('502 Command not implemented');
    }
  });
  socket.on('error', () => {});
});

/** A tiny inbox: list of saved emails, each downloadable as .eml (opens in Outlook / Mail). */
const http = createHttpServer((req, res) => {
  const files = readdirSync(outDir).filter((f) => f.endsWith('.eml')).sort().reverse();
  const name = decodeURIComponent((req.url ?? '/').slice(1));
  if (name && files.includes(name)) {
    res.writeHead(200, { 'Content-Type': 'message/rfc822', 'Content-Disposition': `attachment; filename="${name}"` });
    res.end(readFileSync(join(outDir, name)));
    return;
  }
  const header = (raw, key) => new RegExp(`^${key}:\\s*(.*)$`, 'mi').exec(raw)?.[1]?.trim() ?? '';
  const rows = files
    .map((f) => {
      const raw = readFileSync(join(outDir, f), 'latin1').slice(0, 4000);
      const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
      return `<tr><td>${esc(header(raw, 'Date'))}</td><td>${esc(header(raw, 'To'))}</td><td>${esc(header(raw, 'Subject'))}</td><td><a href="/${encodeURIComponent(f)}">Download .eml</a></td></tr>`;
    })
    .join('');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>CareFlow test mail</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#0f172a}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left;font-size:14px}</style>
<h1>CareFlow test mail</h1><p>${files.length} email(s) caught. Nothing here was delivered to real inboxes. Folder: ${outDir}</p>
<table><tr><th>Date</th><th>To</th><th>Subject</th><th></th></tr>${rows}</table>`);
});

smtp.listen(smtpPort, '127.0.0.1', () => console.log(`[dev-mail] SMTP listening on localhost:${smtpPort}`));
http.listen(httpPort, '127.0.0.1', () => console.log(`[dev-mail] inbox on http://localhost:${httpPort}`));
