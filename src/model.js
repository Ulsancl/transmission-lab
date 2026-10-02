/** Controlled-speed transmission anatomy experiments. See docs/model.md. */
const TAU = Math.PI * 2;
const rpmPower = (torque, rpm) => torque * rpm * TAU / 60000;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const categoryForPart = (id) => {
  if (id === 'housing') return 'housing';
  if (['engine', 'output', 'input-shaft', 'output-shaft', 'shaft-a', 'shaft-b'].includes(id)) return 'input';
  if (['mg1', 'mg2', 'inverter', 'battery'].includes(id)) return 'electrical';
  if (['bearings', 'shaft-seals', 'release-bearing'].includes(id)) return 'bearings';
  if (id.startsWith('oil-') || ['valve-body', 'cooler'].includes(id)) return 'lubrication';
  if (id.startsWith('clutch') || id.startsWith('brake-') || ['selector', 'reverse-unit', 'converter', 'pump', 'turbine', 'stator', 'lock-clutch', 'pressure-plate', 'diaphragm', 'release-fork', 'forward-clutch', 'reverse-clutch', 'pulley-pistons', 'shift-clutches'].includes(id)) return 'clutches';
  return 'gears';
};
const part = (id, name, description) => ({ id, name, description, category: categoryForPart(id) });
const gearList = (ids) => ids.map(id => ({ id, label: id === 'N' ? 'N · 중립' : id === 'R' ? 'R · 후진' : id === 'D' ? 'D · 주행' : `${id}단` }));

export const GEAR_TEETH = Object.freeze({
  '1': [18, 62], '2': [24, 56], '3': [30, 50], '4': [36, 44], '5': [42, 38], '6': [46, 34], R: [18, 62],
});
export const PLANETARY_TEETH = Object.freeze({ sun: 30, ring: 78, planet: 24 });
export const CVT_GEOMETRY = Object.freeze({ centerDistance: 0.24, nominalRadius: 0.067, beltLength: 0.48 + TAU * 0.067 });
const gearRatio = (gear) => gear === 'N' ? 0 : (gear === 'R' ? -1 : 1) * GEAR_TEETH[gear][1] / GEAR_TEETH[gear][0];
const branch = (gear) => gear === 'R' || Number(gear) % 2 === 0 ? 'b' : 'a';
const nextGear = gear => gear === 'N' ? '1' : gear === 'R' ? '1' : String(Number(gear) === 6 ? 5 : Number(gear) + 1);
const commonParts = [
  part('engine', '엔진 입력', '입력 회전수를 일정하게 유지하는 실험용 구동원입니다. RPM과 토크 명령을 직접 바꿉니다.'),
  part('output', '최종 출력', '차동기어·바퀴 앞의 출력입니다. 이 모형은 차량 속도·관성·타이어를 계산하지 않습니다.'),
  part('housing', '하우징', '축과 베어링을 지지하는 케이스입니다. 투명도와 분해 간격을 조절해 내부를 봅니다.'),
];
const gearParts = Object.keys(GEAR_TEETH).map(id => part(`gear-${id}`, `${id === 'R' ? '후진' : `${id}단`} 기어 쌍`, `입력 ${GEAR_TEETH[id][0]}개 / 피동 ${GEAR_TEETH[id][1]}개 톱니. 외접 맞물림마다 회전 방향이 반전합니다.`));
const finalDrivePart = part('final-drive', '최종 전달 기어', '이 원리 모형은 1:1 외접 기어로 회전 방향을 다시 바꿉니다. 실제 차종의 종감속비는 포함하지 않습니다.');
const planetaryParts = [
  part('sun', '선기어 · 30T', '중심의 외접 기어입니다. 플래닛과 맞물립니다. eCVT에서는 MG1에 연결됩니다.'),
  part('ring', '링기어 · 78T', '안쪽에 톱니가 있는 기어입니다. eCVT에서는 MG2와 출력에 연결됩니다.'),
  part('carrier', '캐리어', '플래닛의 축을 지지하며 공전합니다. eCVT에서는 엔진에 연결됩니다.'),
  part('planets', '플래닛 · 24T', '선기어와 링기어 사이에서 자전하면서 캐리어와 함께 공전합니다.'),
];

