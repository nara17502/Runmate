import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Animated, Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';

import { ACCENT, ACCENT_LIGHT } from '../constants/colors';

const formatTime = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const calcKcal = (seconds: number, weightKg: number) => {
  return Math.round(8 * weightKg * (seconds / 3600));
};

const getAchievementMessage = (distanceKm: number, paceStr: string) => {
  if (distanceKm >= 21) return { emoji: '🏆', msg: '하프마라톤급 달리기! 믿을 수 없어요!' };
  if (distanceKm >= 10) return { emoji: '🦁', msg: '10km 이상! 진정한 러너예요!' };
  if (distanceKm >= 5)  return { emoji: '🔥', msg: '5km 완주! 오늘 정말 잘 달렸어요!' };
  if (distanceKm >= 3)  return { emoji: '💪', msg: '멋진 러닝이었어요!' };
  if (distanceKm >= 1)  return { emoji: '👟', msg: '오늘도 달렸어요! 꾸준함이 힘이에요' };
  return { emoji: '🌱', msg: '첫 걸음이 가장 어려워요. 잘했어요!' };
};

export default function RunningResultScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    duration: string;
    distanceKm: string;
    pace: string;
  }>();

  const [weightKg, setWeightKg] = useState(65);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, 'users', uid)).then(snap => {
      if (snap.exists()) {
        const w = parseInt(snap.data().weight || '0');
        if (w > 0) setWeightKg(w);
      }
    }).catch(() => {});
  }, []);

  const duration = parseInt(params.duration || '0');
  const distanceKm = parseFloat(params.distanceKm || '0');
  const pace = params.pace || "--'--\"";
  const kcal = calcKcal(duration, weightKg);
  const { emoji, msg } = getAchievementMessage(distanceKm, pace);

  const handleShare = async () => {
    try {
      await Share.share({
        message: [
          `🏃 RunMate 러닝 완료!`,
          `📏 거리: ${distanceKm.toFixed(2)} km`,
          `⏱ 시간: ${formatTime(duration)}`,
          `⚡ 페이스: ${pace}`,
          `🔥 칼로리: ${kcal} kcal`,
          ``,
          `RunMate 앱으로 함께 달려요 👟`,
        ].join('\n'),
      });
    } catch { /* ignore */ }
  };

  // 숫자 카운트업 애니메이션
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 6 }),
    ]).start();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 상단 헤더 배너 ── */}
        <View style={styles.heroBanner}>
          {/* 배경 원 장식 */}
          <View style={styles.heroBgCircle1} />
          <View style={styles.heroBgCircle2} />

          <Animated.View
            style={[styles.heroContent, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
          >
            <Text style={styles.heroEmoji}>{emoji}</Text>
            <Text style={styles.heroTitle}>러닝 완료!</Text>
            <Text style={styles.heroMsg}>{msg}</Text>
          </Animated.View>
        </View>

        {/* ── 핵심 스탯 (거리 + 시간 크게) ── */}
        <Animated.View style={[styles.mainStatsCard, { opacity: fadeAnim }]}>
          <View style={styles.mainStatLeft}>
            <Text style={styles.mainStatValue}>{distanceKm.toFixed(2)}</Text>
            <Text style={styles.mainStatUnit}>km</Text>
            <Text style={styles.mainStatLabel}>거리</Text>
          </View>
          <View style={styles.mainStatDivider} />
          <View style={styles.mainStatRight}>
            <Text style={styles.mainStatValue2}>{formatTime(duration)}</Text>
            <Text style={styles.mainStatLabel}>시간</Text>
          </View>
        </Animated.View>

        {/* ── 세부 스탯 ── */}
        <Animated.View style={[styles.subStatsCard, { opacity: fadeAnim }]}>
          <View style={styles.subStat}>
            <Text style={styles.subStatIcon}>⚡</Text>
            <Text style={styles.subStatValue}>{pace}</Text>
            <Text style={styles.subStatLabel}>평균 페이스</Text>
          </View>
          <View style={styles.subStatDivider} />
          <View style={styles.subStat}>
            <Text style={styles.subStatIcon}>🔥</Text>
            <Text style={styles.subStatValue}>{kcal}</Text>
            <Text style={styles.subStatLabel}>칼로리 (kcal)</Text>
          </View>
        </Animated.View>

        {/* ── 신발 온도 안내 ── */}
        <Animated.View style={[styles.tempNotice, { opacity: fadeAnim }]}>
          <Text style={styles.tempNoticeEmoji}>👟🔥</Text>
          <Text style={styles.tempNoticeText}>
            달린 시간만큼 신발 온도가 올라갔어요!{'\n'}홈에서 온도를 확인해보세요
          </Text>
        </Animated.View>

        {/* ── 액션 버튼 ── */}
        <View style={styles.btnArea}>
          {params.id ? (
            <TouchableOpacity
              style={styles.detailBtn}
              onPress={() => router.replace({ pathname: '/running-detail', params: { id: params.id } })}
              activeOpacity={0.85}
            >
              <Text style={styles.detailBtnText}>📊 상세 기록 보기</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.85}>
            <Text style={styles.shareBtnText}>📤 기록 공유하기</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.homeBtn}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.85}
          >
            <Text style={styles.homeBtnText}>🏠 홈으로 돌아가기</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F7' },

  // 히어로 배너
  heroBanner: {
    backgroundColor: ACCENT,
    paddingTop: 40, paddingBottom: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroBgCircle1: {
    position: 'absolute', width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.08)', top: -60, right: -50,
  },
  heroBgCircle2: {
    position: 'absolute', width: 160, height: 160, borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.06)', bottom: -40, left: -30,
  },
  heroContent: { alignItems: 'center' },
  heroEmoji: { fontSize: 64, marginBottom: 12 },
  heroTitle: { fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  heroMsg: { fontSize: 15, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 22 },

  // 메인 스탯 카드 (거리 + 시간)
  mainStatsCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: -24,
    borderRadius: 24, padding: 28,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  mainStatLeft: { flex: 1, alignItems: 'center' },
  mainStatRight: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mainStatDivider: { width: 1, backgroundColor: '#F0F0F0', marginVertical: 8 },
  mainStatValue: { fontSize: 52, fontWeight: 'bold', color: ACCENT, lineHeight: 56 },
  mainStatUnit: { fontSize: 18, fontWeight: '700', color: ACCENT, marginTop: -4 },
  mainStatValue2: { fontSize: 36, fontWeight: 'bold', color: '#111', marginBottom: 4 },
  mainStatLabel: { fontSize: 13, color: '#aaa', fontWeight: '600', marginTop: 4 },

  // 세부 스탯 카드 (페이스 + 칼로리)
  subStatsCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 12,
    borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  subStat: { flex: 1, alignItems: 'center', gap: 4 },
  subStatDivider: { width: 1, backgroundColor: '#F0F0F0' },
  subStatIcon: { fontSize: 24 },
  subStatValue: { fontSize: 22, fontWeight: 'bold', color: '#111' },
  subStatLabel: { fontSize: 12, color: '#aaa', fontWeight: '600' },

  // 신발 온도 안내
  tempNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: ACCENT_LIGHT,
    marginHorizontal: 16, marginTop: 12,
    borderRadius: 16, padding: 16,
  },
  tempNoticeEmoji: { fontSize: 28 },
  tempNoticeText: { flex: 1, fontSize: 13, color: '#FF8C60', lineHeight: 20, fontWeight: '500' },

  // 버튼
  btnArea: { marginHorizontal: 16, marginTop: 20, gap: 10 },
  detailBtn: {
    backgroundColor: '#fff',
    borderRadius: 14, paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 2, borderColor: ACCENT,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  detailBtnText: { color: ACCENT, fontWeight: 'bold', fontSize: 16 },
  shareBtn: {
    backgroundColor: '#1A1A2E', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
    elevation: 2,
  },
  shareBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  homeBtn: {
    backgroundColor: ACCENT, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
    shadowColor: ACCENT, shadowOpacity: 0.3,
    shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  homeBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
