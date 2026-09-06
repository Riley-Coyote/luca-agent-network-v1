import { runeWalk, seeded } from "./_rune-core.mjs";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const N = Number(process.argv[2] ?? 4000);
const keys = Array.from({ length: N }, (_, i) => createHash("sha256").update(`stress:${i}`).digest("hex"));

// ---- raster similarity: 16x16 thick-line bitmap, IoU ---------------------
const G = 16;
function raster(P, mirror) {
  const bits = new Uint8Array(G*G);
  const stamp = (x, y) => { const cx = Math.round(x/100*(G-1)), cy = Math.round(y/100*(G-1)); for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++){ const X=cx+dx, Y=cy+dy; if (X>=0&&Y>=0&&X<G&&Y<G && (dx===0||dy===0)) bits[Y*G+X]=1; } };
  const draw = (pts) => { for (let i=0;i<pts.length-1;i++){ const [x0,y0]=pts[i], [x1,y1]=pts[i+1]; const n=Math.ceil(Math.hypot(x1-x0,y1-y0)/2); for (let k=0;k<=n;k++){ const t=k/n; stamp(x0+(x1-x0)*t, y0+(y1-y0)*t); } } };
  draw(P); if (mirror) draw(P.map(([x,y]) => [100-x, y]));
  if (arguments[2]) { const [x,y] = arguments[2]; stamp(x,y); if (mirror) stamp(100-x, y); }
  return bits;
}
function iou(a, b) { let inter=0, uni=0; for (let i=0;i<a.length;i++){ const x=a[i], y=b[i]; inter += x & y; uni += x | y; } return uni ? inter/uni : 1; }
function canonDots(r) { const pts = r.P.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`); if (r.dot) pts.push(`${r.dot[0].toFixed(1)},${r.dot[1].toFixed(1)}`); return (r.mirror?"m":"a") + ":" + pts.sort().join(";"); }
function canon(r) { return (r.mirror?"m":"a") + ":" + r.P.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(";") + (r.dot ? `|${r.dot[0].toFixed(1)},${r.dot[1].toFixed(1)}` : ""); }

function study(label, make) {
  const t0 = Date.now(); const items = keys.map((k) => { const r = make(k); return { key: k, r, bits: raster(r.P, r.mirror, r.dot), canon: canon(r) }; });
  const seen = new Map(); let exact = 0; for (const it of items){ if (seen.has(it.canon)) exact++; else seen.set(it.canon, it.key); }
  let near = 0; const pairs = [];
  for (let i=0;i<items.length;i++) for (let j=i+1;j<items.length;j++){ if (items[i].canon === items[j].canon) continue; const s = iou(items[i].bits, items[j].bits); if (s >= .8){ near++; if (pairs.length < 400) pairs.push([items[i].key, items[j].key, +s.toFixed(3)]); } }
  pairs.sort((a,b)=>b[2]-a[2]);
  const dotsSeen = new Set(items.map((it) => canonDots(it.r))); const dotDistinct = dotsSeen.size / items.length;
  const distinct = seen.size / items.length;
  const mirrored = items.filter((it)=>it.r.mirror).length / items.length;
  console.log(`${label}: n=${items.length} distinct=${(distinct*100).toFixed(2)}% exactDup=${exact} nearPairs(IoU>=.8)=${near} (${(near/(items.length*(items.length-1)/2)*100).toFixed(4)}% of pairs) mirrored=${(mirrored*100).toFixed(0)}% dotsForm=${(dotDistinct*100).toFixed(2)}% ${Date.now()-t0}ms`);
  return { label, n: items.length, distinct, dotDistinct, exact, near, nearShare: near/(items.length*(items.length-1)/2), pairs: pairs.slice(0, 8), mirrored };
}

const v1 = study("v1  4-7, dot 40%, mirror 12%           ", (k) => runeWalk(k, { fixed: true, lenMax: 7, dotP: .4, mirrorP: .12 }));
const v2 = study("v2  same, fill small walks to the box  ", (k) => runeWalk(k, { fixed: true, lenMax: 7, dotP: .4, mirrorP: .12, fill: true }));
const v3 = v1, v4 = v2, v5 = v2;
const fixed = v3, scaled = v4;

// calibration: the current 7x7 system under the same raster metric
const N7=7, AREA=49, MIN_LIT=17, MAX_LIT=23, MAX_LOOSE=4, P_MIN=.38, P_SPAN=.1, CAP=150000, RELAXED=40000;
function orbitsFor(sym){ const partner=(x,y)=>sym==="mirror"?[N7-1-x,y]:[N7-1-x,N7-1-y]; const claimed=new Uint8Array(AREA), out=[]; for (let y=0;y<N7;y++) for (let x=0;x<N7;x++){ const h=y*N7+x; if(claimed[h]) continue; const [px,py]=partner(x,y); const t=py*N7+px; claimed[h]=1; claimed[t]=1; out.push(h===t?[h]:[h,t]); } return out; }
const ORB={mirror:orbitsFor("mirror"),rot2:orbitsFor("rot2")}; const scratch=new Uint8Array(AREA), visited=new Uint8Array(AREA), frontier=new Int32Array(AREA);
const rims=(c)=>{let t=0,b=0,l=0,r=0; for(let i=0;i<N7;i++){t|=c[i];b|=c[(N7-1)*N7+i];l|=c[i*N7];r|=c[i*N7+N7-1];} return t&&b&&l&&r;};
const noQuad=(c)=>{for(let y=0;y<N7-1;y++){const row=y*N7; for(let x=0;x<N7-1;x++){ if(c[row+x]&&c[row+x+1]&&c[row+N7+x]&&c[row+N7+x+1]) return false; }} return true;};
const loose=(c,stop)=>{let e=0; for(let y=0;y<N7;y++) for(let x=0;x<N7;x++){const i=y*N7+x; if(!c[i]) continue; let d=0; if(x>0&&c[i-1])d++; if(x<N7-1&&c[i+1])d++; if(y>0&&c[i-N7])d++; if(y<N7-1&&c[i+N7])d++; if(d===1){e++; if(e>stop) return e;}} return e;};
const onePiece=(c,lit)=>{let s=-1; for(let i=0;i<AREA;i++) if(c[i]){s=i;break;} if(s<0) return false; visited.fill(0); let top=0; frontier[top++]=s; visited[s]=1; let reached=0; while(top){const k=frontier[--top]; reached++; const x=k%N7,y=(k/N7)|0; if(x>0&&c[k-1]&&!visited[k-1]){visited[k-1]=1;frontier[top++]=k-1;} if(x<N7-1&&c[k+1]&&!visited[k+1]){visited[k+1]=1;frontier[top++]=k+1;} if(y>0&&c[k-N7]&&!visited[k-N7]){visited[k-N7]=1;frontier[top++]=k-N7;} if(y<N7-1&&c[k+N7]&&!visited[k+N7]){visited[k+N7]=1;frontier[top++]=k+N7;}} return reached===lit;};
const propose=(orbits,p,rnd)=>{scratch.fill(0); let lit=0; for(const o of orbits){ if(rnd()>=p) continue; for(const k of o) scratch[k]=1; lit+=o.length;} return lit;};
const search=(orbits,rnd,cap,tidy)=>{for(let d=0;d<cap;d++){const lit=propose(orbits,P_MIN+rnd()*P_SPAN,rnd); if(lit<MIN_LIT||lit>MAX_LIT) continue; if(!rims(scratch)) continue; if(!noQuad(scratch)) continue; if(tidy&&loose(scratch,MAX_LOOSE)>MAX_LOOSE) continue; if(!onePiece(scratch,lit)) continue; return scratch.slice();} return null;};
function current(seed){ const rnd=seeded(seed); const sym=rnd()<.5?"mirror":"rot2"; const cells=search(ORB[sym],rnd,CAP,true)??search(ORB[sym],rnd,RELAXED,false)??new Uint8Array(AREA); const P=[]; /* as a set of cell centres, rasterised the same way */ const pts=[]; for(let y=0;y<N7;y++) for(let x=0;x<N7;x++) if(cells[y*N7+x]) pts.push([(x+.5)/N7*100,(y+.5)/N7*100]); return { P: pts, mirror:false, cells }; }
// raster for the current system: stamp each lit cell (no segments)
const NC = Math.min(N, 1500);
{ const t0=Date.now(); const items = keys.slice(0, NC).map((k)=>{ const r=current(k); const bits=new Uint8Array(G*G); for (const [x,y] of r.P){ const cx=Math.round(x/100*(G-1)), cy=Math.round(y/100*(G-1)); for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){ const X=cx+dx,Y=cy+dy; if(X>=0&&Y>=0&&X<G&&Y<G&&(dx===0||dy===0)) bits[Y*G+X]=1; } } return { key:k, bits, canon: Array.from(r.cells).join("") }; });
  const seen=new Set(); let exact=0; for (const it of items){ if(seen.has(it.canon)) exact++; else seen.add(it.canon); }
  let near=0; for (let i=0;i<items.length;i++) for (let j=i+1;j<items.length;j++){ if(items[i].canon===items[j].canon) continue; if (iou(items[i].bits,items[j].bits)>=.8) near++; }
  console.log(`current 7x7 (calibration): n=${items.length} distinct=${(seen.size/items.length*100).toFixed(2)}% exactDup=${exact} nearPairs(IoU>=.8)=${near} (${(near/(items.length*(items.length-1)/2)*100).toFixed(4)}% of pairs) ${Date.now()-t0}ms`);
  writeFileSync(new URL("./_rune-stress.json", import.meta.url), JSON.stringify({ v1, v2, v3, v4, v5, current: { n: items.length, distinct: seen.size/items.length, exact, near, nearShare: near/(items.length*(items.length-1)/2) } }, null, 1));
}