export const TRANSMISSIONS = {
  mt: {
    id: 'mt', name: 'MT · 수동 변속기', shortName: 'MT', badge: 'SYNCHROMESH', subtitle: '하나의 클러치, 선택하는 기어',
    description: '건식 단판 클러치와 동기장치가 있는 대표 구조입니다. 클러치를 열면 엔진과 기어축의 동력이 끊기고, 회전 기어가 오일을 튀겨 기어·베어링을 윤활합니다.',
    gears: gearList(['N', 'R', '1', '2', '3', '4', '5', '6']),
    parts: [...commonParts, part('clutch', '단일 클러치', '결합률 0은 완전 분리, 1은 직결입니다. 중간 값은 제어된 회전차와 토크 용량을 나타내는 교육용 슬립 설정입니다.'), part('input-shaft', '입력축', '클러치를 통과한 회전이 각 단의 입력 기어에 전달됩니다.'), part('output-shaft', '피동축', '선택한 기어만 축에 잠깁니다. 나머지 피동 기어는 축 위에서 자유 회전합니다.'), part('selector', '동기장치·선택 슬리브', '원하는 피동 기어와 출력축을 연결합니다. 실제 동기장치의 마찰·변속 시간은 생략합니다.'), ...gearParts, part('reverse-idler', '후진 아이들러', '후진 경로에 맞물림을 하나 더 넣어 최종 출력 방향을 반대로 바꿉니다.'), finalDrivePart],
    lessons: [
      { title: '1단과 6단을 비교하세요', text: '같은 엔진 RPM에서 큰 감속비는 출력 RPM을 낮추고 전달 토크를 높입니다. 동력은 효율만큼 줄어듭니다.' },
      { title: '기어는 계속 맞물립니다', text: '회색 기어도 돌아갑니다. 동기장치가 축에 잠근 기어만 실제 동력 경로가 됩니다.' },
      { title: '클러치를 열어 보세요', text: '출력은 이 실험의 무관성 경계조건에 따라 정지합니다. 실제 차량은 관성으로 계속 굴러갈 수 있습니다.' },
    ],
  },
  dct: {
    id: 'dct', name: 'DCT · 습식 듀얼 클러치', shortName: 'DCT', badge: 'WET DUAL CLUTCH', subtitle: '오일로 냉각하는 두 클러치 경로',
    description: '오일로 냉각하는 습식 다판 DCT 대표 구조입니다. 홀수·짝수 기어열을 두 클러치가 나눠 구동하며 다음 단을 미리 선택합니다. 건식 DCT도 있지만 이 장면은 습식 구성을 보여 줍니다.',
    gears: gearList(['N', 'R', '1', '2', '3', '4', '5', '6']),
    parts: [...commonParts, part('clutch-a', '클러치 A · 홀수', '1·3·5단을 구동합니다. 반대 클러치와 슬립 상태로 토크를 교대합니다.'), part('clutch-b', '클러치 B · 짝수·후진', '2·4·6단과 후진을 구동합니다. 서로 다른 두 기어를 동시에 완전 직결하지 않습니다.'), part('shaft-a', '홀수 입력축', '선택된 홀수 기어를 통해 출력에서 역구동될 수 있습니다. 클러치가 열렸다고 이 축이 멈추는 것은 아닙니다.'), part('shaft-b', '짝수 입력축', '중공축과 내부축의 대표 구조입니다. 미리 선택한 기어의 속도로 출력에서 역구동됩니다.'), part('output-shaft', '공통 피동축', '현재 단과 미리 선택된 단이 서로 다른 입력축을 공통 출력에 연결합니다.'), part('selector', '기어 선택 슬리브', '각 입력축에서 현재 단과 다음 단을 선택합니다. 다음 단은 엔진 클러치가 열려 있어도 출력축과 연결됩니다.'), ...gearParts, part('reverse-idler', '후진 아이들러', '추가 외접 맞물림으로 최종 출력의 방향을 반전합니다.'), finalDrivePart],
    lessons: [
      { title: '1단에서 2단으로 바꿔 보세요', text: 'A의 홀수 경로에서 B의 짝수 경로로 클러치 결합률이 교대합니다. 미리 선택된 기어도 출력과 함께 회전합니다.' },
      { title: '두 기어를 동시에 잠그지 않습니다', text: '변속 중 두 클러치는 회전차를 허용합니다. 모형은 낮은 출력 속도를 유지한 뒤 새 속도 명령으로 이동합니다.' },
      { title: '1단에서 3단으로 건너뛰세요', text: '같은 입력축의 단을 바꿀 때는 그 클러치를 먼저 열어야 합니다. 이 모형은 토크가 끊기는 구간을 보여 줍니다.' },
    ],
  },
  cvt: {
    id: 'cvt', name: 'CVT · 벨트 무단변속기', shortName: 'CVT', badge: 'VARIABLE PULLEY', subtitle: '톱니 대신 접촉 반지름을 바꿉니다',
    description: '두 가변 풀리의 벨트 접촉 반지름을 서로 바꾸어 감속비를 연속 조절합니다. 같은 벨트 길이와 미끄럼 없는 접촉을 계산합니다.',
    gears: gearList(['N', 'D', 'R']),
    parts: [...commonParts, part('primary', '주동 풀리', '엔진 쪽 가변 풀리입니다. 접촉 반지름이 작아지면 감속비가 커집니다.'), part('secondary', '피동 풀리', '출력 쪽 가변 풀리입니다. 벨트 선속도는 주동 풀리와 같습니다.'), part('belt', '금속 벨트', '두 풀리 사이에 동력을 전달합니다. 이 원리 모형은 벨트 탄성·장력·마찰 한계를 생략합니다.'), part('reverse-unit', '전·후진 선택부', '벨트 자체를 교차시키지 않고 상류 방향 선택부가 풀리의 회전 방향을 바꿉니다.')],
    lessons: [
      { title: '감속비를 연속으로 움직이세요', text: '피동 반지름 ÷ 주동 반지름이 감속비입니다. 두 풀리의 접촉 속도가 같아야 합니다.' },
      { title: '벨트 길이는 일정합니다', text: '풀리 반지름의 단순 합을 고정하는 대신, 두 접선과 감김 호를 포함한 벨트 길이를 유지합니다.' },
      { title: 'eCVT와 구조가 다릅니다', text: '이 벨트 CVT에는 풀리와 벨트가 있습니다. 동력분할 eCVT는 유성기어와 모터를 이용합니다.' },
    ],
  },
  at: {
    id: 'at', name: 'AT · 유성기어 자동변속기', shortName: 'AT', badge: 'PLANETARY + CONVERTER', subtitle: '잡는 부품이 달라지면 비율도 달라집니다',
    description: '토크컨버터와 하나의 유성기어로 저속·직결·증속·후진의 원리를 보여 줍니다. 각 모드는 입출력 포트를 바꾸는 교육용 구성입니다.',
    gears: gearList(['N', 'R', '1', '2', '3', '4']),
    parts: [...commonParts, part('converter', '토크컨버터', '유체로 엔진과 기어를 연결합니다. 이 모형은 지정한 슬립과 1:1 토크 전달을 사용하며 발진 토크 증폭은 계산하지 않습니다.'), part('pump', '펌프·임펠러', '엔진과 같은 RPM으로 유체를 가속합니다.'), part('turbine', '터빈', '유체를 받아 기어 입력을 구동합니다. 잠금이 풀려 있으면 펌프보다 느립니다.'), part('stator', '스테이터', '유체를 안내하는 대표 부품입니다. 이 모형에는 유체 해석이나 실제 토크 증폭 곡선이 없습니다.'), ...planetaryParts, part('brake-sun', '선기어 브레이크', '2단·4단 원리 모드에서 선기어를 하우징에 고정합니다.'), part('brake-ring', '링기어 브레이크', '1단 원리 모드에서 링기어를 고정합니다.'), part('brake-carrier', '캐리어 브레이크', '후진 원리 모드에서 캐리어를 고정합니다.'), part('lock-clutch', '직결 클러치', '3단 원리 모드에서 유성기어 전체를 함께 회전시킵니다. 토크컨버터 잠금과는 별도의 기능입니다.')],
    lessons: [
      { title: '1단: 링을 고정하세요', text: '선기어 입력과 캐리어 출력. 캐리어는 플래닛을 데리고 천천히 같은 방향으로 공전합니다.' },
      { title: '후진: 캐리어를 고정하세요', text: '선기어 입력과 링기어 출력. 공전이 막혀 링기어가 선기어와 반대로 회전합니다.' },
      { title: '실제 AT는 여러 기어셋을 조합합니다', text: '여기서는 네 가지 원리 연결을 하나의 기어셋으로 비교합니다. 특정 양산 4단 미션의 조립도는 아닙니다.' },
      { title: '컨버터 잠금을 켜 보세요', text: '터빈 RPM이 엔진 RPM과 같아지고 지정한 슬립 손실이 없어집니다. 기어 마찰 효율은 그대로 적용됩니다.' },
    ],
  },
  ecvt: {
    id: 'ecvt', name: 'eCVT · 하이브리드 동력분할', shortName: 'eCVT', badge: 'POWER SPLIT', subtitle: '엔진과 두 모터가 하나의 유성기어에',
    description: '엔진은 캐리어, MG1은 선기어, MG2와 출력은 링기어에 연결됩니다. MG1 속도를 바꾸면 엔진 속도를 유지하면서 출력 RPM이 달라집니다.',
    gears: gearList(['D']),
    parts: [...commonParts, ...planetaryParts, part('mg1', 'MG1 · 선기어 모터', '선기어 속도를 조절합니다. 양의 발전 동력은 전기를 만들고, 음의 발전 동력은 모터로 전기를 소비하는 상태입니다.'), part('mg2', 'MG2 · 구동 모터', '링기어와 연결되어 토크를 더하거나 회생합니다. 이 모형에서는 별도 모터 감속기 없이 링에 직접 연결됩니다.'), part('inverter', '인버터', 'MG1·MG2·배터리의 전력 흐름을 연결합니다. 모터와 인버터를 합쳐 94%의 예시 효율을 적용합니다.'), part('battery', '배터리', '양수 kW는 방전, 음수 kW는 충전입니다. SOC·용량·전압·전류 제한은 이 모형에 없습니다.')],
    lessons: [
      { title: 'MG1 속도를 움직이세요', text: '108 × 캐리어 RPM = 30 × 선기어 RPM + 78 × 링기어 RPM. 한 축을 바꾸면 나머지 축과의 관계가 이어집니다.' },
      { title: 'MG2 토크를 더해 보세요', text: '엔진뿐 아니라 배터리도 동력을 줄 수 있습니다. 전체 입력은 엔진 동력과 배터리의 순전력을 더해 계산합니다.' },
      { title: 'MG1 발전 방향을 뒤집으세요', text: 'MG1이 역회전하면 발전기가 모터로 전환될 수 있습니다. 전력 순환과 손실까지 포함해 계산합니다.' },
    ],
  },
};

