export const SHAPES={rectangle:{label:'Rectangle',color:'#5B8DEF'},circle:{label:'Circle',color:'#A78BFA'},runner:{label:'Runner',color:'#F2A65A'},square:{label:'Sq',color:'#45B8A0'},custom:{label:'Custom',color:'#EC7FA2'}};
export function rugShape(rug){
 const raw=String(rug.shape||'').trim().toLowerCase(),alias={rect:'rectangle',sq:'square',round:'circle'};
 if(SHAPES[alias[raw]||raw])return alias[raw]||raw;
 if(['unknown','unspecified'].includes(raw))return 'custom';
 const size=String(rug.size||'').toLowerCase(),label=[size,rug.fileName,rug.design].filter(Boolean).join(' ').toLowerCase();
 if(/(?:^|[\s._-])(?:square|sq)(?=$|[\s._-])/.test(label))return 'square';
 if(/(?:^|[\s._-])(?:circle|round)(?=$|[\s._-])/.test(label))return 'circle';
 if(/(?:^|[\s._-])runner(?=$|[\s._-])/.test(label))return 'runner';
 if(/(?:^|[\s._-])custom(?=$|[\s._-])/.test(label))return 'custom';
 const dimensions=size.match(/^(\d+(?:\.\d+)?)\s*(in|ft)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(in|ft)?$/);
 if(!dimensions)return 'custom';
 const first=dimensions[2]||dimensions[4]||'ft',second=dimensions[4]||dimensions[2]||'ft',a=Number(dimensions[1])*(first==='in'?1/12:1),b=Number(dimensions[3])*(second==='in'?1/12:1);
 if(a<=0||b<=0)return 'custom';
 if(Math.abs(a-b)<0.000001)return 'circle';
 return Math.max(a,b)/Math.min(a,b)>=2.5?'runner':'rectangle';
}
export function rugShapes(rugs=[]){const counts={};for(const rug of rugs){const shape=rugShape(rug),quantity=Number.isSafeInteger(rug.quantity)&&rug.quantity>0?rug.quantity:1;counts[shape]=(counts[shape]||0)+quantity;}return counts;}
export function shapeBadges(counts={}){return Object.entries(SHAPES).filter(([key])=>counts[key]>0).map(([key,value])=>({...value,key,count:counts[key],dots:counts[key]>5?1:counts[key],multiplier:counts[key]>5}));}
