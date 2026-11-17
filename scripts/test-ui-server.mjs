import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createApplication } from '../server/index.mjs';
const qa = resolve('.qa');
await mkdir(qa, { recursive:true });
const fixture = await mkdtemp(join(qa,'react-browser-'));
const app=createApplication({
 dbPath:join(fixture,'demo.sqlite'),demo:true,
 frontendDir:resolve('dist/web'),publicOrigin:'http://127.0.0.1:4313'
});
app.server.listen(4313,'127.0.0.1',()=>console.log('React browser fixture: http://127.0.0.1:4313'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{
 await app.close();await rm(fixture,{recursive:true,force:true});process.exit(0);
});
