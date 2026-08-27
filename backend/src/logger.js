// Structured single-line logging. Log identifiers and outcomes, never
// transcript text, request bodies, or secret values.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

export function createLogger({ level = 'info', stream = process.stdout } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const emit = (levelName) => (message, fields = {}) => {
    if ((LEVELS[levelName] ?? LEVELS.info) > threshold) return;
    const line = { ts: new Date().toISOString(), level: levelName, message, ...fields };
    stream.write(`${JSON.stringify(line)}\n`);
  };

  return {
    level,
    error: emit('error'),
    warn: emit('warn'),
    info: emit('info'),
    debug: emit('debug')
  };
}
