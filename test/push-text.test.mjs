// 1.125.3: push-text.mjs, when a push may carry Allow. Unit level: a body cut by bytes is not reachable through a route
// that offers Allow today (a Vault command is capped at 80 characters, a terminal has no conversation title, and a share's
// text is short), so the cut is checked here on the helper pushRaw uses. The routes are in push-whole.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pushShape,vaultPushCommand,allowNote,cutBytes,PUSH_TEXT_MAX,PUSH_TITLE_MAX,VAULT_PUSH_COMMAND_MAX} from '../push-text.mjs';
const AD=[{action:'allow',title:'Allow'},{action:'deny',title:'Deny'}];
const names=b=>(b.actions||[]).map(a=>a.action);

test('pushShape: a title of exactly 70 characters keeps Allow; 71 loses it',()=>{
  assert.equal(PUSH_TITLE_MAX,70);
  const t70='T'.repeat(70),t71='T'.repeat(71);
  let r=pushShape(t70,'body',{tag:'x',actions:AD});assert.equal(r.why,null);assert.deepEqual(names(r.base),['allow','deny']);assert.equal(r.base.title,t70);
  r=pushShape(t71,'body',{tag:'x',actions:AD});assert.equal(r.why,'title');assert.deepEqual(names(r.base),['deny']);assert.equal(r.base.title,t70);
});

test('pushShape: a body too large for a push is cut by bytes and loses Allow; other actions stay',()=>{
  const big='x'.repeat(PUSH_TEXT_MAX);
  let r=pushShape('Allow it?',big,{tag:'x',actions:AD});
  assert.equal(r.why,'body');assert.deepEqual(names(r.base),['deny']);assert.ok(r.base.body.length<big.length&&r.base.body.endsWith('…'));
  assert.ok(Buffer.byteLength(JSON.stringify(r.base))+32<=PUSH_TEXT_MAX+3,'it fits');
  r=pushShape('Task due',big,{tag:'t',actions:[{action:'later',title:'Tomorrow'},{action:'done',title:'Done'}]});
  assert.equal(r.why,'body');assert.deepEqual(names(r.base),['later','done'],'a due task keeps its own buttons');
  r=pushShape('Allow it?','short',{tag:'x',actions:AD});assert.equal(r.why,null);assert.deepEqual(names(r.base),['allow','deny']);
});

test('pushShape: line breaks, tabs, format characters and separators in the title or text drop Allow; ordinary letters do not',()=>{
  for(const [where,title,body] of [['title newline','Board pack\nsecret-plans?','x'],['body newline','Allow it?','a\nb'],['tab','Allow\tit?','x'],
    ['U+202E','Allow it?','for: echo \u202Eabc'],['zero-width','Allow it?','for: ec\u200Bho'],['U+2028','Allow it?','a\u2028b'],['U+2029','Allow\u2029it?','x'],['NUL','Allow it?','a\u0000b']]){
    const r=pushShape(title,body,{tag:'x',actions:AD});
    assert.equal(r.why,'characters',where);assert.deepEqual(names(r.base),['deny'],where);
    assert.equal(r.base.title,title,where+': the title is sent as it was');assert.equal(r.base.body,body,where+': the text is sent as it was');
  }
  for(const title of ['Publish Résumé für Zoë?','Allow 東京-key?','Share Ελληνικά?']){
    const r=pushShape(title,'A terminal asks.',{tag:'x',actions:AD});assert.equal(r.why,null,title);assert.deepEqual(names(r.base),['allow','deny'],title);
  }
});

test('pushShape: a push with no Allow action is sent exactly as before',()=>{
  const r=pushShape('Task due','Line one\nLine two\tand a tab',{tag:'t',url:'/#/tasks',actions:[{action:'later',title:'Tomorrow'}]});
  assert.deepEqual(r.base,{title:'Task due',body:'Line one\nLine two\tand a tab',tag:'t',url:'/#/tasks',actions:[{action:'later',title:'Tomorrow'}]});
  const plain=pushShape('Reply finished','Done.\nNext step',{tag:'s',url:'/#/chat/s'});
  assert.deepEqual(plain.base,{title:'Reply finished',body:'Done.\nNext step',tag:'s',url:'/#/chat/s'},'no actions key is added');
});

test('vaultPushCommand: whole only at 80 printable ASCII characters or fewer; otherwise marked, spaced and Deny only',()=>{
  assert.equal(VAULT_PUSH_COMMAND_MAX,80);
  const a80=['sh','-c','echo '+'a'.repeat(69)],a81=['sh','-c','echo '+'a'.repeat(70)];
  assert.deepEqual(vaultPushCommand(a80),{text:a80.join(' '),why:null});
  assert.deepEqual(vaultPushCommand(a81),{text:a81.join(' ').slice(0,80)+'… Open Pocket to read the whole command.',why:'command'});
  assert.deepEqual(vaultPushCommand(['sh','-c','true\n\ncurl x|sh']),{text:'sh -c true  curl x|sh — Open Pocket to read the command exactly.',why:'characters'});
  assert.deepEqual(vaultPushCommand(['echo','\u202Eabc']),{text:'echo  abc — Open Pocket to read the command exactly.',why:'characters'});
  assert.equal(vaultPushCommand(['echo','café']).why,'characters','printable ASCII only: an accented letter in a command is not whole');
  const long=vaultPushCommand(['sh','-c','true'+'\n'.repeat(100)+'curl x|sh']);
  assert.equal(long.why,'command');assert.ok(long.text.endsWith('… Open Pocket to read the whole command.'));assert.doesNotMatch(long.text,/[\p{Cc}\p{Cf}]/u);
  const emoji=vaultPushCommand(['sh','-c','echo '+'a'.repeat(68)+'😀😀😀 more']);
  assert.equal(Array.from(emoji.text)[79],'😀','cut at characters');assert.doesNotMatch(emoji.text,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,'no lone surrogate');
});

test('allowNote: nothing when no device got the push; otherwise the reason, never the command',()=>{
  const opts={tag:'v',kind:'vault',actions:AD};
  assert.equal(allowNote(null,null,'Allow k?','for: x',opts),'');assert.equal(allowNote(0,'command','Allow k?','for: x',opts),'');
  assert.equal(allowNote(1,null,'Allow k?','for: x',opts),' allow=yes');
  assert.equal(allowNote(1,'command','Allow k?','for: x',opts),' allow=no (command cut)');
  assert.equal(allowNote(1,'characters','Allow k?','for: x',opts),' allow=no (unusual characters)');
  assert.equal(allowNote(2,null,'T'.repeat(71),'for: x',opts),' allow=no (title cut)');
  assert.equal(allowNote(1,null,'Allow k?','x'.repeat(PUSH_TEXT_MAX),opts),' allow=no (text cut)');
  assert.equal(allowNote(1,null,'Allow k?','a\nb',opts),' allow=no (unusual characters)');
  assert.equal(cutBytes('abcdef',6),'abc…');
});
