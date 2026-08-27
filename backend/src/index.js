// Backend entry point.
//
// Starts the analysis API (W3-T1) in whichever mode is configured:
//   mock -> fixture transcripts + offline stub analyzer, no secrets
//   live -> YouTube captions + Gemini, requires GEMINI_API_KEY
//
// The fixture-playback server with UI scenarios is separate: `npm run mock`.

import { assertSecretsForMode, describeConfig, loadConfig, loadDotEnv } from './config.js';
import { createLogger } from './logger.js';
import { createAnalysisApiService } from './api/factory.js';
import { startApiServer } from './api/server.js';

async function main() {
  loadDotEnv();

  let config;
  let wiring;
  let log;

  try {
    config = loadConfig();
    assertSecretsForMode(config);
    log = createLogger({ level: config.logLevel });
    wiring = createAnalysisApiService(config, { logger: log });
  } catch (error) {
    process.stderr.write(`\nConfiguration error: ${error.message}\n\n`);
    process.exitCode = 1;
    return;
  }

  const started = await startApiServer({ service: wiring.service, config, logger: log });

  const example =
    config.mode === 'live'
      ? 'https://www.youtube.com/watch?v=<videoId>'
      : `https://www.youtube.com/watch?v=${wiring.fixtureVideoIds[0] ?? '<videoId>'}`;

  process.stdout.write(
    [
      '',
      `Analysis API (${config.mode} mode)`,
      ...describeConfig(config).map((line) => `  ${line}`),
      ...(config.mode === 'live'
        ? []
        : [`  fixture ids    ${wiring.fixtureVideoIds.join(', ') || '(none found)'}`]),
      '',
      `  curl ${started.url}/healthz`,
      `  curl -X POST ${started.url}/v1/analyze -H "content-type: application/json" \\`,
      `       -d '{"url":"${example}"}'`,
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

await main();