const supportParts = {
  mt: [
    part('pressure-plate', '클러치 압력판', '플라이휠 쪽에서 마찰 디스크를 눌러 엔진 토크를 전달합니다. 엔진과 함께 회전하고 클러치를 분리할 때 압착이 풀립니다.'),
    part('diaphragm', '다이어프램 스프링', '방사형 스프링 핑거가 압력판의 압착력을 만듭니다. 릴리스 베어링이 중앙을 누르면 압력판이 마찰 디스크를 놓습니다.'),
    part('release-bearing', '클러치 릴리스 베어링', '정지한 포크의 힘을 회전 중인 다이어프램으로 전달합니다. 접촉 링은 엔진 속도로 회전하고 베어링 지지부와 포크는 회전하지 않습니다.'),
    part('release-fork', '클러치 릴리스 포크', '클러치 조작을 베어링의 축방향 이동으로 바꾸는 대표 레버입니다. 모형의 이동량은 결합률을 보여 주는 표시이며 실제 스트로크 계산은 아닙니다.'),
  ],
  dct: [
    part('oil-pump', '기계식 오일 펌프', '이 습식 대표 구성에서는 엔진 측 구동으로 오일을 공급합니다. 클러치 작동·냉각·베어링 윤활에 쓰이며 실제 유량과 압력은 계산하지 않습니다.'),
    part('oil-filter', '오일 흡입 필터', '오일팬에서 펌프로 흡입되는 오일의 이물을 거릅니다. 습식 클러치 냉각용 순환 경로의 대표 필터입니다.'),
    part('valve-body', '유압 밸브바디·메카트로닉스', '전자 제어와 유압 밸브가 두 클러치와 선택 장치를 작동시킵니다. 유로와 솔레노이드의 대표 배치를 표시하며 실제 제어·압력은 계산하지 않습니다.'),
    part('cooler', '클러치 오일 냉각기', '습식 클러치와 기어에서 받은 열을 오일을 통해 내보내는 대표 열교환기입니다. 온도와 냉각 성능은 계산하지 않습니다.'),
  ],
  cvt: [
    part('forward-clutch', '전진 다판 클러치', '전진 경로를 결합하는 대표 습식 클러치입니다. D에서 이 경로를 선택하며 방향 선택부의 세부 유성기어 구성은 단순화했습니다.'),
    part('reverse-clutch', '후진 작동 팩', '후진 경로를 선택하는 대표 마찰 작동부입니다. 양산 설계에 따라 클러치 또는 고정 브레이크를 사용하며 모형은 방향 선택 기능을 단순화합니다.'),
    part('pulley-pistons', '풀리 유압 피스톤', '유압으로 가동 풀리를 축방향 이동시켜 접촉 반지름과 벨트 압착을 조절합니다. 모형에서는 선택한 기어비에 맞춘 위치만 표시합니다.'),
    part('oil-pump', 'CVT 오일 펌프', '풀리 압착과 클러치 작동, 베어링 윤활을 위한 유체를 공급하는 대표 기계식 펌프입니다. 압력·유량·동력 소비는 해석하지 않습니다.'),
    part('oil-filter', 'CVT 오일 스트레이너', '오일 흡입 경로의 이물을 거르는 대표 부품입니다. 필터 저항·오염·교환 주기는 계산하지 않습니다.'),
    part('valve-body', 'CVT 유압 밸브바디', '가변 풀리와 전·후진 작동부로 유압을 나눕니다. 표시 유로는 원리 관찰용이며 실제 제조사별 밸브 회로는 아닙니다.'),
  ],
  at: [
    part('shift-clutches', '변속용 습식 클러치 팩', '교대로 압착되는 마찰판과 강판이 회전 요소를 연결합니다. 고정 브레이크와 함께 유성기어의 연결 상태를 정하는 대표 작동부입니다.'),
    part('oil-pump', 'AT 오일 펌프', '이 대표 구성에서는 컨버터의 엔진 측에서 구동하여 윤활과 유압 제어에 필요한 오일을 공급합니다. 실제 펌프 형식·유량·압력은 생략합니다.'),
    part('oil-filter', 'AT 오일 스트레이너', '오일팬에서 유압 펌프로 들어가는 오일의 이물을 거릅니다. 필터와 오일팬의 형상은 대표 배치입니다.'),
    part('valve-body', 'AT 유압 밸브바디', '유압 밸브와 솔레노이드가 클러치·브레이크·컨버터 작동을 조절합니다. 모형의 단별 포트 연결을 보여 주는 부품이며 실제 유압 제어는 해석하지 않습니다.'),
  ],
  ecvt: [
    part('oil-pump', '모터 냉각·윤활 오일 펌프', '하이브리드 트랜스액슬에서 오일을 기어·베어링과 모터 냉각 경로로 공급하는 대표 부품입니다. 펌프 구동 방식은 설계에 따라 달라 이 장면에는 특정 펌프 RPM을 부여하지 않습니다.'),
    part('oil-filter', '냉각·윤활 오일 스트레이너', '모터 냉각과 기계부 윤활 경로의 이물을 거르는 대표 흡입부입니다. 변속 클러치를 작동시키는 부품은 아닙니다.'),
    part('cooler', '모터 오일 냉각부', '모터의 열을 오일과 케이스 또는 외부 열교환기로 내보내는 대표 냉각부입니다. 실제 설계에 따라 냉각 경로가 달라집니다.'),
  ],
};
for (const [type, definition] of Object.entries(TRANSMISSIONS)) {
  definition.parts.push(
    part('bearings', '축 지지 베어링', '내륜은 지지하는 축과 함께 돌고 외륜은 케이스에 고정됩니다. 여러 축의 베어링을 한 묶음으로 표시하므로 이 묶음에는 하나의 RPM을 부여하지 않습니다. 베어링 하중·수명은 계산하지 않습니다.'),
    part('shaft-seals', '축 오일 씰', '회전축이 케이스를 지나는 곳에서 오일 누설을 줄이는 밀봉부입니다. 고무 립과 고정 씰 하우징을 대표 형상으로 표시합니다.'),
    part('oil-pan', type === 'mt' ? '기어 오일 섬프' : '오일 섬프·저장부', type === 'mt' ? '케이스 아래에 기어 오일을 저장하는 대표 섬프입니다. 기어가 오일을 튀겨 윤활하는 구성이며 건식 클러치와는 분리됩니다.' : '윤활과 냉각에 사용할 오일이 모이는 대표 저장부입니다. 실제 양산 설계에서는 케이스 내부 섬프 또는 탈착식 오일팬을 사용합니다.'),
    part('oil-lines', type === 'mt' ? '비산 윤활 경로' : type === 'ecvt' ? '모터 냉각·윤활 경로' : '오일 유로·윤활 경로', type === 'mt' ? '회전 기어가 튀긴 오일이 기어·베어링으로 이동하는 원리를 표시합니다. 펌프나 가압 파이프가 있는 유압식 변속 구조를 뜻하지 않습니다.' : type === 'ecvt' ? '오일이 기어·베어링을 윤활하고 모터 열을 운반하는 대표 경로입니다. 변속 클러치용 유압 회로는 없으며 실제 온도·유량을 계산하지 않습니다.' : '펌프에서 윤활·냉각·작동부로 이어지는 대표 경로입니다. 표시 입자는 구조 설명용이며 실제 유량·압력·오일 온도가 아닙니다.'),
    ...supportParts[type],
  );
  definition.lubricationMode = type === 'mt' ? 'splash' : type === 'ecvt' ? 'motor-cooling' : 'hydraulic';
  definition.clutchArchitecture = type === 'mt' ? 'dry-single' : type === 'dct' ? 'wet-dual' : type === 'ecvt' ? 'none' : 'wet-actuation';
}

