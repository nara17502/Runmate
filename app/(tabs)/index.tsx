import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions,
  Modal, Animated, PanResponder, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { collection, query, orderBy, limit, getDocs, where, getDoc, doc } from 'firebase/firestore';
import { useRouter, useFocusEffect } from 'expo-router';
import { fmtDateKo, todayIso, thisMonthIso } from '../../constants/dateUtils';
import { auth, db } from '../../firebase/config';
import { getTemperature } from '../../firebase/temperature';
import { scheduleStreakWarning, cancelStreakWarning } from '../../constants/notifications';

const { width: SCREEN_W } = Dimensions.get('window');
import { ACCENT, ACCENT_LIGHT, DARK, BG } from '../../constants/colors';

// ─── 신발 온도 ───────────────────────────────────────────────────
const getTempColor = (temp: number) => {
  if (temp < 37) return '#A8C8F0';
  if (temp < 40) return '#FFE066';
  if (temp < 50) return '#66CC66';
  if (temp < 60) return '#FF9933';
  if (temp < 70) return '#8B4513';
  if (temp < 80) return '#FF3333';
  if (temp < 90) return '#9933FF';
  if (temp < 100) return '#222222';
  return '#FFD700';
};
const getTempLabel = (temp: number) => {
  if (temp < 37) return '워밍업 필요';
  if (temp < 40) return '가볍게 달려요';
  if (temp < 50) return '컨디션 좋아요';
  if (temp < 60) return '달리기 좋은 날';
  if (temp < 70) return '고수 러너!';
  if (temp < 80) return '엘리트 러너!';
  if (temp < 90) return '전설의 러너!';
  if (temp < 100) return '다크 러너';
  return '골드 러너!';
};
const getTempEmoji = (temp: number) => {
  if (temp < 37) return '❄️';
  if (temp < 40) return '🌤';
  if (temp < 50) return '💚';
  if (temp < 60) return '🔥';
  if (temp < 70) return '💪';
  if (temp < 80) return '🚀';
  if (temp < 90) return '👑';
  if (temp < 100) return '🖤';
  return '✨';
};

// ─── 동물 캐릭터 ─────────────────────────────────────────────────
const ANIMALS = [
  { emoji: '🐌', name: '달팽이',  threshold: 50 },
  { emoji: '🐢', name: '거북이',  threshold: 100 },
  { emoji: '🐹', name: '햄스터', threshold: 200 },
  { emoji: '🦝', name: '너구리',  threshold: 300 },
  { emoji: '🐕', name: '강아지',  threshold: 400 },
  { emoji: '🐈', name: '고양이',  threshold: 500 },
  { emoji: '🐗', name: '멧돼지',  threshold: 700 },
  { emoji: '🐰', name: '토끼',    threshold: 1000 },
  { emoji: '🐎', name: '말',      threshold: 2000 },
  { emoji: '🦁', name: '사자',    threshold: 5000 },
  { emoji: '🫎', name: '영양',    threshold: 10000 },
  { emoji: '🐆', name: '치타',    threshold: 20000 },
  { emoji: '🦅', name: '독수리',  threshold: Infinity },
];

