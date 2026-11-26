import type { FastifyPluginAsync } from 'fastify';

import { getBootstrapSetupState, type BootstrapStatePorts } from '../bootstrap/bootstrap-state.js';

export type SetupPageRoutesOptions = BootstrapStatePorts;

export const SETUP_COMPLETE_MESSAGE = 'Initial setup is complete. You can sign in now.';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] as string);
}

function layout(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:32rem;padding:0 1rem;line-height:1.5}
label{display:block;margin-top:1rem;font-weight:600}
input{display:block;width:100%;box-sizing:border-box;padding:.5rem;margin-top:.25rem}
button{margin-top:1.25rem;padding:.6rem 1rem}
.error{color:#8b0000}
</style>
</head>
<body>
${content}
</body>
</html>`;
}

export function setupFormHtml(error?: string): string {
  const message = error
    ? `<p class="error" role="alert">${escapeHtml(error)}</p>`
    : '<p id="setup-help">Create the first Platform Owner for this installation.</p>';
  return layout('Initial setup', `<h1>Initial setup</h1>
${message}
<form method="post" action="/setup" aria-describedby="setup-help">
<label for="setupToken">Bootstrap token</label>
<input id="setupToken" name="setupToken" type="password" autocomplete="off" required autofocus>
<label for="identifierType">Identifier type</label>
<select id="identifierType" name="identifierType" required>
<option value="email">Email</option>
<option value="username">Username</option>
</select>
<label for="identifierValue">Identifier</label>
<input id="identifierValue" name="identifierValue" type="text" autocomplete="username" required>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="new-password" minlength="12" required>
<button type="submit">Complete setup</button>
</form>`);
}

export function setupCompleteHtml(): string {
  return layout('Setup complete', `<h1>Setup complete</h1><p>${escapeHtml(SETUP_COMPLETE_MESSAGE)}</p>`);
}

export function setupUnavailableHtml(): string {
  return layout('Setup unavailable', '<h1>Setup unavailable</h1><p>Initial setup is no longer available.</p>');
}

export const setupPageRoutes: FastifyPluginAsync<SetupPageRoutesOptions> = async (
  fastify,
  options
) => {
  fastify.get('/setup', async (_request, reply) => {
    const state = await getBootstrapSetupState(options);
    return reply
      .header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(state.setupRequired ? setupFormHtml() : setupUnavailableHtml());
  });

  fastify.post('/setup', async (request, reply) => {
    const state = await getBootstrapSetupState(options);
    if (!state.setupRequired) {
      return reply
        .header('Cache-Control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(setupUnavailableHtml());
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const callback = `${request.protocol}://${request.hostname}/setup/claim`;
    const fields = {
      setupToken: String(body.setupToken ?? ''),
      identifierType: String(body.identifierType ?? 'email'),
      identifierValue: String(body.identifierValue ?? ''),
      password: String(body.password ?? ''),
    };
    return reply
      .header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=/setup">
<title>Submitting setup</title>
</head>
<body>
<form id="claim" method="post" action="${escapeHtml(callback)}" hidden>
<input type="hidden" name="setupToken" value="${escapeHtml(fields.setupToken)}">
<input type="hidden" name="identifierType" value="${escapeHtml(fields.identifierType)}">
<input type="hidden" name="identifierValue" value="${escapeHtml(fields.identifierValue)}">
<input type="hidden" name="password" value="${escapeHtml(fields.password)}">
</form>
<script>document.getElementById('claim').submit()</script>
<noscript><a href="/setup">Return to setup</a></noscript>
</body>
</html>`);
  });
};