export function defaultSettings(type = 'dct') {
  type = Object.hasOwn(TRANSMISSIONS, type) ? type : 'dct';
  return { type, rpm: 1800, torque: 140, gear: type === 'cvt' || type === 'ecvt' ? 'D' : '1', clutch: 1, cvtRatio: 1.5, converterLock: false, converterSlip: 0.12, mg1Rpm: 2000, mg2Torque: 40, efficiency: 0.96 };
}

export function normalizeSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const type = Object.hasOwn(TRANSMISSIONS, source.type) ? source.type : 'dct';
  const defaults = defaultSettings(type);
  const normalized = { ...defaults };
  const bounds = { rpm: [0, 7000], torque: [0, 400], clutch: [0, 1], cvtRatio: [0.45, 2.8], converterSlip: [0, 0.85], mg1Rpm: [-10000, 10000], mg2Torque: [-200, 200], efficiency: [0.7, 1] };
  for (const [key, range] of Object.entries(bounds)) {
    const parsed = typeof source[key] === 'string' && source[key].trim() ? Number(source[key]) : source[key];
    if (typeof parsed === 'number' && Number.isFinite(parsed)) normalized[key] = clamp(parsed, ...range);
  }
  const gear = String(source.gear ?? defaults.gear);
  if (TRANSMISSIONS[type].gears.some(item => item.id === gear)) normalized.gear = gear;
  normalized.converterLock = source.converterLock === true;
  return normalized;
}

export function openBeltLength(primaryRadius, secondaryRadius, centerDistance = CVT_GEOMETRY.centerDistance) {
  const delta = secondaryRadius - primaryRadius;
  if (!(primaryRadius > 0 && secondaryRadius > 0 && centerDistance > Math.abs(delta))) throw new RangeError('Invalid open-belt geometry');
  return 2 * Math.sqrt(centerDistance ** 2 - delta ** 2) + Math.PI * (primaryRadius + secondaryRadius) + 2 * delta * Math.asin(delta / centerDistance);
}

export function cvtRadii(ratio) {
  ratio = clamp(Number.isFinite(ratio) ? ratio : 1.5, 0.45, 2.8);
  let lo = 0.001;
  let hi = Math.min(0.2, CVT_GEOMETRY.centerDistance / Math.max(1, Math.abs(ratio - 1)) * 0.999);
  for (let i = 0; i < 70; i++) {
    const primary = (lo + hi) / 2;
    if (openBeltLength(primary, primary * ratio) > CVT_GEOMETRY.beltLength) hi = primary;
    else lo = primary;
  }
  const primaryRadius = (lo + hi) / 2;
  return { primaryRadius, secondaryRadius: primaryRadius * ratio, ...CVT_GEOMETRY };
}

function baseSnapshot(settings, time) {
  return { type: settings.type, time, inputRpm: settings.rpm, outputRpm: 0, ratio: 0, inputTorque: 0, outputTorque: 0, inputPowerKW: 0, outputPowerKW: 0, lossPowerKW: 0, efficiency: settings.efficiency, status: '중립 · 전달 동력 없음', gear: settings.gear, nextGear: null, clutchA: 0, clutchB: 0, shiftProgress: 1, sunRpm: 0, ringRpm: 0, carrierRpm: 0, planetRpm: 0, mg1PowerKW: 0, mg2PowerKW: 0, batteryPowerKW: 0, enginePowerKW: 0, beltSpeed: 0, primaryRadius: 0, secondaryRadius: 0, activeParts: [], partRpm: { ...Object.fromEntries(TRANSMISSIONS[settings.type].parts.map(p => [p.id, 0])), engine: settings.rpm, input: settings.rpm, output: 0, housing: 0 }, notes: [], commandTorque: settings.torque, clutchLossKW: 0, gearLossKW: 0 };
}

function finishPower(s) {
  s.outputPowerKW = rpmPower(s.outputTorque, s.outputRpm);
  s.lossPowerKW = s.inputPowerKW - s.outputPowerKW;
  if (Math.abs(s.lossPowerKW) < 1e-10) s.lossPowerKW = 0;
  s.enginePowerKW = s.inputPowerKW;
  s.partRpm.output = s.outputRpm;
  return s;
}

function gearRotations(s, rpmA, rpmB = rpmA) {
  for (const [id, teeth] of Object.entries(GEAR_TEETH)) {
    const speed = branch(id) === 'a' ? rpmA : rpmB;
    s.partRpm[`gear-${id}-input`] = speed;
    s.partRpm[`gear-${id}-output`] = (id === 'R' ? 1 : -1) * speed * teeth[0] / teeth[1];
    s.partRpm[`gear-${id}`] = s.partRpm[`gear-${id}-output`];
  }
  s.partRpm['output-shaft'] = -s.outputRpm;
  s.partRpm['final-drive'] = s.outputRpm;
  s.partRpm['reverse-idler'] = -rpmB;
  s.partRpm.selector = -s.outputRpm;
}

