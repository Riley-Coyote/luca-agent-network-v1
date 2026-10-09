import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {webcrypto} from "node:crypto";
import vm from "node:vm";

const source=await readFile(new URL("../service-worker.js",import.meta.url),"utf8");
const context={URL,TextEncoder,crypto:webcrypto,setTimeout,clearTimeout};
vm.runInNewContext(source,context);
const core=context.BrowserAwarenessCore;

async function fixture(options={}) {
  const requests=[];
  const selected={id:1,url:"https://example.com/article?token=PRIVATE",incognito:false,...options.tab};
  let probes=0;
  let bookmarkReads=0;
  let storageAccess;
  let saved={profile_instance_id:"profile-sentinel",token:"x".repeat(32),sequence:0,visits:true,bookmarks:true,excerpts:true,origins:["https://example.com"],...options.saved};
  const replies=[];
  const external=[];
  const api={
    storage:{local:{setAccessLevel:async(value)=>{storageAccess=value.accessLevel;},get:async()=>({profile:saved}),set:async(value)=>{saved=value.profile;}}},
    runtime:{id:"test-extension",getURL:()=>"chrome-extension://test-extension/",onMessage:{addListener:(listener)=>external.push(listener)},connectNative:()=>({
      onMessage:{addListener:(listener)=>replies.push(listener)},onDisconnect:{addListener:()=>{}},
      postMessage:(frame)=>{
        requests.push(frame.request);
        const response=frame.request.kind==="observe"
          ? {kind:"receipt",event_id:frame.request.event.event_id,admitted:true}
          : {kind:"status",profile_instance_id:"profile-sentinel",collection_enabled:options.active!==false,allowed_kinds:options.kinds||["visit","bookmark","excerpt"]};
        queueMicrotask(()=>replies[0]({protocol:frame.protocol,request_id:frame.request_id,response}));
      },
    })},
    permissions:{contains:async(query)=>query.origins ? options.origin!==false : options.history!==false,onRemoved:{addListener:()=>{}}},
    tabs:{query:async()=>[selected],get:async()=>({...selected,...options.current})},
    scripting:{executeScript:async()=>{probes++;return [{frameId:0,result:options.probe||{allowed:true,url:"https://example.com/article",title:"Article",excerpt:"Explicit selected text"}}];}},
    history:{onVisited:{addListener:()=>{}}},bookmarks:{search:async(query)=>{bookmarkReads++;return query.url===selected.url?[{id:"1"}]:[];}},
  };
  const worker=core.createWorker(api);
  await worker.ready;
  return {worker,requests,external,get probes(){return probes;},get bookmarkReads(){return bookmarkReads;},get saved(){return saved;},get storageAccess(){return storageAccess;}};
}
test("unpaired, missing origin permission and private tabs never probe or ingest",async()=>{
  for(const options of [{saved:{token:null}},{origin:false},{tab:{incognito:true}},{history:false}]) {
    const f=await fixture(options);
    assert.equal(await f.worker.visit({url:"https://example.com/article"}),false);
    assert.equal(f.probes,0);
    assert.equal(f.requests.filter((value)=>value.kind==="observe").length,0);
    assert.equal(f.storageAccess,"TRUSTED_CONTEXTS");
  }
});
test("app Pause is checked before a privacy probe",async()=>{
  const f=await fixture({active:false});
  assert.equal(await f.worker.visit({url:"https://example.com/article"}),false);
  assert.equal(f.probes,0);
  assert.deepEqual(f.requests.map((value)=>value.kind),["status"]);
});
test("unsafe pages and a navigation race cannot reach native observation",async()=>{
  for(const options of [{probe:{allowed:false,reason:"credential_page"}},{current:{url:"https://another.example/new"}},{probe:{allowed:true,url:"https://another.example/new",title:"Unrelated",excerpt:null}}]) {
    const f=await fixture(options);
    await assert.rejects(f.worker.visit({url:"https://example.com/article"}));
    assert.equal(f.requests.some((value)=>value.kind==="observe"),false);
  }
});
test("corroborated visits are query-free, text-free, changed-state and profile-bound",async()=>{
  const f=await fixture();
  assert.equal(await f.worker.visit({url:"https://example.com/article"}),true);
  assert.equal(await f.worker.visit({url:"https://example.com/article"}),false);
  const observed=f.requests.filter((value)=>value.kind==="observe");
  assert.equal(observed.length,1);
  assert.equal(observed[0].profile_instance_id,"profile-sentinel");
  assert.equal(observed[0].event.url,"https://example.com/article");
  assert.equal(observed[0].event.excerpt,null);
  assert.ok(!JSON.stringify(f.saved).includes("Explicit selected text"));
  assert.ok(!JSON.stringify(f.saved).includes("PRIVATE"));
});
test("an excerpt needs its own local and app kind authority",async()=>{
  const disabled=await fixture({saved:{excerpts:false}});
  await assert.rejects(disabled.worker.share("excerpt"));
  assert.equal(disabled.probes,0);
  const notGranted=await fixture({kinds:["visit"]});
  assert.equal((await notGranted.worker.share("excerpt")).admitted,false);
  assert.equal(notGranted.probes,0);
  const f=await fixture({origin:false});
  assert.equal((await f.worker.share("excerpt")).admitted,true);
  const observed=f.requests.find((value)=>value.kind==="observe");
  assert.equal(observed.event.kind,"excerpt");
  assert.equal(observed.event.excerpt,"Explicit selected text");
});
test("unpaired or app-ungranted bookmark sharing never queries the bookmark database",async()=>{
  for(const options of [{saved:{token:null}},{kinds:["visit"]},{active:false}]) {
    const f=await fixture(options);
    assert.equal((await f.worker.share("bookmark")).admitted,false);
    assert.equal(f.bookmarkReads,0);
    assert.equal(f.probes,0);
  }
});
test("webpage or content-script messages cannot invoke the native bridge",async()=>{
  const f=await fixture();
  for(const sender of [{id:"different-extension",url:"chrome-extension://other/popup.html"},{id:"test-extension",url:"https://example.com/"}]) {
    assert.equal(f.external[0]({kind:"pair",code:"123456"},sender,()=>{throw Error("should not reply");}),false);
  }
  assert.equal(f.requests.length,0);
});
