import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../static/index.html', import.meta.url));
const stylesheet = readFileSync(new URL('../static/overlay.css', import.meta.url));
const script = readFileSync(new URL('../static/overlay.js', import.meta.url));

const securityHeaders = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
};

export function createOverlayServer({ scoreboard, host = '127.0.0.1', port = 3009 } = {}) {
  if (typeof scoreboard !== 'function') throw new TypeError('Missing scoreboard reader');
  if (host !== '127.0.0.1' && host !== '::1') throw new TypeError('Only loopback binding is permitted');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid port');

  const server = createServer((request, response) => {
    const respond = (status, type, body) => {
      response.writeHead(status, { ...securityHeaders, 'content-type': type });
      response.end(body);
    };
    if (request.method !== 'GET') {
      respond(405, 'text/plain; charset=utf-8', 'Method not allowed');
      return;
    }
    if (request.url === '/api/state') {
      try {
        const state = scoreboard();
        respond(200, 'application/json; charset=utf-8', JSON.stringify(state));
      } catch {
        respond(503, 'application/json; charset=utf-8', JSON.stringify({ status: 'unavailable' }));
      }
      return;
    }
    const staticFiles = {
      '/': ['text/html; charset=utf-8', page],
      '/overlay.css': ['text/css; charset=utf-8', stylesheet],
      '/overlay.js': ['text/javascript; charset=utf-8', script],
    };
    const file = staticFiles[request.url];
    if (!file) {
      respond(404, 'text/plain; charset=utf-8', 'Not found');
      return;
    }
    respond(200, file[0], file[1]);
  });
  return {
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        resolve(server.address());
      });
    }),
    close: () => !server.listening ? Promise.resolve() :
      new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
