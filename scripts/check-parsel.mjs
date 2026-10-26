// Read-only probe. Credentials stay in local.env or server environment; no customer rows are printed.
import {ParselCarrier} from '../app/parsel.mjs';
try {process.loadEnvFile(new URL('../data/local.env',import.meta.url));}catch(e){if(e.code!=='ENOENT')throw e;}
if(!process.env.PARSEL_TOKEN){console.log('Parsel: no private API token configured. No request made.');process.exitCode=1;}
else {try {const client=new ParselCarrier({token:process.env.PARSEL_TOKEN,baseUrl:process.env.PARSEL_BASE_URL||'https://api.parsel.app'});await client.request('/shipments');console.log('Parsel: authenticated shipment read succeeded. Booking and printing remain unverified and disabled.');}catch{console.log('Parsel: authenticated shipment read failed. Check token, endpoint and READ_SHIPMENTS permission privately.');process.exitCode=1;}}
