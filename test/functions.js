global.window = global;
require(require('path').join(__dirname,'../js/sim.js'));
const {Machine, COFFEES} = global.PFSim;
let pass=0, fail=0;
function t(name, fn){
  try { const r = fn(); if (r === true) {pass++; console.log('  ok   '+name);}
        else {fail++; console.log('  FAIL '+name+'  -> '+r);} }
  catch(e){ fail++; console.log('  FAIL '+name+'  threw '+e.message); }
}
const run = (m,bags,maxS=400)=>{ let g=0;
  while(m.log.length<bags && g<maxS/0.02){ m.tick(0.02);
    if(m.state==='WAIT_CLAMP') m.pressPedal();
    if(m.state==='ALARM_HOLD') break;
    if(m.state==='BATCH_END') break;
    g++; } return m; };
const settle=(m,s)=>{ for(let i=0;i<Math.round(s/0.02);i++) m.tick(0.02); };

console.log('\n-- cycle & counters --');
t('runs a bag and increments counters', ()=>{ const m=new Machine(1); m.sel=5; m.start(); run(m,3);
  return m.accNums===3 && m.complete===3 && m.accWt>1400 || `accNums=${m.accNums} accWt=${m.accWt}`; });
t('stop halts the cycle', ()=>{ const m=new Machine(1); m.sel=5; m.start(); settle(m,2); m.stop();
  return m.running===false && m.state==='STOP' || 'state='+m.state; });
t('Acc Wt accumulates readings', ()=>{ const m=new Machine(1); m.sel=4; m.start(); run(m,4);
  return Math.abs(m.accWt-400)<12 || 'accWt='+m.accWt; });

console.log('\n-- over/under alarm --');
t('over tolerance raises an alarm and holds', ()=>{ const m=new Machine(2); m.sel=5;
  m.recipe().med=15; m.recipe().slow=2;   // med cuts off too late -> overshoot
  m.start(); let g=0; while(m.state!=='ALARM_HOLD'&&g<20000){m.tick(0.02);g++;}
  return m.state==='ALARM_HOLD' && m.alarm && m.alarm.code==='OVER' && m.ouLamp===true
    || 'state='+m.state+' alarm='+JSON.stringify(m.alarm); });
t('under tolerance raises an alarm', ()=>{ const m=new Machine(2); m.sel=5;
  m.recipe().med=500; m.recipe().slow=60;   // cuts off way short
  m.start(); let g=0; while(m.state!=='ALARM_HOLD'&&g<20000){m.tick(0.02);g++;}
  return m.alarm && m.alarm.code==='UNDER' || 'alarm='+JSON.stringify(m.alarm); });
t('alarm pause blocks discharge until cleared', ()=>{ const m=new Machine(2); m.sel=5;
  m.recipe().med=15; m.recipe().slow=2; m.start(); let g=0; while(m.state!=='ALARM_HOLD'&&g<20000){m.tick(0.02);g++;}
  const held=m.mass; m.pressPedal(); settle(m,2);
  const stillHeld = Math.abs(m.mass-held)<5;
  m.clearAlarm(); const st=m.state; m.pressPedal(); settle(m,4);
  return stillHeld && st==='WAIT_CLAMP' && m.mass<40 || `stillHeld=${stillHeld} st=${st} mass=${m.mass.toFixed(0)}`; });
t('clearing the alarm drops the O/U lamp', ()=>{ const m=new Machine(2); m.sel=5;
  m.recipe().med=15; m.recipe().slow=2; m.start(); let g=0; while(!m.ouLamp&&g<20000){m.tick(0.02);g++;}
  m.clearAlarm(); return m.ouLamp===false && m.alarm===null || 'ouLamp='+m.ouLamp; });

console.log('\n-- batch --');
t('batch stops the machine at the set count', ()=>{ const m=new Machine(3); m.sel=4; m.batchSet=3;
  m.start(); let g=0; while(m.state!=='BATCH_END'&&g<40000){ m.tick(0.02);
    if(m.state==='WAIT_CLAMP') m.pressPedal(); g++; }
  return m.state==='BATCH_END' && m.complete===3 && m.running===false && m.alarm.code==='BATCH'
    || `state=${m.state} complete=${m.complete}`; });
t('Clr Alarm resets the batch so it can resume', ()=>{ const m=new Machine(3); m.sel=4; m.batchSet=2;
  m.start(); let g=0; while(m.state!=='BATCH_END'&&g<40000){ m.tick(0.02);
    if(m.state==='WAIT_CLAMP') m.pressPedal(); g++; }
  m.clearAlarm(); return m.complete===0 && m.alarm===null && m.state==='STOP' || 'complete='+m.complete; });
