// 1.56: actions that run without asking in Review actions. The matcher must be strict: anything
// it cannot be sure is one plain trusted command falls back to the approval card.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRule,validateRules,parseRuleList,matchTrusted,commandWords,TRUSTED_LIMIT} from '../trusted.mjs';

const rules=['Bash(techpro-lookup:*)','Bash(sck-site product:*)','Bash(status-report today)','mcp__memstem__*','mcp__files__read_file','WebSearch'];
const bash=(command,extra={})=>matchTrusted(rules,'Bash',{command,...extra});

test('a trusted command prefix matches the command alone or with plain arguments',()=>{
 assert.equal(bash('techpro-lookup'),'Bash(techpro-lookup:*)');
 assert.equal(bash('techpro-lookup help'),'Bash(techpro-lookup:*)');
 assert.equal(bash('techpro-lookup quote QT-012345 --json'),'Bash(techpro-lookup:*)');
 assert.equal(bash('techpro-lookup "Acme Corp" \'single quoted\''),'Bash(techpro-lookup:*)','quoted arguments are fine');
 assert.equal(bash('  techpro-lookup\thelp  '),'Bash(techpro-lookup:*)','spaces and tabs separate words');
 assert.equal(bash('sck-site product list'),'Bash(sck-site product:*)','a multi-word prefix');
 assert.equal(bash('sck-site product'),'Bash(sck-site product:*)');
 assert.equal(bash('techpro-lookup x',{description:'Look it up',timeout:60000,run_in_background:false}),'Bash(techpro-lookup:*)');
});

test('an exact rule matches that command only',()=>{
 assert.equal(bash('status-report today'),'Bash(status-report today)');
 assert.equal(bash('status-report  today'),'Bash(status-report today)','same words');
 assert.equal(bash('status-report today --all'),null);
 assert.equal(bash('status-report'),null);
});

test('shell syntax, injection and look-alikes always fall back to the card',()=>{
 for(const c of [
  'techpro-lookup help; rm -rf ~','techpro-lookup help;rm -rf ~','techpro-lookup $(id)','techpro-lookup ${HOME}','techpro-lookup $HOME',
  'techpro-lookup help && curl x','techpro-lookup help || curl x','techpro-lookup help & curl x','techpro-lookup help | sh',
  'techpro-lookup `id`','techpro-lookup "`id`"','techpro-lookup "$(id)"',"techpro-lookup '$(id)'",
  'techpro-lookup help\nrm -rf ~','techpro-lookup help\rrm -rf ~','techpro-lookup help \\\nrm -rf ~','techpro-lookup a\\ b',
  'techpro-lookup > /tmp/x','techpro-lookup < /etc/passwd','techpro-lookup 2>/tmp/x','techpro-lookup <<EOF\nx\nEOF','techpro-lookup <(id)',
  'techpro-lookup {a,b}','{ techpro-lookup; }','(techpro-lookup)','techpro-lookup "unclosed','techpro-lookup \'unclosed',
  'techpro-lookupx','techpro-lookupX help','techpro-lookup-evil','techpro-lookup.sh','techpro-lookup"x"',"techpro-lookup'' x",
  'FOO=1 techpro-lookup','PATH=/tmp techpro-lookup help','/tmp/techpro-lookup','./techpro-lookup','~/bin/techpro-lookup help','"techpro-lookup" help',
  'sudo techpro-lookup','env techpro-lookup','command techpro-lookup','exec techpro-lookup',
  'techpro-lookup *','techpro-lookup ?x','techpro-lookup [a]','techpro-lookup\u0000x','techpro-lookup\u001bx',
  'sck-site productx','sck-site "product" list','sck-site','', ' ',
 ])assert.equal(bash(c),null,JSON.stringify(c));
 assert.equal(bash('techpro-lookup help',{dangerouslyDisableSandbox:true}),null,'an unknown input key shows the card');
 assert.equal(matchTrusted(rules,'Bash',{command:42}),null);
 assert.equal(matchTrusted(rules,'Bash',null),null);
 assert.equal(bash('techpro-lookup '+'x'.repeat(5000)),null,'an oversized command shows the card');
 assert.equal(commandWords('a "b c" d').length,3);
});

test('MCP rules: exact names and server wildcards match on the server boundary',()=>{
 const mcp=name=>matchTrusted(rules,name,{query:'anything'});
 assert.equal(mcp('mcp__memstem__memstem_search'),'mcp__memstem__*');
 assert.equal(mcp('mcp__memstem__memstem_get'),'mcp__memstem__*');
 assert.equal(mcp('mcp__files__read_file'),'mcp__files__read_file');
 for(const n of ['mcp__memstemx__tool','mcp__memste__tool','mcp__memstem__','mcp__memstem___x','mcp__memstem','mcp__files__read_file2','mcp__files__write_file','mcp__other__memstem_search','mcp__files__read_file__x'])assert.equal(mcp(n),null,n);
 assert.equal(matchTrusted(rules,'WebSearch',{query:'x'}),'WebSearch');
 for(const tool of ['WebFetch','Edit','Write','NotebookEdit','Agent','Task','PowerShell'])assert.equal(matchTrusted(rules,tool,{command:'techpro-lookup'}),null,tool);
 assert.equal(matchTrusted([],'WebSearch',{}),null,'an empty list trusts nothing');
});

