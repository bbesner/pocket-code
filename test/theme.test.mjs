import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../public/theme.js',import.meta.url),'utf8');
function boot({saved={},dark=false,blocked=false}={}){
 const storage={...saved};
 Object.defineProperties(storage,{
  getItem:{value:key=>storage[key]??null},
  setItem:{value:(key,value)=>{if(blocked)throw Error('Storage denied');storage[key]=value;}}
 });
 const window=new EventTarget(),media=new EventTarget(),root={dataset:{}},meta={};media.matches=dark;
 const context={window,Event,matchMedia:()=>media,document:{documentElement:root,querySelector:()=>({setAttribute:(key,value)=>meta[key]=value})}};
 Object.defineProperty(context,'localStorage',{get:()=>{if(blocked)throw Error('Storage denied');return storage;}});
 vm.runInNewContext(source,context);
 return {api:window.PocketTheme,root,meta,storage,media,window};
}
test('appearance migration preserves an existing browser and defaults new browsers to system',()=>{
 const old=boot({saved:{'pc-accent':'"blue"'},dark:false});
 assert.equal(old.api.preference,'dark');assert.equal(old.api.resolved,'dark');assert.equal(old.api.accent,'blue');
 assert.equal(old.storage['pc-theme'],'"dark"');
 const fresh=boot();assert.equal(fresh.api.preference,'system');assert.equal(fresh.api.resolved,'light');
 assert.equal(boot({dark:true}).api.resolved,'dark');
});
test('explicit choices override the OS; system changes update only system mode',()=>{
 const b=boot();b.api.setPreference('dark');b.media.dispatchEvent(new Event('change'));
 assert.equal(b.api.resolved,'dark');assert.equal(b.storage['pc-theme'],'"dark"');
 b.api.setPreference('system');assert.equal(b.api.resolved,'light');
 b.media.matches=true;b.media.dispatchEvent(new Event('change'));assert.equal(b.api.resolved,'dark');
 b.api.setPreference('light');b.media.dispatchEvent(new Event('change'));assert.equal(b.api.resolved,'light');
 b.api.setPreference('invalid');assert.equal(b.api.preference,'light');
});
test('unavailable or corrupt storage never prevents theme startup or in-memory changes',()=>{
 for(const options of [{blocked:true},{saved:{'pc-theme':'broken','pc-accent':'"bogus"'}}]){
  const b=boot(options);assert.equal(b.api.preference,'system');assert.equal(b.api.accent,'clay');
  b.api.setPreference('dark');b.api.setAccent('purple');assert.equal(b.api.resolved,'dark');assert.equal(b.root.dataset.accent,'purple');
 }
});
test('restoring a page resolves system mode against the current OS preference',()=>{
 const b=boot();b.media.matches=true;b.window.dispatchEvent(new Event('pageshow'));assert.equal(b.api.resolved,'dark');
 assert.equal(b.meta.content,'#131110');
});
