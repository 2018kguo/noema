// Commit the output so readers and portable courses need only Python.
import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
await mkdir('vendor', { recursive: true });
await build({ stdin: { contents: `
  import '@awesome.me/webawesome/dist/components/card/card.js';
  import '@awesome.me/webawesome/dist/components/details/details.js';
  import '@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js';
`, resolveDir: process.cwd() }, bundle: true, minify: true, format: 'esm', target: 'es2020', outfile: 'vendor/components.js', legalComments: 'linked' });
await build({ entryPoints: ['node_modules/@awesome.me/webawesome/dist/styles/themes/default.css'], bundle: true, minify: true, outfile: 'vendor/theme.css' });
await copyFile('node_modules/@awesome.me/webawesome/LICENSE.md', 'vendor/Web-Awesome-LICENSE.md');
await writeFile('vendor/Lit-LICENSE.txt', ['lit', 'lit-element', 'lit-html', '@lit/reactive-element'].join(', ')
  + '\n\n' + await readFile('node_modules/@lit/reactive-element/LICENSE', 'utf8'));
const files = ['components.js', 'components.js.LEGAL.txt', 'theme.css', 'Web-Awesome-LICENSE.md', 'Lit-LICENSE.txt'];
const sha256 = {};
for (const name of files) sha256[name] = createHash('sha256').update(await readFile('vendor/' + name)).digest('hex');
await writeFile('vendor/manifest.json', JSON.stringify({ package: '@awesome.me/webawesome', version: '3.14.0', license: 'MIT', source: 'https://github.com/shoelace-style/webawesome', sha256 }, null, 2) + '\n');
