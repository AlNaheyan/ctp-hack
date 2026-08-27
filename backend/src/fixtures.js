// Reads golden analysis payloads from the canonical fixtures directory.
//
// W1-T2 owns fixture content and schema validation. This module only locates
// and parses files - it never keeps a second copy of one.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ANALYSIS_FIXTURE_DIRS, analysisFixtureRelativePaths } from './config.js';
import { AppError } from './errors.js';

/**
 * Video ids the mock can serve right now.
 * @param {string} fixturesDir
 * @returns {string[]} sorted, de-duplicated ids
 */
export function listAnalysisFixtureIds(fixturesDir) {
  const ids = new Set();

  for (const relativeDir of ANALYSIS_FIXTURE_DIRS) {
    const directory = resolve(fixturesDir, relativeDir);
    if (!existsSync(directory)) continue;

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      if (entry.name === 'README.json') continue;
      ids.add(entry.name.replace(/^analysis-/, '').replace(/\.json$/, ''));
    }
  }

  return [...ids].sort();
}

/**
 * Resolve the on-disk path of one analysis fixture.
 * @param {string} videoId
 * @param {string} fixturesDir
 * @returns {string | null}
 */
export function findAnalysisFixturePath(videoId, fixturesDir) {
  for (const relativePath of analysisFixtureRelativePaths(videoId)) {
    const candidate = resolve(fixturesDir, relativePath);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Load one analysis fixture.
 * @param {string} videoId
 * @param {string} fixturesDir
 * @returns {{ path: string, payload: unknown }}
 */
export function loadAnalysisFixture(videoId, fixturesDir) {
  const path = findAnalysisFixturePath(videoId, fixturesDir);

  if (path === null) {
    const available = listAnalysisFixtureIds(fixturesDir);
    throw new AppError(
      'MOCK_FIXTURE_MISSING',
      `No analysis fixture for video "${videoId}". Add ${analysisFixtureRelativePaths(videoId)[0]} under the canonical fixtures directory, or request one of the available ids.`,
      {
        details: {
          fixturesDir,
          availableVideoIds: available,
          expectedPath: analysisFixtureRelativePaths(videoId)[0]
        }
      }
    );
  }

  try {
    return { path, payload: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (cause) {
    throw new AppError('INTERNAL', `Fixture ${path} is not valid JSON.`, { cause });
  }
}
