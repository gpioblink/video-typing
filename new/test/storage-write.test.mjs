import test from 'node:test';
import assert from 'node:assert/strict';
import { saveStoredTypingProgress, loadStoredTypingProgress, replaceStoredTypingProgress, deleteStoredFrameTypingProgress } from '../src/lib/storage.ts';

test('concurrent character/tag writes and explicit retries preserve the latest complete clip state',async()=>{
 const old=globalThis.chrome;let values={};const delay=()=>new Promise(r=>setTimeout(r,2));
 globalThis.chrome={runtime:{id:'test'},storage:{local:{async get(key){const result=structuredClone(values);await delay();return typeof key==='string'?{[key]:result[key]}:result;},async set(next){await delay();Object.assign(values,structuredClone(next));}}}};
 try{
  const frame={finishedCharIds:['0'],tags:[],updatedAt:1};
  await Promise.all([saveStoredTypingProgress('one','a',frame),saveStoredTypingProgress('one','b',frame),saveStoredTypingProgress('two','c',frame)]);
  assert.deepEqual(Object.keys(await loadStoredTypingProgress('one')).sort(),['a','b']);
  const tag={id:'unknown',pastedCharIds:['0'],content:'ignorance'};
  const reset={a:{finishedCharIds:[],tags:[tag],updatedAt:2},b:{finishedCharIds:[],tags:[],updatedAt:2}};
  await Promise.all([saveStoredTypingProgress('one','a',frame),replaceStoredTypingProgress('one',reset)]);
  assert.deepEqual((await loadStoredTypingProgress('one')).a.finishedCharIds,[]);
  assert.equal((await loadStoredTypingProgress('one')).a.tags[0].id,'unknown');
  assert.equal((await loadStoredTypingProgress('two')).c.finishedCharIds[0],'0');
  await Promise.all([saveStoredTypingProgress('one','c',frame),deleteStoredFrameTypingProgress('one','b')]);
  assert.deepEqual(Object.keys(await loadStoredTypingProgress('one')).sort(),['a','c']);
 }finally{if(old===undefined)delete globalThis.chrome;else globalThis.chrome=old;}
});
