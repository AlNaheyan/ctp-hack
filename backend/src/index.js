// Backend entry point.
//
// Wave 1 only ships the mock API. When ANALYSIS_MODE=live, this validates
// secrets and then stops with a pointer to the ticket that will implement the
// real pipeline, instead of failing later with a confusing runtime error.

import { assertSecretsForMode, describeConfig, loadConfig, loadDotEnv } from './config.js';
import { createLogger } from './logger.js';
import { startMockServer } from './mock/server.js';

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

  if (config.mode === 'live') {
    process.stderr.write(
      [
        '',
        'ANALYSIS_MODE=live is not implemented yet.',
        'The live transcript and analysis pipeline lands in W2-T1, W2-T2, and W3-T1.',
        'Set ANALYSIS_MODE=mock in .env to run against golden fixtures today.',
        '',
        ...describeConfig(config).map((line) => `  ${line}`),
        ''
      ].join('\n')
    );
    process.exitCode = 1;
    return;
  }

  const log = createLogger({ level: config.logLevel });
  const started = await startMockServer({ config, logger: log });

  process.stdout.write(
    ['', 'Backend running in mock mode', ...describeConfig(config).map((line) => `  ${line}`), '', `  ${started.url}/healthz`, ''].join('\n')
  );

  const shutdown = () => started.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

await main();
