export const EXPERIMENT_TIMING = {
  mt: {
    key: 'mtEngagementSeconds', label: '클러치 연결 시간',
    min: 0.5, max: 8, step: 0.1, digits: 1, initial: 3,
    hint: '자동 실험에서 클러치가 분리 상태에서 완전 연결되기까지 걸리는 시간입니다.',
  },
  dct: {
    key: 'dctShiftSeconds', label: '전진 변속 시간',
    min: 0.2, max: 2, step: 0.05, digits: 2, initial: 0.85,
    hint: '전진 단수를 바꿀 때 클러치 교대 또는 같은 축 재선택에 걸리는 시간입니다. 다음 변속부터 적용합니다.',
  },
  cvt: {
    key: 'cvtSweepSeconds', label: '기어비 변화 시간',
    min: 1, max: 12, step: 0.1, digits: 1, initial: 6,
    hint: '자동 실험에서 기어비 명령을 2.60에서 0.45까지 바꾸는 시간입니다.',
  },
  at: {
    key: 'atDwellSeconds', label: '단수 전환 간격',
    min: 0.5, max: 4, step: 0.1, digits: 1, initial: 2,
    hint: '자동 실험에서 다음 연결 모드를 선택하기까지 기다리는 시간입니다. 4단에서는 이 간격의 절반 뒤에 록업합니다.',
  },
  ecvt: {
    key: 'ecvtSweepSeconds', label: 'MG1 속도 변화 시간',
    min: 1, max: 12, step: 0.1, digits: 1, initial: 6,
    hint: '자동 실험에서 MG1 속도 명령을 4,000에서 −1,000 rpm까지 바꾸는 시간입니다.',
  },
};

export function createExperimentPlan(settings) {
  switch (settings.type) {
    case 'mt': {
      const time = settings.mtEngagementSeconds;
      return {
        initial: { gear: '1', clutch: 0 },
        duration: time + 2,
        continuous: elapsed => ({ clutch: Math.min(1, elapsed / time) }),
      };
    }
    case 'dct':
      return {
        initial: { gear: '1', clutch: 1 },
        duration: 7,
        steps: [{ at: 2, settings: { gear: '2' } }, { at: 4.5, settings: { gear: '3' } }],
      };
    case 'cvt': {
      const time = settings.cvtSweepSeconds;
      return {
        initial: { gear: 'D', cvtRatio: 2.6 },
        duration: time + 2,
        continuous: elapsed => ({ cvtRatio: 2.6 - 2.15 * Math.min(1, elapsed / time) }),
      };
    }
    case 'at': {
      const time = settings.atDwellSeconds;
      return {
        initial: { gear: '1', converterLock: false },
        duration: 4.5 * time,
        steps: [
          { at: time, settings: { gear: '2' } },
          { at: 2 * time, settings: { gear: '3' } },
          { at: 3 * time, settings: { gear: '4' } },
          { at: 3.5 * time, settings: { converterLock: true } },
        ],
      };
    }
    case 'ecvt': {
      const time = settings.ecvtSweepSeconds;
      return {
        initial: { gear: 'D', mg1Rpm: 4000 },
        duration: time + 2,
        continuous: elapsed => ({ mg1Rpm: 4000 - 5000 * Math.min(1, elapsed / time) }),
      };
    }
  }
}
