import {servePublicResource} from '../app/public-resources.mjs';
export default async function handler(req,res){
 try{if(await servePublicResource(req,res))return;const {runtime}=await import('../app/vercel-runtime.mjs');const app=await runtime();const url=new URL(req.url,app.origin);const rewritten=url.searchParams.get('__shuttle_path');if(rewritten){if(!rewritten.startsWith('/')||rewritten.startsWith('//'))throw Error('Invalid route');url.pathname=rewritten;url.searchParams.delete('__shuttle_path');req.url=url.pathname+url.search;}
 return await app.handler(req,res);
 }catch(error){console.error('SHUTTLE request failed:',error?.message);if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'SHUTTLE configuration needs attention. Check the private deployment settings.'}));}
}
