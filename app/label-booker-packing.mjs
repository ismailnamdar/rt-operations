// Shared packing knowledge. Explicit later confirmations override earlier defaults.
export const POLICY_VERSION='label-booker-2026-09-30-v1';
export const CATEGORIES=['Expedited','Picture','UGC','Orders'];
export const STANDARD={
 '2x3':{box:[30,6,6],lb:3},'3x5':{box:[36,6,6],lb:7},
 '5x7':{box:[60,6,6],lb:13},'3x3':{box:[36,6,6],lb:4},
 '4x4':{box:[48,6,6],lb:5},'5x5':{box:[60,6,6],lb:9},
 '6x6':{box:[72,6,6],lb:14},'8x8':{box:[95,6,6],lb:23},
 '2.5x7':{box:[32,6,6],lb:8},'2.5x10':{box:[32,8,8],lb:11},
 '5x10':{box:[60,8,8],lb:16},'8x10':{box:[95,8,8],lb:37},
 '8x12':{box:[95,10,10],lb:45},'1x1':{box:[26,4,4],lb:2}
};
export function sizeKey(size){const parts=String(size).toLowerCase().replaceAll('×','x').split('x').map(Number);if(parts.length!==2||parts.some(n=>!Number.isFinite(n)||n<=0))throw Error('Unknown rug dimensions: '+size);return parts.sort((a,b)=>a-b).join('x')}
export function combination(items){const counts=new Map();for(const i of items){if(!Number.isInteger(i.quantity)||i.quantity<1)throw Error('Positive integral rug quantity required');const s=sizeKey(i.size);counts.set(s,(counts.get(s)||0)+i.quantity)}return [...counts].sort(([a],[b])=>a.localeCompare(b)).map(([s,n])=>`${s}:${n}`).join('|')}
const exact=new Map();
function add(parts,box,lb){const items=parts.map(([size,quantity])=>({size,quantity}));exact.set(combination(items),{box,lb,source:'explicit owner confirmation; production chat through 2026-09-30'})}
for(const [s,n,box] of [
 ['2x3',4,[30,8,8]],...[5,6,7].map(n=>['2x3',n,[30,10,10]]),...[8,12].map(n=>['2x3',n,[30,12,12]]),
 ['3x5',2,[36,6,6]],['3x5',3,[36,8,8]],['3x5',4,[36,10,10]],...[6,7,8].map(n=>['3x5',n,[36,12,12]]),
 ['5x7',2,[60,8,8]],...[3,4].map(n=>['5x7',n,[60,10,10]]),['5x7',5,[60,12,12]],
 ...[3,4].map(n=>['3x3',n,[36,8,8]]),...[3,4].map(n=>['4x4',n,[48,8,8]]),
 ['5x5',3,[60,8,8]],['5x5',4,[60,10,10]],['6x6',3,[72,8,8]],['6x6',4,[72,12,12]],
 ['2.5x7',3,[36,10,10]],['2.5x7',4,[36,12,12]],['2.5x10',3,[36,12,12]],['5x10',3,[60,10,10]],
 ...['8x8','8x10'].flatMap(s=>[[s,2,[95,10,10]],[s,3,[95,12,12]]]),['8x12',2,[95,12,12]],['8x12',3,[95,14,14]]
])add([[s,n]],box);
for(const [parts,box] of [
 [[['3x5',2],['2x3',2]],[36,8,8]],[[['3x5',1],['2x3',3]],[36,8,8]],[[['3x5',1],['2x3',4]],[36,10,10]],
 ...[7,8].map(n=>[[['3x5',1],['2x3',n]],[36,12,12]]),
 [[['5x7',1],['3x5',2]],[60,8,8]],...[3,4].map(n=>[[['5x7',1],['3x5',n]],[60,10,10]]),
 [[['5x7',1],['2x3',4]],[60,8,8]],[[['5x7',1],['2x3',8]],[60,10,10]],[[['5x7',2],['2x3',4]],[60,10,10]],
 [[['8x8',1],['2x3',2]],[95,6,6]],[[['8x8',1],['2x3',3]],[95,8,8]],
 [[['8x10',1],['2x3',2]],[95,8,8]],[[['8x10',1],['3x5',2]],[95,10,10]],
 [[['8x12',1],['3x5',2]],[95,12,12]],[[['8x12',1],['2x3',4]],[95,12,12]],
 [[['6x6',1],['3x3',1],['2x3',2],['2.5x7',1]],[72,10,10]],
 [[['8x12',1],['3x5',1]],[95,10,10]],[[['3x3',1],['3x5',1]],[36,6,6]],
 [[['5x5',1],['3x5',1]],[60,8,8]],[[['2.5x10',1],['2x3',1],['3x3',1]],[36,8,8]],
 [[['8x12',1],['3x5',1],['2x3',1]],[95,10,10]],[[['8x8',1],['2.5x10',1],['2.5x7',1]],[95,10,10]]
])add(parts,box);
add([['2x2',2]],[29,4,4],5);
export function packing(items,learned=[]){
 const key=combination(items),saved=learned.find(r=>r.key===key&&r.approvedAt&&r.sourceProductionId);
 const rule=saved||exact.get(key)||(items.length===1&&items[0].quantity===1?STANDARD[sizeKey(items[0].size)]:null);
 const lb=rule?.lb??items.reduce((sum,i)=>sum+(i.lb??STANDARD[sizeKey(i.size)]?.lb??NaN)*i.quantity,0);
 return {key,box:rule?.box||null,lb:Number.isFinite(lb)?lb:null,needsConfirmation:!rule,over100lb:lb>100,source:saved?'saved exact-combination approval':rule?.source||(rule?'standard size table':'unconfirmed estimate required')};
}
