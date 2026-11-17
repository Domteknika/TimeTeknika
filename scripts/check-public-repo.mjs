import { readFileSync,existsSync,statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const privateFile='.private-identifiers.local.json';
const privateTerms=existsSync(privateFile)?JSON.parse(readFileSync(privateFile,'utf8')):[];
const findings=[];
const secretPatterns=[
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
 ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
 ['openai-key',/\bsk-(?:proj-|svcacct-)[A-Za-z0-9_-]{30,}/],
 ['aws-access-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
 ['slack-token',/\bxox[baprs]-[A-Za-z0-9-]{20,}/],
 ['credential-url',/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/]+:[^@\s/]{4,}@/],
 ['private-address',/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/],
];
for(const path of new Set(paths)){
 if(!existsSync(path)||!statSync(path).isFile())continue;
 const normal=path.replaceAll('\\','/');
 if(/(?:^|\/)(?:\.env(?:\..*)?|credentials(?:\.json)?|server\.local\.txt|\.private-identifiers\.local\.json)$/.test(normal)&&!normal.endsWith('.env.example'))findings.push({path,rule:'private-config'});
 if(/\.(?:sqlite(?:3)?(?:-wal|-shm)?|db|key|p12|pfx|dump|bak)$/i.test(normal)||/(?:^|\/)(?:data|backups?|\.qa|node_modules|\.cache-dependencies-before-repair)\//.test(normal))findings.push({path,rule:'private-runtime-file'});
 const buffer=readFileSync(path);
 if(buffer.includes(0))continue; // binary captures require separate visual review
 const text=buffer.toString('utf8');
 for(const [rule,pattern] of secretPatterns){
  // Installation docs use explicit illustrative network examples.
  const content=rule==='private-address'&&normal==='docs/INSTALLATION_LINUX.md'?text.replaceAll(['192','168','1','50'].join('.'),'EXAMPLE_ADDRESS'):text;
  if(pattern.test(content))findings.push({path,rule});
 }
 for(const term of privateTerms)if(term&&text.toLowerCase().includes(term.toLowerCase()))findings.push({path,rule:'private-local-identifier'});
 if(/^(?:server|src|scripts)\//.test(normal)&&!normal.endsWith('check-public-repo.mjs')){
  if(/\b(?:password|passwd|apiKey|api_key|access_token|SETUP_TOKEN)\s*[:=]\s*["'][^"'\r\n]{8,}["']/.test(text))findings.push({path,rule:'literal-credential-review'});
 }
}
if(findings.length){
 console.error(JSON.stringify({status:'review-required',findings},null,2));
 process.exitCode=1;
}else console.log('Public-repo check passed: '+new Set(paths).size+' files; no matching credential patterns or private runtime files. Binary images and Git history require separate review.');
