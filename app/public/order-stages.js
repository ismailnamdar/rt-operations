export const ORDER_STAGES=['awaiting approval','awaiting mockup','awaiting production','in production','cutting / stitching / packing','awaiting carrier','in transit','delivered'];
export function normalizeStage(stage){return stage==='awaiting ups'?'awaiting carrier':stage;}
export function stageLabel(stage){stage=normalizeStage(stage);if(['cutting','stitching','packing'].includes(stage))stage='cutting / stitching / packing';if(stage==='in queue for production')stage='awaiting production';return ORDER_STAGES.includes(stage)?stage[0].toUpperCase()+stage.slice(1):'Stage not recorded';}
