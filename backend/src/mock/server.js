// Mock analysis API.
//
// Serves the canonical golden fixtures over the HTTP shape W3-T1 will own, so
// the extension, macOS, and UI lanes can build without YouTube, Gemini, or a
// teammate process running.
//
// Routes:
//   GET  /healthz               liveness + effective configuration (no secrets)
//   GET  /v1/fixtures           video ids this mock can serve
//   POST /v1/analyze            { url | videoId, forceRefresh? } -> analysis JSON
//   GET  /v1/analysis/:videoId  same payload, convenient for curl

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { assertSecretsForMode, describeConfig, loadConfig, loadDotEnv } from '../config.js';
import { AppError, SCHEMA_VERSION, toErrorResponse } from '../errors.js';
import { createLogger } from '../logger.js';
import { listAnalysisFixtureIds, loadAnalysisFixture } from '../fixtures.js';
import { requireVideoId } from '../transcript/video-url.js';
import {
  SCENARIO_DESCRIPTIONS,
  applyScenario,
  resolveLatencyMs,
  resolveScenario
} from './scenarios.js';

const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS = {
  // Mock-only: the real API (W3-T1) sets a real origin policy.
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-mock-scenario',
  'access-control-allow-methods': 'GET, POST, OPTIONS'
};

const sleep = (ms) => (ms > 0 ? new Promise((done) => setTimeout(done, ms)) : Promise.resolve());

function sendJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
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
      throw new AppError('INVALID_REQUEST', `Request body exceeds ${MAX_BODY_BYTES} bytes.`, {
        status: 413
      });
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

/**
 * Resolve the analysis response for one request.
 * @returns {{ status: number, body: unknown, headers: Record<string, string> }}
 */
function analyze({ videoId, scenario, forceRefresh, config }) {
  const scenarioResponse = applyScenario(scenario, videoId);
  if (scenarioResponse !== null) {
    return {
      status: scenarioResponse.status,
      body: scenarioResponse.body,
      headers: { 'x-mock-scenario': scenario, ...(scenarioResponse.headers ?? {}) }
    };
  }

  const { path, payload } = loadAnalysisFixture(videoId, config.fixturesDir);

  return {
    status: 200,
    body: payload,
    headers: {
      'x-mock-scenario': scenario,
      'x-mock-fixture': path,
      // The mock has no real cache; forceRefresh only flips this marker so
      // clients can prove they sent it.
      'x-analysis-cache': forceRefresh ? 'bypass' : 'hit'
    }
  };
}

/**
 * @param {object} [options]
 * @param {ReturnType<typeof loadConfig>} [options.config]
 * @param {ReturnType<typeof createLogger>} [options.logger]
 */
export function createMockServer({ config = loadConfig(), logger } = {}) {
  const log = logger ?? createLogger({ level: config.logLevel });

  return createServer((request, response) => {
    const startedAt = Date.now();
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    const finish = (status) =>
      log.info('request', {
        method: request.method,
        path: url.pathname,
        status,
        durationMs: Date.now() - startedAt
      });

    const fail = (error) => {
      const { status, body } = toErrorResponse(error);
      if (status >= 500) {
        log.error('request failed', {
          path: url.pathname,
          code: body.error.code,
          message: body.error.message
        });
      } else {
        log.warn('request rejected', { path: url.pathname, code: body.error.code });
      }
      sendJson(response, status, body, { 'x-mock-scenario': 'error' });
      finish(status);
    };

    (async () => {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, CORS_HEADERS);
        response.end();
        return finish(204);
      }

      if (request.method === 'GET' && url.pathname === '/healthz') {
        sendJson(response, 200, {
          status: 'ok',
          schemaVersion: SCHEMA_VERSION,
          mode: config.mode,
          service: 'mock-analysis-api',
          fixturesDir: config.fixturesDir,
          availableVideoIds: listAnalysisFixtureIds(config.fixturesDir),
          defaultScenario: config.mockScenario,
          uptimeSeconds: Math.round(process.uptime())
        });
        return finish(200);
      }

      if (request.method === 'GET' && url.pathname === '/v1/fixtures') {
        sendJson(response, 200, {
          schemaVersion: SCHEMA_VERSION,
          fixturesDir: config.fixturesDir,
          availableVideoIds: listAnalysisFixtureIds(config.fixturesDir),
          scenarios: SCENARIO_DESCRIPTIONS
        });
        return finish(200);
      }

      const analysisMatch = url.pathname.match(/^\/v1\/analysis\/([^/]+)$/);

      if (request.method === 'GET' && analysisMatch) {
        const scenario = resolveScenario(url, request, config);
        await sleep(resolveLatencyMs(url, config));
        const videoId = requireVideoId(decodeURIComponent(analysisMatch[1]));
        const result = analyze({ videoId, scenario, forceRefresh: false, config });
        sendJson(response, result.status, result.body, result.headers);
        return finish(result.status);
      }

      if (request.method === 'POST' && url.pathname === '/v1/analyze') {
        const scenario = resolveScenario(url, request, config);
        const body = await readJsonBody(request);
        await sleep(resolveLatencyMs(url, config));
        const videoId = requireVideoId(body.url ?? body.videoId ?? url.searchParams.get('url'));
        const result = analyze({
          videoId,
          scenario,
          forceRefresh: body.forceRefresh === true,
          config
        });
        sendJson(response, result.status, result.body, result.headers);
        return finish(result.status);
      }

      throw new AppError(
        'INVALID_REQUEST',
        `No route for ${request.method} ${url.pathname}. Try GET /healthz, GET /v1/fixtures, GET /v1/analysis/:videoId, or POST /v1/analyze.`,
        { status: 404 }
      );
    })().catch(fail);
  });
}

/**
 * Start the mock API. Pass port 0 for an ephemeral port (used by tests).
 * @param {object} [options]
 */
export async function startMockServer({ config = loadConfig(), logger } = {}) {
  const log = logger ?? createLogger({ level: config.logLevel });
  const server = createMockServer({ config, logger: log });

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

async function main() {
  loadDotEnv();

  let config;
  try {
    config = loadConfig();
    assertSecretsForMode(config);
  } catch (error) {
    process.stderr.write(`\nConfiguration error: ${error.message}\n\n`);
    process.exitCode = 1;
    return;
  }

  const log = createLogger({ level: config.logLevel });
  const started = await startMockServer({ config, logger: log });

  process.stdout.write(
    [
      '',
      'Mock analysis API (W1-T4)',
      ...describeConfig(config).map((line) => `  ${line}`),
      '',
      `  curl ${started.url}/healthz`,
      `  curl -X POST ${started.url}/v1/analyze -H "content-type: application/json" \\`,
      '       -d \'{"url":"https://www.youtube.com/watch?v=demoTalk001"}\'',
      '',
      '  Ctrl+C to stop.',
      ''
    ].join('\n')
  );

  const shutdown = () => {
    log.info('shutting down');
    started.close().then(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
