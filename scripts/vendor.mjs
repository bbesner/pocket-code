// Reproduce checked-in browser assets after deliberately updating pinned packages.
import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const files=[['marked/lib/marked.umd.js','marked.js'],['marked/LICENSE','marked-LICENSE.txt'],['dompurify/dist/purify.min.js','purify.js'],['dompurify/LICENSE','purify-LICENSE.txt']];
fs.mkdirSync(path.join(root,'public/vendor'),{recursive:true});
for(const [source,target] of files)fs.copyFileSync(path.join(root,'node_modules',source),path.join(root,'public/vendor',target));