function manual(settings, time) {
  const s = baseSnapshot(settings, time);
  const { clutch: c, rpm, torque, efficiency: eta, gear } = settings;
  const shaftRpm = rpm * c;
  s.partRpm.clutch = shaftRpm;
  s.partRpm['input-shaft'] = shaftRpm;
  if (gear !== 'N') {
    s.ratio = gearRatio(gear);
    s.outputRpm = shaftRpm / s.ratio;
    s.inputTorque = torque * c;
    s.outputTorque = s.inputTorque * s.ratio * eta;
    s.inputPowerKW = rpmPower(s.inputTorque, rpm);
    s.clutchLossKW = rpmPower(s.inputTorque, rpm - shaftRpm);
    s.gearLossKW = rpmPower(s.inputTorque, shaftRpm) * (1 - eta);
    s.clutchA = c;
    s.status = c === 0 ? '클러치 분리 · 전달 동력 없음' : c === 1 ? `${gear === 'R' ? '후진' : `${gear}단`} · 직결` : `${gear === 'R' ? '후진' : `${gear}단`} · 제어 슬립`;
    if (c > 0) s.activeParts = ['engine', 'clutch', 'input-shaft', `gear-${gear}`, 'selector', 'output-shaft', 'final-drive', 'output', ...(gear === 'R' ? ['reverse-idler'] : [])];
  }
  gearRotations(s, shaftRpm);
  s.notes = ['클러치 중간 값은 회전차와 전달 토크 용량을 함께 지정한 교육용 제어 상태입니다.', '무관성·정속 실험: 차량 관성과 동기장치 마찰은 생략합니다.'];
  return finishPower(s);
}

function dualClutch(settings, time, transition) {
  const s = baseSnapshot(settings, time);
  const { rpm, torque, clutch: c, efficiency: eta, gear } = settings;
  let selected = gear;
  let other = nextGear(gear);
  let rpmA = 0, rpmB = 0;
  let torqueA = 0, torqueB = 0;
  const engage = (id, amount) => { if (branch(id) === 'a') { s.clutchA = amount; torqueA = torque * amount; } else { s.clutchB = amount; torqueB = torque * amount; } };
  if (gear !== 'N') {
    if (transition) {
      const p = clamp(transition.elapsed / transition.duration, 0, 1);
      s.shiftProgress = p;
      const from = transition.from, to = transition.to;
      s.shiftFrom = from; s.shiftTo = to;
      const fromRatio = gearRatio(from), toRatio = gearRatio(to);
      const sign = Math.sign(toRatio);
      s.outputRpm = rpm * c / Math.max(Math.abs(fromRatio), Math.abs(toRatio)) * sign;
      if (branch(from) !== branch(to)) {
        engage(from, c * (1 - p)); engage(to, c * p);
        selected = from; other = to;
        s.status = `${from} → ${to}단 · 클러치 교대`;
      } else {
        selected = p < 0.5 ? from : to;
        other = nextGear(selected);
        engage(selected, c * Math.abs(1 - 2 * p));
        s.status = `${from} → ${to}단 · 같은 축 재선택`;
      }
      s.transitionSpeedHeld = true;
      s.notes.push('교대 중 낮은 출력 속도를 유지해 두 클러치에 회전차를 허용합니다. 완료 후 새 정속 명령을 적용합니다.');
    } else {
      s.outputRpm = rpm * c / gearRatio(gear);
      engage(gear, c);
      s.status = c > 0 ? `${gear === 'R' ? '후진' : `${gear}단`} · ${branch(gear).toUpperCase()} 경로 전달` : '두 클러치 분리 · 전달 동력 없음';
    }
    const aGear = branch(selected) === 'a' ? selected : other;
    const bGear = branch(selected) === 'b' ? selected : other;
    rpmA = s.outputRpm * gearRatio(aGear);
    rpmB = s.outputRpm * gearRatio(bGear);
    s.selectedA = aGear; s.selectedB = bGear;
    s.nextGear = other;
    s.ratio = gearRatio(gear);
    s.kinematicInputOutputRatio = Math.abs(s.outputRpm) > 1e-12 ? rpm / s.outputRpm : 0;
    s.outputTorque = (torqueA * gearRatio(aGear) + torqueB * gearRatio(bGear)) * eta;
    s.inputTorque = torqueA + torqueB;
    s.inputPowerKW = rpmPower(s.inputTorque, rpm);
    s.clutchLossKW = rpmPower(torqueA, rpm - rpmA) + rpmPower(torqueB, rpm - rpmB);
    s.gearLossKW = (rpmPower(torqueA, rpmA) + rpmPower(torqueB, rpmB)) * (1 - eta);
    s.preselectedParts = [`gear-${other}`, `shaft-${branch(other)}`];
    for (const [id, engagement] of [[aGear, s.clutchA], [bGear, s.clutchB]]) {
      if (engagement > 1e-9) s.activeParts.push(`clutch-${branch(id)}`, `shaft-${branch(id)}`, `gear-${id}`);
    }
    if (s.inputTorque > 0) s.activeParts.push('engine', 'selector', 'output-shaft', 'final-drive', 'output', ...(gear === 'R' ? ['reverse-idler'] : []));
  }
  gearRotations(s, rpmA, rpmB);
  s.partRpm['shaft-a'] = rpmA; s.partRpm['shaft-b'] = rpmB;
  s.partRpm['clutch-a'] = rpm; s.partRpm['clutch-b'] = rpm;
  s.notes.push('분리된 클러치의 입력축도 미리 선택된 기어를 통해 출력에서 역구동됩니다.');
  return finishPower(s);
}

function variablePulley(settings, time) {
  const s = baseSnapshot(settings, time);
  Object.assign(s, cvtRadii(settings.cvtRatio));
  const connected = settings.gear !== 'N';
  const sign = settings.gear === 'R' ? -1 : 1;
  const primaryRpm = connected ? sign * settings.rpm * settings.clutch : 0;
  s.ratio = connected ? sign * settings.cvtRatio : 0;
  s.outputRpm = primaryRpm / settings.cvtRatio;
  s.inputTorque = connected ? settings.torque * settings.clutch : 0;
  s.outputTorque = connected ? s.inputTorque * s.ratio * settings.efficiency : 0;
  s.inputPowerKW = rpmPower(s.inputTorque, settings.rpm);
  s.beltSpeed = primaryRpm * TAU / 60 * s.primaryRadius;
  s.clutchLossKW = rpmPower(s.inputTorque, settings.rpm - Math.abs(primaryRpm));
  s.gearLossKW = rpmPower(s.inputTorque, Math.abs(primaryRpm)) * (1 - settings.efficiency);
  s.partRpm.primary = primaryRpm; s.partRpm.secondary = s.outputRpm;
  // The belt translates; it does not have one angular shaft speed. Use beltSpeed in m/s.
  s.partRpm.belt = 0; s.partRpm['reverse-unit'] = primaryRpm;
  if (connected && settings.clutch > 0) { s.activeParts = ['engine', 'reverse-unit', 'primary', 'belt', 'secondary', 'output']; s.status = `${sign > 0 ? '주행' : '후진'} · 연속 감속비 ${settings.cvtRatio.toFixed(2)}`; }
  s.notes = ['길이가 일정한 개방 벨트·미끄럼 없는 접촉을 가정합니다.', '전·후진 선택부를 단순화했으며 발진 기어·유체 컨버터·벨트 장력은 포함하지 않습니다.'];
  return finishPower(s);
}

