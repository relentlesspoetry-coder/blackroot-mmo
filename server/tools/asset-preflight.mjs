import fs from 'node:fs';
const directory = new URL('../../client/models/', import.meta.url);
if (!fs.existsSync(directory) || !fs.readdirSync(directory).some(name => name.endsWith('.glb'))) {
  console.error('BLOCKED: full client/models/*.glb asset checkout required; text-only checkout is not an asset/browser pass.');
  process.exit(1);
}
