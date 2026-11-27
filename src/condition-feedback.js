const formatters = new Map();

function format(value, digits = 0, signed = false) {
  if (!Number.isFinite(value)) return '—';
  const key = digits * 2 + Number(signed);
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat('ko-KR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: signed ? 'exceptZero' : 'auto',
    }));
  }
  return formatters.get(key).format(value || 0);
}

function gearName(gear) {
  if (gear === 'R') return '후진';
  return gear ? `${gear}단` : '미선택';
}

function flowLabel(value, positive, negative) {
  // Match the displayed precision for near-zero power.
  if (Math.abs(value) < 0.05) return '동력 없음';
  return value > 0 ? positive : negative;
}

function speedDifference(coupling) {
  return `회전차 ${format(coupling?.slipRpm)} rpm`;
}

const charts = {
  mt: {
    title: '클러치 앞뒤 회전수', unit: 'rpm', digits: 0, limit: 7000,
    read(snapshot) {
      const clutch = snapshot.detail.couplings[0];
      return {
        status: snapshot.status,
        summary: `${speedDifference(clutch)} · 미끄럼 손실 ${format(clutch?.heatKW, 2)} kW`,
        rows: [['엔진측', clutch?.inputRpm], ['변속기측', clutch?.outputRpm]],
      };
    },
  },
  dct: {
    title: '클러치 경로별 출력 동력', unit: 'kW', digits: 1, limit: 50, autoScale: true,
    read(snapshot) {
      const [a, b] = snapshot.detail.powerPaths;
      return {
        status: snapshot.status,
        summary: `K1 결합 ${format(snapshot.clutchA * 100)}% · K2 결합 ${format(snapshot.clutchB * 100)}%`,
        rows: [
          [`K1 · ${gearName(snapshot.selectedA)}`, a?.outputPowerKW],
          [`K2 · ${gearName(snapshot.selectedB)}`, b?.outputPowerKW],
        ],
      };
    },
  },
  cvt: {
    title: '풀리 유효 반지름', unit: 'mm', digits: 1, limit: 100,
    read(snapshot) {
      const coupling = snapshot.detail.couplings[0];
      const direction = snapshot.gear === 'R' ? '후진' : '주행';
      const status = snapshot.gear === 'N' ? snapshot.status :
        coupling?.state === 'open' ? `${direction} 선택 · 발진 결합 분리` : snapshot.status;
      return {
        status,
        summary: `벨트 선속도 ${format(snapshot.beltSpeed, 2, true)} m/s`,
        rows: [['구동 풀리', snapshot.primaryRadius * 1000], ['종동 풀리', snapshot.secondaryRadius * 1000]],
      };
    },
  },
  at: {
    title: '컨버터 앞뒤 회전수', unit: 'rpm', digits: 0, limit: 7000,
    read(snapshot) {
      const converter = snapshot.detail.couplings[0];
      const lock = snapshot.converterLocked ? '록업 연결' : '록업 해제';
      return {
        status: snapshot.status,
        summary: `${lock} · ${speedDifference(converter)}`,
        rows: [['펌프', converter?.inputRpm], ['터빈', converter?.outputRpm]],
      };
    },
  },
  ecvt: {
    title: 'MG1·MG2 축과 배터리 동력', unit: 'kW', digits: 1, limit: 100, autoScale: true, signed: true,
    read(snapshot) {
      const { mg1PowerKW, mg2PowerKW, batteryPowerKW } = snapshot;
      return {
        status: '유성기어 동력 분기',
        summary: '양수는 MG1 발전, MG2 구동, 배터리 방전입니다.',
        rows: [
          [`MG1 · ${flowLabel(mg1PowerKW, '발전', '구동')}`, mg1PowerKW],
          [`MG2 · ${flowLabel(mg2PowerKW, '구동', '회생')}`, mg2PowerKW],
          [`배터리 · ${flowLabel(batteryPowerKW, '방전', '충전')}`, batteryPowerKW],
        ],
      };
    },
  },
};

let mounted;

function mountFeedback() {
  const metrics = document.querySelector('.metrics');
  if (!metrics) return null;

  const panel = document.createElement('section');
  panel.className = 'condition-feedback panel';
  panel.setAttribute('aria-labelledby', 'condition-feedback-title');
  panel.innerHTML = `
    <div class="condition-feedback-intro">
      <h2 id="condition-feedback-title">현재 작동 상태</h2>
      <p class="condition-feedback-status"></p>
      <p class="condition-feedback-summary"></p>
    </div>
    <figure class="condition-graph" aria-labelledby="condition-graph-title">
      <figcaption><span id="condition-graph-title"></span> <small class="condition-graph-scale" hidden>자동 눈금</small></figcaption>
      <dl></dl>
      <div class="condition-axis" aria-hidden="true"><span></span><span>0</span><span></span></div>
    </figure>`;
  metrics.after(panel);
  return {
    panel,
    status: panel.querySelector('.condition-feedback-status'),
    summary: panel.querySelector('.condition-feedback-summary'),
    caption: panel.querySelector('#condition-graph-title'),
    scale: panel.querySelector('.condition-graph-scale'),
    series: panel.querySelector('dl'),
    axis: panel.querySelectorAll('.condition-axis span'),
    rows: [],
  };
}

function createRow() {
  const row = document.createElement('div');
  row.className = 'condition-graph-row';
  row.innerHTML = '<dt></dt><dd><span class="condition-track" aria-hidden="true"><i></i></span><span class="condition-value"></span></dd>';
  return { row, label: row.querySelector('dt'), bar: row.querySelector('i'), value: row.querySelector('.condition-value') };
}

function updateText(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function powerLimit(values, minimum) {
  const peak = Math.max(...values.filter(Number.isFinite).map(Math.abs), minimum);
  const decade = 10 ** Math.floor(Math.log10(peak));
  return [1, 2, 5, 10].find(step => peak <= step * decade) * decade;
}

/** Draw the current model state next to the calculated results. */
export function renderConditionFeedback(snapshot, _settingsOrState) {
  const chart = charts[snapshot?.type];
  if (!chart || !snapshot.detail) return;
  if (!mounted?.panel.isConnected) mounted = mountFeedback();
  if (!mounted) return;

  const { status, summary, rows } = chart.read(snapshot);
  if (mounted.chart !== chart) {
    mounted.chart = chart;
    mounted.panel.dataset.signed = Boolean(chart.signed);
    mounted.caption.textContent = `${chart.title} (${chart.unit})`;
    mounted.scale.hidden = !chart.autoScale;
    mounted.rows = rows.map(createRow);
    mounted.series.replaceChildren(...mounted.rows.map(item => item.row));
  }
  updateText(mounted.status, status);
  updateText(mounted.summary, summary);

  const limit = chart.autoScale ? powerLimit(rows.map(([, value]) => value), chart.limit) : chart.limit;
  updateText(mounted.axis[0], format(chart.signed ? -limit : 0));
  updateText(mounted.axis[2], `${format(limit, 0, chart.signed)} ${chart.unit}`);

  for (const [index, [label, value]] of rows.entries()) {
    const item = mounted.rows[index];
    updateText(item.label, label);
    updateText(item.value, `${format(value, chart.digits, chart.signed)} ${chart.unit}`);
    const width = Number.isFinite(value) ? Math.abs(value) / limit * (chart.signed ? 50 : 100) : 0;
    const percent = Math.round(Math.min(width, 100) * 100) / 100;
    if (item.percent !== percent) {
      item.percent = percent;
      item.bar.style.width = `${percent}%`;
    }
    item.bar.classList.toggle('is-negative', value < 0);
  }
}
