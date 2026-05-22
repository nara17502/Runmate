import { useState, useEffect, useMemo } from 'react';
import { ACCENT, BG } from '../constants/colors';
import { fmtDateShort, fmtDayKo, thisMonthIso } from '../constants/dateUtils';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { collection, query, where, getDocs, orderBy, getDoc, doc, deleteDoc } from 'firebase/firestore';
import { useRouter } from 'expo-router';
import { auth, db } from '../firebase/config';

// ─── 타입 ────────────────────────────────────────────────────────
type SortKey = 'date' | 'distanceKm' | 'duration' | 'pace';
type SortDir = 'asc' | 'desc';

interface RunRecord {
  id: string;
  date: string;
  distanceKm: number;
  duration: number;       // 초
  paceSecPerKm: number;   // 초/km
  durationFmt: string;    // MM:SS
  paceFmt: string;        // M'SS"
}

// ─── 헬퍼 ────────────────────────────────────────────────────────
const fmtDuration = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
const fmtPace = (secPerKm: number) => {
  if (!isFinite(secPerKm) || secPerKm <= 0) return '-';
  const m = Math.floor(secPerKm / 60);
  const s = Math.floor(secPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
};

const BAR_MAX_H = 90;

// ─── 컬럼 정의 ───────────────────────────────────────────────────
const COLUMNS: { key: SortKey; label: string; width: number; align: 'left' | 'right' | 'center' }[] = [
  { key: 'date',       label: '날짜',   width: 90,  align: 'left'   },
  { key: 'distanceKm', label: '거리',   width: 68,  align: 'right'  },
  { key: 'duration',   label: '시간',   width: 62,  align: 'center' },
  { key: 'pace',       label: '페이스', width: 62,  align: 'center' },
];

// ─── 메인 컴포넌트 ───────────────────────────────────────────────
export default function MyRecordsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [records, setRecords] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [chartTab, setChartTab] = useState<'weekly' | 'pace'>('weekly');

  // 전체 요약 통계
  const [totalKm, setTotalKm] = useState(0);
  const [totalRuns, setTotalRuns] = useState(0);
  const [bestKm, setBestKm] = useState(0);
  const [bestPace, setBestPace] = useState(0); // 낮을수록 빠름

  // 월간 통계
  const [monthKm, setMonthKm] = useState(0);
  const [monthRuns, setMonthRuns] = useState(0);
  const [monthBestKm, setMonthBestKm] = useState(0);
  const [monthBestPace, setMonthBestPace] = useState(0);

  useEffect(() => {
    loadRecords();
  }, []);

  const loadRecords = async () => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, 'runningRecords'),
          where('userId', '==', userId),
          orderBy('createdAt', 'desc'),
        )
      );

      const list: RunRecord[] = snap.docs.map(d => {
        const data = d.data();
        const km = data.distanceKm || 0;
        const dur = data.duration || 0;
        const pace = km > 0 ? dur / km : 0;
        return {
          id: d.id,
          date: data.date || '',
          distanceKm: km,
          duration: dur,
          paceSecPerKm: pace,
          durationFmt: fmtDuration(dur),
          paceFmt: fmtPace(pace),
        };
      });

      setRecords(list);
      setTotalRuns(list.length);

      const kmSum = list.reduce((s, r) => s + r.distanceKm, 0);
      setTotalKm(parseFloat(kmSum.toFixed(2)));
      setBestKm(list.length ? Math.max(...list.map(r => r.distanceKm)) : 0);

      const validPaces = list.filter(r => r.paceSecPerKm > 0).map(r => r.paceSecPerKm);
      setBestPace(validPaces.length ? Math.min(...validPaces) : 0);

      // 월간 통계
      const month = thisMonthIso();
      const monthList = list.filter(r => r.date.startsWith(month));
      const mKmSum = monthList.reduce((s, r) => s + r.distanceKm, 0);
      setMonthKm(parseFloat(mKmSum.toFixed(2)));
      setMonthRuns(monthList.length);
      setMonthBestKm(monthList.length ? Math.max(...monthList.map(r => r.distanceKm)) : 0);
      const mPaces = monthList.filter(r => r.paceSecPerKm > 0).map(r => r.paceSecPerKm);
      setMonthBestPace(mPaces.length ? Math.min(...mPaces) : 0);
    } catch (e) {
      console.log('기록 로드 오류:', e);
    }
    setLoading(false);
  };

  const handleDelete = (id: string) => {
    Alert.alert(
      '기록 삭제',
      '이 러닝 기록을 삭제할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제', style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'runningRecords', id));
              const updated = records.filter(r => r.id !== id);
              setRecords(updated);
              setTotalRuns(updated.length);
              const kmSum = updated.reduce((s, r) => s + r.distanceKm, 0);
              setTotalKm(parseFloat(kmSum.toFixed(2)));
              setBestKm(updated.length ? Math.max(...updated.map(r => r.distanceKm)) : 0);
              const validPaces = updated.filter(r => r.paceSecPerKm > 0).map(r => r.paceSecPerKm);
              setBestPace(validPaces.length ? Math.min(...validPaces) : 0);
            } catch {
              Alert.alert('오류', '삭제에 실패했어요. 다시 시도해주세요.');
            }
          },
        },
      ],
    );
  };

  // ─── 차트 데이터 ─────────────────────────────────────────────
  const getMonday = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
  };

  const weeklyChartData = useMemo(() => {
    const todayMonday = getMonday(new Date().toISOString().slice(0, 10));
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(todayMonday + 'T00:00:00');
      d.setDate(d.getDate() - (7 - i) * 7);
      const ws = d.toISOString().slice(0, 10);
      return { weekStart: ws, label: `${d.getMonth() + 1}/${d.getDate()}` };
    });
    const weekMap: Record<string, number> = {};
    records.forEach(r => {
      if (!r.date) return;
      const ws = getMonday(r.date);
      weekMap[ws] = (weekMap[ws] || 0) + r.distanceKm;
    });
    const items = weeks.map(w => ({
      label: w.label,
      km: parseFloat((weekMap[w.weekStart] || 0).toFixed(1)),
      isCurrent: w.weekStart === todayMonday,
    }));
    const maxKm = Math.max(...items.map(d => d.km), 1);
    return items.map(item => ({
      ...item,
      barH: item.km > 0 ? Math.max((item.km / maxKm) * BAR_MAX_H, 4) : 0,
    }));
  }, [records]);

  const paceChartData = useMemo(() => {
    const items = [...records]
      .filter(r => r.paceSecPerKm > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-10)
      .map((r, i, arr) => ({
        label: r.date.slice(5).replace('-', '/'),
        paceSec: r.paceSecPerKm,
        paceFmt: r.paceFmt,
        isLatest: i === arr.length - 1,
      }));
    if (items.length < 2) return items;
    const minPace = Math.min(...items.map(d => d.paceSec));
    return items.map(item => ({
      ...item,
      barH: Math.max((minPace / item.paceSec) * BAR_MAX_H, 4),
    }));
  }, [records]);

  // ─── 정렬 ────────────────────────────────────────────────────
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      // 날짜는 최신순, 나머지는 높은순이 기본
      setSortDir(key === 'pace' ? 'asc' : 'desc');
    }
  };

  const sorted = useMemo(() => {
    return [...records].sort((a, b) => {
      let av: number, bv: number;
      switch (sortKey) {
        case 'date':       av = a.date.localeCompare(b.date); bv = 0; break;
        case 'distanceKm': av = a.distanceKm; bv = b.distanceKm; break;
        case 'duration':   av = a.duration;   bv = b.duration;   break;
        case 'pace':       av = a.paceSecPerKm; bv = b.paceSecPerKm; break;
        default:           av = 0; bv = 0;
      }
      if (sortKey === 'date') return sortDir === 'desc' ? -av : av;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [records, sortKey, sortDir]);

  // ─── 렌더 헬퍼 ───────────────────────────────────────────────
  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <Text style={styles.sortIconInactive}>↕</Text>;
    return <Text style={styles.sortIconActive}>{sortDir === 'desc' ? '↓' : '↑'}</Text>;
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>

      {/* ── 헤더 ─────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>내 러닝 기록</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── 요약 통계 ─────────────────────────────────────── */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{totalRuns}</Text>
            <Text style={styles.statLabel}>총 러닝</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{totalKm.toLocaleString()}</Text>
            <Text style={styles.statLabel}>누적 km</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{bestKm.toFixed(1)}</Text>
            <Text style={styles.statLabel}>최장 km</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{bestPace > 0 ? fmtPace(bestPace) : '-'}</Text>
            <Text style={styles.statLabel}>최고 페이스</Text>
          </View>
        </View>

        {/* ── 월간 리포트 ───────────────────────────────────── */}
        {!loading && (
          <View style={styles.monthCard}>
            <View style={styles.monthHeader}>
              <Text style={styles.monthTitle}>
                📅 {new Date().getMonth() + 1}월 리포트
              </Text>
              <Text style={styles.monthSub}>{monthRuns > 0 ? `${monthRuns}번 달렸어요 🔥` : '이번 달 아직 러닝 없음'}</Text>
            </View>
            <View style={styles.monthStats}>
              <View style={styles.monthStat}>
                <Text style={styles.monthStatValue}>{monthRuns}</Text>
                <Text style={styles.monthStatLabel}>이번달 러닝</Text>
              </View>
              <View style={styles.monthStatDiv} />
              <View style={styles.monthStat}>
                <Text style={styles.monthStatValue}>{monthKm.toLocaleString()}</Text>
                <Text style={styles.monthStatLabel}>이번달 km</Text>
              </View>
              <View style={styles.monthStatDiv} />
              <View style={styles.monthStat}>
                <Text style={styles.monthStatValue}>{monthBestKm > 0 ? monthBestKm.toFixed(1) : '-'}</Text>
                <Text style={styles.monthStatLabel}>최장 거리</Text>
              </View>
              <View style={styles.monthStatDiv} />
              <View style={styles.monthStat}>
                <Text style={styles.monthStatValue}>{monthBestPace > 0 ? fmtPace(monthBestPace) : '-'}</Text>
                <Text style={styles.monthStatLabel}>최고 페이스</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── 차트 ─────────────────────────────────────────── */}
        {!loading && records.length >= 2 && (
          <View style={styles.chartCard}>
            {/* 탭 */}
            <View style={styles.chartTabRow}>
              {(['weekly', 'pace'] as const).map(tab => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.chartTab, chartTab === tab && styles.chartTabActive]}
                  onPress={() => setChartTab(tab)}
                >
                  <Text style={[styles.chartTabText, chartTab === tab && styles.chartTabTextActive]}>
                    {tab === 'weekly' ? '주간 거리' : '페이스 추이'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.chartBody}>
              {chartTab === 'weekly' ? (
                <>
                  <View style={styles.chartArea}>
                    {weeklyChartData.map((item, i) => (
                      <View key={i} style={styles.barCol}>
                        {item.km > 0 && (
                          <Text style={styles.barValueText}>{item.km}</Text>
                        )}
                        <View style={[
                          styles.bar,
                          { height: item.barH || 0 },
                          item.isCurrent ? styles.barActive : styles.barDefault,
                        ]} />
                      </View>
                    ))}
                  </View>
                  <View style={styles.xRow}>
                    {weeklyChartData.map((item, i) => (
                      <Text key={i} style={[styles.xLabel, item.isCurrent && styles.xLabelActive]}>
                        {item.label}
                      </Text>
                    ))}
                  </View>
                  <Text style={styles.chartHint}>단위: km · 최근 8주</Text>
                </>
              ) : paceChartData.length < 2 ? (
                <View style={styles.chartEmpty}>
                  <Text style={styles.chartEmptyText}>러닝 기록이 2개 이상이면 추이를 볼 수 있어요</Text>
                </View>
              ) : (
                <>
                  <View style={styles.chartArea}>
                    {paceChartData.map((item, i) => (
                      <View key={i} style={styles.barCol}>
                        <View style={[
                          styles.bar,
                          { height: (item as any).barH || 0 },
                          item.isLatest ? styles.barActive : styles.barDefault,
                        ]} />
                      </View>
                    ))}
                  </View>
                  <View style={styles.xRow}>
                    {paceChartData.map((item, i) => (
                      <Text key={i} style={[styles.xLabel, item.isLatest && styles.xLabelActive]}>
                        {item.label}
                      </Text>
                    ))}
                  </View>
                  <Text style={styles.chartHint}>막대가 높을수록 빨라요 · 최근 10회</Text>
                </>
              )}
            </View>
          </View>
        )}

        {/* ── 테이블 ────────────────────────────────────────── */}
        <View style={styles.tableCard}>

          {/* 컬럼 헤더 */}
          <View style={styles.tableHeader}>
            {COLUMNS.map(col => (
              <TouchableOpacity
                key={col.key}
                style={[styles.colHeader, { width: col.width }]}
                onPress={() => handleSort(col.key)}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.colHeaderText,
                  { textAlign: col.align },
                  sortKey === col.key && styles.colHeaderActive,
                ]}>
                  {col.label}
                </Text>
                <SortIcon col={col.key} />
              </TouchableOpacity>
            ))}
          </View>

          {/* 로딩 */}
          {loading && (
            <View style={styles.centerBox}>
              <ActivityIndicator color={ACCENT} size="large" />
              <Text style={styles.loadingText}>기록 불러오는 중...</Text>
            </View>
          )}

          {/* 비어있음 */}
          {!loading && sorted.length === 0 && (
            <View style={styles.centerBox}>
              <Text style={styles.emptyEmoji}>🏃</Text>
              <Text style={styles.emptyText}>아직 러닝 기록이 없어요</Text>
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => router.push('/running')}
              >
                <Text style={styles.emptyBtnText}>첫 러닝 시작하기</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 기록 행 */}
          {!loading && sorted.map((r, i) => (
            <TouchableOpacity
              key={r.id}
              style={[
                styles.tableRow,
                i % 2 === 1 && styles.tableRowAlt,
                i === sorted.length - 1 && { borderBottomWidth: 0 },
              ]}
              onPress={() => router.push({ pathname: '/running-detail', params: { id: r.id } })}
              activeOpacity={0.7}
            >
              {/* 날짜 */}
              <View style={{ width: COLUMNS[0].width }}>
                <Text style={styles.cellDate}>{fmtDateShort(r.date)}</Text>
                <Text style={styles.cellSub}>{r.date ? fmtDayKo(r.date) : ''}</Text>
              </View>

              {/* 거리 */}
              <View style={[styles.cellRight, { width: COLUMNS[1].width }]}>
                <Text style={[styles.cellKm, sortKey === 'distanceKm' && styles.cellHighlight]}>
                  {r.distanceKm.toFixed(2)}
                </Text>
                <Text style={styles.cellUnit}>km</Text>
              </View>

              {/* 시간 */}
              <View style={{ width: COLUMNS[2].width, alignItems: 'center' }}>
                <Text style={[styles.cellMono, sortKey === 'duration' && styles.cellHighlight]}>
                  {r.durationFmt}
                </Text>
              </View>

              {/* 페이스 */}
              <View style={{ width: COLUMNS[3].width, alignItems: 'center' }}>
                <Text style={[styles.cellMono, sortKey === 'pace' && styles.cellHighlight]}>
                  {r.paceFmt}
                </Text>
              </View>

              {/* 삭제 (1km 미만만) */}
              <View style={styles.deleteCell}>
                {r.distanceKm < 1 && (
                  <TouchableOpacity
                    onPress={() => handleDelete(r.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.deleteIcon}>×</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 40 + insets.bottom }} />
      </ScrollView>
    </View>
  );
}


// ═══════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },

  // 헤더
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  backBtn: { width: 40, justifyContent: 'center' },
  backBtnText: { fontSize: 30, color: '#222', lineHeight: 36 },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: '#111' },

  // 요약 통계
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 18, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: 'bold', color: ACCENT, marginBottom: 3 },
  statLabel: { fontSize: 11, color: '#aaa', fontWeight: '600' },
  statDivider: { width: 1, height: 32, backgroundColor: '#F0F0F0' },

  // 월간 리포트
  monthCard: {
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: '#1A1A2E', borderRadius: 18, overflow: 'hidden',
    elevation: 4,
  },
  monthHeader: {
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  monthTitle: { fontSize: 15, fontWeight: 'bold', color: '#fff' },
  monthSub: { fontSize: 12, color: ACCENT },
  monthStats: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginHorizontal: 12, marginBottom: 14,
    borderRadius: 12, paddingVertical: 14,
  },
  monthStat: { flex: 1, alignItems: 'center' },
  monthStatValue: { fontSize: 17, fontWeight: 'bold', color: '#fff', marginBottom: 3 },
  monthStatLabel: { fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  monthStatDiv: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.12)' },

  // 차트 카드
  chartCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 12,
    borderRadius: 18, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  chartTabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  chartTab: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
  },
  chartTabActive: {
    borderBottomWidth: 2, borderBottomColor: ACCENT,
  },
  chartTabText: { fontSize: 13, fontWeight: '600', color: '#bbb' },
  chartTabTextActive: { color: ACCENT },
  chartBody: {
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
  },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: BAR_MAX_H + 20,
  },
  barCol: {
    flex: 1, alignItems: 'center', justifyContent: 'flex-end',
  },
  barValueText: {
    fontSize: 8, color: '#bbb', fontWeight: '600', marginBottom: 2,
  },
  bar: {
    width: '60%', borderRadius: 3,
  },
  barDefault: { backgroundColor: ACCENT + '44' },
  barActive: { backgroundColor: ACCENT },
  xRow: {
    flexDirection: 'row', marginTop: 4,
  },
  xLabel: {
    flex: 1, fontSize: 9, color: '#ccc', textAlign: 'center',
  },
  xLabelActive: { color: ACCENT, fontWeight: '700' },
  chartHint: {
    fontSize: 10, color: '#ccc', textAlign: 'center', marginTop: 6,
  },
  chartEmpty: {
    paddingVertical: 24, alignItems: 'center',
  },
  chartEmptyText: { fontSize: 13, color: '#ccc', textAlign: 'center' },

  // 테이블 카드
  tableCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 12,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },

  // 컬럼 헤더
  tableHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#FAFAFA',
    borderBottomWidth: 2, borderBottomColor: ACCENT,
  },
  colHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
  },
  colHeaderText: {
    fontSize: 12, color: '#aaa', fontWeight: '700',
  },
  colHeaderActive: { color: ACCENT },
  sortIconInactive: { fontSize: 10, color: '#ddd' },
  sortIconActive: { fontSize: 11, color: ACCENT, fontWeight: 'bold' },

  // 테이블 행
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  tableRowAlt: { backgroundColor: '#FDFCFB' },

  // 셀
  cellDate: { fontSize: 14, fontWeight: '600', color: '#222' },
  cellSub: { fontSize: 11, color: '#ccc', marginTop: 1 },
  cellRight: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'flex-end', gap: 2 },
  cellKm: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  cellUnit: { fontSize: 11, color: '#bbb' },
  cellMono: { fontSize: 14, color: '#555', fontWeight: '600' },
  cellHighlight: { color: ACCENT },

  // 삭제 버튼
  deleteCell: { width: 28, alignItems: 'center' },
  deleteIcon: { fontSize: 20, color: '#FF3B30', fontWeight: '300', lineHeight: 22 },

  // 비어있음 / 로딩
  centerBox: { alignItems: 'center', paddingVertical: 48 },
  loadingText: { fontSize: 14, color: '#bbb', marginTop: 12 },
  emptyEmoji: { fontSize: 44, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#bbb', fontWeight: '600', marginBottom: 18 },
  emptyBtn: {
    backgroundColor: ACCENT,
    paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 12,
  },
  emptyBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
});