test('rules: writes, blanket rules and malformed rules are refused with a reason',()=>{
 const err=r=>{const p=parseRule(r);assert.equal(p.ok,false,r);return p.error;};
 for(const r of ['Edit','Write','NotebookEdit','MultiEdit','Edit(*)','Write(/tmp/x)','Edit(src/**)'])assert.match(err(r),/changes files, so it always asks/,r);
 for(const r of ['Agent','Task','Task(x)'])assert.match(err(r),/subagent/,r);
 assert.match(err('PowerShell'),/PowerShell always asks/);
 for(const r of ['Bash','Bash()','Bash(*)','Bash(:*)','Bash( * )'])assert.match(err(r),/Name the command/,r);
 assert.match(err('Bash(ls *.md)'),/only wildcard is :\*/);
 assert.match(err('Bash(techpro-lookup*)'),/only wildcard/);
 for(const r of ['Bash(a;b)','Bash(a && b:*)','Bash($(id):*)','Bash(a | b)','Bash(a\nb)','Bash(a > b)'])assert.match(err(r),/one simple command/,r);
 assert.match(err('Bash(FOO=1 techpro-lookup:*)'),/VAR=value/);
 assert.match(err('Bash("open:*)'),/close every quote/);
 for(const r of ['mcp__*','mcp__','mcp__*__*'])assert.match(err(r),/Name a server/,r);
 assert.match(err('mcp__memstem'),/mcp__memstem__\*/);
 assert.match(err('mcp__mem stem__*'),/server wildcard/);
 assert.match(err('WebFetch(domain:example.com)'),/name the tool only/);
 assert.match(err('Read'),/does not need a rule/);
 assert.match(err('rm -rf'),/Use Bash\(command:\*\)/);
 assert.match(err(''),/Type a rule/);
 assert.match(err('Bash(x'+'y'.repeat(400)+')'),/under 300/);
});

test('rules are normalised, deduplicated and capped',()=>{
 assert.equal(parseRule('  Bash(  sck-site   product :*)  ').rule.text,'Bash(sck-site product:*)');
 assert.equal(parseRule('Bash(git log *)').rule.text,'Bash(git log:*)','Bash(prefix *) is the same as :*');
 assert.equal(parseRule('Bash(techpro-lookup "a,b")').rule.text,'Bash(techpro-lookup "a,b")');
 assert.deepEqual(validateRules(['Bash(a:*)','Bash(a :*)','WebSearch']),{rules:['Bash(a:*)','WebSearch']});
 assert.deepEqual(validateRules(['WebSearch','Edit']),{error:'Edit changes files, so it always asks.',rule:'Edit',index:1});
 assert.ok(validateRules(Array.from({length:TRUSTED_LIMIT+1},(_,i)=>`Bash(c${i})`)).error);
 assert.ok(validateRules('Bash(a:*)').error);
 assert.ok(validateRules([7]).error);
});

test('the environment list: lines or commas outside parentheses; bad rules are reported, not used',()=>{
 const {rules:list,ignored}=parseRuleList('Bash(techpro-lookup:*), mcp__memstem__*\nBash(report "a,b")\n\n  WebSearch ,Edit,Bash(x; y)');
 assert.deepEqual(list,['Bash(techpro-lookup:*)','mcp__memstem__*','Bash(report "a,b")','WebSearch']);
 assert.deepEqual(ignored.map(x=>x.rule),['Edit','Bash(x; y)']);
 assert.deepEqual(parseRuleList(''),{rules:[],ignored:[]});
});

// 1.73.8: Bash ends a command at an unquoted # that starts a word, and VAR+=value is an assignment; an MCP server wildcard
// stops at the next "__". Each used to be trusted as written.
test('a bare # word, a VAR+= first word and a double underscore after a server wildcard are not trusted',()=>{
 const r=['Bash(remove # --dry-run)','Bash(PATH+=/fixture:*)','mcp__safe__*'];
 assert.equal(parseRule('Bash(remove # --dry-run)').ok,false);assert.equal(commandWords('remove # --dry-run'),null);
 assert.equal(matchTrusted(['Bash(remove:*)'],'Bash',{command:'remove # --dry-run'}),null,'a prefix rule does not cover a comment either');
 assert.deepEqual(commandWords('echo a#b'),['echo','a#b'],'a # inside a word is literal');assert.deepEqual(commandWords("echo '#'"),['echo',"'#'"]);
 assert.equal(parseRule('Bash(PATH+=/fixture:*)').ok,false);assert.equal(commandWords('PATH+=/fixture other-command'),null);
 assert.equal(matchTrusted(r,'Bash',{command:'PATH+=/fixture other-command'}),null);
 assert.equal(matchTrusted(r,'mcp__safe__other__delete',{}),null,'mcp__safe__* does not reach server safe__other');
 assert.equal(matchTrusted(r,'mcp__safe__read_file',{}),'mcp__safe__*');assert.equal(matchTrusted(r,'mcp__safe__tool_',{}),'mcp__safe__*');
});
