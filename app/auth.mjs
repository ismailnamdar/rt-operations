import {scryptSync,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
export const digest=x=>createHash('sha256').update(x).digest('hex');
export function hashPassword(password){if(typeof password!=='string'||(password.length<14||password.length>256))throw Error('Use a password of at least 14 characters');const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function verifyPassword(password,stored){try{const [salt,hex]=stored.split(':');const expected=Buffer.from(hex,'hex'),actual=scryptSync(String(password),salt,64);return actual.length===expected.length&&timingSafeEqual(actual,expected);}catch{return false;}}
export function secretEquals(a,b){if(!b)return false;const x=Buffer.from(String(a||'')),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function requireRole(user,roles){if(!user||!roles.includes(user.role))throw Object.assign(Error('Your role cannot perform this action'),{status:403});}
export async function login(store,email,password,clientKey='local'){
 const normalized=String(email||'').trim().toLowerCase();if(normalized.length>254||typeof password!=='string'||password.length>256)throw Object.assign(Error('Email or password is incorrect'),{status:401});
 const result=await store.transaction(s=>{
  s.loginAttempts||={};const now=Date.now();for(const [key,value] of Object.entries(s.loginAttempts))if(value.until<=now)delete s.loginAttempts[key];
  const keys=[digest('email:'+normalized),digest('client:'+clientKey)],limits=[10,50];
  if(keys.some((key,i)=>(s.loginAttempts[key]?.count||0)>=limits[i]))return {error:'Too many login attempts; retry in 15 minutes',status:429};
  if(Object.keys(s.loginAttempts).length>4000)return {error:'Sign-in temporarily busy; retry later',status:429};
  for(const key of keys){s.loginAttempts[key]||={count:0,until:now+900000};s.loginAttempts[key].count++;}
  const u=s.users.find(u=>u.email.toLowerCase()===normalized&&!u.disabled);
  if(!u||!verifyPassword(password,u.passwordHash))return {error:'Email or password is incorrect',status:401};
  delete s.loginAttempts[keys[0]];
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');s.sessions=s.sessions.filter(x=>x.expiresAt>now);s.sessions.push({hash:digest(token),userId:u.id,csrf,expiresAt:now+8*3600_000});
  return {token,csrf,user:{id:u.id,email:u.email,role:u.role}};
 });
 if(result.error)throw Object.assign(Error(result.error),{status:result.status});return result;
}
export function sessionFor(state,token){if(!token)return null;const session=state.sessions.find(s=>s.hash===digest(token)&&s.expiresAt>Date.now());const user=session&&state.users.find(u=>u.id===session.userId&&!u.disabled);return user?{session,user}:null;}
