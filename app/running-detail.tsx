import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';

import { ACCENT, BG } from '../constants/colors';
import { fmtDateLong } from '../constants/dateUtils';

// ─── 헬퍼 ────────────────────────────────────────────────────────
const haversineM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const fmtTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const fmtPace = (secPerKm: number) => {
  if (!isFinite(secPerKm) || secPerKm <= 0) return "--'--\"";
  const m = Math.floor(secPerKm / 60);
  const s = Math.floor(secPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
};


// ─── 1km 스플릿 계산 ─────────────────────────────────────────────
type Split = {
  km: number;
  paceSecPerKm: number;
  splitTimeSec: number;
  elapsedSec: number;
  isPartial: boolean;
  partialKm?: number;
};

const calcSplits = (route: { lat: number; lon: number; time: number }[]): Split[] => {
  if (route.length < 2) return [];

  // 각 포인트의 누적 거리(m)와 경과 시간(ms) 계산
  const cumDist: number[] = [0];
  for (let i = 1; i < route.length; i++) {
    const d = haversineM(route[i - 1].lat, route[i - 1].lon, route[i].lat, route[i].lon);
    cumDist.push(cumDist[i - 1] + (d < 50 ? d : 0)); // GPS 노이즈 제거
  }

  const startTime = route[0].time;
  const totalM = cumDist[cumDist.length - 1];
  if (totalM < 100) return [];

  const splits: Split[] = [];
  let prevElapsedSec = 0;
  let kmMark = 1000; // 첫 1km 경계

  while (kmMark <= totalM) {
    // kmMark에 해당하는 포인트 보간
    let idx = cumDist.findIndex(d => d >= kmMark);
    if (idx < 1) break;

    const ratio = (kmMark - cumDist[idx - 1]) / (cumDist[idx] - cumDist[idx - 1]);
    const elapsedMs = route[idx - 1].time + ratio * (route[idx].time - route[idx - 1].time) - startTime;
    const elapsedSec = elapsedMs / 1000;
    const splitTimeSec = elapsedSec - prevElapsedSec;
    const paceSecPerKm = splitTimeSec; // 정확히 1km

    splits.push({
      km: Math.round(kmMark / 1000),
      paceSecPerKm,
      splitTimeSec,
      elapsedSec,
      isPartial: false,
    });

    prevElapsedSec = elapsedSec;
    kmMark += 1000;
  }

  // 마지막 부분 구간 (1km 미만)
  const lastKmMark = (splits.length) * 1000;
  const remainM = totalM - lastKmMark;
  if (remainM > 50) {
    const totalElapsedSec = (route[route.length - 1].time - startTime) / 1000;
    const splitTimeSec = totalElapsedSec - prevElapsedSec;
    const paceSecPerKm = splitTimeSec / (remainM / 1000);
    splits.push({
      km: splits.length + 1,
      paceSecPerKm,
      splitTimeSec,
      elapsedSec: totalElapsedSec,
      isPartial: true,
      partialKm: remainM / 1000,
    });
  }

  return splits;
};

// ─── 페이스 색상 (빠를수록 초록, 느릴수록 주황) ───────────────────
const getPaceColor = (sec: number, minSec: number, maxSec: number) => {
  if (maxSec === minSec) return ACCENT;
  const t = (sec - minSec) / (maxSec - minSec); // 0=빠름, 1=느림
  const r = Math.round(80 + t * (255 - 80));
  const g = Math.round(200 - t * (200 - 107));
  const b = Math.round(80 - t * (80 - 53));
  return `rgb(${r},${g},${b})`;
};

// ─── 메인 컴포넌트 ───────────────────────────────────────────────
export default function RunningDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams();
  const [record, setRecord]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userWeight, setUserWeight] = useState<number>(65);

  useEffect(() => {
    if (id) loadRecord();
  }, [id]);

  const loadRecord = async () => {
    try {
      const [docSnap, userId] = await Promise.all([
        getDoc(doc(db, 'runningRecords', id as string)),
        Promise.resolve(auth.currentUser?.uid),
      ]);
      if (docSnap.exists()) setRecord({ id: docSnap.id, ...docSnap.data() });

      if (userId) {
        const userSnap = await getDoc(doc(db, 'users', userId));
        if (userSnap.exists()) {
          const w = parseInt(userSnap.data().weight || '0');
          if (w > 0) setUserWeight(w);
        }
      }
    } catch (e) {
      console.log('기록 로드 오류:', e);
    }
    setLoading(false);
  };

  // 로딩 화면
  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>러닝 상세</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={ACCENT} size="large" />
          <Text style={styles.loadingText}>기록 불러오는 중...</Text>
        </View>
      </View>
    );
  }

  if (!record) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>러닝 상세</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingBox}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>😢</Text>
          <Text style={styles.loadingText}>기록을 찾을 수 없어요</Text>
        </View>
      </View>
    );
  }

  const route: { lat: number; lon: number; time: number }[] = record.route || [];
  const coordinates = route.map(p => ({ latitude: p.lat, longitude: p.lon }));
  const startPoint = coordinates[0];
  const endPoint = coordinates.length > 1 ? coordinates[coordinates.length - 1] : null;

  const centerLat = coordinates.length > 0
    ? coordinates.reduce((s, c) => s + c.latitude, 0) / coordinates.length
    : 37.5665;
  const centerLon = coordinates.length > 0
    ? coordinates.reduce((s, c) => s + c.longitude, 0) / coordinates.length
    : 126.9780;

  const splits = calcSplits(route);
  const validPaces = splits.map(s => s.paceSecPerKm).filter(p => isFinite(p) && p > 0);
  const minPace = validPaces.length ? Math.min(...validPaces) : 0;
  const maxPace = validPaces.length ? Math.max(...validPaces) : 0;
  const maxBar = maxPace > 0 ? maxPace : 1;

  // 경로 재계산 거리 — km 스플릿과 동일한 알고리즘으로 GPS 드리프트 제거
  let routeDistM = 0;
  for (let i = 1; i < route.length; i++) {
    const d = haversineM(route[i - 1].lat, route[i - 1].lon, route[i].lat, route[i].lon);
    if (d >= 1 && d < 50) routeDistM += d;
  }
  const routeDistKm = routeDistM / 1000;
  const hasRoute = routeDistKm > 0.05;

  // 표시 거리·페이스: 경로 데이터 있으면 재계산값 사용 (km 스플릿과 일치)
  const displayDistKm  = hasRoute ? routeDistKm : record.distanceKm;
  const displayPaceSec = record.duration > 0 && displayDistKm > 0
    ? record.duration / displayDistKm
    : 0;
  const displayPace    = displayPaceSec > 0 ? fmtPace(displayPaceSec) : record.pace;

  // 칼로리 추정 — 페이스 기반 MET × 실제 체중
  const met = displayPaceSec < 300 ? 12.5   // < 5:00/km
            : displayPaceSec < 360 ? 10.0   // 5:00~6:00
            : displayPaceSec < 420 ? 9.0    // 6:00~7:00
            : displayPaceSec < 480 ? 8.0    // 7:00~8:00
            : displayPaceSec < 600 ? 7.0    // 8:00~10:00
            : 6.0;                           // > 10:00/km
  const calorie = Math.round((record.duration / 3600) * met * userWeight);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>러닝 상세</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 지도 */}
        {coordinates.length > 0 ? (
          <MapView
            style={styles.map}
            initialRegion={{
              latitude: centerLat, longitude: centerLon,
              latitudeDelta: 0.008, longitudeDelta: 0.008,
            }}
          >
            {coordinates.length > 1 && (
              <Polyline coordinates={coordinates} strokeColor={ACCENT} strokeWidth={4} />
            )}
            {startPoint && <Marker coordinate={startPoint} title="출발" pinColor="green" />}
            {endPoint && <Marker coordinate={endPoint} title="도착" pinColor="red" />}
          </MapView>
        ) : (
          <View style={styles.noMap}>
            <Text style={styles.noMapEmoji}>🗺️</Text>
            <Text style={styles.noMapText}>경로가 기록되지 않았어요</Text>
            <Text style={styles.noMapSub}>GPS 신호가 약하거나 실내에서 달린 경우{'\n'}경로 데이터가 저장되지 않을 수 있어요</Text>
          </View>
        )}

        {/* 날짜 */}
        <Text style={styles.dateText}>{fmtDateLong(record.date)}</Text>

        {/* 핵심 통계 */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{fmtTime(record.duration)}</Text>
            <Text style={styles.statLabel}>시간</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{hasRoute ? routeDistKm.toFixed(2) : record.distanceKm}</Text>
            <Text style={styles.statLabel}>km</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{displayPace}</Text>
            <Text style={styles.statLabel}>평균 페이스</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{calorie}</Text>
            <Text style={styles.statLabel}>kcal{userWeight === 65 ? ' *' : ''}</Text>
          </View>
        </View>

        {/* 체중 미설정 안내 */}
        {userWeight === 65 && (
          <Text style={styles.calorieNote}>
            * 칼로리는 기본 체중(65kg) 기준이에요. 마이페이지 → 프로필 편집에서 체중을 입력하면 더 정확해져요.
          </Text>
        )}

        {/* 1km 스플릿 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>km 스플릿</Text>

          {splits.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyEmoji}>📍</Text>
              <Text style={styles.emptyText}>구간 데이터가 충분하지 않아요</Text>
            </View>
          ) : (
            <>
              {/* 컬럼 헤더 */}
              <View style={styles.splitHeader}>
                <Text style={[styles.splitHeaderTxt, { width: 40 }]}>구간</Text>
                <Text style={[styles.splitHeaderTxt, { flex: 1 }]}>페이스</Text>
                <Text style={[styles.splitHeaderTxt, { width: 64, textAlign: 'right' }]}>구간 시간</Text>
                <Text style={[styles.splitHeaderTxt, { width: 64, textAlign: 'right' }]}>누적 시간</Text>
              </View>

              {splits.map((s, i) => {
                const barWidth = maxBar > 0 ? (s.paceSecPerKm / maxBar) * 100 : 0;
                const barColor = getPaceColor(s.paceSecPerKm, minPace, maxPace);
                const isBest = s.paceSecPerKm === minPace && !s.isPartial;
                return (
                  <View key={i} style={[styles.splitRow, i === splits.length - 1 && { borderBottomWidth: 0 }]}>
                    {/* 구간 번호 */}
                    <View style={styles.splitKmWrap}>
                      <Text style={styles.splitKm}>{s.km}</Text>
                      {s.isPartial && (
                        <Text style={styles.splitPartialBadge}>
                          {s.partialKm!.toFixed(2)}
                        </Text>
                      )}
                    </View>

                    {/* 페이스 + 바 */}
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <View style={styles.splitBarRow}>
                        <Text style={[styles.splitPace, isBest && styles.splitPaceBest]}>
                          {fmtPace(s.paceSecPerKm)}
                        </Text>
                        {isBest && <Text style={styles.bestBadge}>최고</Text>}
                      </View>
                      <View style={styles.splitBarTrack}>
                        <View style={[styles.splitBarFill, { width: `${barWidth}%` as any, backgroundColor: barColor }]} />
                      </View>
                    </View>

                    {/* 구간 시간 */}
                    <Text style={[styles.splitTime, { width: 64, textAlign: 'right' }]}>
                      {fmtTime(s.splitTimeSec)}
                    </Text>

                    {/* 누적 시간 */}
                    <Text style={[styles.splitElapsed, { width: 64, textAlign: 'right' }]}>
                      {fmtTime(s.elapsedSec)}
                    </Text>
                  </View>
                );
              })}

              {/* 범례 */}
              <View style={styles.legend}>
                <View style={[styles.legendDot, { backgroundColor: getPaceColor(minPace, minPace, maxPace) }]} />
                <Text style={styles.legendText}>빠름</Text>
                <View style={[styles.legendDot, { backgroundColor: getPaceColor(maxPace, minPace, maxPace), marginLeft: 12 }]} />
                <Text style={styles.legendText}>느림</Text>
              </View>
            </>
          )}
        </View>

        <View style={{ height: 32 + insets.bottom }} />
      </ScrollView>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },

  // 헤더 (my-records 스타일 통일)
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  backBtn: { width: 40, justifyContent: 'center' },
  backBtnText: { fontSize: 30, color: '#222', lineHeight: 36 },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: '#111' },

  // 로딩 / 에러
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 15, color: '#bbb', fontWeight: '500' },

  // 지도
  map: { width: '100%', height: 260 },
  noMap: {
    height: 160, backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center', gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  noMapEmoji: { fontSize: 36 },
  noMapText: { fontSize: 14, color: '#bbb' },
  noMapSub: { fontSize: 12, color: '#ccc', textAlign: 'center', marginTop: 6, lineHeight: 18 },

  // 날짜
  dateText: {
    textAlign: 'center', fontSize: 13, color: '#aaa',
    fontWeight: '600', marginTop: 16, marginBottom: 4,
  },

  // 핵심 통계
  statsCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 8,
    borderRadius: 20, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: 'bold', color: ACCENT, marginBottom: 3 },
  statLabel: { fontSize: 11, color: '#aaa', fontWeight: '600' },
  statDivider: { width: 1, height: 32, backgroundColor: '#F0F0F0' },

  // 섹션 공통
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 12,
    borderRadius: 20, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#111', marginBottom: 14 },

  // 스플릿 컬럼 헤더
  splitHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 2, borderBottomColor: ACCENT,
    marginBottom: 4,
  },
  splitHeaderTxt: { fontSize: 11, color: '#aaa', fontWeight: '700' },

  // 스플릿 행
  splitRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
    gap: 4,
  },
  splitKmWrap: { width: 40, alignItems: 'flex-start', gap: 2 },
  splitKm: { fontSize: 15, fontWeight: 'bold', color: '#222' },
  splitPartialBadge: { fontSize: 9, color: '#bbb', fontWeight: '600' },

  splitBarRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  splitPace: { fontSize: 14, fontWeight: '700', color: '#333' },
  splitPaceBest: { color: ACCENT },
  bestBadge: {
    fontSize: 9, fontWeight: '800', color: ACCENT,
    backgroundColor: '#FFF0EB', paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 4,
  },
  splitBarTrack: {
    height: 5, backgroundColor: '#F0F0F0',
    borderRadius: 3, overflow: 'hidden',
  },
  splitBarFill: { height: '100%', borderRadius: 3 },

  splitTime: { fontSize: 13, fontWeight: '600', color: '#555' },
  splitElapsed: { fontSize: 12, color: '#bbb' },

  // 범례
  legend: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 14, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#F5F5F5',
  },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: '#bbb', marginLeft: 4 },

  // 빈 상태
  emptyBox: { alignItems: 'center', paddingVertical: 24 },
  emptyEmoji: { fontSize: 32, marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#bbb', fontWeight: '500' },

  calorieNote: {
    fontSize: 11, color: '#AAAAAA', marginHorizontal: 20,
    marginTop: -8, marginBottom: 12, lineHeight: 16,
  },
});
