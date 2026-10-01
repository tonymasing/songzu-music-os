import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const url = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString("base64")}`;
const autoUrl = url(await readFile(new URL("../src/lib/auto-score.ts",import.meta.url),"utf8"));
const lib=await import(autoUrl);
const adapter=await import(url((await readFile(new URL("../src/lib/guitar-ai-adapter.ts",import.meta.url),"utf8")).replace('from "@/lib/auto-score"',`from "${autoUrl}"`)));
const fixture={format:"songzu-auto-score",version:1,analyzer:"songzu_local_dsp_v1",targetInstrument:"guitar",bpm:60,musicalKey:"C",timeSignature:"4/4",durationSeconds:4,confidence:100,sourceProfile:"single_instrument",notes:[],drumHits:[],warnings:[],
 chords:[{startSeconds:0,durationSeconds:4,name:"C",root:"C",quality:"",bass:null,confidence:100,reviewStatus:"confirmed",pitches:[48,52,55],guitarFrets:[-1,3,2,0,1,0]}],
 bars:[{index:1,startSeconds:0,endSeconds:4,chords:["C"],notes:[],drumHits:[]}],
 beatConfirmations:[0,1,2,3].map(startSeconds=>({startSeconds,endSeconds:startSeconds+1,name:"C"}))};
const song={id:"synthetic-song",title:"合成測試",bpm:60,musicalKey:"C"};
for(const name of ["Alex","Mei","本機創作者"]) {
 const done=lib.finalizeAutoScoreResult(structuredClone(fixture),name);
 assert.equal(done.review.finalizedBy,name);
 const canonical=adapter.buildFormalGuitarAiCanonicalContent(done,song);
 assert(canonical); assert.equal(canonical.score.review.finalizedBy,name);
 const review={reviewer:"Independent Reviewer",role:"musician",confirmedBeatCount:4,totalBeatCount:4,reviewedAt:new Date().toISOString()};
 const next=lib.applyAutoScoreIndependentReview(done,review);
 assert.equal(next.review.finalizedBy,name);
 assert.throws(()=>lib.applyAutoScoreIndependentReview(done,{...review,reviewer:` ${name.toUpperCase()} `}));
 assert.throws(()=>lib.applyAutoScoreIndependentReview(done,{...review,confirmedBeatCount:3}));
 assert.throws(()=>lib.finalizeAutoScoreResult({...fixture,beatConfirmations:fixture.beatConfirmations.slice(0,3)},name));
}
assert.equal(lib.finalizeAutoScoreResult(fixture).review.finalizedBy,"本機創作者");
console.log("PASS portable score actor, preserved identity, self-review rejection, incomplete-beat rejection");
