import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './config';

const MIN_TEMP = 36.5;
const MAX_TEMP = 100;

const tempCache: { [uid: string]: { temp: number; ts: number } } = {};
const CACHE_TTL = 60_000;

const setCache = (uid: string, temp: number) => { tempCache[uid] = { temp, ts: Date.now() }; };
const clearCache = (uid: string) => { delete tempCache[uid]; };

// 온도 데이터 가져오기 및 자동 계산
export const getTemperature = async (userId: string): Promise<number> => {
  const cached = tempCache[userId];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.temp;

  const ref = doc(db, 'temperature', userId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, { temp: MIN_TEMP, lastRunAt: null, updatedAt: Date.now() });
    setCache(userId, MIN_TEMP);
    return MIN_TEMP;
  }

  const data = snap.data();
  let temp = data.temp ?? MIN_TEMP;
  const lastRunAt = data.lastRunAt ?? null;
  const now = Date.now();

  // 마지막 러닝 후 48시간 유예, 이후 하루(24시간)당 0.1도씩 하락
  if (lastRunAt) {
    const hoursPassed = (now - lastRunAt) / (1000 * 60 * 60);
    if (hoursPassed >= 48) {
      const drops = Math.floor(hoursPassed / 24);
      temp = Math.max(MIN_TEMP, temp - drops * 0.1);
      temp = parseFloat(temp.toFixed(1));
      await updateDoc(ref, { temp, updatedAt: now });
    }
  }

  setCache(userId, temp);
  return temp;
};

// 러닝 완료 후 온도 상승
export const updateTempAfterRun = async (userId: string, durationSeconds: number) => {
  const ref = doc(db, 'temperature', userId);
  const snap = await getDoc(ref);

  let temp = snap.exists() ? snap.data().temp ?? MIN_TEMP : MIN_TEMP;

  // 15분당 0.1도, 하루 최대 0.8도 (2시간)
  const minutes = durationSeconds / 60;
  const rise = Math.min(Math.floor(minutes / 15) * 0.1, 0.8);
  temp = Math.min(MAX_TEMP, parseFloat((temp + rise).toFixed(1)));

  await setDoc(ref, {
    temp,
    lastRunAt: Date.now(),
    updatedAt: Date.now(),
  }, { merge: true });

  clearCache(userId);
  return temp;
};

// 마라톤 대회 인증 시 온도 상승
export const updateTempAfterRace = async (
  userId: string,
  distance: '풀' | '하프' | '10km'
) => {
  const ref = doc(db, 'temperature', userId);
  const snap = await getDoc(ref);

  let temp = snap.exists() ? snap.data().temp ?? MIN_TEMP : MIN_TEMP;

  const riseMap = { '풀': 5, '하프': 3, '10km': 1 };
  const rise = riseMap[distance];
  temp = Math.min(MAX_TEMP, parseFloat((temp + rise).toFixed(1)));

  await updateDoc(ref, { temp, updatedAt: Date.now() });
  clearCache(userId);
  return temp;
};