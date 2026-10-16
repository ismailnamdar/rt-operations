import {runtime} from '../app/vercel-runtime.mjs';
export default async function handler(req,res){
 try{const app=await runtime();const url=new URL(req.url,app.origin);const rewritten=url.searchParams.get('__shuttle_path');if(rewritten){if(!rewritten.startsWith('/')||rewritten.startsWith('//'))throw Error('Invalid route');url.pathname=rewritten;url.searchParams.delete('__shuttle_path');req.url=url.pathname+url.search;}
 return await app.handler(req,res);
 }catch{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'SHUTTLE configuration needs attention. Check the private deployment settings.'}));}
}
