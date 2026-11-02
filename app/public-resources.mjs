import fs from 'node:fs/promises';
import {resolveOrigins} from './origins.mjs';
import {SupabaseAuth} from './supabase-auth.mjs';
const cache=new Map();
const security={
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
// Public compiled files and login configuration contain no customer records.
// Keep them independent of PostgreSQL initialization, locks and provider sync.
export async function servePublicResource(req,res,env=process.env){
 const {canonical,allowed}=resolveOrigins(env),origin=allowed.find(o=>new URL(o).host===req.headers.host);
 if(!origin){res.writeHead(403,{...security,'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Unexpected host'}));return true;}
 if(req.method!=='GET')return false;
 const url=new URL(req.url,canonical),rewritten=url.searchParams.get('__shuttle_path');
 if(rewritten){if(!rewritten.startsWith('/')||rewritten.startsWith('//'))throw Error('Invalid route');url.pathname=rewritten;}
 if(url.pathname==='/'&&!String(req.headers.cookie||'').split(';').some(p=>p.trim().startsWith('shuttle_session='))){res.writeHead(302,{...security,Location:'/login','Cache-Control':'no-store'});res.end();return true;}
 if(url.pathname==='/auth/config'){
  const auth=new SupabaseAuth({url:env.SUPABASE_URL,key:env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY});res.writeHead(200,{...security,'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({provider:'supabase',configured:auth.configured()}));return true;
 }
 const filename=url.pathname==='/login'?'login.html':/^\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:js|css|svg)$/.test(url.pathname)?url.pathname.slice(1):null;
 if(!filename)return false;
 let bytes=cache.get(filename);if(!bytes){try{bytes=await fs.readFile(new URL('./public/'+filename,import.meta.url));}catch(error){if(error.code==='ENOENT')return false;throw error;}cache.set(filename,bytes);}
 const type=filename.endsWith('.html')?'text/html':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'image/svg+xml';res.writeHead(200,{...security,'Content-Type':type,'Cache-Control':'no-store'});res.end(bytes);return true;
}
