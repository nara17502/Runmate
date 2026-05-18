const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** "2026. 5. 12 (화)" */
export const fmtDateLong = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()} (${DAY_KO[d.getDay()]})`;
};

/** "5/12 (화)" */
export const fmtDateShort = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} (${DAY_KO[d.getDay()]})`;
};

/** "5월 12일 화요일" */
export const fmtDateKo = (date: Date): string =>
  `${date.getMonth() + 1}월 ${date.getDate()}일 ${DAY_KO[date.getDay()]}요일`;

/** "화요일" */
export const fmtDayKo = (iso: string): string => {
  if (!iso) return '';
  return DAY_KO[new Date(iso).getDay()] + '요일';
};

/** "5/12 06:30" */
export const fmtDateTime = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** "YYYY-MM-DD" (오늘) */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** "YYYY-MM" (이번달) */
export const thisMonthIso = (): string => new Date().toISOString().slice(0, 7);
