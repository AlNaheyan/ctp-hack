// Reads golden analysis payloads from the canonical fixtures directory.
//
// W1-T2 owns fixture content and schema validation. This module only locates
// and parses files - it never keeps a second copy of one.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FIXTURE_MANIFEST_RELATIVE_PATH } from './config.js';
import { AppError } from './errors.js';

function analysisFixtureRecords(fixturesDir) {
  const manifestPath = resolve(fixturesDir, FIXTURE_MANIFEST_RELATIVE_PATH);
  if (!existsSync(manifestPath)) return [];

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(manifest.fixtures)) return [];

    return manifest.fixtures
      .filter((entry) => entry.contract === 'analysis' && entry.valid === true)
      .flatMap((entry) => {
        const path = resolve(fixturesDir, entry.path);
        if (!existsSync(path)) return [];
        const payload = JSON.parse(readFileSync(path, 'utf8'));
        return typeof payload.videoId === 'string' ? [{ path, payload }] : [];
      });
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', `Fixture manifest ${manifestPath} is not valid.`, { cause });
  }
}

/**
 * Video ids the mock can serve right now.
 * @param {string} fixturesDir
 * @returns {string[]} sorted, de-duplicated ids
 */
export function listAnalysisFixtureIds(fixturesDir) {
  return [...new Set(analysisFixtureRecords(fixturesDir).map(({ payload }) => payload.videoId))].sort();
}

/**
 * Resolve the on-disk path of one analysis fixture.
 * @param {string} videoId
 * @param {string} fixturesDir
 * @returns {string | null}
 */
export function findAnalysisFixturePath(videoId, fixturesDir) {
  return analysisFixtureRecords(fixturesDir).find(({ payload }) => payload.videoId === videoId)?.path ?? null;
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
      'VIDEO_NOT_FOUND',
      `No analysis fixture for video "${videoId}". Add a valid analysis entry to ${FIXTURE_MANIFEST_RELATIVE_PATH}, or request one of the available ids.`,
      {
        details: {
          fixturesDir,
          availableVideoIds: available,
          fixtureManifest: resolve(fixturesDir, FIXTURE_MANIFEST_RELATIVE_PATH)
        }
      }
    );
  }

  try {
    return { path, payload: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', `Fixture ${path} is not valid JSON.`, { cause });
  }
}
