import {randomBytes,randomUUID} from 'node:crypto';
import {digest,hashPassword,secretEquals,requireRole} from './auth.mjs';
const error=(message,status=400)=>Object.assign(Error(message),{status});
const emailAddress=value=>{const email=String(value||'').trim().toLowerCase();if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw error('Enter a valid work email');return email;};
export async function bootstrapOwner(store,{email,password,token},{setupToken,ownerEmail}){
 if(!setupToken||setupToken.length<32||!secretEquals(token,setupToken))throw error('Setup authorization required',403);
 email=emailAddress(email);if(!ownerEmail||email!==ownerEmail.trim().toLowerCase())throw error('Use the configured owner email',403);
 const passwordHash=hashPassword(password);
 return store.transaction(s=>{if(s.users.some(u=>u.role==='owner')||s.settings.ownerBootstrapped)throw error('Initial setup is already complete',409);s.users.push({id:randomUUID(),email,role:'owner',passwordHash});s.settings.ownerBootstrapped=true;return {ok:true};});
}
export async function inviteUser(store,actor,{email,role='viewer',purpose='invite',flagManager=false},origin){
 requireRole(actor,['owner']);email=emailAddress(email);if(!['owner','warehouse','viewer'].includes(role)||!['invite','reset'].includes(purpose))throw error('Invalid account permissions');
 const token=randomBytes(32).toString('hex');
 await store.transaction(s=>{
  const existing=s.users.find(u=>u.email.toLowerCase()===email);
  if(purpose==='invite'&&existing)throw error('Account exists; use a password reset link');if(purpose==='reset'&&!existing)throw error('Account not found');
  s.invitations=(s.invitations||[]).filter(i=>i.email!==email&&i.expiresAt>Date.now());
  s.invitations.push({hash:digest(token),email,role:existing?.role||role,flagManager:existing?.flagManager??Boolean(flagManager),purpose,expiresAt:Date.now()+24*3600000,createdBy:actor.id});
  s.events.push({id:randomUUID(),at:new Date().toISOString(),type:'account_link_created',actor:actor.id,email,purpose});
 });
 return {url:origin+'/accept#token='+token,expiresInHours:24};
}
export async function acceptInvitation(store,{token,password}){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw error('Invitation is invalid or expired');
 const passwordHash=hashPassword(password);
 return store.transaction(s=>{
  const invite=(s.invitations||[]).find(i=>i.hash===digest(token)&&i.expiresAt>Date.now());if(!invite)throw error('Invitation is invalid or expired');
  let user=s.users.find(u=>u.email.toLowerCase()===invite.email);
  if(invite.purpose==='reset'){if(!user||user.disabled)throw error('Account is unavailable');user.passwordHash=passwordHash;s.sessions=s.sessions.filter(x=>x.userId!==user.id);}
  else{if(user)throw error('Account already exists');user={id:randomUUID(),email:invite.email,role:invite.role,flagManager:invite.flagManager,passwordHash};s.users.push(user);}
  s.invitations=s.invitations.filter(i=>i.hash!==invite.hash);
  s.events.push({id:randomUUID(),at:new Date().toISOString(),type:'account_link_accepted',userId:user.id,purpose:invite.purpose});return {ok:true,email:user.email};
 });
}
export async function disableUser(store,actor,id){requireRole(actor,['owner']);if(id===actor.id)throw error('You cannot disable your own account');return store.transaction(s=>{const user=s.users.find(u=>u.id===id);if(!user)throw error('Account not found');if(user.role==='owner'&&s.users.filter(u=>u.role==='owner'&&!u.disabled).length<=1)throw error('Keep at least one active owner');user.disabled=true;s.sessions=s.sessions.filter(x=>x.userId!==id);s.events.push({id:randomUUID(),at:new Date().toISOString(),type:'account_disabled',actor:actor.id,userId:id});return {ok:true};});}
