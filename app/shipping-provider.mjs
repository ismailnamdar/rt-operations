import {ParselCarrier} from './parsel.mjs';
export class DisabledCarrier{
 constructor(){this.disabled=true;}
 unavailable(){throw Object.assign(Error('Shipping is disconnected. Connect Parsel before booking, retrieving or printing labels.'),{status:503});}
 async preflight(){this.unavailable();}async buy(){this.unavailable();}async lookup(){this.unavailable();}async label(){this.unavailable();}async quote(){this.unavailable();}
}
export function shippingProvider(env){if(env.PARSEL_ENABLED!=='1')return new DisabledCarrier();if(!env.PARSEL_TOKEN)throw Error('Parsel is enabled but its private token is missing');return new ParselCarrier({token:env.PARSEL_TOKEN,baseUrl:env.PARSEL_BASE_URL||'https://api.parsel.app',liveBooking:false,labelHosts:(env.PARSEL_LABEL_HOSTS||'').split(',').filter(Boolean)});}
