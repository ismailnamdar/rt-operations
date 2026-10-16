import {createStore} from './store.mjs';
import {hashPassword} from './auth.mjs';
import {randomUUID} from 'node:crypto';
const [email,role='viewer']=process.argv.slice(2);
if(!email||!['owner','warehouse','viewer'].includes(role))throw Error('Usage: node app/users.mjs EMAIL owner|warehouse|viewer; provide SHUTTLE_NEW_PASSWORD in the environment');
const hash=hashPassword(process.env.SHUTTLE_NEW_PASSWORD),store=await createStore();
await store.transaction(s=>{if(s.users.some(u=>u.email.toLowerCase()===email.toLowerCase()))throw Error('User already exists');s.users.push({id:randomUUID(),email,role,passwordHash:hash});return true;});await store.close();console.log('User created; no credentials printed.');
