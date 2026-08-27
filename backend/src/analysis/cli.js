#!/usr/bin/env node
// Developer tool: analyse a transcript file and print the analysis JSON.
//
//   npm run analyze                                   # golden transcript, stub provider
//   npm run analyze -- --meta                         # plus the internal bookkeeping
//   npm run analyze -- path/to/transcript.json
//   npm run analyze -- --live                         # real Gemini call, needs GEMINI_API_KEY
//
// This is not an HTTP surface. W3-T1 owns routes, caching, and orchestration.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT, loadConfig, loadDotEnv } from '../config.js';
import { AppError } from '../errors.js';
import { createLogger } from '../logger.js';
import { analyzeTranscript } from './analyzer.js';
import { createProvider } from './providers/index.js';

const DEFAULT_TRANSCRIPT = 'fixtures/valid/transcript.json';

function parseArgs(argv) {
  const options = { live: false, meta: false, title: undefined, path: DEFAULT_TRANSCRIPT };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--live') options.live = true;
    else if (arg === '--meta') options.meta = true;
    else if (arg === '--title') options.title = argv[++index];
    else if (!arg.startsWith('--')) options.path = arg;
  }

  return options;
}

async function main() {
  loadDotEnv();

  const options = parseArgs(process.argv.slice(2));
  const base = loadConfig();
  const config = { ...base, mode: options.live ? 'live' : 'mock' };
  const logger = createLogger({ level: config.logLevel, stream: process.stderr });

  const path = resolve(REPO_ROOT, options.path);
  let transcript;
  try {
    transcript = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    process.stderr.write(`\nCould not read a transcript from ${path}: ${error.message}\n\n`);
    process.exitCode = 1;
    return;
  }

  const provider = createProvider(config);

  try {
    const { analysis, meta } = await analyzeTranscript(transcript, {
      provider,
      title: options.title,
      logger
    });

    process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
    if (options.meta) process.stderr.write(`\n${JSON.stringify(meta, null, 2)}\n`);
  } catch (error) {
    const typed = error instanceof AppError;
    process.stderr.write(
      `\nAnalysis failed${typed ? ` [${error.code}]` : ''}: ${error.message}\n${
        typed && error.details ? `${JSON.stringify(error.details, null, 2)}\n` : ''
      }\n`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
