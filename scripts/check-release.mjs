// Read-only guard against mismatched versions, stale caches and broken local docs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const json=name=>JSON.parse(read(name));
try {
 const pkg=json('package.json'),lock=json('package-lock.json'),release=json('public/release.json');
 assert.match(pkg.version,/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/,'semantic version');
 assert.equal(lock.version,pkg.version,'lockfile version');
 assert.equal(lock.packages[''].version,pkg.version,'lockfile root package version');
 assert.equal(release.version,pkg.version,'release JSON version');
 assert.ok(Number.isInteger(release.assetV)&&release.assetV>0,'positive asset build');
 const heading=read('CHANGELOG.md').match(/^## \[([^\]]+)\](.*)$/m);
 assert.equal(heading?.[1],pkg.version,'first changelog entry matches the checkout');
 assert.match(heading[2],new RegExp('build '+release.assetV+'(?:\\D|$)'),'changelog asset build');
 if(process.argv.includes('--released')){
  assert.doesNotMatch(heading[2],/Unreleased/i,'release date must be recorded');
  assert.match(heading[2],/\d{4}-\d{2}-\d{2}/,'release entry needs an actual date');
 }
 assert.ok(read('README.md').includes(`**${pkg.version} / build ${release.assetV}**`),'README checkout version/build');
 const assets=[...read('public/index.html').matchAll(/(?:src|href)="([^"?]+)\?v=(\d+)"/g)];
 assert.ok(assets.length>0,'versioned frontend assets exist');
 for(const [,file,build] of assets){
  assert.equal(Number(build),release.assetV,'index asset build: '+file);
  assert.ok(fs.existsSync(path.join(root,'public',file)),'asset exists: '+file);
 }
 const sw=read('public/sw.js');
 assert.equal(Number(sw.match(/const V\s*=\s*['"]pc-v(\d+)['"]/)?.[1]),release.assetV,'service-worker cache build');
 const shell=sw.match(/const SHELL\s*=\s*(\[[\s\S]*?\]);/)?.[1];assert.ok(shell,'service-worker shell list');
 const cached=[...shell.matchAll(/['"]([^'"]+)['"]/g)].map(m=>m[1]);
 for(const url of cached){
  const build=url.match(/[?&]v=(\d+)/)?.[1];if(build)assert.equal(Number(build),release.assetV,'cached asset build: '+url);
  assert.ok(fs.existsSync(path.join(root,'public',url==='/'?'index.html':url.slice(1).split('?')[0])),'cached asset exists: '+url);
 }
 for(const [,file,build] of assets)assert.ok(cached.includes('/'+file+'?v='+build),'versioned asset is precached: '+file);
 assert.ok(cached.includes('/release.json?v='+release.assetV),'release metadata is precached');
 const notes=read('server.mjs').match(/const RELEASE_NOTES\s*=\s*(\[[\s\S]*?\]);/)?.[1];
 assert.deepEqual(JSON.parse(notes),release.notes,'server and frontend release notes');
 const markdown=[];
 for(const name of fs.readdirSync(root))if(name.endsWith('.md'))markdown.push(path.join(root,name));
 const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.md'))markdown.push(file);}};
 walk(path.join(root,'docs'));
 let checked=0;
 for(const file of markdown){
  const text=fs.readFileSync(file,'utf8').replace(/```[\s\S]*?```/g,'');
  for(const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)){
   const target=match[1];if(/^(?:[a-z][\w+.-]*:|#|\/\/)/i.test(target))continue;
   const local=decodeURIComponent(target.split(/[?#]/)[0]);
   const resolved=path.resolve(path.dirname(file),local);
   assert.ok(resolved.startsWith(root+path.sep),'local doc link stays in repository: '+target);
   assert.ok(fs.existsSync(resolved),path.relative(root,file)+' has a missing local link: '+target);checked++;
  }
 }
 console.log(`Release metadata agrees: ${pkg.version} / build ${release.assetV}; ${checked} local documentation links checked.`);
} catch(error) {
 console.error('Release check failed: '+error.message);process.exitCode=1;
}
