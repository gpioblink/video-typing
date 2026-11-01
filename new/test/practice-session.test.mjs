import test from 'node:test';
import assert from 'node:assert/strict';
import { historyPracticeClip, practiceStorageKey, restartTypingProgress } from '../src/lib/practiceSession.ts';

test('history round trip preserves clip boundaries and rejects unsafe videos or ranges',()=>{
 const item={url:'https://www.youtube.com/watch?v=abcdefghijk&start=10&end=40',title:'Test',typingProgress:{},updatedAt:1,subtitle:{fileName:'test.srt',cues:[{start:12,end:14,text:'Test words.'}]}};
 const clip=historyPracticeClip(item);assert.equal(clip.start,10);assert.equal(clip.end,40);assert.equal(practiceStorageKey(clip),item.url);
 for(const url of ['javascript:alert(1)','https://evil.test/watch?v=abcdefghijk','https://www.youtube.com/watch?v=abcdefghijk&start=NaN&end=40','https://www.youtube.com/watch?v=abcdefghijk&start=50&end=40'])assert.throws(()=>historyPracticeClip({...item,url}));
});
test('retry clears typed letters but preserves unresolved hint metadata until successful review',()=>{
 const tags=[{id:'tag',content:'ignorance',pastedCharIds:['0'],hint:{headword:'test',meaning:'meaning',selectedText:'test',selectedAt:1}}];
 const progress={frame:{finishedCharIds:['0','1'],tags,updatedAt:5}};
 const retry=restartTypingProgress(progress);assert.deepEqual(retry.frame.finishedCharIds,[]);assert.deepEqual(retry.frame.tags,tags);assert.deepEqual(progress.frame.finishedCharIds,['0','1']);
 const solved=restartTypingProgress({frame:{...progress.frame,tags:[]}});assert.deepEqual(solved.frame.tags,[]);
});