const getAnimalData = (totalKm: number) => {
  for (let i = 0; i < ANIMALS.length; i++) {
    const a = ANIMALS[i];
    if (totalKm < a.threshold) {
      const prev = i > 0 ? ANIMALS[i - 1].threshold : 0;
      const progress = (totalKm - prev) / (a.threshold - prev);
      const next = ANIMALS[i + 1] ?? null;
      const remaining = a.threshold - totalKm;
      return { ...a, progress: Math.min(progress, 1), remaining, next };
    }
  }
  const last = ANIMALS[ANIMALS.length - 1];
  return { ...last, progress: 1, remaining: 0, next: null };
};

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [temp, setTemp]               = useState(36.5);
  const [totalKm, setTotalKm]         = useState(0);
  const [recentRecords, setRecentRecords] = useState<any[]>([]);
  const [ranking, setRanking]         = useState<any[]>([]);
  const [nickname, setNickname]       = useState('');
  const [todayKm, setTodayKm]         = useState(0);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [showCharSheet, setShowCharSheet] = useState(false);
  const [showTempInfo, setShowTempInfo]   = useState(false);
  const [runStats, setRunStats] = useState({
    totalRuns: 0, avgDistKm: 0, avgPaceSec: 0, streakDays: 0, thisMonthDays: 0,
  });

  const sheetY = useRef(new Animated.Value(800)).current;

  const openSheet = useCallback(() => {
    setShowCharSheet(true);
    Animated.spring(sheetY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
  }, [sheetY]);

  const closeSheet = useCallback(() => {
    Animated.timing(sheetY, { toValue: 800, useNativeDriver: true, duration: 260 }).start(() =>
      setShowCharSheet(false)
    );
  }, [sheetY]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
      onPanResponderMove: (_, g) => { if (g.dy > 0) sheetY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.5) closeSheet();
        else Animated.spring(sheetY, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  useFocusEffect(useCallback(() => { loadAll(); }, []));

  const loadAll = async () => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    await Promise.all([
      loadTemp(userId), loadProfile(userId), loadRecentRecords(userId),
      loadTotalKm(userId), loadRanking(userId), loadRunStats(userId),
    ]);
    setLoading(false);
    setRefreshing(false);
  };

  const onRefresh = () => { setRefreshing(true); loadAll(); };

  const loadRunStats = async (userId: string) => {
    try {
      const snap = await getDocs(
        query(collection(db, 'runningRecords'), where('userId', '==', userId), orderBy('createdAt', 'desc'))
      );
      const docs = snap.docs.map(d => d.data());
      if (docs.length === 0) return;

      const totalRuns  = docs.length;
      const avgDistKm  = docs.reduce((s, d) => s + (d.distanceKm || 0), 0) / totalRuns;
      const avgPaceSec = docs.reduce((s, d) => s + (d.duration / (d.distanceKm || 1)), 0) / totalRuns;

      const nowMonth    = thisMonthIso();
      const monthDates  = new Set(docs.filter(d => d.date?.startsWith(nowMonth)).map(d => d.date));
      const thisMonthDays = monthDates.size;

      const allDates = Array.from(new Set(docs.map(d => d.date as string))).sort().reverse();
      let streak = 0; let cur = new Date();
      for (const dateStr of allDates) {
        const d = new Date(dateStr);
        const diff = Math.round((cur.getTime() - d.getTime()) / 86400000);
        if (diff <= 1) { streak++; cur = d; } else break;
      }

      setRunStats({ totalRuns, avgDistKm, avgPaceSec, streakDays: streak, thisMonthDays });

      const today   = todayIso();
      const ranToday = docs.some(d => d.date === today);
      if (ranToday) await cancelStreakWarning();
      else if (streak > 0) await scheduleStreakWarning(streak);
    } catch (e) { console.log('통계 오류:', e); }
  };

  const loadTemp = async (userId: string) => { setTemp(await getTemperature(userId)); };

  const loadProfile = async (userId: string) => {
    const docSnap = await getDoc(doc(db, 'users', userId));
    if (docSnap.exists()) setNickname(docSnap.data().nickname || '러너');
  };

  const loadRecentRecords = async (userId: string) => {
    try {
      const snap = await getDocs(query(
        collection(db, 'runningRecords'),
        where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(3)
      ));
      const records = snap.docs.map(d => {
        const data = d.data();
        const mins = Math.floor(data.duration / 60);
        const secs = data.duration % 60;
        const paceSecPerKm = data.duration / (data.distanceKm || 1);
        const pm = Math.floor(paceSecPerKm / 60);
        const ps = Math.floor(paceSecPerKm % 60);
        return {
          id: d.id, date: data.date,
          duration: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
          distanceKm: data.distanceKm,
          pace: `${pm}'${String(ps).padStart(2, '0')}"`,
        };
      });
      setRecentRecords(records);
      const today = todayIso();
      const todayTotal = records.filter(r => r.date === today).reduce((s, r) => s + r.distanceKm, 0);
      setTodayKm(parseFloat(todayTotal.toFixed(2)));
    } catch (e) { console.log('기록 로드 오류:', e); }
  };

  const loadTotalKm = async (userId: string) => {
    try {
      const runSnap = await getDocs(query(collection(db, 'runningRecords'), where('userId', '==', userId)));
      let total = 0;
      runSnap.docs.forEach(d => { total += d.data().distanceKm || 0; });
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        (userDoc.data().records || []).forEach((r: any) => {
          if (r.distance === '풀') total += 42.195;
          else if (r.distance === '하프') total += 21.0975;
          else if (r.distance === '10km') total += 10;
        });
      }
      setTotalKm(parseFloat(total.toFixed(2)));
    } catch (e) { console.log('누적거리 오류:', e); }
  };

  const loadRanking = async (userId: string) => {
    try {
      const myDoc   = await getDoc(doc(db, 'users', userId));
      const myAgeNum = myDoc.exists() ? parseInt(myDoc.data().age) : 0;
      const today   = todayIso();
      const snap    = await getDocs(query(
        collection(db, 'runningRecords'),
        where('date', '==', today), orderBy('distanceKm', 'desc'), limit(20)
      ));

      const userMap: { [uid: string]: any } = {};
      snap.docs.forEach(d => {
        const data = d.data(); const uid = data.userId;
        if (!userMap[uid]) userMap[uid] = { userId: uid, totalKm: 0, nickname: '', age: 0 };
        userMap[uid].totalKm += data.distanceKm;
      });
      for (const uid of Object.keys(userMap)) {
        const uDoc = await getDoc(doc(db, 'users', uid));
        if (uDoc.exists()) {
          const p = uDoc.data();
          userMap[uid].nickname = p.nickname || '익명';
          userMap[uid].age = parseInt(p.age) || 0;
        }
      }
      const filtered = Object.values(userMap)
        .filter(u => Math.abs(u.age - myAgeNum) <= 5)
        .sort((a, b) => b.totalKm - a.totalKm).slice(0, 10)
        .map((u, i) => ({
          rank: i + 1, nickname: u.nickname,
          animal: getAnimalData(u.totalKm).emoji,
          km: parseFloat(u.totalKm.toFixed(2)), isMe: u.userId === userId,
        }));
      setRanking(filtered);
    } catch (e) { console.log('랭킹 오류:', e); }
  };

  // ─── 파생 데이터 ────────────────────────────────────────────────
  const tempColor    = getTempColor(temp);
  const tempLabel    = getTempLabel(temp);
  const tempEmoji    = getTempEmoji(temp);
  const isLightTemp  = temp < 37 || (temp >= 37 && temp < 40);
  const tempTextColor = isLightTemp ? '#333' : '#fff';
  const animal       = getAnimalData(totalKm);
  const today   = new Date();
  const dateStr = fmtDateKo(today);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" progressBackgroundColor={ACCENT} />
        }
      >
        {/* ── 히어로 헤더 ──────────────────────────────────────── */}
        <View style={styles.hero}>
          <View style={styles.heroDeco1} />
          <View style={styles.heroDeco2} />

          {/* 날짜 + 인사 */}
          <View style={styles.heroTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroDate}>{dateStr}</Text>
              {loading
                ? <SkeletonBox width={180} height={18} style={{ marginTop: 4, backgroundColor: 'rgba(255,255,255,0.2)' }} />
                : <Text style={styles.heroGreet}>
                    {nickname ? `${nickname} 님, 안녕하세요 👋` : '오늘도 달려볼까요? 👋'}
                  </Text>
              }
            </View>
            {/* 오늘 km 뱃지 */}
            <View style={styles.heroKmBadge}>
              <Text style={styles.heroKmLabel}>오늘</Text>
              {loading
                ? <SkeletonBox width={52} height={22} style={{ marginTop: 2, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.2)' }} />
                : <Text style={styles.heroKmValue}>{todayKm > 0 ? `${todayKm}km` : '-'}</Text>
              }
            </View>
          </View>

          {/* 스탯 칩 3종 */}
          <View style={styles.heroStatRow}>
            {[
              { emoji: '🔥', label: '연속', value: loading ? '-' : `${runStats.streakDays}일` },
              { emoji: '📅', label: '이번달', value: loading ? '-' : `${runStats.thisMonthDays}일` },
              { emoji: '🌍', label: '누적', value: loading ? '-' : `${totalKm.toFixed(0)}km` },
            ].map((s, i) => (
              <View key={s.label} style={{ flex: 1, flexDirection: 'row' }}>
                {i > 0 && <View style={styles.heroStatDivider} />}
                <View style={styles.heroStatChip}>
                  <Text style={styles.heroStatEmoji}>{s.emoji}</Text>
                  <Text style={styles.heroStatValue}>{s.value}</Text>
                  <Text style={styles.heroStatLabel}>{s.label}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ── 빠른 이동 버튼 ───────────────────────────────────── */}
        <View style={styles.quickRow}>
          {[
            { emoji: '📋', label: '내 기록', route: '/my-records' },
            { emoji: '👥', label: '그룹 러닝', route: '/(tabs)/group' },
            { emoji: '🏅', label: '마이페이지', route: '/(tabs)/profile' },
          ].map(btn => (
            <TouchableOpacity
              key={btn.label}
              style={styles.quickBtn}
              onPress={() => router.push(btn.route as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.quickBtnEmoji}>{btn.emoji}</Text>
              <Text style={styles.quickBtnLabel}>{btn.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── 러닝 시작 CTA ──────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.ctaCard}
          activeOpacity={0.88}
          onPress={() => router.push('/running')}
        >
          {/* 신발 온도 원 */}
          <View style={[styles.tempCircle, { backgroundColor: tempColor }]}>
            <Text style={styles.tempCircleEmoji}>👟</Text>
            <Text style={[styles.tempCircleValue, { color: tempTextColor }]}>{temp.toFixed(1)}°</Text>
          </View>

          {/* 텍스트 */}
          <View style={styles.ctaTextBlock}>
            <View style={styles.ctaStatusRow}>
              <Text style={styles.ctaStatusEmoji}>{tempEmoji}</Text>
              <Text style={styles.ctaStatusLabel}>{tempLabel}</Text>
            </View>
            <Text style={styles.ctaTitle}>러닝 시작하기</Text>
            <View style={styles.ctaHintRow}>
              <Text style={styles.ctaHint}>신발 온도 {temp.toFixed(1)}°C</Text>
              <TouchableOpacity
                style={styles.infoBtn}
                onPress={e => { e.stopPropagation(); setShowTempInfo(true); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.infoBtnText}>?</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.ctaArrowWrap}>
            <Text style={styles.ctaArrow}>›</Text>
          </View>
        </TouchableOpacity>

        {/* 신발 온도 힌트 배너 */}
        {!loading && temp <= 36.5 && (
          <TouchableOpacity style={styles.tempHintBanner} activeOpacity={0.85} onPress={() => setShowTempInfo(true)}>
            <Text style={styles.tempHintText}>👟 신발 온도가 36.5°C예요. 달릴수록 올라가요!</Text>
            <Text style={styles.tempHintLink}>자세히 ›</Text>
          </TouchableOpacity>
        )}

        {/* ── 내 캐릭터 ───────────────────────────────────────── */}
        <View style={styles.sectionLabel}>
          <View style={styles.sectionBar} />
          <Text style={styles.sectionLabelText}>내 캐릭터</Text>
        </View>
        <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={openSheet} disabled={loading}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>🐾 캐릭터 현황</Text>
            {!loading && <Text style={styles.cardMore}>상세보기 ›</Text>}
          </View>

          {loading ? (
            <View style={{ gap: 10 }}>
              <View style={styles.animalRow}>
                <SkeletonBox width={64} height={64} style={{ borderRadius: 32 }} />
                <View style={{ gap: 8, flex: 1 }}>
                  <SkeletonBox width={80} height={20} />
                  <SkeletonBox width={140} height={14} />
                </View>
              </View>
              <SkeletonBox width="100%" height={8} style={{ borderRadius: 4 }} />
            </View>
          ) : (
            <>
              <View style={styles.animalRow}>
                <View style={styles.animalEmojiWrap}>
                  <Text style={styles.animalEmoji}>{animal.emoji}</Text>
                </View>
                <View style={styles.animalMeta}>
                  <Text style={styles.animalName}>{animal.name}</Text>
                  {animal.next ? (
                    <Text style={styles.animalNext}>
                      다음: {animal.next.emoji} {animal.next.name}까지{' '}
                      <Text style={styles.animalNextKm}>{animal.remaining.toFixed(0)}km</Text>
                    </Text>
                  ) : (
                    <Text style={styles.animalNext}>🎉 최고 등급 달성!</Text>
                  )}
                </View>
                <View style={styles.animalKmBubble}>
                  <Text style={styles.animalKmValue}>{totalKm.toFixed(0)}</Text>
                  <Text style={styles.animalKmUnit}>km</Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${animal.progress * 100}%` as any }]} />
              </View>
              <View style={styles.progressLabelRow}>
                <Text style={styles.progressLabel}>{animal.name}</Text>
                {animal.next && <Text style={styles.progressLabel}>{animal.next.name}</Text>}
              </View>
            </>
          )}
        </TouchableOpacity>

        {/* ── 최근 러닝 기록 ──────────────────────────────────── */}
        <View style={styles.sectionLabel}>
          <View style={styles.sectionBar} />
          <Text style={styles.sectionLabelText}>최근 기록</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>🏃 최근 러닝</Text>
            <TouchableOpacity onPress={() => router.push('/my-records')}>
              <Text style={styles.cardMore}>전체보기 ›</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            [0,1,2].map(i => (
              <View key={i} style={[styles.recordRow, i === 2 && { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1, gap: 6 }}>
                  <SkeletonBox width={80} height={13} />
                  <SkeletonBox width={60} height={11} />
                </View>
                <SkeletonBox width={48} height={18} style={{ marginHorizontal: 8 }} />
                <SkeletonBox width={56} height={28} />
              </View>
            ))
          ) : recentRecords.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyEmoji}>🏃</Text>
              <Text style={styles.emptyText}>아직 러닝 기록이 없어요</Text>
              <Text style={styles.emptyHint}>위 버튼을 눌러 첫 러닝을 시작해보세요!</Text>
            </View>
          ) : (
            recentRecords.map((r, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.recordRow, i === recentRecords.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => router.push({ pathname: '/running-detail', params: { id: r.id } })}
                activeOpacity={0.7}
              >
                <View style={styles.recordAccentBar} />
                <View style={styles.recordLeft}>
                  <Text style={styles.recordDate}>{r.date}</Text>
                  <Text style={styles.recordPace}>⏱ 페이스 {r.pace}</Text>
                </View>
                <View style={styles.recordMid}>
                  <Text style={styles.recordDuration}>{r.duration}</Text>
                  <Text style={styles.recordDurationLabel}>시간</Text>
                </View>
                <View style={styles.recordRight}>
                  <Text style={styles.recordKm}>{r.distanceKm}</Text>
                  <Text style={styles.recordKmUnit}>km</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* ── 연령대 랭킹 ─────────────────────────────────────── */}
        <View style={styles.sectionLabel}>
          <View style={styles.sectionBar} />
          <Text style={styles.sectionLabelText}>오늘의 랭킹</Text>
        </View>
        <View style={[styles.card, { marginBottom: 36 }]}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>🏆 동일 연령대 랭킹</Text>
            <Text style={styles.cardSub}>오늘 기준</Text>
          </View>

          {loading ? (
            [0,1,2].map(i => (
              <View key={i} style={[styles.rankRow, i === 2 && { borderBottomWidth: 0 }]}>
                <SkeletonBox width={32} height={20} style={{ borderRadius: 4 }} />
                <View style={{ flex: 1, gap: 6 }}>
                  <SkeletonBox width={90} height={15} />
                </View>
                <SkeletonBox width={48} height={20} />
              </View>
            ))
          ) : ranking.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyEmoji}>🏆</Text>
              <Text style={styles.emptyText}>오늘 같은 연령대 기록이 없어요</Text>
              <Text style={styles.emptyHint}>오늘 달리면 랭킹에 등록돼요!</Text>
            </View>
          ) : (
            ranking.map((r, i) => {
              const medalColors: Record<number, string> = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' };
              const medalBg: Record<number, string> = { 1: '#FFF8E0', 2: '#F5F5F5', 3: '#FDF0E6' };
              const isTop3 = r.rank <= 3;
              return (
                <View
                  key={i}
                  style={[
                    styles.rankRow,
                    r.isMe && styles.rankRowMe,
                    i === ranking.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  {/* 순위 */}
                  <View style={[
                    styles.rankNumWrap,
                    isTop3 && { backgroundColor: medalBg[r.rank] },
                  ]}>
                    <Text style={[styles.rankNum, isTop3 && { color: medalColors[r.rank] }]}>
                      {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}`}
                    </Text>
                  </View>

                  {/* 닉네임 + 동물 */}
                  <View style={styles.rankNameWrap}>
                    <Text style={styles.rankAnimal}>{r.animal}</Text>
                    <Text style={[styles.rankNickname, r.isMe && styles.rankNicknameMe]}>
                      {r.nickname}{r.isMe ? '  (나)' : ''}
                    </Text>
                  </View>

                  {/* 거리 */}
                  <View style={styles.rankKmWrap}>
                    <Text style={[styles.rankKm, r.isMe && styles.rankKmMe]}>{r.km}</Text>
                    <Text style={styles.rankKmUnit}>km</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

      </ScrollView>

      {/* 캐릭터 상세 바텀시트 */}
      <CharacterSheet
        visible={showCharSheet} onClose={closeSheet}
        sheetY={sheetY} panResponder={panResponder}
        animal={animal} totalKm={totalKm} runStats={runStats}
      />

      {/* 신발 온도 설명 모달 */}
      <TempInfoModal visible={showTempInfo} onClose={() => setShowTempInfo(false)} />
    </SafeAreaView>
  );
}

// ─── 신발 온도 설명 모달 ─────────────────────────────────────────
const TEMP_TIERS = [
  { emoji: '❄️', label: '워밍업 필요',  range: '36.5°C~', color: '#A8C8F0' },
  { emoji: '🌤', label: '가볍게 달려요', range: '37°C~',   color: '#FFE066' },
  { emoji: '💚', label: '컨디션 좋아요', range: '40°C~',   color: '#66CC66' },
  { emoji: '🔥', label: '달리기 좋은 날',range: '50°C~',   color: '#FF9933' },
  { emoji: '💪', label: '고수 러너!',   range: '60°C~',   color: '#8B4513' },
  { emoji: '🚀', label: '엘리트 러너!', range: '70°C~',   color: '#FF3333' },
  { emoji: '👑', label: '전설의 러너!', range: '80°C~',   color: '#9933FF' },
  { emoji: '✨', label: '골드 러너!',   range: '100°C',   color: '#FFD700' },
];

function TempInfoModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={ti.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[ti.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={ti.header}>
          <Text style={ti.headerEmoji}>👟🌡️</Text>
          <View style={{ flex: 1 }}>
            <Text style={ti.headerTitle}>신발 온도 시스템</Text>
            <Text style={ti.headerSub}>달릴수록 신발이 뜨거워져요!</Text>
          </View>
          <TouchableOpacity style={ti.closeBtn} onPress={onClose}>
            <Text style={ti.closeTxt}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
          <View style={ti.section}>
            <Text style={ti.sectionTitle}>어떻게 올라가나요?</Text>
            {[
              { emoji: '🏃', text: '15분 달리기마다 ', accent: '+0.1°C', hint: '하루 최대 +0.8°C (2시간 달리기)', accentColor: ACCENT },
              { emoji: '🏅', text: '대회 인증 시 보너스 상승', accent: '', hint: '10km +1°C · 하프마라톤 +3°C · 풀마라톤 +5°C', accentColor: ACCENT },
              { emoji: '❄️', text: '48시간 쉬면 ', accent: '-0.1°C', hint: '꾸준히 달려야 온도를 유지할 수 있어요', accentColor: '#5B9BD5' },
            ].map((row, i) => (
              <View key={i} style={[ti.ruleRow, i === 2 && { borderBottomWidth: 0 }]}>
                <Text style={ti.ruleEmoji}>{row.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={ti.ruleText}>{row.text}{row.accent
                    ? <Text style={{ color: row.accentColor, fontWeight: 'bold' }}>{row.accent}</Text>
                    : null} {row.accent ? '상승' : ''}</Text>
                  <Text style={ti.ruleHint}>{row.hint}</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={ti.section}>
            <Text style={ti.sectionTitle}>온도 구간별 칭호</Text>
            {TEMP_TIERS.map(t => (
              <View key={t.label} style={ti.tierRow}>
                <View style={[ti.tierDot, { backgroundColor: t.color }]} />
                <Text style={ti.tierEmoji}>{t.emoji}</Text>
                <Text style={ti.tierLabel}>{t.label}</Text>
                <Text style={ti.tierRange}>{t.range}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 스켈레톤 ────────────────────────────────────────────────────
function SkeletonBox({ width, height, style }: { width: number | string; height: number; style?: any }) {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View style={[{ width, height, backgroundColor: '#E8E8ED', borderRadius: 6, opacity: anim }, style]} />
  );
}

// ─── 바텀시트 컴포넌트 ────────────────────────────────────────────
type SheetProps = {
  visible: boolean; onClose: () => void; sheetY: Animated.Value; panResponder: any;
  animal: ReturnType<typeof getAnimalData>; totalKm: number;
  runStats: { totalRuns: number; avgDistKm: number; avgPaceSec: number; streakDays: number; thisMonthDays: number };
};

function CharacterSheet({ visible, onClose, sheetY, panResponder, animal, totalKm, runStats }: SheetProps) {
  const insets = useSafeAreaInsets();
  const currentIdx   = ANIMALS.findIndex(a => a.threshold > totalKm);
  const earnedAnimals = currentIdx > 0 ? ANIMALS.slice(0, currentIdx + 1) : ANIMALS.slice(0, 1);
  const fmtPace = (sec: number) => `${Math.floor(sec / 60)}'${String(Math.floor(sec % 60)).padStart(2, '0')}"`;
  const prevThreshold = (() => {
    const idx = ANIMALS.findIndex(a => a.threshold > totalKm);
    return idx > 0 ? ANIMALS[idx - 1].threshold : 0;
  })();
  const nextThreshold = animal.next ? animal.threshold : null;
  const progressKm   = totalKm - prevThreshold;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <TouchableOpacity style={sh.backdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View
        style={[sh.sheet, { transform: [{ translateY: sheetY }], paddingBottom: insets.bottom + 16 }]}
        {...panResponder.panHandlers}
      >
        <View style={sh.handle} />
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={sh.sheetHeader}>
            <View style={sh.bigEmojiWrap}>
              <Text style={sh.bigEmoji}>{animal.emoji}</Text>
            </View>
            <View style={sh.sheetHeaderText}>
              <Text style={sh.sheetTitle}>{animal.name}</Text>
              <Text style={sh.sheetSub}>나의 러닝 파트너</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={sh.closeBtn}>
              <Text style={sh.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={sh.section}>
            <Text style={sh.sectionTitle}>다음 레벨까지</Text>
            {animal.next ? (
              <>
                <View style={sh.levelRow}>
                  <View style={sh.levelAnimal}>
                    <Text style={sh.levelEmoji}>{animal.emoji}</Text>
                    <Text style={sh.levelName}>{animal.name}</Text>
                  </View>
                  <View style={sh.levelArrow}><Text style={sh.levelArrowTxt}>›</Text></View>
                  <View style={sh.levelAnimal}>
                    <Text style={sh.levelEmoji}>{animal.next.emoji}</Text>
                    <Text style={sh.levelName}>{animal.next.name}</Text>
                  </View>
                </View>
                <View style={sh.bigProgress}>
                  <View style={[sh.bigProgressFill, { width: `${animal.progress * 100}%` as any }]} />
                </View>
                <View style={sh.progressMeta}>
                  <Text style={sh.progressMetaL}>{progressKm.toFixed(1)}km 달림</Text>
                  <Text style={sh.progressMetaR}>
                    <Text style={{ color: ACCENT, fontWeight: 'bold' }}>{animal.remaining.toFixed(0)}km</Text> 남음
                  </Text>
                </View>
                <View style={sh.kmChip}>
                  <Text style={sh.kmChipTxt}>총 {totalKm.toFixed(1)}km / {nextThreshold?.toLocaleString()}km</Text>
                </View>
              </>
            ) : (
              <View style={sh.maxLevel}>
                <Text style={sh.maxLevelEmoji}>🏆</Text>
                <Text style={sh.maxLevelTxt}>최고 등급 달성!</Text>
              </View>
            )}
          </View>

          <View style={sh.section}>
            <Text style={sh.sectionTitle}>성장 타임라인</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sh.timeline}>
              {ANIMALS.map((a, i) => {
                const unlocked = i < earnedAnimals.length;
                const isCurrent = i === earnedAnimals.length - 1;
                return (
                  <View key={a.name} style={sh.timelineItem}>
                    {i < ANIMALS.length - 1 && (
                      <View style={[sh.timelineLine, unlocked && i < earnedAnimals.length - 1 && sh.timelineLineActive]} />
                    )}
                    <View style={[sh.timelineDot, unlocked && sh.timelineDotActive, isCurrent && sh.timelineDotCurrent]}>
                      <Text style={[sh.timelineEmoji, !unlocked && sh.timelineEmojiLocked]}>
                        {unlocked ? a.emoji : '🔒'}
                      </Text>
                    </View>
                    <Text style={[sh.timelineName, !unlocked && sh.timelineNameLocked]}>{a.name}</Text>
                    <Text style={sh.timelineKm}>
                      {i === 0 ? '0km~' : `${ANIMALS[i-1].threshold < 10000
                        ? ANIMALS[i-1].threshold
                        : (ANIMALS[i-1].threshold / 1000).toFixed(0) + 'k'}~`}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>

          <View style={[sh.section, { marginBottom: 8 }]}>
            <Text style={sh.sectionTitle}>러닝 습관 통계</Text>
            <View style={sh.statsGrid}>
              <StatCard icon="🏃" label="총 러닝" value={`${runStats.totalRuns}회`} />
              <StatCard icon="📏" label="평균 거리" value={`${runStats.avgDistKm.toFixed(1)}km`} />
              <StatCard icon="⚡" label="평균 페이스" value={runStats.totalRuns > 0 ? fmtPace(runStats.avgPaceSec) : '-'} />
              <StatCard icon="🔥" label="연속 달리기" value={`${runStats.streakDays}일`} accent />
              <StatCard icon="📅" label="이번달 달린 날" value={`${runStats.thisMonthDays}일`} />
              <StatCard icon="🌍" label="총 누적" value={`${totalKm.toFixed(1)}km`} accent />
            </View>
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function StatCard({ icon, label, value, accent }: { icon: string; label: string; value: string; accent?: boolean }) {
  return (
    <View style={[sh.statCard, accent && sh.statCardAccent]}>
      <Text style={sh.statIcon}>{icon}</Text>
      <Text style={sh.statValue}>{value}</Text>
      <Text style={[sh.statLabel, accent && sh.statLabelAccent]}>{label}</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: ACCENT },
  scroll:   { flex: 1, backgroundColor: BG },

  // ── 히어로 헤더 ──
  hero: {
    backgroundColor: ACCENT,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
    overflow: 'hidden',
  },
  heroDeco1: {
    position: 'absolute', width: SCREEN_W * 1.4, height: SCREEN_W * 1.4,
    borderRadius: SCREEN_W * 0.7, backgroundColor: 'rgba(255,255,255,0.07)',
    top: -SCREEN_W * 0.9, right: -SCREEN_W * 0.3,
  },
  heroDeco2: {
    position: 'absolute', width: SCREEN_W, height: SCREEN_W,
    borderRadius: SCREEN_W * 0.5, backgroundColor: 'rgba(255,255,255,0.05)',
    bottom: -SCREEN_W * 0.6, left: -SCREEN_W * 0.2,
  },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  heroDate:   { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '600', marginBottom: 4 },
  heroGreet:  { fontSize: 17, fontWeight: 'bold', color: '#fff' },
  heroKmBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 16, minWidth: 72,
  },
  heroKmLabel: { fontSize: 10, color: 'rgba(255,255,255,0.8)', fontWeight: '700', marginBottom: 2 },
  heroKmValue: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  heroStatRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16, paddingVertical: 12, paddingHorizontal: 4,
  },
  heroStatChip: { flex: 1, alignItems: 'center', gap: 2 },
  heroStatDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginVertical: 4 },
  heroStatEmoji: { fontSize: 16 },
  heroStatValue: { fontSize: 15, fontWeight: 'bold', color: '#fff' },
  heroStatLabel: { fontSize: 10, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },

  // ── 빠른 이동 ──
  quickRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4,
  },
  quickBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 14,
    backgroundColor: '#fff', borderRadius: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2, gap: 4,
  },
  quickBtnEmoji: { fontSize: 22 },
  quickBtnLabel: { fontSize: 11, color: '#555', fontWeight: '700' },

  // ── CTA 카드 ──
  ctaCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: DARK,
    marginHorizontal: 16, marginTop: 12,
    borderRadius: 20, padding: 18, gap: 16,
    shadowColor: DARK, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 5 },
    elevation: 7,
  },
  tempCircle: {
    width: 70, height: 70, borderRadius: 35,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 3,
  },
  tempCircleEmoji: { fontSize: 24 },
  tempCircleValue: { fontSize: 13, fontWeight: 'bold', marginTop: 1 },
  ctaTextBlock: { flex: 1 },
  ctaStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 },
  ctaStatusEmoji: { fontSize: 13 },
  ctaStatusLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  ctaTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 3 },
  ctaHintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ctaHint: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },
  infoBtn: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  infoBtnText: { fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 'bold', lineHeight: 12 },
  ctaArrowWrap: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  ctaArrow: { fontSize: 22, color: 'rgba(255,255,255,0.5)', lineHeight: 26 },

  // 온도 힌트 배너
  tempHintBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: ACCENT_LIGHT, marginHorizontal: 16, marginTop: 8,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10,
  },
  tempHintText: { flex: 1, fontSize: 13, color: ACCENT, fontWeight: '500' },
  tempHintLink: { fontSize: 12, color: ACCENT, fontWeight: '700', marginLeft: 8 },

  // 섹션 레이블
  sectionLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6,
  },
  sectionBar: { width: 4, height: 16, borderRadius: 2, backgroundColor: ACCENT },
  sectionLabelText: { fontSize: 13, fontWeight: '700', color: '#888', letterSpacing: 0.4 },

  // 공통 카드
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 0,
    borderRadius: 20, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: '#111' },
  cardSub:   { fontSize: 11, color: '#bbb', fontWeight: '600' },
  cardMore:  { fontSize: 13, color: ACCENT, fontWeight: '600' },

  // 캐릭터
  animalRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  animalEmojiWrap: {
    width: 62, height: 62, borderRadius: 31,
    backgroundColor: ACCENT_LIGHT,
    justifyContent: 'center', alignItems: 'center',
  },
  animalEmoji: { fontSize: 36 },
  animalMeta: { flex: 1 },
  animalName: { fontSize: 19, fontWeight: 'bold', color: '#111', marginBottom: 4 },
  animalNext: { fontSize: 12, color: '#888' },
  animalNextKm: { color: ACCENT, fontWeight: 'bold' },
  animalKmBubble: {
    alignItems: 'center', backgroundColor: BG,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12,
  },
  animalKmValue: { fontSize: 18, fontWeight: 'bold', color: ACCENT },
  animalKmUnit:  { fontSize: 10, color: ACCENT, fontWeight: '600' },
  progressTrack: { height: 8, backgroundColor: '#F0F0F0', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressFill:  { height: '100%', backgroundColor: ACCENT, borderRadius: 4 },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { fontSize: 11, color: '#ccc', fontWeight: '600' },

  // 최근 기록
  recordRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  recordAccentBar: {
    width: 3, height: 36, borderRadius: 2,
    backgroundColor: ACCENT, marginRight: 12,
  },
  recordLeft: { flex: 1 },
  recordDate: { fontSize: 13, color: '#999', marginBottom: 2, fontWeight: '500' },
  recordPace: { fontSize: 11, color: '#bbb' },
  recordMid:  { alignItems: 'center', marginHorizontal: 12 },
  recordDuration:      { fontSize: 16, fontWeight: '700', color: '#333' },
  recordDurationLabel: { fontSize: 10, color: '#ccc', marginTop: 1 },
  recordRight: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  recordKm:     { fontSize: 26, fontWeight: 'bold', color: ACCENT },
  recordKmUnit: { fontSize: 13, color: ACCENT, fontWeight: '600' },

  // 랭킹
  rankRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5', gap: 10,
  },
  rankRowMe: {
    backgroundColor: ACCENT_LIGHT, borderRadius: 10,
    paddingHorizontal: 8, marginHorizontal: -8,
    borderBottomWidth: 0, marginBottom: 1,
  },
  rankNumWrap: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  rankNum: { fontSize: 16, fontWeight: '700', color: '#bbb', textAlign: 'center' },
  rankNameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rankAnimal: { fontSize: 18 },
  rankNickname:   { fontSize: 15, color: '#222', fontWeight: '600' },
  rankNicknameMe: { color: ACCENT },
  rankKmWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  rankKm:     { fontSize: 18, fontWeight: 'bold', color: '#333' },
  rankKmMe:   { color: ACCENT },
  rankKmUnit: { fontSize: 12, color: '#aaa' },

  // 비어있을 때
  emptyBox:  { alignItems: 'center', paddingVertical: 24 },
  emptyEmoji: { fontSize: 36, marginBottom: 8 },
  emptyText:  { fontSize: 15, color: '#bbb', fontWeight: '600', marginBottom: 4 },
  emptyHint:  { fontSize: 12, color: '#ccc', textAlign: 'center' },
});

// ─── 바텀시트 스타일 ──────────────────────────────────────────────
const sh = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: BG, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    maxHeight: '90%',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D1D1D6', alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12,
    borderRadius: 20, padding: 16, gap: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  bigEmojiWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: ACCENT_LIGHT, justifyContent: 'center', alignItems: 'center' },
  bigEmoji: { fontSize: 38 },
  sheetHeaderText: { flex: 1 },
  sheetTitle: { fontSize: 22, fontWeight: 'bold', color: '#111' },
  sheetSub:   { fontSize: 13, color: '#aaa', marginTop: 2 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center' },
  closeTxt: { fontSize: 14, color: '#888', fontWeight: '600' },
  section: {
    backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12,
    borderRadius: 20, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#aaa', marginBottom: 14, letterSpacing: 0.5 },
  levelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 18, gap: 16 },
  levelAnimal: { alignItems: 'center', gap: 4 },
  levelEmoji: { fontSize: 36 },
  levelName: { fontSize: 13, fontWeight: '600', color: '#555' },
  levelArrow: { paddingBottom: 12 },
  levelArrowTxt: { fontSize: 28, color: '#D1D1D6', fontWeight: '300' },
  bigProgress: { height: 12, backgroundColor: '#F0F0F0', borderRadius: 6, overflow: 'hidden', marginBottom: 10 },
  bigProgressFill: { height: '100%', backgroundColor: ACCENT, borderRadius: 6 },
  progressMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  progressMetaL: { fontSize: 13, color: '#aaa' },
  progressMetaR: { fontSize: 13, color: '#aaa' },
  kmChip: { backgroundColor: ACCENT_LIGHT, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, alignSelf: 'center' },
  kmChipTxt: { fontSize: 13, color: ACCENT, fontWeight: '700' },
  maxLevel: { alignItems: 'center', paddingVertical: 16, gap: 8 },
  maxLevelEmoji: { fontSize: 48 },
  maxLevelTxt: { fontSize: 18, fontWeight: 'bold', color: ACCENT },
  timeline: { paddingHorizontal: 4, paddingBottom: 4, gap: 0, flexDirection: 'row' },
  timelineItem: { alignItems: 'center', width: 72, position: 'relative' },
  timelineLine: { position: 'absolute', top: 20, left: '50%', width: 72, height: 2, backgroundColor: '#EEE', zIndex: 0 },
  timelineLineActive: { backgroundColor: ACCENT },
  timelineDot: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center', marginBottom: 6, zIndex: 1, borderWidth: 2, borderColor: 'transparent' },
  timelineDotActive: { backgroundColor: ACCENT_LIGHT },
  timelineDotCurrent: { borderColor: ACCENT, backgroundColor: ACCENT_LIGHT },
  timelineEmoji: { fontSize: 22 },
  timelineEmojiLocked: { opacity: 0.4 },
  timelineName: { fontSize: 11, fontWeight: '600', color: '#333', textAlign: 'center' },
  timelineNameLocked: { color: '#CCC' },
  timelineKm: { fontSize: 9, color: '#BBB', marginTop: 2, textAlign: 'center' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: (SCREEN_W - 32 - 36 - 20) / 3, backgroundColor: BG, borderRadius: 16, padding: 14, alignItems: 'center', gap: 4 },
  statCardAccent: { backgroundColor: ACCENT_LIGHT },
  statIcon:  { fontSize: 22 },
  statValue: { fontSize: 16, fontWeight: 'bold', color: '#111' },
  statLabel: { fontSize: 10, color: '#aaa', textAlign: 'center', fontWeight: '600' },
  statLabelAccent: { color: ACCENT },
});

// ─── 신발 온도 모달 스타일 ────────────────────────────────────────
const ti = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: BG, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 20,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 12,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    marginHorizontal: 16, marginBottom: 8, borderRadius: 20, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  headerEmoji: { fontSize: 32 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#111' },
  headerSub:   { fontSize: 12, color: '#aaa', marginTop: 2 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center' },
  closeTxt: { fontSize: 14, color: '#888', fontWeight: '600' },
  section: {
    backgroundColor: '#fff', marginHorizontal: 16, marginTop: 8, borderRadius: 20, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#aaa', marginBottom: 12, letterSpacing: 0.4 },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  ruleEmoji: { fontSize: 22, width: 28, textAlign: 'center', marginTop: 2 },
  ruleText: { fontSize: 14, fontWeight: '600', color: '#222', marginBottom: 2 },
  ruleHint: { fontSize: 12, color: '#aaa', lineHeight: 17 },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  tierDot:   { width: 10, height: 10, borderRadius: 5 },
  tierEmoji: { fontSize: 18, width: 24, textAlign: 'center' },
  tierLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: '#222' },
  tierRange: { fontSize: 12, color: '#aaa', fontWeight: '600' },
});
