import {fingerprint,fail} from './shipping.mjs';
import {randomUUID} from 'node:crypto';
export class MockCarrier {
 constructor(){this.purchases=0;this.bookings=new Map();}
 async preflight(p){return {sourceVersion:p.sourceVersion,approvalHash:fingerprint(p),paymentVerified:p.paymentVerified,qcPassed:p.units.every(u=>u.qcPassed),hold:false,existingBooking:this.bookings.get(p.shipmentId),rates:[{id:p.rateId,carrier:p.carrier,service:p.service,currency:p.currency,costCents:p.maxCostCents}]};}
 async buy(p){this.purchases++;const b={id:randomUUID(),tracking:'TEST-'+randomUUID().slice(0,8),carrier:p.carrier,service:p.service,format:'ZPL',isTest:true};this.bookings.set(p.shipmentId,b);return b;}
 async lookup(p){return this.bookings.get(p.shipmentId)||null;}
 async label(b){return Buffer.from(`^XA^FO40,40^A0N,45,45^FDTEST - VOID^FS^FO40,110^A0N,28,28^FDDO NOT SHIP^FS^FO40,180^A0N,24,24^FD${b.tracking}^FS^XZ`);}
}
export class ParselCarrier {
 constructor({token,baseUrl='https://api.parsel.app',liveBooking=false,verifyCurrent,labelHosts=[],fetchImpl=fetch}){const url=new URL(baseUrl);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/')throw Error('Parsel requires an HTTPS API origin');Object.assign(this,{token,baseUrl:url.origin,liveBooking,verifyCurrent,labelHosts,fetchImpl});}
 async request(route,{method='GET',body}={}){const res=await this.fetchImpl(this.baseUrl+route,{method,headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20_000),redirect:'error'});if(!res.ok)fail('Parsel request failed ('+res.status+'); reconcile any attempted purchase',502);return (await res.json()).data;}
 async quote(input){return this.request('/shipments',{method:'POST',body:{...input,buy_cheapest_rate:false,label_format:'ZPL',inline_label:true}});}
 async preflight(p){
  if(!this.verifyCurrent)fail('Fresh Gmail/Shopify/prescan verification is not connected',503);
  const current=await this.verifyCurrent(p);const ship=await this.request('/shipments/'+encodeURIComponent(p.shipmentId));
  if(fingerprint(ship.destination)!==fingerprint(p.destination)||fingerprint(ship.parcel)!==fingerprint(p.package)||ship.ship_date&&ship.ship_date!==p.shipDate)fail('Parsel address, ship date or package differs from approval');
  return {...current,existingBooking:ship.shipping_label||null,rates:(ship.shipping_rates||[]).map(r=>({id:r.id,carrier:r.carrier,service:r.service,currency:r.price.currency,costCents:Math.round(r.price.amount*100)}))};
 }
 async buy(p){if(!this.liveBooking)fail('Live Parsel purchases are disabled until the supervised pilot',503);const ship=await this.request('/shipments/'+encodeURIComponent(p.shipmentId)+'/rates/'+encodeURIComponent(p.rateId),{method:'POST',body:{}});const label=ship.shipping_label,rate=label?.shipping_rate;if(!label?.id||!label.tracking_code||!rate)fail('Missing carrier purchase receipt',502);return {id:label.id,tracking:label.tracking_code,carrier:rate.carrier,service:rate.service,format:label.label_format||'PDF',url:label.label_url,isTest:false};}
 async lookup(p){const ship=await this.request('/shipments/'+encodeURIComponent(p.shipmentId));if(fingerprint(ship.destination)!==fingerprint(p.destination)||fingerprint(ship.parcel)!==fingerprint(p.package))fail('Existing carrier shipment differs from approved package');const l=ship.shipping_label,r=l?.shipping_rate;if(!l)return null;if(!r||r.id!==p.rateId)fail('Existing booking is not the approved rate');return {id:l.id,tracking:l.tracking_code,carrier:r.carrier,service:r.service,format:l.label_format||'PDF',url:l.label_url,isTest:false};}
 async label(booking){const label=await this.request('/shipping_labels/'+encodeURIComponent(booking.id));if(label.tracking_code!==booking.tracking)fail('Retrieved label tracking differs from booked label');const u=new URL(label.label_url);if(u.protocol!=='https:'||u.username||u.password||!this.labelHosts.includes(u.hostname))fail('Label download host must be verified and configured',503);const res=await this.fetchImpl(u,{signal:AbortSignal.timeout(20_000),redirect:'error'});if(!res.ok)fail('Label download failed',502);let bytes=0;const chunks=[];for await(const chunk of res.body){bytes+=chunk.length;if(bytes>5*1024*1024)fail('Label exceeds download size limit',502);chunks.push(chunk);}return Buffer.concat(chunks);}
}
