// Local mock of the polyphonic.chat front door. Serves:
//   /            -> home/ (the new root landing)
//   /web/        -> home/web/ (the web-app door, re-skinned)
//   /beta/       -> current-site/dist (the desktop beta page, as built)
//   /assets/     -> current-site/assets (fonts, tokens, engines shared by all)
import http from 'node:http';import {readFile,stat} from 'node:fs/promises';import {resolve,extname,sep,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const roots={home:here,beta:resolve(here,'../current-site/dist'),assets:resolve(here,'../current-site/assets')};
const port=Number(process.env.PORT||8746);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8'};
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');let pathname=decodeURIComponent(url.pathname);
  if(pathname==='/beta'||pathname==='/web'){res.writeHead(302,{Location:pathname+'/'+url.search});res.end();return}
  let root=roots.home,rel=pathname;
  if(pathname.startsWith('/beta/')){root=roots.beta;rel=pathname.slice(5)}
  else if(pathname.startsWith('/assets/')){root=roots.assets;rel=pathname.slice(7)}
  if(rel.endsWith('/'))rel+='index.html';
  const file=resolve(root,'.'+rel);
  if(!file.startsWith(root+sep))throw new Error('outside root');
  if(!(await stat(file)).isFile())throw new Error('not a file');
  const data=await readFile(file);
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'"});
  res.end(data);
 }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found')}
}).listen(port,'127.0.0.1',()=>console.log(`Polyphonic front-door mock: http://127.0.0.1:${port}/`));
