// Rebuild the kit from its Blender scripts:  npm run kit [-- --sheet out.png]
//   assets/blender/*.py  ->  public/kit/<pack>.glb (quantised, meshopt-compressed) + public/kit/index.json
// Needs Blender 4.2+ (set BLENDER if it is not in the usual place).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const sheetAt = args.indexOf('--sheet');
const sheet = sheetAt >= 0 ? args.splice(sheetAt, 2)[1] : null;
const blender = process.env.BLENDER ?? ['/Applications/Blender.app/Contents/MacOS/Blender', 'blender'].find((p) => p === 'blender' || existsSync(p));
const raw = mkdtempSync(join(tmpdir(), 'kit-'));

const log = execFileSync(blender, ['-b', '--factory-startup', '-P', 'assets/blender/build.py', '--', 'sample', raw, ...(sheet ? [sheet] : [])], { encoding: 'utf8', maxBuffer: 1 << 26 });
// Which pack holds each family: the app reads this to know what to fetch when a piece is first needed.
const index = {}, atlases = [];
for (const line of log.split('\n')) {
  const m = /^PACK (\S+) (.*)$/.exec(line);
  if (m) for (const family of m[2].split(' ')) index[family] = m[1];
  const a = /^ATLAS (\S+)/.exec(line);
  if (a) atlases.push(a[1]); // this pack has painted figures: their paint is in <pack>.png
}
for (const f of readdirSync('public/kit')) rmSync(join('public/kit', f));
let total = 0;
for (const pack of new Set(Object.values(index))) {
  const out = `public/kit/${pack}.glb`;
  // -kn keeps one named node per piece, -kv keeps the vertex colours (no material refers to them),
  // -vtf leaves texture coordinates as they are (their packed scale would live in a material).
  execFileSync('npx', ['gltfpack', '-i', join(raw, `${pack}.glb`), '-o', out, '-cc', '-kn', '-kv', '-vp', '13', '-vc', '8', '-vtf'], { stdio: ['ignore', 'ignore', 'inherit'] });
  const kb = statSync(out).size / 1024;
  total += kb;
  console.log(`${pack.padEnd(10)} ${kb.toFixed(0).padStart(5)} KB  ${Object.values(index).filter((p) => p === pack).length} families`);
}
for (const pack of atlases) {
  copyFileSync(join(raw, `${pack}.png`), `public/kit/${pack}.png`);
  const kb = statSync(`public/kit/${pack}.png`).size / 1024;
  total += kb;
  console.log(`${(pack + '.png').padEnd(14)} ${kb.toFixed(0).padStart(5)} KB  painted figures`);
}
writeFileSync('public/kit/index.json', JSON.stringify({ families: index, atlases }));
console.log(`total      ${total.toFixed(0).padStart(5)} KB`);
