export const STORAGE_KEY = 'transmission-lab.v2';
export const LEGACY_KEY = 'transmission-lab.v1';

export function createProjectStorage(storage, decode) {
  let blocked = false, recovery = null;
  function load() {
    try {
      const current = storage.getItem(STORAGE_KEY), old = current === null ? storage.getItem(LEGACY_KEY) : null;
      const raw = current ?? old;
      if (!raw) return { data: null };
      try {
        const value = JSON.parse(raw);
        if(value===null)return {data:null};
        const content = current === null && !value.format ? JSON.stringify({ ...value, format: 'transmission-lab-project', version: 1 }) : raw;
        const data=decode(content), backup=storage.getItem(`${STORAGE_KEY}.recovery`);
        if(backup!==null)recovery={raw:backup,key:`${STORAGE_KEY}.recovery`,reason:'이전에 자동으로 열지 못한 원문 백업입니다.'};
        return { data, recovery };
      } catch (error) {
        recovery = { raw, key: current === null ? LEGACY_KEY : STORAGE_KEY, reason: error.message };
        if (recovery.key === STORAGE_KEY) {
          const backupKey = `${STORAGE_KEY}.recovery`;
          const existing = storage.getItem(backupKey);
          // Never overwrite a different recovery copy with another damaged record.
          if (existing !== null && existing !== raw) blocked = true;
          else { storage.setItem(backupKey, raw); blocked = storage.getItem(backupKey) !== raw; }
        }
        return { data: null, recovery, blocked };
      }
    } catch (error) { blocked = true; return { data: null, recovery, blocked, error: error.message }; }
  }
  function save(project) {
    if (blocked) return { ok: false, reason: '이전 저장 내용을 보존하고 있습니다. 프로젝트 파일로 저장해 주세요.' };
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(project));
      return { ok: true };
    } catch { return { ok: false, reason: '자동 저장 공간을 사용할 수 없습니다. 프로젝트 파일로 저장해 주세요.' }; }
  }
  return { load, save, get recovery() { return recovery; } };
}
