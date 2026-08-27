import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const usage = 'Usage: npm run test:smoke -- --base-url <deployment-url>';
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function parseSmokeBaseUrl(args) {
  if (args.length !== 2 || args[0] !== '--base-url' || !args[1]) {
    throw new Error(usage);
  }

  let url;
  try {
    url = new URL(args[1]);
  } catch {
    throw new Error(usage);
  }

  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopbackHosts.has(url.hostname)))) {
    throw new Error('Smoke base URL must use HTTPS or loopback HTTP.');
  }

  return url;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = parseSmokeBaseUrl(process.argv.slice(2));
  const child = spawn(process.execPath, [
    './node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.smoke.config.ts',
  ], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BASE_URL: url.href },
  });
  child.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}
