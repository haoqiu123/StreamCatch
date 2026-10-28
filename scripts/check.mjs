import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const extension=path.join(root,'extension');
const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.equal(manifest.version,pkg.version,'Manifest/package version mismatch');
const refs=[manifest.background.service_worker,manifest.action.default_popup,manifest.options_page,
  ...Object.values(manifest.icons),...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap(script=>script.js)];
for(const ref of refs)assert(fs.existsSync(path.join(extension,ref)),`Missing extension file: ${ref}`);
function* walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const value=path.join(dir,entry.name);if(entry.isDirectory())yield* walk(value);else yield value;}}
const files=[...walk(extension)].filter(file=>file.endsWith('.js'));
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
for(const file of [...walk(extension),...walk(path.join(root,'native'))]){
  if(!/\.(?:js|py|html|css|json)$/.test(file))continue;
  const source=fs.readFileSync(file,'utf8');
  assert(!/\/Users\/[^/\s]+\/|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source),`Local path or credential in ${file}`);
}
console.log(`PASS manifest references, version ${manifest.version}, ${files.length} JavaScript syntax checks, public-source scan.`);