t('batchSet 0 disables the batch function', ()=>{ const m=new Machine(3); m.sel=4; m.batchSet=0;
  m.start(); run(m,5); return m.state!=='BATCH_END' && m.log.length===5 || 'state='+m.state; });

console.log('\n-- feed speed modes --');
t('two-speed Med/Slow never opens Fast', ()=>{ const m=new Machine(4); m.sel=1;
  m.recipe().feedSpeed=2; m.start(); let fast=false,g=0;
  while(m.log.length<1&&g<40000){ m.tick(0.02); if(m.fastOn) fast=true;
    if(m.state==='WAIT_CLAMP') m.pressPedal(); g++; }
  return fast===false || 'fast fired'; });
t('two-speed Fast/Slow never opens Med', ()=>{ const m=new Machine(4); m.sel=1;
  m.recipe().feedSpeed=1; m.start(); let med=false,g=0;
  while(m.log.length<1&&g<40000){ m.tick(0.02); if(m.medOn) med=true;
    if(m.state==='WAIT_CLAMP') m.pressPedal(); g++; }
  return med===false || 'med fired'; });
t('feed = target disables that feed', ()=>{ const m=new Machine(4); m.sel=5; m.start();
  let fast=false,g=0;   // Rec5 ships fast=500=target
  while(m.log.length<1&&g<40000){ m.tick(0.02); if(m.fastOn) fast=true;
    if(m.state==='WAIT_CLAMP') m.pressPedal(); g++; }
  return fast===false || 'fast fired though fast==target'; });

console.log('\n-- scale settings --');
t('division quantises the reading', ()=>{ const m=new Machine(5); m.division=10; m.mass=1234; settle(m,1);
  const q=m.quantise(m.trueReading()); return q%10===0 || 'q='+q; });
t('unit kg converts', ()=>{ const m=new Machine(5); m.mass=1500; settle(m,1); m.unit='kg';
  return m.display()==='1.50' || 'display='+m.display(); });
t('unit lb converts', ()=>{ const m=new Machine(5); m.mass=454; settle(m,1); m.unit='lb';
  return m.display()==='1.00' || 'display='+m.display(); });
t('over capacity shows OFL', ()=>{ const m=new Machine(5); m.mass=2600; settle(m,1);
  return m.display()==='OFL' || 'display='+m.display(); });
t('overload alarms and stops the machine', ()=>{ const m=new Machine(5); m.sel=1; m.capacity=300;
  m.start(); let g=0; while(m.state!=='STOP'&&g<40000){m.tick(0.02);g++;}
  return m.alarm && m.alarm.code==='OFL' && m.running===false || 'alarm='+JSON.stringify(m.alarm); });

console.log('\n-- zero & calibration --');
t('Zero rejected while unstable', ()=>{ const m=new Machine(6); m.manualMode=true; m.man.fast=true;
  settle(m,1.5); return m.zero()===false || 'accepted while feeding'; });
t('Zero accepted when stable', ()=>{ const m=new Machine(6); m.mass=0; settle(m,1);
  return m.zero()===true || 'rejected when still'; });
t('Zero removes a tare offset', ()=>{ const m=new Machine(6); m.rawOffset=40; settle(m,1);
  m.zero(); settle(m,0.5); return Math.abs(m.quantise(m.trueReading()))<=1 || 'reads '+m.quantise(m.trueReading()); });
t('Wt Clb rejected without Record Wt', ()=>{ const m=new Machine(6); m.clbWt=2000;
  return m.wtClb()===false || 'accepted with no recorded span'; });
t('Wt Clb rejected with no Clb Wt', ()=>{ const m=new Machine(6); m.mass=2000; settle(m,1);
  m.recordWt(); m.clbWt=0; return m.wtClb()===false || 'accepted with zero weight'; });
t('full calibration corrects a span error', ()=>{ const m=new Machine(6);
  m.rawPerGram=1.04; m.rawOffset=12; m.mass=0; settle(m,1); m.zeroClb();
  m.mass=2000; settle(m,1); m.recordWt(); m.clbWt=2000; m.wtClb(); settle(m,0.5);
  return Math.abs(m.quantise(m.trueReading())-2000)<=1 || 'reads '+m.quantise(m.trueReading()); });
