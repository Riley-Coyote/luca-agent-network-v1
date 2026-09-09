import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await cp('assets','dist/assets',{recursive:true});
await cp('index.html','dist/index.html');
await writeFile('dist/robots.txt','User-agent: *\nDisallow: /\n');
const html=await readFile('index.html','utf8');
if(html.includes('{{')||html.includes('x-dc'))throw new Error('Editor template remains in output');
console.log('Built dist/: static HTML and self-hosted assets. Preview indexing remains disabled.');
