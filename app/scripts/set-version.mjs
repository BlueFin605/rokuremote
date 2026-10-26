import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version "${version ?? ''}" - expected e.g. 1.0.57`);
  process.exit(1);
}
const target = fileURLToPath(new URL('../src/app/version.ts', import.meta.url));
writeFileSync(target, `export const APP_VERSION = '${version}';\n`);
console.log(`APP_VERSION set to ${version}`);
