// Share the first authenticated snapshot between the dashboard and account
// controls. A transient failed request retries through the existing live poll;
// it cannot permanently prevent the profile and sign-out controls mounting.
let resolve;
const ready=new Promise(r=>{resolve=r;});
export function firstLiveState(){return ready;}
export function publishLiveState(snapshot){if(snapshot?.hosted?.user&&resolve){resolve(snapshot);resolve=null;}}
