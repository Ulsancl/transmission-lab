import './style.css';
import { TRANSMISSIONS, defaultSettings, normalizeSettings, createSimulator } from './model.js';
import { createTransmissionScene } from './scene.js';
import packageInfo from '../package.json';
import { captureComparison, createProject, readProject, COMPARISON_LIMIT } from './project.js';
import { advanceClock } from './clock.js';
import { createProjectStorage } from './storage.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (v, digits=0) => Number.isFinite(v) ? v.toLocaleString('ko-KR', {maximumFractionDigits:digits, minimumFractionDigits:digits}) : '—';
const icons = {
  gear:'<circle cx="12" cy="12" r="4"/><path d="m9 2-1 3-3 1-3-1-1 3 2 2v4l-2 2 1 3 3-1 3 1 1 3h4l1-3 3-1 3 1 1-3-2-2v-4l2-2-1-3-3 1-3-1-1-3Z"/>',
  play:'<path d="m8 4 12 8-12 8Z"/>', pause:'<path d="M8 4v16M16 4v16"/>', reset:'<path d="M3 10a9 9 0 1 1 1 7M3 3v7h7"/>',
  save:'<path d="M4 3h13l3 3v15H4Z"/><path d="M8 3v6h8V3M8 21v-8h8v8"/>', open:'<path d="M3 7V4h7l2 3h9v13H3l3-10h15"/>',
  camera:'<path d="M3 7h5l2-3h4l2 3h5v14H3Z"/><circle cx="12" cy="14" r="4"/>',help:'<circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 1 1 3 4v3M12 18h.01"/>',
  arrows:'<path d="M3 8h18l-4-4M21 16H3l4 4"/>', cut:'<path d="M4 4h7v16H4ZM15 4h5v16h-5M11 12h4"/>', chart:'<path d="M3 3v18h18M6 15l4-6 4 4 6-9"/>', plus:'<path d="M12 4v16M4 12h16"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.gear}</svg>`;
const META = {
  mt:{tag:'MT',title:'수동변속기',sub:'기어를 직접 연결하는 구조',headline:'맞물린 기어, 선택되는 동력',experiment:'클러치 연결 실험',accent:'#61d9d0'},
  dct:{tag:'DCT',title:'듀얼 클러치',sub:'두 갈래로 이어지는 변속',headline:'다음 기어를 미리 준비하다',experiment:'1 → 2 → 3단 변속 실험',accent:'#61d9d0'},
  cvt:{tag:'CVT',title:'무단변속기',sub:'풀리 반지름으로 바꾸는 비율',headline:'단계 없이 달라지는 기어비',experiment:'기어비 연속 변화 실험',accent:'#f5b55e'},
  at:{tag:'AT',title:'자동변속기',sub:'유성기어와 토크컨버터',headline:'고정하는 부품이 바꾸는 회전',experiment:'유성기어 1 → 4단 실험',accent:'#b3a0ff'},
  ecvt:{tag:'e-CVT',title:'하이브리드',sub:'기계와 전기로 나누는 동력',headline:'세 개의 축, 두 갈래의 에너지',experiment:'MG1 회전수 변화 실험',accent:'#90df9e'},
};
const validType = value => Object.hasOwn(META,value);
const VIEW_BOOLEAN_KEYS=['labels','flow','bearings','clutches','lubrication','oilFlow'];
const CATEGORIES={all:'전체',gears:'기어',clutches:'클러치',bearings:'베어링',lubrication:'윤활'};
const categoryVisibility={bearings:'bearings',clutches:'clutches',lubrication:'lubrication'};
const HOUSING_MODES=['cutaway','closed','hidden'];
const defaultView=()=>({explode:0.06,housing:1,housingMode:'cutaway',cutaway:0.55,quality:'auto',labels:true,flow:true,bearings:true,clutches:true,lubrication:true,oilFlow:true,focusCategory:'all',speed:1/60,selectedPart:null});
function normalizeView(value){
  const next=defaultView();if(!value||typeof value!=='object')return next;
  for(const key of ['explode','cutaway'])if(Number.isFinite(value[key]))next[key]=Math.max(0,Math.min(1,value[key]));
  if(HOUSING_MODES.includes(value.housingMode)){next.housingMode=value.housingMode;if(Number.isFinite(value.housing))next.housing=Math.max(0,Math.min(1,value.housing));}
  else if(Number.isFinite(value.housing)&&value.housing<=0.012)next.housingMode='hidden';
  for(const key of VIEW_BOOLEAN_KEYS)if(typeof value[key]==='boolean')next[key]=value[key];
  if(['auto','high','balanced','low'].includes(value.quality))next.quality=value.quality;
  if(Number.isFinite(value.speed)&&[1/120,1/60,1/30].some(s=>Math.abs(s-value.speed)<1e-8))next.speed=value.speed;
  return next;
}
let type='dct', view=defaultView();
const storageManager=createProjectStorage(localStorage,readProject);
const storageState=storageManager.load();
const stored=storageState.data;
if(validType(stored?.settings?.type))type=stored.settings.type;
let simulator=createSimulator(stored?.settings ? normalizeSettings(stored.settings) : defaultSettings(type));
type=simulator.settings.type;
if(stored?.view)view=normalizeView(stored.view);
let paused=false, snapshot=simulator.snapshot(), trace=[], comparisons=stored?.comparisons||[], latestExperiment=stored?.experiment||null, chartMetric='rpm', sequence=null, lastTimestamp=0, lastSample=-1, lastUI=0;
let storageWarning='', focused=false;
let lessonIndex=0, inspectorTab='parts', partFilter='all', persistTimer, toastTimer, selectedPart=null;
const native=window.transmissionDesktop;

$('#app').innerHTML=`
  <header class="app-header">
    <a class="brand" href="#" aria-label="Transmission Lab 홈"><span class="brand-icon">${icon('gear')}</span><span>TRANSMISSION <b>LAB</b><small>자동차 변속기 구조 실험실</small></span></a>
    <div class="header-center"><span class="status-dot"></span> INTERACTIVE MECHANICAL LAB <span class="version">01</span></div>
    <div class="header-actions"><button id="recover-storage" class="subtle-button" hidden>저장 복구</button><button id="open-project" class="icon-button" title="프로젝트 열기" aria-label="프로젝트 열기">${icon('open')}</button><button id="save-project" class="subtle-button">${icon('save')}<span>프로젝트 저장</span></button><button id="help" class="icon-button" title="사용 안내" aria-label="사용 안내">${icon('help')}</button></div>
  </header>
  <nav class="transmission-tabs" aria-label="변속기 형식">${Object.entries(META).map(([id,m],i)=>`<button class="type-tab" data-type="${id}" aria-pressed="${id===type}"><span class="type-number">0${i+1}</span><span class="type-symbol">${m.tag}</span><span class="type-copy"><b>${m.title}</b><small>${m.sub}</small></span></button>`).join('')}</nav>
  <main class="workbench">
    <aside class="control-panel panel">
      <div class="panel-heading"><span class="eyebrow">INPUT / CONTROL</span><h2>운전 조건</h2><span class="tiny-tag">실시간</span></div>
      <div class="control-section"><div class="section-title"><span>엔진 입력</span><small>ENGINE</small></div>
        <label class="range-control" for="rpm"><span>엔진 회전수</span><span class="value"><output id="rpm-value">1,800</output><small>rpm</small></span><input id="rpm" data-setting="rpm" type="range" min="0" max="7000" step="50"><span class="range-ends"><small>정지</small><small>7,000 rpm</small></span></label>
        <label class="range-control" for="torque"><span>입력 토크</span><span class="value"><output id="torque-value">140</output><small>N·m</small></span><input id="torque" data-setting="torque" type="range" min="0" max="400" step="5"><span class="range-ends"><small>0</small><small>400 N·m</small></span></label>
      </div>
      <div class="control-section"><div class="section-title"><span id="gear-heading">기어 선택</span><small id="gear-state">SELECT</small></div><div id="gear-selector" class="gear-selector" role="group" aria-label="기어 선택"></div><p id="gear-hint" class="control-hint"></p></div>
      <div id="type-controls" class="control-section"></div>
      <div class="experiment-box"><span class="eyebrow">TRY AN EXPERIMENT</span><button id="experiment" class="experiment-button">${icon('arrows')}<span>변속 실험</span><b>↗</b></button><p id="experiment-hint">조건을 바꾸며 부품의 움직임을 살펴보세요.</p></div>
      <div class="control-section view-controls"><div class="section-title"><span>해부 모드</span><small>DISSECTION</small></div>
        <label class="range-control compact" for="explode"><span>부품 벌리기</span><span class="value"><output id="explode-value">6</output><small>%</small></span><input id="explode" data-view="explode" type="range" min="0" max="1" step="0.01"></label>
        <div class="housing-view"><span class="view-group-label">케이스 관찰</span><div class="housing-modes" aria-label="케이스 관찰 방식"><button data-housing-mode="cutaway" aria-pressed="true">절개</button><button data-housing-mode="closed" aria-pressed="false">외형</button><button data-housing-mode="hidden" aria-pressed="false">내부만</button></div></div>
        <label class="range-control compact" for="cutaway"><span>절개 범위</span><span class="value"><output id="cutaway-value">55</output><small>%</small></span><input id="cutaway" data-view="cutaway" type="range" min="0" max="1" step="0.01"></label>
        <label class="range-control compact" for="housing"><span>케이스 불투명도</span><span class="value"><output id="housing-value">100</output><small>%</small></span><input id="housing" data-view="housing" type="range" min="0" max="1" step="0.01"></label>
        <div class="check-row"><label><input type="checkbox" id="labels" data-view="labels">부품 이름</label><label><input type="checkbox" id="flow" data-view="flow">동력 흐름</label></div>
        <div class="anatomy-visibility"><span>구성 요소 표시</span><div class="anatomy-checks"><label><input type="checkbox" id="clutches" data-view="clutches">클러치 계통</label><label><input type="checkbox" id="bearings" data-view="bearings">베어링·씰</label><label><input type="checkbox" id="lubrication" data-view="lubrication">오일 계통</label><label><input type="checkbox" id="oilFlow" data-view="oilFlow">오일 흐름</label></div><p>이름표는 부품 회전에 따라 돌지 않습니다. 오일 흐름은 윤활 경로를 보여주는 원리 표시입니다.</p></div>
      </div>
    </aside>
    <section class="center-column">
      <section class="scene-panel panel" aria-label="변속기 3D 구조">
        <div class="scene-heading"><div><span class="eyebrow" id="scene-kicker">DUAL CLUTCH TRANSMISSION</span><h1 id="scene-title">다음 기어를 미리 준비하다</h1></div><span class="model-tag">대표 구조 / 원리 모델</span></div>
        <div class="scene-toolbar"><div class="segmented camera-presets" aria-label="카메라 방향"><button data-camera="isometric" class="active">입체</button><button data-camera="front">정면</button><button data-camera="top">위에서</button></div><div><button id="focus-scene" class="subtle-button" aria-pressed="false" title="크게 보기 (F)">크게 보기</button><button id="reset-camera" class="icon-button" aria-label="시점 초기화" title="시점 초기화">${icon('reset')}</button><button id="capture" class="icon-button" aria-label="3D 이미지 저장" title="3D 이미지 저장">${icon('camera')}</button></div></div>
        <div class="scene-quick-tools"><div class="housing-modes" aria-label="빠른 케이스 관찰"><button data-housing-mode="cutaway">절개</button><button data-housing-mode="closed">외형</button><button data-housing-mode="hidden">내부만</button></div><label class="quick-explode">벌리기 <input data-view="explode" type="range" min="0" max="1" step="0.01" aria-label="빠른 부품 벌리기"></label><label class="quality-control">화질 <select id="quality" aria-label="화질"><option value="auto">자동</option><option value="high">정밀</option><option value="balanced">균형</option><option value="low">가볍게</option></select></label><button id="quick-experiment" class="subtle-button">자동 실험</button><button id="show-result" class="subtle-button" hidden>결과 보기</button></div>
        <div id="scene" class="scene-host"></div>
        <div class="scene-overlay"><span class="live-badge"><i></i><span id="operating-status">동력 전달 중</span></span><div id="clutch-indicator" class="clutch-indicator"></div></div>
        <div class="scene-bottom"><span class="orbit-hint">드래그 회전 · 휠 확대 · 부품 클릭</span><div class="flow-legend"><span><i class="cyan"></i>입력</span><span><i class="amber"></i>출력</span><span id="electric-legend"><i class="green"></i>전기</span><span id="oil-legend"><i class="oil-color"></i>윤활</span></div></div>
        <div class="transport"><div class="transport-buttons"><button id="toggle-pause" class="play-button" aria-label="시뮬레이션 일시정지">${icon('pause')}</button><button id="reset" class="icon-button" title="실험 초기화" aria-label="실험 초기화">${icon('reset')}</button><span id="simulation-time">00:00.0</span></div><div class="speed-control"><span>회전 표시</span><button data-speed="0.0083333333">1/120</button><button data-speed="0.0166666667" class="active">1/60</button><button data-speed="0.0333333333">1/30</button></div><span class="transport-note">수치는 실제 회전수</span></div>
      </section>
      <section class="metrics" aria-label="계산 결과"><div class="metric"><span>입력 회전수</span><strong id="metric-input">1,800</strong><small>rpm</small><div class="metric-bar cyan-bar"></div></div><div class="metric"><span>출력 회전수</span><strong id="metric-output">—</strong><small>rpm</small><div class="metric-bar amber-bar"></div></div><div class="metric"><span id="ratio-label">기어 감속비</span><strong id="metric-ratio">—</strong><small id="ratio-unit">: 1</small><div class="metric-bar purple-bar"></div></div><div class="metric"><span>출력 토크</span><strong id="metric-torque">—</strong><small>N·m</small><div class="metric-bar green-bar"></div></div></section>
      <section id="experiment-result" class="experiment-result panel" hidden aria-live="polite"></section>
      <section class="chart-panel panel"><div class="chart-heading"><div><span class="eyebrow">LIVE TELEMETRY</span><h2>변화 기록 <small id="chart-window">최근 20초</small></h2></div><button id="toggle-chart" class="subtle-button" aria-expanded="true">그래프 접기</button><div class="segmented chart-tabs"><button data-chart="rpm" class="active">회전수</button><button data-chart="torque">토크</button><button data-chart="power">동력</button></div><button id="record" class="subtle-button">${icon('plus')}조건 비교</button></div><div class="chart-wrap"><canvas id="chart" aria-label="입력과 출력의 시간 변화 그래프"></canvas><div id="chart-legend" class="chart-legend"></div></div><div class="energy-row"><span><span id="power-input-label">입력</span> <b id="power-input">—</b> kW</span><span class="energy-arrow">→</span><span>출력 <b id="power-output">—</b> kW</span><span class="loss">손실 <b id="power-loss">—</b> kW</span><span id="battery-power" class="battery-readout"></span></div></section>
    </section>
    <aside class="inspector-panel panel"><div class="panel-heading"><span class="eyebrow">ANATOMY / GUIDE</span><h2>구조 살펴보기</h2></div><div class="inspector-tabs"><button data-inspector="parts" class="active">부품 해부</button><button data-inspector="principle">작동 원리</button></div><div id="inspector-content"></div><div class="model-equation"><span class="eyebrow">MECHANICAL RELATION</span><p id="equation"></p><small id="equation-hint"></small></div><div class="model-note"><span class="note-icon">i</span><p>회전수와 기어비의 관계를 살펴보는 실험입니다. 실제 차량의 가속·발열·제어 로직은 포함하지 않습니다.</p></div></aside>
  </main>
  <footer class="app-footer"><span><i class="status-dot"></i><span id="footer-status">실험 준비 완료</span> <span id="storage-status" role="status"></span></span><span>TRANSMISSION LAB <b>v${packageInfo.version}</b> <span class="footer-separator">/</span> 오프라인 구조 실험실</span></footer>
  <div id="toast" class="toast" role="status"></div>
  <dialog id="modal"><div id="modal-content"></div></dialog>
  <input id="project-file" type="file" accept=".json,application/json" hidden>
`;

let scene;
try { scene=createTransmissionScene($('#scene'),{onSelectPart:selectPart}); scene.setType(type); }
catch(error) { $('#scene').innerHTML=`<div class="scene-error"><h2>3D 화면을 시작할 수 없습니다</h2><p>${esc(error.message)}</p><p>그래픽 가속을 사용할 수 있는 환경에서 다시 실행해 주세요.</p></div>`; console.error(error); }

function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3500); }
function persistNow(){
  clearTimeout(persistTimer);const result=storageManager.save(project());
  $('#storage-status').textContent=result.ok?'자동 저장됨':'자동 저장 실패 · 프로젝트 저장 필요';
  $('#storage-status').classList.toggle('has-warning',!result.ok);
  if(!result.ok&&storageWarning!==result.reason){storageWarning=result.reason;toast(result.reason);}if(result.ok)storageWarning='';
  return result;
}
function persist(){clearTimeout(persistTimer);persistTimer=setTimeout(persistNow,180);}
function slider(key,label,min,max,step,unit) { const v=simulator.settings[key]; return `<label class="range-control" for="${key}"><span>${label}</span><span class="value"><output id="${key}-value">${fmt(v,key==='cvtRatio'?2:0)}</output><small>${unit}</small></span><input id="${key}" data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${v}"></label>`; }
function renderControls() {
  const d=TRANSMISSIONS[type], m=META[type];
  $('.workbench').style.setProperty('--type-accent',m.accent);
  for(const b of document.querySelectorAll('[data-type]')) b.setAttribute('aria-pressed',String(b.dataset.type===type));
  $('#scene-title').textContent=m.headline;
  $('#scene-kicker').textContent=({mt:'MANUAL TRANSMISSION',dct:'DUAL CLUTCH TRANSMISSION',cvt:'CONTINUOUSLY VARIABLE TRANSMISSION',at:'PLANETARY AUTOMATIC TRANSMISSION',ecvt:'HYBRID POWER-SPLIT TRANSMISSION'})[type];
  $('#gear-selector').innerHTML=d.gears.map(g=>`<button data-gear="${esc(g.id)}" aria-pressed="${String(g.id===simulator.settings.gear)}" class="${['N','R'].includes(g.id)?'aux-gear':''}">${esc(g.label)}</button>`).join('');
  $('#gear-hint').textContent=({mt:'기어를 선택하고 클러치를 연결해 동력을 전달하세요.',dct:'홀수·짝수 기어가 서로 다른 클러치를 사용합니다.',cvt:'D에서 기어비를 연속으로 바꿀 수 있습니다.',at:'기어마다 입력·출력·고정하는 부품이 달라집니다.',ecvt:'MG1 회전수가 엔진과 출력축의 관계를 바꿉니다.'})[type];
  let html='';
  if(type==='mt'||type==='dct') html=`<div class="section-title"><span>클러치 연결</span><small>COUPLING</small></div>${slider('clutch','연결 정도',0,1,0.01,'%')}<p class="control-hint">0%는 분리, 100%는 완전 연결입니다. 중간 값은 미끄럼을 단순화한 상태입니다.</p>`;
  if(type==='cvt') html=`<div class="section-title"><span>풀리 조절</span><small>PULLEY RATIO</small></div>${slider('cvtRatio','기어비',0.45,2.8,0.01,': 1')}<div class="pulley-info"><span>구동 반지름 <b id="primary-radius">—</b> mm</span><span>종동 반지름 <b id="secondary-radius">—</b> mm</span></div><p class="control-hint">입력 풀리가 커지면 출력축이 더 빠르게 회전합니다.</p>`;
  if(type==='at') html=`<div class="section-title"><span>토크컨버터</span><small>FLUID COUPLING</small></div><label class="toggle-control"><span>록업 클러치 연결</span><input id="converterLock" data-setting="converterLock" type="checkbox"><i></i></label>${slider('converterSlip','펌프·터빈 미끄럼',0,0.85,0.01,'%')}<p class="control-hint">록업을 연결하면 엔진과 터빈이 같은 속도로 회전합니다.</p>`;
  if(type==='ecvt') html=`<div class="section-title"><span>모터 / 발전기</span><small>POWER SPLIT</small></div>${slider('mg1Rpm','MG1 회전수',-10000,10000,100,'rpm')}${slider('mg2Torque','MG2 보조 토크',-200,200,5,'N·m')}<p class="control-hint">MG1은 태양기어, 엔진은 캐리어, MG2·출력은 링기어에 연결됩니다.</p>`;
  $('#type-controls').innerHTML=html;
  $('#experiment span').textContent=m.experiment;
  $('#experiment-hint').textContent='자동으로 조건을 바꿉니다. 중간에 조절하면 실험이 멈춥니다.';
  $('#electric-legend').hidden=type!=='ecvt';
  $('#equation').textContent=type==='ecvt'||type==='at'?'(Nₛ + Nᵣ) × ω꜀ = Nₛ × ωₛ + Nᵣ × ωᵣ':type==='cvt'?'ω입력 × r입력 = ω출력 × r출력':'기어비 = 출력 기어 잇수 / 입력 기어 잇수';
  $('#equation-hint').textContent=type==='ecvt'||type==='at'?'N: 잇수 · ω: 회전수 · s: 태양 · r: 링 · c: 캐리어':type==='cvt'?'벨트 미끄럼이 없는 상태 · r: 접촉 반지름':'단순 기어 쌍 기준 · 외접 기어의 회전 방향은 반대';
  syncInputs(); renderInspector(); updateUI();
}
function syncInputs() {
  for(const el of document.querySelectorAll('[data-setting]')) {
    const value=simulator.settings[el.dataset.setting]; if(el.type==='checkbox')el.checked=Boolean(value);else el.value=value;
  }
  for(const el of document.querySelectorAll('[data-view]')) {const value=view[el.dataset.view];if(el.type==='checkbox')el.checked=Boolean(value);else el.value=value;}
  document.querySelectorAll('[data-speed]').forEach(b=>b.classList.toggle('active',Math.abs(Number(b.dataset.speed)-view.speed)<1e-8));
  $('#quality').value=view.quality;
  updateInputLabels();
}
function updateInputLabels() {
  document.querySelectorAll('[data-view="explode"]').forEach(el=>el.value=view.explode);
  for(const key of ['rpm','torque','clutch','cvtRatio','converterSlip','mg1Rpm','mg2Torque']) {const el=$(`#${key}-value`);if(el)el.textContent=fmt(simulator.settings[key]*(['clutch','converterSlip'].includes(key)?100:1),key==='cvtRatio'?2:0);}
  for(const key of ['explode','housing','cutaway'])$(`#${key}-value`).textContent=fmt(view[key]*100);
  document.querySelectorAll('[data-housing-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.housingMode===view.housingMode)));
  $('#cutaway').disabled=view.housingMode!=='cutaway';$('#housing').disabled=view.housingMode==='hidden';
  if($('#converterSlip'))$('#converterSlip').disabled=Boolean(simulator.settings.converterLock);
  $('#oilFlow').disabled=!view.lubrication;
  $('#oil-legend').hidden=!view.lubrication;
  for(const b of document.querySelectorAll('[data-gear]'))b.setAttribute('aria-pressed',String(b.dataset.gear===simulator.settings.gear));
}
function selectType(next,settings) {
  if(!validType(next))return;
  type=next;sequence=null;selectedPart=null;view.selectedPart=null;lessonIndex=0;partFilter='all';view.focusCategory='all';trace=[];lastSample=-1;
  simulator=createSimulator(settings?normalizeSettings({...settings,type:next}):defaultSettings(next));snapshot=simulator.snapshot();
  scene?.setType(type);renderControls();renderExperimentResult();persist();drawChart();
}
function setSettings(partial,fromSequence=false) {
  if(validType(partial?.type)&&partial.type!==type){selectType(partial.type,partial);return;}
  if(!fromSequence)sequence=null;
  simulator.setSettings(partial);snapshot=simulator.snapshot();syncInputs();updateUI();persist();
}
function selectPart(id) {
  const part=TRANSMISSIONS[type].parts.find(p=>p.id===id);if(!part)return;
  const visibleKey=categoryVisibility[part.category];if(visibleKey&&!view[visibleKey]){view[visibleKey]=true;syncInputs();persist();}
  if(partFilter!=='all'&&part.category!==partFilter)partFilter=Object.hasOwn(CATEGORIES,part.category)?part.category:'all';view.focusCategory=partFilter;
  selectedPart=id;view.selectedPart=id;scene?.selectPart(id);inspectorTab='parts';renderInspector();updateUI();
}
function renderInspector() {
  const d=TRANSMISSIONS[type];
  document.querySelectorAll('[data-inspector]').forEach(b=>b.classList.toggle('active',b.dataset.inspector===inspectorTab));
  if(inspectorTab==='parts') {
    const filtered=d.parts.filter(p=>partFilter==='all'||p.category===partFilter);
    const part=d.parts.find(p=>p.id===selectedPart)||filtered[0]||d.parts[0];
    const filters=Object.entries(CATEGORIES).map(([key,label])=>{const count=key==='all'?d.parts.length:d.parts.filter(p=>p.category===key).length;return `<button data-part-filter="${key}" aria-pressed="${key===partFilter}" ${count?'':'disabled'}>${label}<small>${count}</small></button>`;}).join('');
    $('#inspector-content').innerHTML=`<p class="inspector-intro">기어뿐 아니라 연결·지지·윤활 부품도 살펴보세요.</p><div class="part-filters" aria-label="부품 종류">${filters}</div><div class="parts-list">${filtered.map(p=>`<button data-part="${esc(p.id)}" class="part-button ${p.id===selectedPart?'selected':''} ${view[categoryVisibility[p.category]]===false?'is-hidden':''}"><span class="part-index">${String(d.parts.indexOf(p)+1).padStart(2,'0')}</span><span>${esc(p.name)}</span><i class="part-status ${snapshot.activeParts?.includes(p.id)?'transmitting':''}"></i></button>`).join('')}</div><article class="part-detail"><span class="eyebrow">${selectedPart?'SELECTED COMPONENT':'COMPONENT GUIDE'}${part?.category==='lubrication'?' / LUBRICATION':''}</span><h3>${esc(part?.name||d.name)}</h3><p>${esc(part?.description||d.description)}</p><div class="part-live"><span id="part-motion-label">부품 회전수</span><b id="part-rpm">${fmt(snapshot.partRpm?.[part?.id])} <small>rpm</small></b></div></article>`;
    $('#part-rpm').dataset.part=part?.id||'';
  } else {
    const lesson=d.lessons[Math.min(lessonIndex,d.lessons.length-1)];
    $('#inspector-content').innerHTML=`<div class="principle-intro"><span class="principle-symbol">${META[type].tag}</span><p>${esc(d.description)}</p></div><div class="lesson-navigation">${d.lessons.map((_,i)=>`<button data-lesson="${i}" class="${i===lessonIndex?'active':''}" aria-label="원리 ${i+1}">${i+1}</button>`).join('')}</div><article class="lesson-card"><span class="eyebrow">HOW IT WORKS / ${String(lessonIndex+1).padStart(2,'0')}</span><h3>${esc(lesson?.title)}</h3><p>${esc(lesson?.text)}</p></article><div class="planetary-readouts" id="planetary-readouts"></div>`;
  }
}
function updateUI() {
  $('#metric-input').textContent=fmt(snapshot.inputRpm);
  $('#metric-output').textContent=fmt(snapshot.outputRpm);
  $('#metric-ratio').textContent=Math.abs(snapshot.ratio)>0.001?fmt(snapshot.ratio,2):'—';
  $('#ratio-unit').textContent=type==='ecvt'?'등가 : 1':': 1';
  $('#ratio-label').textContent=type==='ecvt'?'엔진 / 출력 속도비':'기어 감속비';
  $('#power-input-label').textContent=type==='ecvt'?'엔진 + 배터리 순입력':'입력';
  $('#metric-torque').textContent=fmt(snapshot.outputTorque);
  $('#power-input').textContent=fmt(snapshot.inputPowerKW,1);$('#power-output').textContent=fmt(snapshot.outputPowerKW,1);$('#power-loss').textContent=fmt(snapshot.lossPowerKW,1);
  $('#operating-status').textContent=paused?'일시정지':snapshot.status||'동력 전달 중';
  $('.live-badge').classList.toggle('is-paused',paused);
  const time=snapshot.time||0;$('#simulation-time').textContent=`${String(Math.floor(time/60)).padStart(2,'0')}:${fmt(time%60,1).padStart(4,'0')}`;
  $('#footer-status').textContent=sequence?'조건을 자동으로 바꾸는 중':paused?'일시정지 · 조건을 조절할 수 있습니다':snapshot.notes?.[0]||'부품을 클릭해 구조를 살펴보세요';
  $('#battery-power').textContent=type==='ecvt'?`배터리 ${snapshot.batteryPowerKW>=0?'공급':'충전'} ${fmt(Math.abs(snapshot.batteryPowerKW||0),1)} kW`:'';
  if($('#primary-radius'))$('#primary-radius').textContent=fmt(snapshot.primaryRadius*1000,1);
  if($('#secondary-radius'))$('#secondary-radius').textContent=fmt(snapshot.secondaryRadius*1000,1);
  if($('#part-rpm')) {
    const id=$('#part-rpm').dataset.part||selectedPart||TRANSMISSIONS[type].parts[0]?.id,part=TRANSMISSIONS[type].parts.find(p=>p.id===id),belt=id==='belt';
    const stationary=(part?.category==='lubrication'&&(id!=='oil-pump'||type==='ecvt'))||['housing','shaft-seals','shift-clutches','pulley-pistons'].includes(id);
    if(id==='bearings') {const [shaft,bearing]=Object.entries(snapshot.bearingRpm||{})[0]||[];const shaftName={'input-shaft':'입력축','shaft-a':'K1 축',primary:'입력 풀리',input:'터빈축',engine:'캐리어'}[shaft]||'대표 축';$('#part-motion-label').textContent=`${shaftName} 내륜 / 외륜`;$('#part-rpm').innerHTML=bearing?`${fmt(bearing.inner)} / ${fmt(bearing.outer)} <small>rpm · 예시</small>`:'축별로 회전';}
    else {$('#part-motion-label').textContent=belt?'벨트 선속도':stationary?'구성 역할':'부품 회전수';$('#part-rpm').innerHTML=stationary?(part?.category==='lubrication'?'윤활·냉각 계통':['shift-clutches','pulley-pistons'].includes(id)?'복합 작동부':'고정 지지부'):`${fmt(belt?snapshot.beltSpeed:id==='planets'?snapshot.planetRpm:snapshot.partRpm?.[id],belt?2:0)} <small>${belt?'m/s':'rpm'}</small>`;}
  }
  for(const el of document.querySelectorAll('[data-part]'))el.querySelector('.part-status')?.classList.toggle('transmitting',snapshot.activeParts?.includes(el.dataset.part));
  if(type==='dct')$('#clutch-indicator').innerHTML=`<div><span class="clutch-label">K1 · 홀수</span><b>${fmt((snapshot.clutchA||0)*100)}%</b><i style="--level:${(snapshot.clutchA||0)*100}%"></i></div><div><span class="clutch-label">K2 · 짝수</span><b>${fmt((snapshot.clutchB||0)*100)}%</b><i style="--level:${(snapshot.clutchB||0)*100}%"></i></div><small>${snapshot.shiftFrom?`${esc(snapshot.shiftFrom)} → ${esc(snapshot.shiftTo)} 변속 중`:`현재 ${esc(snapshot.gear)}${/^[1-6]$/.test(snapshot.gear)?'단':''} · 대기 ${esc(snapshot.nextGear||'—')}${/^[1-6]$/.test(snapshot.nextGear)?'단':''}`}</small>`;
  else if(type==='at')$('#clutch-indicator').innerHTML=`<div class="mechanism-status">${simulator.settings.converterLock?'록업 연결':'유체로 전달'}<small>태양 ${fmt(snapshot.sunRpm)} · 링 ${fmt(snapshot.ringRpm)} rpm</small></div>`;
  else if(type==='ecvt')$('#clutch-indicator').innerHTML=`<div class="mechanism-status">전기·기계 동력 분기<small>MG1 ${snapshot.mg1PowerKW>=0?'발전':'구동'} ${fmt(Math.abs(snapshot.mg1PowerKW),1)} kW<br>MG2 ${snapshot.mg2PowerKW>=0?'구동':'회생'} ${fmt(Math.abs(snapshot.mg2PowerKW),1)} kW</small></div>`;
  else $('#clutch-indicator').innerHTML='';
  if($('#planetary-readouts'))$('#planetary-readouts').innerHTML=['at','ecvt'].includes(type)?['sun','carrier','ring'].map((key,i)=>`<span>${['태양기어','캐리어','링기어'][i]}<b>${fmt(snapshot[`${key}Rpm`])}<small>rpm</small></b></span>`).join(''):'';
}
function togglePause(value=!paused){paused=value;$('#toggle-pause').innerHTML=icon(paused?'play':'pause');$('#toggle-pause').setAttribute('aria-label',paused?'시뮬레이션 재생':'시뮬레이션 일시정지');updateUI();}
function reset(){sequence=null;simulator.reset();snapshot=simulator.snapshot();trace=[];lastSample=-1;updateUI();drawChart();}
function startExperiment(){
  const original=simulator.settings;reset();
  const initial=({dct:{gear:'1',clutch:1},mt:{gear:'1',clutch:0},cvt:{gear:'D',cvtRatio:2.6},at:{gear:'1',converterLock:false},ecvt:{gear:'D',mg1Rpm:4000}})[type];
  simulator=createSimulator({...original,...initial});snapshot=simulator.snapshot();togglePause(false);
  if(type==='dct'){setSettings({gear:'1',clutch:1},true);sequence={start:0,duration:7,steps:[{at:2,settings:{gear:'2'}},{at:4.5,settings:{gear:'3'}}],index:0};}
  if(type==='mt'){setSettings({gear:'1',clutch:0},true);sequence={start:0,duration:5,continuous:t=>({clutch:Math.min(1,t/3)})};}
  if(type==='cvt'){setSettings({gear:'D',cvtRatio:2.6},true);sequence={start:0,duration:8,continuous:t=>({cvtRatio:2.6-2.15*Math.min(1,t/6)})};}
  if(type==='at'){setSettings({gear:'1',converterLock:false},true);sequence={start:0,duration:9,steps:[{at:2,settings:{gear:'2'}},{at:4,settings:{gear:'3'}},{at:6,settings:{gear:'4'}},{at:7,settings:{converterLock:true}}],index:0};}
  if(type==='ecvt'){setSettings({mg1Rpm:4000},true);sequence={start:0,duration:8,continuous:t=>({mg1Rpm:4000-5000*Math.min(1,t/6)})};}
  sequence.before=captureComparison(simulator.settings,snapshot,`${META[type].tag} 실험 전`,packageInfo.version);
  latestExperiment=null;renderExperimentResult();syncInputs();toast(`${META[type].experiment}을 시작했습니다. 현재 엔진 입력으로 진행합니다.`);
}
function runSequence(){
  if(!sequence)return;const t=snapshot.time-sequence.start;
  if(sequence.continuous)simulator.setSettings(sequence.continuous(t));
  else while(sequence.steps[sequence.index]&&t>=sequence.steps[sequence.index].at-1e-10)simulator.setSettings(sequence.steps[sequence.index++].settings);
  snapshot=simulator.snapshot();syncInputs();
  if(t>=sequence.duration-1e-10){
    latestExperiment={before:sequence.before,after:captureComparison(simulator.settings,snapshot,`${META[type].tag} 실험 후`,packageInfo.version),duration:t};
    sequence=null;togglePause(true);renderExperimentResult();persist();toast('실험 완료 · 전후 결과가 보관되었습니다.');
  }
}
function advance(seconds){
  const beforeTime=snapshot.time;
  const result=advanceClock(seconds,dt=>{
    if(sequence)dt=Math.min(dt,Math.max(0,sequence.duration-(snapshot.time-sequence.start)));
    simulator.step(dt);snapshot=simulator.snapshot();const wasSequence=Boolean(sequence);runSequence();
    if(snapshot.time-lastSample>=0.1-1e-10){trace.push({...snapshot});trace=trace.filter(p=>p.time>=snapshot.time-20);lastSample=snapshot.time;}
    if(wasSequence&&!sequence)return false;
  });
  if(result.stalled){togglePause(true);toast('화면이 오래 지연되어 실험을 일시정지했습니다. 재생을 눌러 이어가세요.');}
  drawChart();return {...result,advanced:snapshot.time-beforeTime};
}
function renderExperimentResult(){
  const el=$('#experiment-result');el.hidden=!latestExperiment||latestExperiment.after.type!==type;$('#show-result').hidden=el.hidden;if(el.hidden)return;
  const {before,after,duration}=latestExperiment;
  const explanation=({mt:'클러치를 연결하면서 출력축에 동력이 전달됩니다.',dct:'1단에서 3단으로 이동하며 홀수·짝수 클러치가 교대로 연결됩니다.',cvt:'입력 풀리의 유효 반지름이 커지면서 출력 회전수가 달라집니다.',at:'유성기어 연결을 바꾸고 록업을 연결한 뒤의 결과입니다.',ecvt:'MG1 회전수를 바꾼 전후의 기계·전기 동력 분배입니다.'})[type];
  el.innerHTML=`<div class="result-heading"><span class="eyebrow">최근 자동 실험 · ${META[type].tag} · ${fmt(duration,1)}초</span><button id="save-experiment-comparison" class="subtle-button">전후 비교에 추가</button></div><p>${before.snapshot.inputRpm===0?'엔진이 정지한 조건입니다. 회전수 입력을 높여 다시 실험하면 동력 전달을 관찰할 수 있습니다.':explanation}</p><div class="experiment-values">${[['출력 회전수','outputRpm','rpm',0],['출력 토크','outputTorque','N·m',1],['기어비','ratio',':1',2]].map(([label,key,unit,d])=>`<span>${label}<b>${fmt(before.snapshot[key],d)} → ${fmt(after.snapshot[key],d)} <small>${unit}</small></b></span>`).join('')}</div><small>전·후 입력 회전수 ${fmt(before.snapshot.inputRpm)} / ${fmt(after.snapshot.inputRpm)} rpm · 최근 자동 실험 1건을 보관합니다.</small>`;
  $('#save-experiment-comparison').onclick=()=>{if(comparisons.length+2>COMPARISON_LIMIT){toast('비교 공간이 부족합니다. 비교표에서 기존 결과를 삭제해 주세요.');showComparisons();return;}comparisons.push(structuredClone(before),structuredClone(after));persist();showComparisons();};
}

function drawChart(){
  const canvas=$('#chart'), bounds=canvas.getBoundingClientRect();if(!bounds.width)return;
  const dpr=Math.min(devicePixelRatio||1,2), w=bounds.width,h=bounds.height;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const fields=chartMetric==='rpm'?['inputRpm','outputRpm']:chartMetric==='torque'?['inputTorque','outputTorque']:['inputPowerKW','outputPowerKW'];
  const unit={rpm:'rpm',torque:'N·m',power:'kW'}[chartMetric];
  const values=trace.flatMap(p=>fields.map(f=>p[f]||0));const min=Math.min(0,...values), max=Math.max(chartMetric==='rpm'?1000:chartMetric==='torque'?100:10,...values)*1.12,low=min<0?min*1.12:0;
  const left=44,right=w-14,top=9,bottom=h-25;const range=Math.max(1,max-low);ctx.font='10px Segoe UI, sans-serif';ctx.textBaseline='middle';
  for(let i=0;i<4;i++){const y=top+(bottom-top)*i/3;ctx.strokeStyle='#26323c';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle='#81909c';ctx.textAlign='right';ctx.fillText(fmt(max-range*i/3,chartMetric==='power'?1:0),left-7,y);}
  ctx.textAlign='left';ctx.fillStyle='#81909c';ctx.fillText(unit,3,h-10);
  const end=Math.max(20,snapshot.time||0),begin=end-20;
  for(let i=0;i<=4;i++){const x=left+(right-left)*i/4;ctx.strokeStyle='#1d2831';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.fillStyle='#6b7c8c';ctx.textAlign='center';ctx.fillText(`${fmt(begin+5*i)}s`,x,h-10);}
  fields.forEach((f,index)=>{ctx.strokeStyle=index===0?'#61d9d0':'#f5b55e';ctx.lineWidth=1.8;ctx.lineJoin='round';ctx.beginPath();let first=true;for(const p of trace){if(p.time<begin)continue;const x=left+(p.time-begin)/20*(right-left),y=bottom-((p[f]||0)-low)/range*(bottom-top);if(first){ctx.moveTo(x,y);first=false;}else ctx.lineTo(x,y);}ctx.stroke();});
  $('#chart-legend').innerHTML=`<span><i class="cyan"></i>${chartMetric==='power'&&type==='ecvt'?'엔진 + 배터리 순입력':'입력'}</span><span><i class="amber"></i>출력</span>`;
}
new ResizeObserver(()=>drawChart()).observe($('.chart-wrap'));

function showModal(html){$('#modal-content').innerHTML=`<button class="modal-close icon-button" id="close-modal" aria-label="닫기">${icon('close')}</button>${html}`;$('#modal').showModal();$('#close-modal').onclick=()=>$('#modal').close();}
function showHelp(){showModal(`<span class="eyebrow">WELCOME TO THE LAB</span><h2>변속기를 안쪽에서 살펴보세요.</h2><p class="modal-lead">형식을 고르고 조건을 바꾸면, 회전과 동력 흐름을 바로 확인할 수 있습니다.</p><ol class="help-steps"><li><b>변속기 선택</b><span>위쪽에서 MT · DCT · CVT · AT · e-CVT를 고릅니다.</span></li><li><b>내부 구조 보기</b><span>절개·외형·내부만을 전환하고 절개 범위를 조절해 케이스 벽과 내부 조립 구조를 살펴봅니다. 부품 벌리기로 조립 순서도 관찰할 수 있습니다. 드래그로 회전하고, 부품을 클릭하면 설명이 나타납니다. 이름표는 부품이 회전해도 읽을 수 있는 위치에 유지됩니다.</span></li><li><b>부품별 해부</b><span>오른쪽의 기어 · 클러치 · 베어링 · 윤활을 고르면 해당 부품의 이름과 설명을 모아 볼 수 있습니다. 왼쪽 표시 항목으로 구조를 켜거나 끄고, 오일 흐름으로 윤활 경로를 살펴봅니다.</span></li><li><b>조건 조절</b><span>회전수·토크·기어를 바꿉니다. CVT는 기어비, e-CVT는 MG1과 MG2를 직접 조절합니다.</span></li><li><b>자동 실험과 비교</b><span>변속 실험을 누르고 그래프를 살펴봅니다. 조건 비교를 눌러 결과를 최대 4개 보관할 수 있습니다.</span></li><li><b>저장</b><span>설정은 자동 보관됩니다. 프로젝트 저장은 설정과 비교 결과를 JSON 파일로 저장합니다. 카메라 버튼은 3D 화면을 PNG로 저장합니다.</span></li></ol><div class="help-note">스페이스: 재생 / 일시정지 · ↑ / ↓: 기어 변경<br>화면 회전은 관찰을 위해 느리게 표시합니다. 계산값은 실제 회전수입니다. 오일 흐름은 윤활 경로를 설명하는 표시이며 유량·압력·온도를 계산하지 않습니다.<br>AT는 단일 유성기어를 사용하는 4개 연결 원리 모드이며, 특정 차량의 4단 변속기 설계도와는 다릅니다. 기어비·부품 배치는 학습용 대표 값입니다.</div>`);}
function recordComparison(){if(comparisons.length>=COMPARISON_LIMIT){toast('비교 결과는 최대 4개입니다. 기존 결과를 삭제한 뒤 추가해 주세요.');showComparisons();return false;}comparisons.push(captureComparison(simulator.settings,simulator.snapshot(),`${META[type].tag} ${simulator.settings.gear} · ${fmt(snapshot.inputRpm)} rpm`,packageInfo.version));persist();showComparisons();return true;}
function showComparisons(){
  showModal(`<span class="eyebrow">EXPERIMENT COMPARISON · ${comparisons.length} / ${COMPARISON_LIMIT}</span><h2>운전 조건 비교</h2><p class="modal-lead">저장한 순간의 계산값을 자동 저장하고 프로젝트에도 함께 보관합니다. 조건 적용은 현재 모델로 새 실험을 시작합니다.</p>${comparisons.length?'':'<p class="modal-lead">현재 조건을 추가하거나 자동 실험의 전후 결과를 추가해 보세요.</p>'}<div class="comparison-grid"><table><thead><tr><th>조건</th>${comparisons.map((c,i)=>`<th>${esc(c.name)}<small class="result-source">${c.source==='recalculated-legacy'?'이전 형식 · 조건으로 재계산':`순간 기록 · v${esc(c.appVersion||'?')} · ${fmt(c.snapshot.time,2)}초`}</small><button class="load-comparison" data-compare-load="${i}">조건 적용</button><button class="delete-comparison" data-compare-delete="${i}" aria-label="${esc(c.name)} 삭제">삭제</button></th>`).join('')}</tr></thead><tbody>${[['출력 회전수','outputRpm','rpm',0],['기어비','ratio',':1',2],['출력 토크','outputTorque','N·m',1],['입력 동력','inputPowerKW','kW',1],['출력 동력','outputPowerKW','kW',1],['손실 동력','lossPowerKW','kW',1]].map(([label,key,unit,d])=>`<tr><th>${label}</th>${comparisons.map(c=>`<td>${fmt(c.snapshot[key],d)} <small>${unit}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div><button id="export-csv" class="primary-button" ${comparisons.length?'':'disabled'}>비교표 CSV 저장</button> <button id="clear-comparisons" class="subtle-button" ${comparisons.length?'':'disabled'}>비교 결과 비우기</button>`);
  $('#export-csv').onclick=()=>{const rows=[['형식','기어','입력 회전수 rpm','출력 회전수 rpm','기어비','출력 토크 N·m','입력 동력 kW','출력 동력 kW','손실 kW','기록 시간 s','결과 출처','앱 버전'],...comparisons.map(c=>[META[c.type].tag,c.settings.gear,c.snapshot.inputRpm,c.snapshot.outputRpm,c.snapshot.ratio,c.snapshot.outputTorque,c.snapshot.inputPowerKW,c.snapshot.outputPowerKW,c.snapshot.lossPowerKW,c.snapshot.time,c.source,c.appVersion])];download(new Blob(['\ufeff'+rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'transmission-comparison.csv');};
  $('#clear-comparisons').onclick=()=>{comparisons=[];persist();$('#modal').close();toast('비교 결과를 비웠습니다.');};
}
function download(blob,name){const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function project(){return createProject({settings:simulator.settings,view,comparisons,experiment:latestExperiment,appVersion:packageInfo.version});}
function loadProject(content){
  const data=readProject(content);const nextView=normalizeView(data.view);
  comparisons=data.comparisons;latestExperiment=data.experiment;view=nextView;selectType(data.settings.type,data.settings);toast(data.legacy?'이전 형식의 조건을 불러왔습니다. 비교표의 재계산 표시를 확인해 주세요.':'프로젝트와 저장한 비교 결과를 불러왔습니다.');return true;
}
async function saveProject(){try{const contents=JSON.stringify(project(),null,2);if(native){const result=await native.saveProject({contents,name:'transmission-lab.transmission.json'});if(!result.canceled)toast('프로젝트를 저장했습니다.');}else{download(new Blob([contents],{type:'application/json'}),'transmission-lab.transmission.json');toast('프로젝트 파일을 저장합니다.');}}catch(e){toast(`저장 실패: ${e.message}`);}}
async function openProject(){try{if(native){const result=await native.openProject();if(!result.canceled)loadProject(result.content);}else $('#project-file').click();}catch(e){toast(`파일을 열 수 없습니다: ${e.message}`);}}
function newProject(){comparisons=[];latestExperiment=null;view=defaultView();selectType('dct');togglePause(false);toast('새 프로젝트를 시작했습니다.');}
function toggleFocus(value=!focused){focused=value;$('.scene-panel').classList.toggle('is-focused',focused);$('#focus-scene').textContent=focused?'작게 보기':'크게 보기';$('#focus-scene').setAttribute('aria-pressed',String(focused));$('#focus-scene').focus();}
function command(value){if(value==='new-project')newProject();if(value==='open-project')openProject();if(value==='save-project')saveProject();if(value==='toggle-pause')togglePause();if(value==='reset')reset();if(value==='help')showHelp();if(value.startsWith('camera-'))setCamera(value.slice(7));}
function setCamera(preset){scene?.setCamera(preset);document.querySelectorAll('[data-camera]').forEach(b=>b.classList.toggle('active',b.dataset.camera===preset));}

document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.type)selectType(b.dataset.type);
  if(b.dataset.gear)setSettings({gear:b.dataset.gear});
  if(b.dataset.camera)setCamera(b.dataset.camera);
  if(b.dataset.speed){view.speed=Number(b.dataset.speed);document.querySelectorAll('[data-speed]').forEach(x=>x.classList.toggle('active',x===b));persist();}
  if(b.dataset.housingMode){view.housingMode=b.dataset.housingMode;syncInputs();persist();}
  if(b.dataset.part)selectPart(b.dataset.part);
  if(b.dataset.partFilter){partFilter=b.dataset.partFilter;view.focusCategory=partFilter;selectedPart=null;view.selectedPart=null;scene?.selectPart(null);renderInspector();updateUI();}
  if(b.dataset.inspector){inspectorTab=b.dataset.inspector;renderInspector();}
  if(b.dataset.lesson){lessonIndex=Number(b.dataset.lesson);renderInspector();}
  if(b.dataset.chart){chartMetric=b.dataset.chart;document.querySelectorAll('[data-chart]').forEach(x=>x.classList.toggle('active',x===b));drawChart();}
  if(b.dataset.compareLoad!==undefined){const c=comparisons[Number(b.dataset.compareLoad)];selectType(c.type,c.settings);$('#modal').close();toast('비교 조건을 적용했습니다.');}
  if(b.dataset.compareDelete!==undefined){comparisons.splice(Number(b.dataset.compareDelete),1);persist();showComparisons();}
});
document.addEventListener('input',event=>{const el=event.target;if(el.dataset.setting)setSettings({[el.dataset.setting]:el.type==='checkbox'?el.checked:Number(el.value)});if(el.dataset.view){view[el.dataset.view]=el.type==='checkbox'?el.checked:Number(el.value);updateInputLabels();if(['bearings','clutches','lubrication'].includes(el.dataset.view)&&inspectorTab==='parts')renderInspector();persist();}});
$('#toggle-pause').onclick=()=>togglePause();$('#reset').onclick=reset;$('#reset-camera').onclick=()=>{scene?.resetCamera();setCamera('isometric');};$('#experiment').onclick=startExperiment;$('#help').onclick=showHelp;$('#save-project').onclick=saveProject;$('#open-project').onclick=openProject;$('#record').onclick=recordComparison;
$('#quick-experiment').onclick=startExperiment;$('#focus-scene').onclick=()=>toggleFocus();
$('#show-result').onclick=()=>showModal(`<h2>자동 실험의 전후 결과</h2><div class="experiment-result">${$('#experiment-result').innerHTML.replace(/<button[^>]*>[\s\S]*?<\/button>/,'')}</div>`);
$('#quality').onchange=e=>{view.quality=e.target.value;persist();};
$('#toggle-chart').onclick=()=>{const collapsed=$('.chart-panel').classList.toggle('is-collapsed');$('#toggle-chart').setAttribute('aria-expanded',String(!collapsed));$('#toggle-chart').textContent=collapsed?'그래프 펼치기':'그래프 접기';drawChart();};
$('#recover-storage').hidden=!storageManager.recovery;
$('#recover-storage').onclick=()=>{const recovery=storageManager.recovery;if(!recovery)return;showModal(`<span class="eyebrow">STORAGE RECOVERY</span><h2>이전 저장 내용 보관</h2><p class="modal-lead">읽을 수 없거나 현재 앱이 지원하지 않는 이전 저장 내용을 보존했습니다. 원문을 파일로 받아 보관할 수 있습니다.</p><p class="help-note">${esc(recovery.reason)}</p><button id="export-recovery" class="primary-button">원문 파일 저장</button>`);$('#export-recovery').onclick=()=>download(new Blob([recovery.raw],{type:'application/json'}),'transmission-storage-recovery.json');};
$('#capture').onclick=()=>{if(!scene)return;try{const data=scene.capture();const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));download(new Blob([bytes],{type:'image/png'}),`transmission-${type}-${Date.now()}.png`);if(!native)toast('3D 화면을 저장합니다.');}catch(e){toast(`이미지를 저장할 수 없습니다: ${e.message}`);}};
$('#project-file').onchange=async event=>{try{const file=event.target.files?.[0];if(file){if(file.size>2*1024*1024)throw new Error('파일이 너무 큽니다.');loadProject(await file.text());}}catch(e){toast(`파일을 열 수 없습니다: ${e.message}`);}finally{event.target.value='';}};
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const b=$('#modal').getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)$('#modal').close();}});
document.addEventListener('keydown',e=>{if($('#modal').open)return;if(e.key==='Escape'&&focused){e.preventDefault();toggleFocus(false);return;}if(e.target.matches('input,textarea,select')||e.ctrlKey||e.metaKey||e.altKey)return;if(e.code==='KeyF'){e.preventDefault();toggleFocus();}if(e.code==='Space'){e.preventDefault();togglePause();}if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const gears=TRANSMISSIONS[type].gears.filter(g=>!['N','R'].includes(g.id));const index=gears.findIndex(g=>g.id===simulator.settings.gear);const next=gears[Math.max(0,Math.min(gears.length-1,index+(e.key==='ArrowUp'?1:-1)))];if(next)setSettings({gear:next.id});}});
native?.onCommand(command);native?.onSaveResult(result=>{if(result.path)toast('파일을 저장했습니다.');else if(result.error)toast(result.error);else if(result.canceled)toast('파일 저장을 취소했습니다.');});
$('.brand').onclick=e=>{e.preventDefault();scene?.resetCamera();};
window.transmissionLab={getState:()=>({settings:{...simulator.settings},view:{...view},snapshot:{...snapshot},paused,comparisons:comparisons.length,experiment:latestExperiment?structuredClone(latestExperiment):null,focused,sequence:!!sequence,scene:scene?.getDiagnostics()}),setSettings,selectType,reset,pause:()=>togglePause(true),play:()=>togglePause(false),selectPart,project,loadProject,scene,runExperiment:startExperiment,advance,recordComparison,persistNow,showComparisons,toggleFocus};
renderControls();renderExperimentResult();
if(matchMedia('(min-width:1061px) and (max-height:900px)').matches){$('.chart-panel').classList.add('is-collapsed');$('#toggle-chart').setAttribute('aria-expanded','false');$('#toggle-chart').textContent='그래프 펼치기';}
if(storageState.recovery||storageState.error)toast('이전 저장 내용을 자동으로 열지 못했습니다. 저장 복구와 프로젝트 저장을 이용해 주세요.');
if(stored?.legacy)toast('이전 형식의 비교 조건을 복원했습니다. 재계산 결과로 표시됩니다.');
function frame(timestamp){const dt=lastTimestamp?Math.max(0,(timestamp-lastTimestamp)/1000):0;lastTimestamp=timestamp;if(!paused&&!document.hidden)advance(dt);scene?.update(snapshot,view,paused||document.hidden?0:Math.min(dt,1));if(timestamp-lastUI>100){updateUI();lastUI=timestamp;}requestAnimationFrame(frame);}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange',()=>{lastTimestamp=0;});
window.addEventListener('beforeunload',()=>{persistNow();scene?.dispose();});
