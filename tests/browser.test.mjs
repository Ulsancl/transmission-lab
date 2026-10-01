import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { TRANSMISSIONS } from '../src/model.js';

const url=process.env.TRANSMISSION_TEST_URL||'http://127.0.0.1:5175';
let server;
if(!process.env.TRANSMISSION_TEST_URL){
 server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:5175,strictPort:true}});
 await server.listen();
}
const version=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')).version;
const output=path.resolve(`output/qa-v${version}`);await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:1,acceptDownloads:true});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const results=[];
async function check(name,action){await action();results.push({name,passed:true});console.log(`PASS ${name}`);}
try {
 await page.goto(url);await page.waitForFunction(()=>window.transmissionLab?.getState().scene?.meshCount>0,{timeout:30000});
 await page.evaluate(()=>window.transmissionLab.pause());
 await check('All five types render their own geometry and change operating values',async()=>{
  const geometries=[];
  for(const type of ['mt','dct','cvt','at','ecvt']){
   await page.locator(`[data-type="${type}"]`).click();await page.waitForTimeout(250);
   const state=await page.evaluate(()=>window.transmissionLab.getState());
   assert.equal(state.settings.type,type);assert.ok(state.scene.meshCount>15);assert.ok(Number.isFinite(state.snapshot.outputRpm));
   geometries.push({type,meshes:state.scene.meshCount,parts:state.scene.partIds});
   assert.equal(await page.locator('.type-tab[aria-pressed=true]').count(),1);
   await page.screenshot({path:path.join(output,`${type}-desktop.png`)});
  }
  assert.ok(new Set(geometries.map(g=>g.meshes)).size>=4);await fs.writeFile(path.join(output,'scene-diagnostics.json'),JSON.stringify(geometries,null,2));
 });
 await check('DCT shift swaps odd and even clutch after preselection',async()=>{
  await page.locator('[data-type=dct]').click();await page.evaluate(()=>window.transmissionLab.play());
  await page.locator('[data-gear="2"]').click();await page.waitForFunction(()=>window.transmissionLab.getState().snapshot.clutchB>.99);
  const s=await page.evaluate(()=>window.transmissionLab.getState().snapshot);assert.ok(s.clutchA<.01);assert.equal(s.gear,'2');
 });
 await check('Neutral and open clutch stop delivered torque',async()=>{
  await page.locator('[data-type=mt]').click();await page.locator('[data-gear=N]').click();
  let s=await page.evaluate(()=>window.transmissionLab.getState().snapshot);assert.equal(s.outputTorque,0);
  await page.locator('[data-gear="1"]').click();await page.evaluate(()=>window.transmissionLab.setSettings({clutch:0}));
  s=await page.evaluate(()=>window.transmissionLab.getState().snapshot);assert.equal(s.outputTorque,0);assert.equal(s.outputRpm,0);
 });
 await check('CVT continuously changes radius and output RPM with fixed belt length',async()=>{
  await page.locator('[data-type=cvt]').click();await page.evaluate(()=>window.transmissionLab.setSettings({cvtRatio:2.5}));
  const a=await page.evaluate(()=>window.transmissionLab.getState().snapshot);await page.evaluate(()=>window.transmissionLab.setSettings({cvtRatio:.5}));
  const b=await page.evaluate(()=>window.transmissionLab.getState().snapshot);assert.ok(b.outputRpm>a.outputRpm*4);assert.ok(b.primaryRadius>a.primaryRadius);
  assert.ok(Number((await page.locator('#primary-radius').textContent()).replaceAll(',',''))>10);
 });
 await check('AT lockup changes turbine speed and removes converter slip loss',async()=>{
  await page.locator('[data-type=at]').click();const a=await page.evaluate(()=>window.transmissionLab.getState().snapshot);
  await page.locator('#converterLock').check();const b=await page.evaluate(()=>window.transmissionLab.getState().snapshot);
  assert.equal(b.turbineRpm,b.inputRpm);assert.ok(b.outputRpm>a.outputRpm);assert.ok(b.lossPowerKW<a.lossPowerKW);
 });
 await check('eCVT exposes mechanical and electric split with correct planetary speed constraint',async()=>{
  await page.locator('[data-type=ecvt]').click();await page.evaluate(()=>window.transmissionLab.setSettings({mg1Rpm:-2000,mg2Torque:100}));
  const s=await page.evaluate(()=>window.transmissionLab.getState().snapshot);assert.ok(Math.abs(108*s.carrierRpm-30*s.sunRpm-78*s.ringRpm)<1e-6);
  assert.ok(Math.abs(s.inputPowerKW-s.outputPowerKW-s.lossPowerKW)<1e-8);assert.ok((await page.locator('#battery-power').textContent()).includes('배터리'));
 });
 await check('Dissection, label toggles, cameras and component selection',async()=>{
  await page.evaluate(()=>window.transmissionLab.pause());
  await page.locator('#explode').fill('1');await page.locator('#housing').fill('0.65');await page.locator('#labels').uncheck();
  const s=await page.evaluate(()=>window.transmissionLab.getState());assert.equal(s.view.explode,1);assert.equal(s.view.housing,.65);assert.equal(s.view.labels,false);
  await page.locator('[data-camera=front]').click();await page.locator('[data-camera=top]').click();await page.locator('[data-camera=isometric]').click();
  await page.locator('.parts-list [data-part=mg1]').click();assert.match(await page.locator('.part-detail h3').textContent(),/MG1/);
  await page.locator('[data-inspector=principle]').click();await page.locator('[data-lesson="1"]').click();assert.match(await page.locator('.lesson-card h3').textContent(),/MG2/);
 });
 await check('Pause freezes time and reset clears the recorded time',async()=>{
  await page.evaluate(()=>window.transmissionLab.pause());const a=await page.evaluate(()=>window.transmissionLab.getState().snapshot.time);await page.waitForTimeout(300);
  assert.equal((await page.evaluate(()=>window.transmissionLab.getState().snapshot.time)),a);
  await page.locator('#reset').click();assert.equal((await page.evaluate(()=>window.transmissionLab.getState().snapshot.time)),0);
 });
 await check('Names stay in place while all five mechanisms actually rotate',async()=>{
  for(const type of ['mt','dct','cvt','at','ecvt']){
   await page.locator(`[data-type=${type}]`).click();await page.evaluate(()=>window.transmissionLab.pause());await page.locator('#labels').check();await page.waitForTimeout(250);
   const result=await page.evaluate(()=>{
    const api=window.transmissionLab,{snapshot,view}=api.getState();api.scene.update(snapshot,view,0);const before=api.scene.getDiagnostics();
    for(let i=0;i<22;i++)api.scene.update(snapshot,view,.1);
    return {before,after:api.scene.getDiagnostics()};
   });
   assert.ok(result.before.labelPositions.length>3);
   for(const label of result.before.labelPositions){const after=result.after.labelPositions.find(l=>l.id===label.id);assert.ok(after,`${type} lost label ${label.id}`);assert.ok(Math.hypot(after.x-label.x,after.y-label.y)<.05,`${type} rotating label ${label.id}`);}
   assert.ok(result.before.rotorAngles.some((r,i)=>Math.abs(r.angle-result.after.rotorAngles[i].angle)>.01),`${type} rotations must continue`);
  }
 });
 await check('Engine and gears have neutral steel materials with machined surface detail',async()=>{
  await page.locator('[data-type=dct]').click();await page.waitForTimeout(100);
  const props=await page.evaluate(()=>window.transmissionLab.getState().scene.materialProperties);
  for(const id of ['engine','gear-1','shaft-a']){
   const p=props.find(p=>p.id===id);assert.ok(p,id);assert.ok(p.materials.some(m=>m.metalness>=.8&&m.bumpScale>0),`${id} steel finish`);
   const steel=p.materials.filter(m=>m.metalness>=.8&&!m.surface?.includes('brass'));
   assert.ok(steel.length,`${id} must contain machined steel, separately from any brass synchronizer cone`);
   for(const mat of steel){const rgb=mat.color.slice(1).match(/../g).map(h=>parseInt(h,16));assert.ok(Math.max(...rgb)-Math.min(...rgb)<55,`${id} steel surface must have a neutral metal color: ${mat.color}`);}
  }
 });
 await check('Additional mechanical and oil assemblies match each transmission architecture',async()=>{
  const expected={mt:['bearings','shaft-seals','oil-pan','oil-lines','pressure-plate','diaphragm','release-bearing','release-fork'],dct:['bearings','shaft-seals','oil-pan','oil-lines','oil-pump','oil-filter','valve-body','cooler'],cvt:['bearings','shaft-seals','oil-pan','oil-lines','forward-clutch','reverse-clutch','pulley-pistons','oil-pump','valve-body'],at:['bearings','shaft-seals','oil-pan','oil-lines','shift-clutches','oil-pump','oil-filter','valve-body'],ecvt:['bearings','shaft-seals','oil-pan','oil-lines','cooler']};
  for(const[type,ids]of Object.entries(expected)){
   await page.locator(`[data-type=${type}]`).click();await page.waitForTimeout(100);const state=await page.evaluate(()=>window.transmissionLab.getState());
   for(const id of ids)assert.ok(state.scene.partIds.includes(id),`${type} missing ${id}`);
   for(const part of TRANSMISSIONS[type].parts){const drawn=state.scene.parts.find(p=>p.id===part.id);assert.ok(drawn,`${type} inspector part missing geometry: ${part.id}`);assert.equal(drawn.category,part.category,`${type} category mismatch: ${part.id}`);}
   assert.equal(state.snapshot.lubrication.pressureSolved,false);assert.equal(state.snapshot.lubrication.temperatureSolved,false);
   if(type==='mt')assert.ok(!state.scene.partIds.includes('valve-body'));
   if(type==='ecvt')assert.equal(state.scene.parts.filter(p=>p.category==='clutches').length,0);
  }
 });
 await check('Cast housings have thick section faces and switch between cutaway, closed and hidden views',async()=>{
  for(const type of ['mt','dct','cvt','at','ecvt']){
   await page.locator(`[data-type=${type}]`).click();await page.locator('.view-controls [data-housing-mode=cutaway]').click();await page.locator('#housing').fill('1');await page.locator('#explode').fill('0.06');await page.locator('#cutaway').fill('0.35');
   await page.waitForFunction(()=>window.transmissionLab.getState().scene.housing?.mode==='cutaway');
   const cut=await page.evaluate(()=>window.transmissionLab.getState().scene.housing);assert.ok(cut.wallThickness>=.1);assert.ok(cut.cutFaceTriangles>0);assert.ok(cut.ribCount>=12&&cut.boltCount>=16);assert.ok(cut.visibleTriangles>0);assert.equal(cut.rectangularProxy,false);
   assert.equal(cut.bearingFits.length,cut.bearingSupportCount);for(const fit of cut.bearingFits){assert.ok(fit.minimumBoreRadius>fit.outerRaceRadius+.008,`${type} outer race must fit the housing chamfer`);assert.ok(fit.retainerAxialOffset-.028>.118,`${type} retainer must clear the bearing end bevel`);}
   await page.locator('#cutaway').fill('0.85');await page.waitForFunction(()=>window.transmissionLab.getState().scene.housing?.cutaway===.85);
   const wide=await page.evaluate(()=>window.transmissionLab.getState().scene.housing);assert.ok(wide.visibleTriangles<cut.visibleTriangles,`${type}: opening must remove actual shell geometry`);
   await page.locator('.view-controls [data-housing-mode=closed]').click();await page.waitForFunction(()=>window.transmissionLab.getState().scene.housing?.mode==='closed');
   const closed=await page.evaluate(()=>window.transmissionLab.getState().scene.housing);assert.equal(closed.cutFaceTriangles,0);assert.ok(closed.visibleTriangles>cut.visibleTriangles);assert.equal(await page.locator('#cutaway').isDisabled(),true);
   await page.screenshot({path:path.join(output,`${type}-closed.png`)});
   await page.locator('.view-controls [data-housing-mode=hidden]').click();await page.waitForFunction(()=>window.transmissionLab.getState().scene.housing?.mode==='hidden');
   assert.equal((await page.evaluate(()=>window.transmissionLab.getState().scene.housing)).visibleTriangles,0);assert.equal(await page.locator('#housing').isDisabled(),true);
   await page.locator('.view-controls [data-housing-mode=cutaway]').click();await page.locator('#cutaway').fill('0.55');
  }
 });
 await check('Meshing gears use machined involute teeth and physically compatible helical hands',async()=>{
  await page.locator('[data-type=dct]').click();await page.waitForTimeout(100);const gears=await page.evaluate(()=>window.transmissionLab.getState().scene.gears);
  for(let i=1;i<=6;i++){const pair=gears.filter(g=>g.partId===`gear-${i}`&&g.pitchRadius>.4);assert.equal(pair.length,2);assert.ok(pair.every(g=>g.involute&&Math.abs(g.helixDegrees)>10));assert.ok(pair[0].helixDegrees*pair[1].helixDegrees<0);assert.ok(Math.abs(pair[0].pitchRadius+pair[1].pitchRadius-2)<1e-8);}
  await page.locator('[data-type=ecvt]').click();await page.waitForTimeout(100);const planetary=await page.evaluate(()=>window.transmissionLab.getState().scene.gears),sun=planetary.find(g=>g.partId==='sun'),ring=planetary.find(g=>g.partId==='ring'),planets=planetary.filter(g=>g.partId==='planets');
  assert.equal(ring.internal,true);assert.equal(planets.length,3);for(const planet of planets){assert.ok(sun.helixDegrees*planet.helixDegrees<0);assert.ok(ring.helixDegrees*planet.helixDegrees>0);}
 });
 await check('Cutaway mode, opening and opacity persist through project restoration',async()=>{
  await page.locator('.view-controls [data-housing-mode=closed]').click();await page.locator('#housing').fill('0.7');const p=await page.evaluate(()=>window.transmissionLab.project());
  await page.locator('.view-controls [data-housing-mode=cutaway]').click();await page.locator('#cutaway').fill('0.23');await page.evaluate(p=>window.transmissionLab.loadProject(JSON.stringify(p)),p);
  let view=(await page.evaluate(()=>window.transmissionLab.getState())).view;assert.equal(view.housingMode,'closed');assert.equal(view.housing,.7);assert.equal(view.cutaway,p.view.cutaway);
  const old={...p,view:{...p.view,housing:0}};delete old.view.housingMode;delete old.view.cutaway;await page.evaluate(p=>window.transmissionLab.loadProject(JSON.stringify(p)),old);assert.equal((await page.evaluate(()=>window.transmissionLab.getState())).view.housingMode,'hidden');
  await page.locator('.view-controls [data-housing-mode=cutaway]').click();await page.locator('#housing').fill('1');await page.locator('#cutaway').fill('0.55');
 });
 await check('Category visibility hides geometry and labels; choosing a hidden bearing restores it',async()=>{
  await page.locator('[data-type=dct]').click();await page.locator('[data-inspector=parts]').click();await page.locator('#bearings').uncheck();await page.locator('#clutches').uncheck();await page.locator('#lubrication').uncheck();await page.waitForTimeout(100);
  let d=await page.evaluate(()=>window.transmissionLab.getState().scene);
  for(const category of ['bearings','clutches','lubrication'])for(const part of d.parts.filter(p=>p.category===category)){assert.equal(part.visible,false);assert.ok(!d.labelPositions.some(l=>l.id===part.id));}
  assert.equal(await page.locator('#oilFlow').isDisabled(),true);
  await page.locator('[data-part-filter=bearings]').click();await page.locator('.parts-list [data-part=bearings]').click();await page.waitForTimeout(100);
  assert.equal(await page.locator('#bearings').isChecked(),true);assert.match(await page.locator('#part-motion-label').textContent(),/내륜/);
  assert.equal((await page.evaluate(()=>window.transmissionLab.getState().scene.parts.find(p=>p.id==='bearings').visible)),true);
  await page.locator('#clutches').check();await page.locator('#lubrication').check();
 });
 await check('Part filters isolate names and provide oil component descriptions',async()=>{
  await page.locator('#explode').fill('0.12');await page.locator('#housing').fill('1');
  await page.locator('[data-part-filter=lubrication]').click();await page.waitForTimeout(100);const d=await page.evaluate(()=>window.transmissionLab.getState().scene);
  for(const label of d.labelPositions)assert.equal(d.parts.find(p=>p.id===label.id).category,'lubrication');
  await page.locator('.parts-list [data-part=oil-filter]').click();assert.match(await page.locator('.part-detail h3').textContent(),/필터|스트레이너/);assert.match(await page.locator('#part-rpm').textContent(),/윤활/);
  await page.screenshot({path:path.join(output,'dct-oil-anatomy.png')});await page.locator('[data-part-filter=all]').click();
 });
 await check('New anatomy visibility survives project save/load and legacy projects receive defaults',async()=>{
  await page.locator('#oilFlow').uncheck();await page.locator('#bearings').uncheck();const p=await page.evaluate(()=>window.transmissionLab.project());
  await page.locator('#bearings').check();await page.evaluate(p=>window.transmissionLab.loadProject(JSON.stringify(p)),p);assert.equal(await page.locator('#bearings').isChecked(),false);assert.equal(await page.locator('#oilFlow').isChecked(),false);
  for(const key of ['bearings','clutches','lubrication','oilFlow'])delete p.view[key];
  delete p.view.housingMode;delete p.view.cutaway;p.view.housing=.12;
  await page.evaluate(p=>window.transmissionLab.loadProject(JSON.stringify(p)),p);const state=await page.evaluate(()=>window.transmissionLab.getState());for(const key of ['bearings','clutches','lubrication','oilFlow'])assert.equal(state.view[key],true);
  assert.equal(state.view.housingMode,'cutaway');assert.equal(state.view.housing,1);assert.equal(state.view.cutaway,.55);
  await page.locator('[data-type=ecvt]').click();
 });
 await check('Project import/export preserves controls and rejects invalid input',async()=>{
  const p=await page.evaluate(()=>window.transmissionLab.project());await page.locator('[data-type=dct]').click();
  await page.evaluate(p=>window.transmissionLab.loadProject(JSON.stringify(p)),p);assert.equal((await page.evaluate(()=>window.transmissionLab.getState().settings.type)),'ecvt');
  const rejected=await page.evaluate(()=>{try{window.transmissionLab.loadProject('{"format":"other"}');return false;}catch{return true;}});assert.equal(rejected,true);
  const download=page.waitForEvent('download');await page.locator('#save-project').click();const d=await download;assert.match(d.suggestedFilename(),/transmission/);const target=path.join(output,'project.json');await d.saveAs(target);assert.equal(JSON.parse(await fs.readFile(target,'utf8')).format,'transmission-lab-project');
 });
 await check('Saved comparison table and CSV download',async()=>{
  await page.locator('#record').click();assert.equal(await page.locator('tbody tr').count(),6);
  const download=page.waitForEvent('download');await page.locator('#export-csv').click();await(await download).saveAs(path.join(output,'comparison.csv'));await page.locator('#close-modal').click();
 });
 await check('PNG exports actual rendered canvas',async()=>{
  const download=page.waitForEvent('download');await page.locator('#capture').click();const d=await download;const target=path.join(output,'capture.png');await d.saveAs(target);assert.ok((await fs.stat(target)).size>20000);
 });
 await check('Persistent settings survive reload',async()=>{
  await page.evaluate(()=>window.transmissionLab.setSettings({rpm:2850}));await page.waitForTimeout(250);await page.reload();await page.waitForFunction(()=>window.transmissionLab);
  const s=await page.evaluate(()=>window.transmissionLab.getState());assert.equal(s.settings.type,'ecvt');assert.equal(s.settings.rpm,2850);
 });
 await check('Responsive mobile layout has no horizontal page overflow',async()=>{
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);const sizes=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(sizes.page<=sizes.viewport+1,JSON.stringify(sizes));await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
 });
 assert.deepEqual(errors,[]);results.push({name:'No browser errors',passed:true});
 await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify({passed:results.length,results,errors},null,2));
 console.log(`All ${results.length} browser checks passed.`);
}finally{await browser.close();await server?.close();}
