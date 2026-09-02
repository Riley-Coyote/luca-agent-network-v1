// Long-exposure the field: composite N frames with a per-pixel max so grains draw their own
// paths. Long smooth streaks = laminar, graceful flow. Short scattered specks = chaotic churn.
// Tile-density statistics cannot tell those two apart; this can.
//
//   node chamber-streaks.mjs <outfile.png> [--n=60000] [--frames=20] [--gap=60] [--tune='{"viscosity":0}']
import { createRequire } from "node:module";
const require = createRequire("/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/desktop/package.json");
const { chromium } = require("@playwright/test");
const argv = process.argv.slice(2);
const out = argv.find(a=>!a.startsWith("--")) || "./streaks.png";
const arg = (k,d)=>{ const m=argv.find(a=>a.startsWith(`--${k}=`)); return m? m.slice(k.length+3) : d; };
const tune = JSON.parse(arg("tune","{}"));

const b = await chromium.launch({ args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport:{width:1440,height:900}, deviceScaleFactor:1 });
p.setDefaultTimeout(180000);
await p.goto(`file:///Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/design-artifacts/landing/chamber.html?n=${arg("n","60000")}`);
await p.waitForFunction(()=>window.__aperture,null,{timeout:20000});
await p.evaluate(t=>Object.assign(window.__tune,t), tune);
await p.waitForTimeout(16000);
await p.evaluate(()=>{for(const e of document.querySelectorAll("body > *")) if(e.id!=="field") e.style.opacity="0";});

const frames=[]; const N=+arg("frames","20"), gap=+arg("gap","60");
for(let i=0;i<N;i++){ frames.push((await p.screenshot()).toString("base64")); await p.waitForTimeout(gap); }

const dataUrl = await p.evaluate(async (fs)=>{
  const load=async u=>{ const i=new Image(); await new Promise(r=>{i.onload=r;i.src="data:image/png;base64,"+u}); return i; };
  const first=await load(fs[0]);
  const cv=document.createElement('canvas'); cv.width=first.width; cv.height=first.height;
  const g=cv.getContext('2d'); g.drawImage(first,0,0);
  let acc=g.getImageData(0,0,cv.width,cv.height);
  for(let k=1;k<fs.length;k++){
    const img=await load(fs[k]); g.clearRect(0,0,cv.width,cv.height); g.drawImage(img,0,0);
    const d=g.getImageData(0,0,cv.width,cv.height).data;
    for(let i=0;i<d.length;i++) if(d[i]>acc.data[i]) acc.data[i]=d[i];
  }
  g.putImageData(acc,0,0); return cv.toDataURL('image/png');
}, frames);

const { writeFileSync } = await import("node:fs");
writeFileSync(out, Buffer.from(dataUrl.split(",")[1],"base64"));
console.log(out, JSON.stringify(tune), "fps", await p.evaluate(()=>Math.round(window.__aperture.fps)));
await b.close();
