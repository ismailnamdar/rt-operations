const LOOPBACK=['localhost','127.0.0.1','[::1]'];
function parse(value){
 const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('Set an exact SHUTTLE origin without a path');
 if(url.protocol==='http:'&&!LOOPBACK.includes(url.hostname))throw Error('SHUTTLE requires HTTPS outside this computer');
 return url.origin;
}
// Vercel exposes bare hostnames; loopback hosts (vercel dev) are served over plain HTTP.
function fromHost(host){if(!host)return null;const hostname=new URL('http://'+host).hostname;return parse((LOOPBACK.includes(hostname)?'http://':'https://')+host);}
export function localOrigins(port=43841){return LOOPBACK.map(host=>`http://${host}:${port}`);}
// canonical: the single public address used for Shopify OAuth, webhooks and invitations.
// allowed: every address a browser may legitimately use, including Vercel preview URLs.
export function resolveOrigins(env,{port}={}){
 const explicit=env.SHUTTLE_ORIGIN?parse(env.SHUTTLE_ORIGIN):null;
 const vercel=[env.VERCEL_PROJECT_PRODUCTION_URL,env.VERCEL_BRANCH_URL,env.VERCEL_URL].map(fromHost).filter(Boolean);
 const local=!explicit&&!vercel.length&&port?localOrigins(port):[];
 const canonical=explicit||vercel[0]||local[0];if(!canonical)throw Error('Set SHUTTLE_ORIGIN or deploy on Vercel');
 return {canonical,allowed:[...new Set([canonical,...vercel,...local])]};
}