function planetarySpeeds(s, sun, ring, carrier) {
  s.sunRpm = sun; s.ringRpm = ring; s.carrierRpm = carrier;
  s.planetRpm = carrier - PLANETARY_TEETH.sun / PLANETARY_TEETH.planet * (sun - carrier);
  s.partRpm.sun = sun; s.partRpm.ring = ring; s.partRpm.carrier = carrier;
  s.partRpm.planets = s.planetRpm - carrier;
  s.partRpm['planet-relative'] = s.partRpm.planets;
  s.planetaryResidual = (PLANETARY_TEETH.sun + PLANETARY_TEETH.ring) * carrier - PLANETARY_TEETH.sun * sun - PLANETARY_TEETH.ring * ring;
  s.sunTeeth = PLANETARY_TEETH.sun; s.ringTeeth = PLANETARY_TEETH.ring; s.planetTeeth = PLANETARY_TEETH.planet;
}

function automaticPlanetary(settings, time) {
  const s = baseSnapshot(settings, time);
  const { sun: ns, ring: nr } = PLANETARY_TEETH;
  const rpm = settings.rpm * (settings.converterLock ? 1 : 1 - settings.converterSlip);
  s.turbineRpm = rpm;
  s.converterSlip = settings.converterLock ? 0 : settings.converterSlip;
  s.converterLocked = settings.converterLock;
  s.partRpm.converter = settings.rpm; s.partRpm.pump = settings.rpm; s.partRpm.turbine = rpm; s.partRpm.stator = 0;
  s.partRpm.input = rpm;
  let sun = 0, ring = 0, carrier = 0;
  const mode = {
    '1': { sun: rpm, ring: 0, carrier: rpm * ns / (ns + nr), input: 'sun', output: 'carrier', hold: 'ring', ratio: (ns + nr) / ns },
    '2': { sun: 0, ring: rpm, carrier: rpm * nr / (ns + nr), input: 'ring', output: 'carrier', hold: 'sun', ratio: (ns + nr) / nr },
    '3': { sun: rpm, ring: rpm, carrier: rpm, input: 'sun', output: 'carrier', hold: null, ratio: 1 },
    '4': { sun: 0, ring: rpm * (ns + nr) / nr, carrier: rpm, input: 'carrier', output: 'ring', hold: 'sun', ratio: nr / (ns + nr) },
    R: { sun: rpm, ring: -rpm * ns / nr, carrier: 0, input: 'sun', output: 'ring', hold: 'carrier', ratio: -nr / ns },
  }[settings.gear];
  if (mode) {
    ({ sun, ring, carrier } = mode);
    s.activePorts = { input: mode.input, output: mode.output };
    s.heldElement = mode.hold;
    s.ratio = mode.ratio;
    s.outputRpm = mode[mode.output];
    s.inputTorque = settings.torque;
    s.outputTorque = settings.torque * mode.ratio * settings.efficiency;
    s.inputPowerKW = rpmPower(s.inputTorque, settings.rpm);
    s.clutchLossKW = rpmPower(s.inputTorque, settings.rpm - rpm);
    s.gearLossKW = rpmPower(s.inputTorque, rpm) * (1 - settings.efficiency);
    s.activeParts = ['engine', 'converter', 'pump', 'turbine', mode.input, mode.output, 'planets', 'output', ...(mode.hold ? [`brake-${mode.hold}`] : ['lock-clutch', 'ring'])];
    s.status = `${settings.gear === 'R' ? '후진' : `${settings.gear}단 원리`} · ${mode.hold ? `${({ sun: '선기어', ring: '링기어', carrier: '캐리어' })[mode.hold]} 고정` : '전체 직결'}`;
  }
  planetarySpeeds(s, sun, ring, carrier);
  s.partRpm['brake-sun'] = 0; s.partRpm['brake-ring'] = 0; s.partRpm['brake-carrier'] = 0;
  s.partRpm['lock-clutch'] = carrier;
  s.notes = ['단일 유성기어의 입출력·고정 포트를 바꾸는 원리 모형입니다. 실제 4단 양산 변속기의 조립도와 다릅니다.', '토크컨버터는 지정 슬립·토크비 1.0을 가정합니다. 스테이터에 의한 발진 토크 증폭은 생략합니다.'];
  return finishPower(s);
}

function powerSplit(settings, time) {
  const s = baseSnapshot(settings, time);
  const { sun: ns, ring: nr } = PLANETARY_TEETH;
  const etaE = 0.94;
  const carrier = settings.rpm, sun = settings.mg1Rpm;
  const ring = ((ns + nr) * carrier - ns * sun) / nr;
  planetarySpeeds(s, sun, ring, carrier);
  s.outputRpm = ring;
  s.ratio = Math.abs(ring) > 1e-12 ? carrier / ring : 0;
  s.inputTorque = settings.torque;
  s.enginePowerKW = rpmPower(settings.torque, carrier);
  s.mg1Torque = -settings.torque * ns / (ns + nr);
  s.engineRingTorque = settings.torque * nr / (ns + nr);
  s.mg1PowerKW = rpmPower(-s.mg1Torque, sun);
  s.mg2PowerKW = rpmPower(settings.mg2Torque, ring);
  s.mg1ElectricalPowerKW = s.mg1PowerKW >= 0 ? s.mg1PowerKW * etaE : s.mg1PowerKW / etaE;
  s.mg2ElectricalPowerKW = s.mg2PowerKW >= 0 ? s.mg2PowerKW / etaE : s.mg2PowerKW * etaE;
  s.batteryPowerKW = s.mg2ElectricalPowerKW - s.mg1ElectricalPowerKW;
  const mechanicalPower = s.enginePowerKW - s.mg1PowerKW + s.mg2PowerKW;
  const signedEta = mechanicalPower >= 0 ? settings.efficiency : 1 / settings.efficiency;
  s.outputTorque = (s.engineRingTorque + settings.mg2Torque) * signedEta;
  s.outputPowerKW = rpmPower(s.outputTorque, ring);
  s.inputPowerKW = s.enginePowerKW + s.batteryPowerKW;
  s.gearLossKW = Math.abs(mechanicalPower - s.outputPowerKW);
  s.electricalLossKW = (s.mg1PowerKW - s.mg1ElectricalPowerKW) + (s.mg2ElectricalPowerKW - s.mg2PowerKW);
  s.lossPowerKW = s.gearLossKW + s.electricalLossKW;
  s.electricalEfficiency = etaE;
  s.partRpm.mg1 = sun; s.partRpm.mg2 = ring; s.partRpm.output = ring;
  s.activeParts = ['engine', 'carrier', 'planets', 'sun', 'ring', 'mg1', 'output', 'inverter', ...(Math.abs(settings.mg2Torque) > 1e-9 ? ['mg2'] : []), ...(Math.abs(s.batteryPowerKW) > 1e-9 ? ['battery'] : [])];
  s.status = `${s.mg1PowerKW >= 0 ? 'MG1 발전' : 'MG1 구동'} · ${s.batteryPowerKW >= 0 ? '배터리 방전' : '배터리 충전'}`;
  s.notes = ['엔진·MG1 속도와 엔진·MG2 토크를 지정한 준정적 실험입니다. 배터리 순전력이 수지를 맞춥니다.', 'MG1 kW 양수 = 발전, MG2 kW 양수 = 축 구동, 배터리 kW 양수 = 방전입니다.', '전체 순입력 = 엔진 kW + 배터리 kW. 모터·인버터 예시 효율 94%, SOC·전력 한계는 생략합니다.'];
  return s;
}

