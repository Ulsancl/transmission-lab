/** Selection-dependent observations, all derived from the current model snapshot. */
export function componentReadouts(snapshot, partId, bearing = null) {
  const d = snapshot.detail;
  if (!d) return { rows: [], note: '' };
  const rows = [], add = (label, value, unit, digits = 1) => { if (Number.isFinite(value)) rows.push({ label, value, unit, digits }); };
  let note = '';
  const coupling = d.couplings.find(item => item.id === partId);
  if (coupling) {
    add('입출력 회전차', coupling.slipRpm, 'rpm', 0);
    add('전달 토크', coupling.transmittedTorqueNm, 'N·m');
    add('미끄럼 손실', coupling.heatKW, 'kW', 2);
    note = '회전차 × 전달 토크로 구한 손실입니다. 부품 온도는 계산하지 않습니다.';
  }
  const meshes = d.mesh.filter(item => item.partIds.includes(partId));
  for (const mesh of meshes.slice(0, 2)) add(mesh.label, mesh.frequencyHz, 'Hz');
  if (meshes.length) note = '톱니가 맞물림 지점을 지나는 빈도입니다. 소음이나 진동 크기를 뜻하지 않습니다.';
  if (partId === 'bearings' && bearing) {
    add('케이지 공전', bearing.cageRpm, 'rpm', 0);
    add('볼 자전 · 고정 좌표', bearing.ballWorldRpm, 'rpm', 0);
    note = '확대되는 첫 베어링의 표시 치수 기준입니다. 접촉각 0°, 미끄럼 없는 운동이며 볼의 띠는 회전 관찰용입니다.';
  }
  if (['belt', 'primary', 'secondary'].includes(partId) && d.belt) {
    add('벨트 순환', d.belt.circulationHz, '회/s', 2);
    add('구동 감김각', d.belt.primaryWrapDeg, '°');
    add('종동 감김각', d.belt.secondaryWrapDeg, '°');
    add('이상 접선 전달력', d.belt.tangentialForceN, 'N', 0);
    note = '토크 ÷ 접촉 반지름으로 구한 힘입니다. 벨트 장력·압착력·허용 하중은 아닙니다.';
  }
  if (partId.startsWith('brake-') && d.idealPlanetaryTorques) {
    const torque = d.idealPlanetaryTorques;
    add('고정 요소 반력 토크', torque.holdingElement === partId.slice(6) ? torque.holdingTorqueNm : 0, 'N·m');
    add('고정부 전달 동력', 0, 'kW');
    note = '고정 요소는 반력 토크를 받지만 회전하지 않아 동력을 전달하지 않습니다. 기어 손실 전 이상 평형입니다.';
  }
  if (partId === 'output') {
    add('부하 반력 토크', d.outputLoadTorqueNm, 'N·m');
    add('출력 동력', snapshot.outputPowerKW, 'kW', 2);
    note = '정속 경계조건의 부하 반력입니다. 차량 가속도를 계산한 값은 아닙니다.';
  }
  if (!rows.length) {
    add('미끄럼 손실', d.slipLossKW, 'kW', 2);
    add('기계 전달 손실', d.mechanicalLossKW, 'kW', 2);
    if (snapshot.type === 'ecvt') add('모터·인버터 손실', d.electricalLossKW, 'kW', 2);
    note = '현재 변속기 전체의 손실 분해입니다. 입력 − 출력과 일치하며 온도 상승은 계산하지 않습니다.';
  }
  return { rows, note };
}
