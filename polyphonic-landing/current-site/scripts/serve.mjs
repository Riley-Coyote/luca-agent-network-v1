import http from 'node:http';import {readFile,stat} from 'node:fs/promises';import {resolve,extname,sep} from 'node:path';import {gzipSync} from 'node:zlib';
const root=resolve('dist'),port=Number(process.env.PORT||8744);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
http.createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
  const url=new URL(req.url,'http://localhost');const pathname=decodeURIComponent(url.pathname);const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return}
  if(!(await stat(file)).isFile())throw new Error('Not a file');let data=await readFile(file);const type=types[extname(file)]||'application/octet-stream';
  const headers={'Content-Type':type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Cache-Control':'no-cache','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"};
  if(/text|javascript|svg/.test(type)&&(req.headers['accept-encoding']||'').includes('gzip')){data=gzipSync(data);headers['Content-Encoding']='gzip';headers.Vary='Accept-Encoding'}
  headers['Content-Length']=data.length;res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Page not found')}
}).listen(port,'127.0.0.1',()=>console.log(`Polyphonic preview: http://127.0.0.1:${port}/`));
