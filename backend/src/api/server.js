// Analysis HTTP API (W3-T1).
//
//   GET  /healthz               liveness, versions, cache counters (no secrets)
//   POST /v1/analyze            { url | videoId, language?, forceRefresh? }
//   GET  /v1/analysis/:videoId  same result, convenient for curl
//
// The documented boundary W3-T4 integrates through. Routing, headers, and error
// mapping only: orchestration lives in analysis-service.js.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { toErrorResponse } from '../errors.js';
import { AppError } from '../errors.js';

const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-request-id',
  'access-control-allow-methods': 'GET, POST, OPTIONS'
});

const newRequestId = () => `req_${randomUUID().replaceAll('-', '').slice(0, 24)}`;

function sendJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...CORS_HEADERS,
    ...headers
  });
  response.end(payload);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new AppError('INVALID_REQUEST', `Request body exceeds ${MAX_BODY_BYTES} bytes.`, { status: 413 });
    }
    chunks.push(chunk);
  }

  if (size === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('INVALID_REQUEST', 'Request body must be JSON.');
  }
}

/** Cache headers so clients and proxies can reason about freshness. */
function cacheHeaders(cache, meta) {
  return {
    'x-analysis-cache': cache.status,
    'x-analysis-model': meta.modelId,
    'x-analysis-prompt-version': meta.promptVersion,
    'cache-control': `private, max-age=${cache.expiresInSeconds}`,
    age: String(cache.ageSeconds)
  };
}

const truthy = (value) => value === '1' || value === 'true' || value === true;

/**
 * @param {object} options
 * @param {{ analyze: Function, health: Function }} options.service
 * @param {object} options.config
 * @param {object} [options.logger]
 */
export function createApiServer({ service, config, logger }) {
  const startedAt = Date.now();

  return createServer((request, response) => {
    const requestStartedAt = Date.now();
    const requestId = newRequestId();
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    const finish = (status, extra = {}) =>
      logger?.info?.('request', {
        requestId,
        method: request.method,
        path: url.pathname,
        status,
        durationMs: Date.now() - requestStartedAt,
        ...extra
      });

    const fail = (error) => {
      const { status, body } = toErrorResponse(error);
      body.error.requestId = requestId;

      if (status >= 500) {
        logger?.error?.('request failed', { requestId, path: url.pathname, code: body.error.code });
      } else {
        logger?.warn?.('request rejected', { requestId, path: url.pathname, code: body.error.code });
      }

      if (config.logPayloads) {
        logger?.info?.('frontend response payload', { requestId, status, response: body });
      }

      sendJson(response, status, body, { 'x-request-id': requestId });
      finish(status, { code: body.error.code });
    };

    const succeed = (result) => {
      if (config.logPayloads) {
        logger?.info?.('frontend response payload', { requestId, status: 200, response: result.analysis });
      }
      sendJson(response, 200, result.analysis, {
        'x-request-id': requestId,
        ...cacheHeaders(result.cache, result.meta)
      });
      finish(200, { cache: result.cache.status, events: result.analysis.events.length });
    };

    (async () => {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, CORS_HEADERS);
        response.end();
        return finish(204);
      }

      if (request.method === 'GET' && url.pathname === '/healthz') {
        sendJson(
          response,
          200,
          {
            status: 'ok',
            service: 'analysis-api',
            mode: config.mode,
            uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
            ...service.health()
          },
          { 'x-request-id': requestId, 'cache-control': 'no-store' }
        );
        return finish(200);
      }

      if (request.method === 'POST' && url.pathname === '/v1/analyze') {
        const body = await readJsonBody(request);

        return succeed(
          await service.analyze({
            url: body.url,
            videoId: body.videoId,
            language: body.language,
            forceRefresh: body.forceRefresh === true || truthy(url.searchParams.get('forceRefresh'))
          })
        );
      }

      const byId = url.pathname.match(/^\/v1\/analysis\/([^/]+)$/);
      if (request.method === 'GET' && byId) {
        return succeed(
          await service.analyze({
            videoId: decodeURIComponent(byId[1]),
            language: url.searchParams.get('language') ?? undefined,
            forceRefresh: truthy(url.searchParams.get('forceRefresh'))
          })
        );
      }

      throw new AppError(
        'INVALID_REQUEST',
        `No route for ${request.method} ${url.pathname}. Try GET /healthz, POST /v1/analyze, or GET /v1/analysis/:videoId.`,
        { status: 404 }
      );
    })().catch(fail);
  });
}

/**
 * Start the API. Pass port 0 for an ephemeral port (used by tests).
 * @param {object} options
 */
export async function startApiServer({ service, config, logger }) {
  const server = createApiServer({ service, config, logger });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.port;

  return {
    server,
    port,
    url: `http://${config.host}:${port}`,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
