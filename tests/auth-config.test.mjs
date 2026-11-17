import test from 'node:test';
import assert from 'node:assert/strict';
import { accessConfig, secret } from '../server/auth.mjs';
test('Adresse externe normalisée et cookies HTTPS automatiques',()=>{
  assert.deepEqual(accessConfig({APP_URL:'https://temps.example.ch/'}),{publicOrigin:'https://temps.example.ch',secureCookies:true});
  assert.equal(accessConfig({APP_URL:'http://localhost:4310'}).secureCookies,false);
  assert.equal(accessConfig({PUBLIC_ORIGIN:'https://ancien.example.ch'}).secureCookies,true);
  for(const APP_URL of ['temps.example.ch','https://a.ch/chemin','ftp://a.ch','https://user:pass@a.ch','https://a.ch/?x=1'])assert.throws(()=>accessConfig({APP_URL}));
  assert.equal(secret(' 12345678 ',true),' 12345678 ');
});
