// Appwrite Function entry point — Europe (Frankfurt)
// Mirrors the behaviour of src/index.ts without Hono or @hono/node-server.
// Deploy via: appwrite deploy function (run from deploy/appwrite/)

import { createConnection } from 'node:net';

const tokens = (process.env.AGENT_TOKENS ?? '')
  .split(',')
  .map(t => t.trim())
  .filter(Boolean);

function authenticate(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return false;
  return tokens.includes(authHeader.slice(7));
}

async function checkHttp(url, timeout) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    const responseTime = Date.now() - start;
    return {
      status: res.status < 400 ? 'up' : 'down',
      responseTime,
      statusCode: res.status,
      message: `${res.status} ${res.statusText}`,
    };
  } catch (err) {
    return {
      status: 'down',
      responseTime: Date.now() - start,
      message: err?.message ?? 'Request failed',
    };
  }
}

function checkTcp(address, timeout) {
  const cleaned = address.replace(/^tcp:\/\//, '');
  const lastColon = cleaned.lastIndexOf(':');
  const host = cleaned.slice(0, lastColon);
  const port = parseInt(cleaned.slice(lastColon + 1), 10);
  const start = Date.now();

  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    socket.setTimeout(timeout);

    socket.once('connect', () => {
      socket.destroy();
      resolve({ status: 'up', responseTime: Date.now() - start, message: 'Connection successful' });
    });

    socket.once('error', err => {
      socket.destroy();
      resolve({ status: 'down', responseTime: Date.now() - start, message: err.message });
    });

    socket.once('timeout', () => {
      socket.destroy();
      resolve({ status: 'down', responseTime: Date.now() - start, message: 'Connection timed out' });
    });
  });
}

export default async ({ req, res, log }) => {
  const region = process.env.AGENT_REGION ?? 'europe-frankfurt';

  // GET /  →  health probe
  if (req.method === 'GET') {
    return res.json({ ok: true, region, version: '1.0.0' });
  }

  // POST /  →  run a check
  if (req.method === 'POST') {
    const authHeader = req.headers['authorization'] ?? '';
    if (!authenticate(authHeader)) {
      return res.json({ error: 'Unauthorized' }, 401);
    }

    let body;
    try {
      body = JSON.parse(req.body ?? '{}');
    } catch {
      return res.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.type || !body.url) {
      return res.json({ error: 'Missing required fields: type, url' }, 400);
    }

    if (!['http', 'tcp'].includes(body.type)) {
      return res.json({ error: 'Invalid type, must be http or tcp' }, 400);
    }

    const timeout = body.timeout ?? 10000;
    log(`[CHECK] ${body.type} ${body.url} timeout=${timeout}`);

    const result = body.type === 'tcp'
      ? await checkTcp(body.url, timeout)
      : await checkHttp(body.url, timeout);

    log(`[RESULT] ${result.status} ${result.responseTime}ms`);

    return res.json(result);
  }

  return res.json({ error: 'Method not allowed' }, 405);
};