t('wrong Clb Wt leaves the machine reading wrong', ()=>{ const m=new Machine(6);
  m.mass=0; settle(m,1); m.zeroClb(); m.mass=2000; settle(m,1); m.recordWt();
  m.clbWt=1800; m.wtClb();          // operator typo
  m.sel=5; m.mass=0; settle(m,1); m.start(); run(m,4);
  const s=m.stats(4); return s.calErr>15 || 'calErr='+s.calErr.toFixed(1); });

console.log('\n-- manual override --');
t('manual latches drive the actuators', ()=>{ const m=new Machine(7); m.manualMode=true;
  m.man.med=true; settle(m,1); const fed=m.mass>50; m.man.med=false; settle(m,1);
  return fed || 'no flow, mass='+m.mass.toFixed(0); });
t('Clamp runs the full discharge sequence', ()=>{ const m=new Machine(7); m.manualMode=true;
  m.mass=500; m.pressPedal(); const seen=new Set();
  for(let i=0;i<400;i++){ m.tick(0.02); if(m.mdState) seen.add(m.mdState); }
  return m.mass<1 && seen.has('CLAMP') && seen.has('DISC') && seen.has('UNCLAMP')
    || `mass=${m.mass.toFixed(1)} seen=${[...seen]}`; });
t('Disc latch empties the chamber', ()=>{ const m=new Machine(7); m.manualMode=true;
  m.mass=800; m.man.disc=true; settle(m,3); return m.mass<1 || 'mass='+m.mass.toFixed(1); });

console.log('\n-- environment --');
t('empty hopper alarms', ()=>{ const m=new Machine(8); m.sel=1; m.hopper=0; m.start();
  let g=0; while(m.state!=='STOP'&&g<40000){m.tick(0.02);g++;}
  return m.alarm && m.alarm.code==='HOPPER' || 'alarm='+JSON.stringify(m.alarm); });
t('feed timeout alarms when flow stalls', ()=>{ const m=new Machine(8); m.sel=1; m.hopper=200;
  m.start(); let g=0; while(m.state!=='STOP'&&g<200000){m.tick(0.02);g++;}
  return m.alarm && (m.alarm.code==='NOFLOW'||m.alarm.code==='HOPPER') || 'alarm='+JSON.stringify(m.alarm); });
t('every coffee preset runs', ()=>{ for(const c of COFFEES){ const m=new Machine(9); m.sel=5; m.coffee=c;
    m.start(); run(m,2); if(m.log.length<2) return 'stalled on '+c.name; } return true; });

console.log('\n-- AI Pack --');
t('AI Pack trims Slow toward the target', ()=>{ const m=new Machine(10); m.sel=5;
  const r=m.recipe(); r.slow=30; r.aiPack=true;      // starts well under
  m.start(); let g=0;
  while(m.log.length<20 && g<200000){ m.tick(0.02);
    if(m.state==='WAIT_CLAMP') m.pressPedal();
    if(m.state==='ALARM_HOLD'){ m.clearAlarm(); m.pressPedal(); }
    g++; }
  const s=m.stats(4);
  return s && Math.abs(s.mean-500)<5 && r.slow!==30 || `slow=${r.slow} mean=${s?s.mean.toFixed(1):'none'}`; });
t('AI Pack off leaves Slow alone', ()=>{ const m=new Machine(10); m.sel=5;
  const r=m.recipe(); r.slow=30; r.aiPack=false; m.start(); run(m,4);
  return r.slow===30 || 'slow drifted to '+r.slow; });

console.log('\n-- recipes --');
t('20 recipe slots, 5 enabled at the factory', ()=>{ const m=new Machine(11);
  return m.recipes.length===20 && m.recipes.filter(r=>r.enabled).length===5
    || 'n='+m.recipes.length+' enabled='+m.recipes.filter(r=>r.enabled).length; });
t('a new recipe can be created and run', ()=>{ const m=new Machine(11); m.sel=7;
  const r=m.recipe(); r.enabled=true; r.name='250g'; r.target=250; r.fast=250; r.med=130; r.slow=9;
  m.start(); run(m,4); const s=m.stats(4);
  return s.n===4 && Math.abs(s.mean-250)<6 || `n=${s.n} mean=${s.mean}`; });
t('stats report spread and rate', ()=>{ const m=new Machine(11); m.sel=5; m.start(); run(m,6);
  const s=m.stats(6); return s.sd>=0 && s.rate>0 && s.n===6 || JSON.stringify(s); });

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