function ancillaryAnatomy(s, settings) {
  const spin = (key) => s.partRpm[key] || 0;
  const bearingKeys = {
    mt: ['input-shaft', 'output-shaft', 'output'],
    dct: ['shaft-a', 'shaft-b', 'output-shaft', 'output'],
    cvt: ['primary', 'secondary'],
    at: ['input', 'sun', 'carrier', 'ring', 'output'],
    ecvt: ['engine', 'mg1', 'mg2', 'output'],
  }[s.type];
  s.bearingRpm = Object.fromEntries(bearingKeys.map(key => [key, { inner: spin(key), outer: 0 }]));
  if (s.type === 'mt') {
    s.partRpm['pressure-plate'] = s.inputRpm;
    s.partRpm.diaphragm = s.inputRpm;
    s.partRpm['release-bearing'] = s.inputRpm;
    s.releaseBearing = { contactRpm: s.inputRpm, housingRpm: 0, releaseFraction: 1 - settings.clutch };
    if (s.inputTorque > 0) s.activeParts.push('pressure-plate', 'diaphragm');
  } else if (s.type !== 'ecvt') {
    // Chosen representative pump drive: mechanical engine-side drive, not a flow solution.
    s.partRpm['oil-pump'] = s.inputRpm;
    if (s.type === 'cvt') {
      s.partRpm['forward-clutch'] = settings.rpm * settings.clutch;
      s.partRpm['reverse-clutch'] = settings.rpm * settings.clutch;
      if (s.inputTorque > 0) s.activeParts.push(s.gear === 'R' ? 'reverse-clutch' : 'forward-clutch', 'pulley-pistons');
    }
    if (s.type === 'at' && s.gear !== 'N' && s.inputTorque > 0) s.activeParts.push('shift-clutches');
  }
  const mechanismMoving = bearingKeys.some(key => Math.abs(spin(key)) > 1e-9) || (['dct', 'cvt', 'at'].includes(s.type) && s.inputRpm > 1e-9);
  s.lubrication = { mode: TRANSMISSIONS[s.type].lubricationMode, schematic: true, mechanismMoving, pressureSolved: false, flowSolved: false, temperatureSolved: false };
  if (mechanismMoving) {
    s.activeParts.push('bearings', 'oil-pan', 'oil-lines');
    if (s.type !== 'mt') s.activeParts.push('oil-pump', 'oil-filter');
    if (['dct', 'cvt', 'at'].includes(s.type)) s.activeParts.push('valve-body');
    if (s.type === 'dct' || s.type === 'ecvt') s.activeParts.push('cooler');
  }
  s.activeParts = [...new Set(s.activeParts)];
  return s;
}

