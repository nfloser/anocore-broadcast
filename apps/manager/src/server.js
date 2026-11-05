import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../static/index.html', import.meta.url));
const script = readFileSync(new URL('../static/manager.js', import.meta.url));
const css = readFileSync(new URL('../static/manager.css', import.meta.url));
const MAX_BODY_BYTES = 8192;
const HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
};

function matchesToken(header, token) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function createManagerServer({ settings, token, host = '127.0.0.1', port = 3010 } = {}) {
  if (host !== '127.0.0.1' && host !== '::1') throw new TypeError('Only loopback binding is permitted');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid port');
  if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') < 32) {
    throw new TypeError('Strong operator token of at least 32 bytes required');
  }
  if (!settings || typeof settings.get !== 'function' || typeof settings.update !== 'function') {
    throw new TypeError('Missing settings controller');
  }

  const server = createServer(async (req, res) => {
    const reply = (status, type, data) => {
      res.writeHead(status, { ...HEADERS, 'content-type': type });
      res.end(data);
    };
    const json = (status, value) => reply(status, 'application/json; charset=utf-8', JSON.stringify(value));
    if (req.url === '/api/config') {
      if (!matchesToken(req.headers.authorization, token)) {
        json(401, { error: 'Unauthorized' });
        return;
      }
      if (req.method === 'GET') {
        json(200, settings.get());
        return;
      }
      if (req.method !== 'POST') {
        json(405, { error: 'Method not allowed' });
        return;
      }
      const hostHeader = req.headers.host;
      const origin = req.headers.origin;
      if (hostHeader !== '127.0.0.1:' + server.address().port &&
          hostHeader !== '[::1]:' + server.address().port) {
        json(403, { error: 'Invalid host' });
        return;
      }
      if (origin !== 'http://' + hostHeader) {
        json(403, { error: 'Invalid origin' });
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
        json(415, { error: 'Expected application/json' });
        return;
      }
      if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
        json(413, { error: 'Request too large' });
        req.resume();
        return;
      }
      let size = 0;
      const chunks = [];
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            json(413, { error: 'Request too large' });
            return;
          }
          chunks.push(chunk);
        }
        json(200, settings.update(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      } catch (error) {
        if (!res.writableEnded) json(400, { error: 'Invalid configuration JSON' });
      }
      return;
    }
    if (req.method !== 'GET') {
      reply(405, 'text/plain; charset=utf-8', 'Method not allowed');
      return;
    }
    const staticFiles = {
      '/': ['text/html; charset=utf-8', index],
      '/manager.js': ['text/javascript; charset=utf-8', script],
      '/manager.css': ['text/css; charset=utf-8', css],
    };
    const file = staticFiles[req.url];
    if (!file) {
      reply(404, 'text/plain; charset=utf-8', 'Not found');
      return;
    }
    reply(200, file[0], file[1]);
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
