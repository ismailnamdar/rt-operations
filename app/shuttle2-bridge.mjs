// Local-only compatibility bridge: retain the existing SHUTTLE 2.0 runtime and receipts.
// Never enabled by the Vercel runtime or bundled with account credentials.
const POST_PATHS=new Set(['/api/run','/api/setup','/api/resume','/api/review/save','/api/review/delete','/api/approve','/api/reconcile','/api/email-template','/api/lukas-todo/complete','/api/mockup-batches/save','/api/mockup-batches/submit','/api/order-actions','/api/order-action','/api/inventory/import','/api/schedule','/api/fulfill','/api/decisions','/api/answers','/api/answer','/api/run-control','/api/cancel']);
const GET_PATHS=new Set(['/api/run-detail','/api/mockup/history','/api/production/asset']);
export class Shuttle2Bridge{
 constructor(origin,{fetchImpl=fetch}={}){const url=new URL(origin);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('SHUTTLE 2.0 bridge requires a fixed loopback origin');this.origin=url.origin;this.fetch=fetchImpl;}
 handles(method,pathname){return method==='POST'?POST_PATHS.has(pathname):method==='GET'&&(GET_PATHS.has(pathname)||/^\/assets\/[a-zA-Z0-9_.-]+\.(png|jpg|svg)$/.test(pathname));}
 async source(){const response=await this.fetch(this.origin+'/api/state',{signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok)throw Error('SHUTTLE 2.0 connection unavailable');const value=await response.json();if(!value.token||!value.results||!Array.isArray(value.runs))throw Error('SHUTTLE 2.0 response incomplete');this.cached=value;return value;}
 async snapshot(){try{return await this.source();}catch{return {...(this.cached||{results:{review:[],questions:[],gallery:[],history:[],alerts:[]},runs:[],pipeline:{orders:[]},unfulfilled:{orders:[]}}),connection:{ready:false,message:'The original SHUTTLE 2.0 runtime is unavailable. Existing agent actions are paused; saved reviews remain visible.'}};}}
 async request(method,path,body){const url=new URL(path,this.origin);if(url.origin!==this.origin||!this.handles(method,url.pathname))throw Object.assign(Error('Unsupported SHUTTLE 2.0 action'),{status:404});
  const source=method==='POST'?await this.source():null;
  const response=await this.fetch(url,{method,headers:method==='POST'?{'Content-Type':'application/json',Origin:this.origin,'X-Shuttle-Token':source.token}:{},body:method==='POST'?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000),redirect:'error'});
  return {status:response.status,type:response.headers.get('content-type')||'application/json',bytes:Buffer.from(await response.arrayBuffer())};
 }
}