// These are derived observations of the controlled-speed model, not additional
// dynamics. In particular, heat is a power rate, not a solved temperature.
function mechanicalDetail(s, settings) {
  const nearZero = value => Math.abs(value) < 1e-10 ? 0 : value;
  const detail = {
    couplings: [], powerPaths: [], mesh: [], belt: null, idealPlanetaryTorques: null,
    outputLoadTorqueNm: nearZero(-s.outputTorque),
    powerBalanceResidualKW: nearZero(s.inputPowerKW - s.outputPowerKW - s.lossPowerKW),
    slipLossKW: s.clutchLossKW,
    mechanicalLossKW: s.gearLossKW,
    electricalLossKW: s.electricalLossKW ?? 0,
    temperatureSolved: false,
  };
  const coupling = (id, label, inputRpm, outputRpm, transmittedTorqueNm, engagement, locked = false) => {
    const slipRpm = nearZero(inputRpm - outputRpm);
    const entry = {
      id, label, inputRpm, outputRpm, slipRpm, transmittedTorqueNm, engagement,
      heatKW: nearZero(rpmPower(transmittedTorqueNm, slipRpm)),
      state: engagement <= 1e-12 ? 'open' : locked ? 'locked' : Math.abs(slipRpm) > 1e-9 ? 'slipping' : 'synchronous',
    };
    detail.couplings.push(entry);
    return entry;
  };
  const path = (id, label, inputPowerKW, outputPowerKW, torqueNm) => {
    detail.powerPaths.push({ id, label, inputPowerKW, outputPowerKW, torqueNm, lossPowerKW: nearZero(inputPowerKW - outputPowerKW) });
  };
  const mesh = (id, label, partIds, teeth, relativeInputRpm, loaded) => {
    detail.mesh.push({ id, label, partIds, teeth, relativeInputRpm, frequencyHz: Math.abs(relativeInputRpm) * teeth / 60, loaded });
  };

  if (s.type === 'mt') {
    coupling('clutch', '단일 클러치', s.inputRpm, s.partRpm['input-shaft'], s.inputTorque, settings.clutch, settings.clutch === 1);
    path('manual', '선택 기어 경로', s.inputPowerKW, s.outputPowerKW, s.inputTorque);
  } else if (s.type === 'dct') {
    for (const bank of ['a', 'b']) {
      const engagement = bank === 'a' ? s.clutchA : s.clutchB;
      const selectedGear = bank === 'a' ? s.selectedA : s.selectedB;
      const torqueNm = settings.torque * engagement;
      const shaftRpm = s.partRpm[`shaft-${bank}`];
      const locked = engagement === 1 && Math.abs(s.inputRpm - shaftRpm) < 1e-9;
      coupling(`clutch-${bank}`, `클러치 ${bank.toUpperCase()}`, s.inputRpm, shaftRpm, torqueNm, engagement, locked);
      path(`shaft-${bank}`, `${bank.toUpperCase()} ${selectedGear ? `${selectedGear === 'R' ? '후진' : `${selectedGear}단`}` : '분리'} 경로`, rpmPower(torqueNm, s.inputRpm), rpmPower(torqueNm, shaftRpm) * settings.efficiency, torqueNm);
    }
  } else if (s.type === 'cvt') {
    const connected = s.gear !== 'N';
    // Direction selection is downstream of this equivalent start coupling.
    // Comparing engine RPM with a reversed primary pulley would invent slip.
    coupling('reverse-unit', '전·후진 선택부 등가 결합', s.inputRpm, Math.abs(s.partRpm.primary), s.inputTorque, connected ? settings.clutch : 0, connected && settings.clutch === 1);
    path('belt', '풀리·벨트 경로', s.inputPowerKW, s.outputPowerKW, s.inputTorque);
    const angle = Math.asin((s.secondaryRadius - s.primaryRadius) / CVT_GEOMETRY.centerDistance);
    const tangentialForceN = (s.gear === 'R' ? -1 : 1) * s.inputTorque / s.primaryRadius;
    detail.belt = {
      primaryWrapDeg: (Math.PI - 2 * angle) * 180 / Math.PI,
      secondaryWrapDeg: (Math.PI + 2 * angle) * 180 / Math.PI,
      tangentLengthM: Math.sqrt(CVT_GEOMETRY.centerDistance ** 2 - (s.secondaryRadius - s.primaryRadius) ** 2),
      circulationHz: Math.abs(s.beltSpeed) / CVT_GEOMETRY.beltLength,
      tangentialForceN,
      primaryTorqueNm: tangentialForceN * s.primaryRadius,
      idealSecondaryTorqueNm: tangentialForceN * s.secondaryRadius,
      contactSpeedResidualMps: nearZero(s.partRpm.primary * TAU / 60 * s.primaryRadius - s.partRpm.secondary * TAU / 60 * s.secondaryRadius),
      tensionSolved: false, tractionLimitSolved: false,
    };
  } else if (s.type === 'at') {
    coupling('converter', '컨버터·잠금', s.inputRpm, s.turbineRpm, s.inputTorque, s.gear === 'N' ? 0 : 1, s.converterLocked);
    path('planetary', '컨버터·유성 경로', s.inputPowerKW, s.outputPowerKW, s.inputTorque);
  } else {
    // Signed stage balances also work while generating or backdriving. These
    // powers are connected stages, so their input/output columns are not totals.
    path('mg1', 'MG1 기계 → 전기', s.mg1PowerKW, s.mg1ElectricalPowerKW, -s.mg1Torque);
    path('mg2', 'MG2 전기 → 기계', s.mg2ElectricalPowerKW, s.mg2PowerKW, settings.mg2Torque);
    path('ring', '링 합성 → 출력', s.enginePowerKW - s.mg1PowerKW + s.mg2PowerKW, s.outputPowerKW, s.engineRingTorque + settings.mg2Torque);
  }

  if (s.type === 'mt' || s.type === 'dct') {
    for (const [gear, [inputTeeth]] of Object.entries(GEAR_TEETH)) {
      const loaded = s.type === 'mt'
        ? s.gear === gear && Math.abs(s.inputTorque) > 1e-9
        : (s.selectedA === gear && settings.torque * s.clutchA > 1e-9) || (s.selectedB === gear && settings.torque * s.clutchB > 1e-9);
      mesh(`gear-${gear}`, `${gear === 'R' ? '후진' : `${gear}단`} 맞물림`, [`gear-${gear}`, ...(gear === 'R' ? ['reverse-idler'] : [])], inputTeeth, s.partRpm[`gear-${gear}-input`], loaded);
    }
  } else if (s.type === 'at' || s.type === 'ecvt') {
    const { sun: ns, ring: nr } = PLANETARY_TEETH;
    const loaded = Math.abs(s.inputTorque) > 1e-9;
    mesh('sun-planets', '선기어·플래닛 맞물림', ['sun', 'planets', 'carrier'], ns, s.sunRpm - s.carrierRpm, loaded);
    mesh('ring-planets', '링기어·플래닛 맞물림', ['ring', 'planets', 'carrier'], nr, s.ringRpm - s.carrierRpm, loaded);
    // External torques ON the ideal planetary unit. Its friction is accounted
    // for by the existing lumped efficiency downstream, not these reactions.
    // Locked direct drive does not determine an internal tooth-load split.
    if (s.type === 'ecvt' || s.heldElement) {
      const coefficients = { sun: ns, ring: nr, carrier: -(ns + nr) };
      const input = s.type === 'ecvt' ? 'carrier' : s.activePorts.input;
      const scale = s.inputTorque / coefficients[input];
      const torques = Object.fromEntries(Object.entries(coefficients).map(([id, value]) => [id, value * scale]));
      const holdingElement = s.heldElement ?? null;
      detail.idealPlanetaryTorques = {
        ...torques, holdingElement, holdingTorqueNm: holdingElement ? torques[holdingElement] : 0,
        holdingPowerKW: holdingElement ? nearZero(rpmPower(torques[holdingElement], s.partRpm[holdingElement])) : 0,
        torqueBalanceResidualNm: nearZero(torques.sun + torques.ring + torques.carrier),
        powerBalanceResidualKW: nearZero(rpmPower(torques.sun, s.sunRpm) + rpmPower(torques.ring, s.ringRpm) + rpmPower(torques.carrier, s.carrierRpm)),
      };
    }
  }
  s.detail = detail;
  return s;
}

export function createSimulator(initialSettings = {}) {
  let settings = normalizeSettings(initialSettings);
  let time = 0;
  let transition = null;
  const evaluate = () => mechanicalDetail(ancillaryAnatomy(({ mt: manual, dct: dualClutch, cvt: variablePulley, at: automaticPlanetary, ecvt: powerSplit })[settings.type](settings, time, transition), settings), settings);
  return {
    get settings() { return { ...settings }; },
    setSettings(partial = {}) {
      const old = settings;
      const typeChanged = typeof partial.type === 'string' && partial.type !== old.type && Object.hasOwn(TRANSMISSIONS, partial.type);
      settings = normalizeSettings(typeChanged ? { ...defaultSettings(partial.type), ...partial } : { ...old, ...partial });
      if (typeChanged) { time = 0; transition = null; }
      else if (old.type === 'dct' && old.gear !== settings.gear) {
        // Crossing neutral/reverse is an immediate disengage/reselect, not an overlapping direction reversal.
        const forward = id => /^[1-6]$/.test(id);
        transition = forward(old.gear) && forward(settings.gear) ? { from: transition?.to ?? old.gear, to: settings.gear, elapsed: 0, duration: 0.85 } : null;
      }
      return evaluate();
    },
    reset() { time = 0; transition = null; return evaluate(); },
    step(dtSeconds) {
      const dt = typeof dtSeconds === 'number' && Number.isFinite(dtSeconds) ? clamp(dtSeconds, 0, 1) : 0;
      time += dt;
      if (transition) { transition.elapsed += dt; if (transition.elapsed >= transition.duration - 1e-12) transition = null; }
      return evaluate();
    },
    snapshot() { return evaluate(); },
  };
}
