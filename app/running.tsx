import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, Modal, ActivityIndicator, AppState, BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../firebase/config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { updateTempAfterRun } from '../firebase/temperature';
import { cancelStreakWarning, showRunningBgNotif, cancelRunningBgNotif } from '../constants/notifications';

import { ACCENT } from '../constants/colors';
import {
  LOCATION_TASK, setOnLocation, getBgLocations, clearBgLocations,
} from '../constants/locationTask';

const DRAFT_KEY = 'runmate_pending_run';

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const formatPace = (distanceM: number, seconds: number) => {
  if (distanceM < 10) return "--'--\"";
  const paceSecPerKm = seconds / (distanceM / 1000);
  const m = Math.floor(paceSecPerKm / 60);
  const s = Math.floor(paceSecPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
};

type Phase = 'idle' | 'running' | 'paused';

export default function RunningScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [showStopModal, setShowStopModal] = useState(false);
  const [locationPermission, setLocationPermission] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savePhase, setSavePhase] = useState<'idle' | 'saving' | 'retrying' | 'failed'>('idle');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationRef = useRef<Location.LocationSubscription | null>(null);
  const lastPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const routeRef = useRef<{ lat: number; lon: number; time: number }[]>([]);
  const phaseRef = useRef<Phase>('idle');
  const pendingRunRef = useRef<{
    runData: any; userId: string;
    finalSeconds: number; finalDistanceKm: number; finalPace: string;
  } | null>(null);
  const isUploadingRef = useRef(false);
  const bgStartRef = useRef<number | null>(null); // timestamp when app went to background

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    requestPermission();
    const appSub = AppState.addEventListener('change', async (nextState) => {
      if (nextState.match(/inactive|background/) && phaseRef.current === 'running') {
        setOnLocation(null); // pause live UI updates; task keeps collecting in background
        bgStartRef.current = Date.now();
        showRunningBgNotif();
      } else if (nextState === 'active') {
        cancelRunningBgNotif();
        if (phaseRef.current === 'running') {
          // Compensate timer for time spent in background
          if (bgStartRef.current) {
            const bgSecs = Math.floor((Date.now() - bgStartRef.current) / 1000);
            setSeconds(prev => prev + bgSecs);
            bgStartRef.current = null;
          }
          // Merge locations collected while backgrounded
          const pts = await getBgLocations();
          clearBgLocations();
          pts.forEach(([lat, lon]) => {
            routeRef.current.push({ lat, lon, time: Date.now() });
            if (lastPosRef.current) {
              const d = getDistance(lastPosRef.current.lat, lastPosRef.current.lon, lat, lon);
              if (d >= 1 && d < 50) setDistanceM(prev => prev + d);
            }
            lastPosRef.current = { lat, lon };
          });
          // Re-register live callback for foreground updates
          setOnLocation(makeLiveHandler());
        }
      }
    });
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phaseRef.current !== 'idle') {
        Alert.alert('러닝 중', '러닝을 종료하려면 아래 종료 버튼을 누르세요', [{ text: '확인' }]);
      } else {
        router.back();
      }
      return true;
    });
    return () => { appSub.remove(); backSub.remove(); cleanup().catch(() => {}); };
  }, []);

  const requestPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationPermission(status === 'granted');
    if (status !== 'granted') {
      Alert.alert('위치 권한 필요', 'GPS 러닝을 위해 위치 권한이 필요해요!');
      return;
    }
    await Location.requestBackgroundPermissionsAsync();
  };

  // Returns a location handler that updates route + distance state in real time
  const makeLiveHandler = () => (lat: number, lon: number) => {
    routeRef.current.push({ lat, lon, time: Date.now() });
    if (lastPosRef.current) {
      const d = getDistance(lastPosRef.current.lat, lastPosRef.current.lon, lat, lon);
      if (d >= 1 && d < 50) setDistanceM(prev => prev + d);
    }
    lastPosRef.current = { lat, lon };
  };

  // ─── 타이머 / GPS 제어 ────────────────────────────────────────
  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setSeconds(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startGPS = async () => {
    await clearBgLocations();
    setOnLocation(makeLiveHandler());
    try {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 3000,
        distanceInterval: 5,
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: '러닝 측정 중',
          notificationBody: 'GPS로 거리를 측정하고 있어요',
          notificationColor: '#FF6B35',
        },
      });
    } catch {
      // Fallback for Expo Go environments where TaskManager background location is unavailable
      locationRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 3000, distanceInterval: 5 },
        (loc) => {
          const { latitude: lat, longitude: lon } = loc.coords;
          routeRef.current.push({ lat, lon, time: Date.now() });
          if (lastPosRef.current) {
            const d = getDistance(lastPosRef.current.lat, lastPosRef.current.lon, lat, lon);
            if (d >= 1 && d < 50) setDistanceM(prev => prev + d);
          }
          lastPosRef.current = { lat, lon };
        }
      );
    }
  };

  const stopGPS = async () => {
    setOnLocation(null);
    if (locationRef.current) {
      locationRef.current.remove();
      locationRef.current = null;
    }
    try {
      if (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      }
    } catch {}
  };

  const cleanup = async () => {
    stopTimer();
    await stopGPS();
    deactivateKeepAwake();
    cancelRunningBgNotif();
  };

  // ─── 러닝 제어 ────────────────────────────────────────────────
  const handleStart = async () => {
    if (!locationPermission) {
      await requestPermission();
      return;
    }
    setSeconds(0);
    setDistanceM(0);
    lastPosRef.current = null;
    routeRef.current = [];
    await activateKeepAwakeAsync();
    startTimer();
    await startGPS();
    setPhase('running');
  };

  const handlePause = async () => {
    stopTimer();
    await stopGPS();
    lastPosRef.current = null; // GPS 재개 시 이전 위치로 인한 점프 방지
    setPhase('paused');
  };

  const handleResume = async () => {
    stopTimer();
    await stopGPS();
    startTimer();
    await startGPS();
    setPhase('running');
  };

  const handleStopPress = () => {
    setShowStopModal(true);
  };

  // ─── 저장 헬퍼 ───────────────────────────────────────────────
  const saveDraft = async (data: any) => {
    try {
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  };

  const clearDraft = async () => {
    try { await AsyncStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  };

  // 자동 재시도 3회 (1.5s 간격)
  const uploadWithRetry = async (runData: any, userId: string): Promise<string> => {
    let lastErr: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        setSavePhase('retrying');
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
      try {
        const docRef = await addDoc(collection(db, 'runningRecords'), runData);
        await updateTempAfterRun(userId, runData.duration);
        return docRef.id;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  };

  const goToResult = (id: string | undefined, finalSeconds: number, finalDistanceKm: number, finalPace: string) => {
    setSaving(false);
    setSavePhase('idle');
    const params: any = { duration: String(finalSeconds), distanceKm: String(finalDistanceKm), pace: finalPace };
    if (id) params.id = id;
    router.replace({ pathname: '/running-result', params });
  };

  const showSaveFailAlert = () => {
    const pending = pendingRunRef.current;
    if (!pending) return;
    Alert.alert(
      '저장 실패 ⚠️',
      '네트워크 오류로 기록을 저장하지 못했어요.\n다시 시도하거나 결과만 확인할 수 있어요.',
      [
        {
          text: '다시 시도',
          onPress: async () => {
            if (!pendingRunRef.current || isUploadingRef.current) return;
            isUploadingRef.current = true;
            const { runData, userId, finalSeconds, finalDistanceKm, finalPace } = pendingRunRef.current;
            setSaving(true);
            setSavePhase('saving');
            try {
              const docId = await uploadWithRetry(runData, userId);
              await clearDraft();
              pendingRunRef.current = null;
              goToResult(docId, finalSeconds, finalDistanceKm, finalPace);
            } catch {
              isUploadingRef.current = false;
              setSaving(false);
              setSavePhase('failed');
              showSaveFailAlert();
            }
          },
        },
        {
          text: '결과만 보기',
          style: 'cancel',
          onPress: () => {
            const { finalSeconds, finalDistanceKm, finalPace } = pending;
            goToResult(undefined, finalSeconds, finalDistanceKm, finalPace);
          },
        },
      ],
      { cancelable: false }
    );
  };

  const doSave = async (
    runData: any, userId: string,
    finalSeconds: number, finalDistanceKm: number, finalPace: string,
  ) => {
    if (isUploadingRef.current) return;
    isUploadingRef.current = true;

    await saveDraft({ ...runData, createdAt: Date.now() });
    pendingRunRef.current = { runData, userId, finalSeconds, finalDistanceKm, finalPace };

    setSaving(true);
    setSavePhase('saving');

    try {
      const docId = await uploadWithRetry(runData, userId);
      await clearDraft();
      await cancelStreakWarning();
      pendingRunRef.current = null;
      goToResult(docId, finalSeconds, finalDistanceKm, finalPace);
    } catch {
      isUploadingRef.current = false;
      setSaving(false);
      setSavePhase('failed');
      showSaveFailAlert();
    }
  };

  const handleFinish = async () => {
    await cleanup();
    setPhase('idle');
    setShowStopModal(false);

    const finalSeconds = seconds;

    // 경로 좌표 재계산 거리 — GPS 드리프트(1m 미만) 및 텔레포트(50m 초과) 제거
    const routeCalcM = routeRef.current.reduce((acc, pt, i) => {
      if (i === 0) return acc;
      const d = getDistance(routeRef.current[i - 1].lat, routeRef.current[i - 1].lon, pt.lat, pt.lon);
      return acc + (d >= 1 && d < 50 ? d : 0);
    }, 0);
    // 경로 데이터가 충분하면 재계산값 사용, 없으면 실시간 누적값 fallback
    const finalDistanceM = routeCalcM > 10 ? routeCalcM : distanceM;
    const finalDistanceKm = parseFloat((finalDistanceM / 1000).toFixed(2));
    const finalPace = formatPace(finalDistanceM, finalSeconds);

    if (finalDistanceM < 10) {
      Alert.alert('기록 없음', '측정된 거리가 너무 짧아 기록이 저장되지 않았어요');
      router.back();
      return;
    }

    const userId = auth.currentUser?.uid;
    if (!userId) { router.back(); return; }

    const runData = {
      userId,
      date: new Date().toISOString().slice(0, 10),
      duration: finalSeconds,
      distanceM: Math.round(finalDistanceM),
      distanceKm: finalDistanceKm,
      pace: finalPace,
      route: routeRef.current,
      createdAt: serverTimestamp(),
    };

    // 500m 미만 또는 30초 미만: 저장 여부 선택
    if (finalDistanceM < 500 || finalSeconds < 30) {
      Alert.alert(
        '짧은 러닝이에요',
        `거리 ${finalDistanceKm}km · 시간 ${formatTime(finalSeconds)}\n이 기록을 저장할까요?`,
        [
          {
            text: '저장 안 함',
            style: 'cancel',
            onPress: () => router.back(),
          },
          {
            text: '저장하기',
            onPress: () => doSave(runData, userId, finalSeconds, finalDistanceKm, finalPace),
          },
        ],
        { cancelable: false }
      );
      return;
    }

    doSave(runData, userId, finalSeconds, finalDistanceKm, finalPace);
  };

  const handleCancelStop = () => {
    setShowStopModal(false);
  };

  const distanceKm = (distanceM / 1000).toFixed(2);
  const pace = formatPace(distanceM, seconds);

  // 뒤로가기 처리
  const handleBack = () => {
    if (phase !== 'idle') {
      Alert.alert('러닝 중', '러닝을 종료하려면 아래 종료 버튼을 누르세요', [{ text: '확인' }]);
    } else {
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.container}>

      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backWrap}>
          <Text style={styles.backBtn}>← 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🏃 러닝</Text>
        {/* 상태 배지 */}
        <View style={[
          styles.statusBadge,
          phase === 'running' && styles.statusBadgeRunning,
          phase === 'paused' && styles.statusBadgePaused,
        ]}>
          <Text style={styles.statusBadgeText}>
            {phase === 'idle' ? '대기' : phase === 'running' ? '● 측정중' : '⏸ 일시정지'}
          </Text>
        </View>
      </View>

      {/* 스톱워치 원 */}
      <View style={styles.watchSection}>
        <TouchableOpacity
          style={[
            styles.watchButton,
            phase === 'running' && styles.watchRunning,
            phase === 'paused' && styles.watchPaused,
          ]}
          onPress={phase === 'idle' ? handleStart : phase === 'running' ? handlePause : handleResume}
          activeOpacity={0.85}
        >
          <Text style={styles.watchTime}>{formatTime(seconds)}</Text>
          <Text style={styles.watchHint}>
            {phase === 'idle' ? '탭하여 시작'
              : phase === 'running' ? '탭하여 일시정지'
              : '탭하여 계속하기'}
          </Text>
          {phase === 'paused' && (
            <View style={styles.pauseIcon}>
              <Text style={styles.pauseIconText}>⏸</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* 스탯 */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{distanceKm}</Text>
          <Text style={styles.statLabel}>거리 (km)</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{pace}</Text>
          <Text style={styles.statLabel}>페이스 (/km)</Text>
        </View>
      </View>

      {/* 시작 전 안내 */}
      {phase === 'idle' && (
        <View style={styles.guideBox}>
          <Text style={styles.guideText}>📍 탭하면 GPS 측정이 시작돼요</Text>
          <Text style={styles.guideText}>💡 달리다 멈추면 일시정지로 기록을 유지하세요</Text>
          <Text style={styles.guideText}>🔆 러닝 중 화면이 자동으로 켜진 상태를 유지해요</Text>
        </View>
      )}

      {/* 일시정지 중 안내 */}
      {phase === 'paused' && (
        <View style={[styles.guideBox, styles.pauseGuide]}>
          <Text style={styles.pauseGuideText}>⏸ 일시정지 중 — GPS 및 타이머가 멈춰있어요</Text>
          <Text style={styles.pauseGuideText}>원을 탭하거나 아래 버튼으로 계속 달릴 수 있어요</Text>
        </View>
      )}

      {/* 컨트롤 버튼 (러닝/일시정지 시) */}
      {phase !== 'idle' && (
        <View style={styles.controlRow}>
          {phase === 'running' ? (
            <TouchableOpacity style={styles.pauseBtn} onPress={handlePause}>
              <Text style={styles.pauseBtnIcon}>⏸</Text>
              <Text style={styles.pauseBtnText}>일시정지</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.resumeBtn} onPress={handleResume}>
              <Text style={styles.resumeBtnIcon}>▶</Text>
              <Text style={styles.resumeBtnText}>계속하기</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.stopBtn} onPress={handleStopPress}>
            <Text style={styles.stopBtnIcon}>⏹</Text>
            <Text style={styles.stopBtnText}>종료</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 저장 중 오버레이 */}
      {saving && (
        <View style={styles.savingOverlay}>
          <View style={styles.savingBox}>
            <ActivityIndicator color={ACCENT} size="large" />
            <Text style={styles.savingText}>
              {savePhase === 'retrying' ? '재시도 중...' : '기록 저장 중...'}
            </Text>
            <Text style={styles.savingHint}>잠시만 기다려주세요</Text>
          </View>
        </View>
      )}

      {/* 종료 확인 모달 */}
      <Modal visible={showStopModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>러닝을 종료할까요?</Text>
            <View style={styles.modalStats}>
              <View style={styles.modalStatRow}>
                <Text style={styles.modalStatIcon}>🕐</Text>
                <Text style={styles.modalStatLabel}>시간</Text>
                <Text style={styles.modalStatValue}>{formatTime(seconds)}</Text>
              </View>
              <View style={styles.modalStatRow}>
                <Text style={styles.modalStatIcon}>📍</Text>
                <Text style={styles.modalStatLabel}>거리</Text>
                <Text style={styles.modalStatValue}>{distanceKm} km</Text>
              </View>
              <View style={[styles.modalStatRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.modalStatIcon}>⚡</Text>
                <Text style={styles.modalStatLabel}>페이스</Text>
                <Text style={styles.modalStatValue}>{pace}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.finishBtn, saving && { opacity: 0.6 }]}
              onPress={handleFinish}
              disabled={saving}
            >
              <Text style={styles.finishBtnText}>
                {saving ? '저장 중...' : '✅ 종료 & 저장'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.continueBtn} onPress={handleCancelStop}>
              <Text style={styles.continueBtnText}>계속 달릴게요!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },

  // 헤더
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
  },
  backWrap: { width: 60 },
  backBtn: { color: '#fff', fontSize: 15 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  statusBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
    backgroundColor: '#2a2a4e',
  },
  statusBadgeRunning: { backgroundColor: 'rgba(255,107,53,0.25)' },
  statusBadgePaused: { backgroundColor: 'rgba(255,200,0,0.2)' },
  statusBadgeText: { color: '#aaa', fontSize: 11, fontWeight: '700' },

  // 스톱워치 원
  watchSection: { alignItems: 'center', justifyContent: 'center', paddingVertical: 36 },
  watchButton: {
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: '#2a2a4e', borderWidth: 4, borderColor: '#444',
    justifyContent: 'center', alignItems: 'center',
    elevation: 10,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  watchRunning: {
    borderColor: ACCENT, backgroundColor: '#2a1a0e',
    shadowColor: ACCENT, shadowOpacity: 0.4,
  },
  watchPaused: {
    borderColor: '#FFC107', backgroundColor: '#1e1a08',
    shadowColor: '#FFC107', shadowOpacity: 0.3,
  },
  watchTime: { fontSize: 52, fontWeight: 'bold', color: '#fff' },
  watchHint: { color: '#888', fontSize: 13, marginTop: 8 },
  pauseIcon: { position: 'absolute', top: 16, right: 20 },
  pauseIconText: { fontSize: 18, opacity: 0.5 },

  // 스탯
  statsRow: {
    flexDirection: 'row', backgroundColor: '#2a2a4e',
    marginHorizontal: 16, borderRadius: 16, padding: 24,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: '#444' },
  statValue: { fontSize: 32, fontWeight: 'bold', color: ACCENT },
  statLabel: { color: '#999', fontSize: 13, marginTop: 4 },

  // 안내 박스
  guideBox: {
    marginHorizontal: 16, marginTop: 16,
    padding: 16, backgroundColor: '#2a2a4e',
    borderRadius: 12, gap: 8,
  },
  guideText: { color: '#888', fontSize: 13, textAlign: 'center' },
  pauseGuide: { backgroundColor: 'rgba(255,193,7,0.08)', borderWidth: 1, borderColor: 'rgba(255,193,7,0.2)' },
  pauseGuideText: { color: '#FFC107', fontSize: 13, textAlign: 'center', opacity: 0.9 },

  // 컨트롤 버튼
  controlRow: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 20, gap: 12,
  },
  pauseBtn: {
    flex: 1, backgroundColor: '#2a2a4e', borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderColor: '#444',
  },
  pauseBtnIcon: { fontSize: 22, color: '#fff' },
  pauseBtnText: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  resumeBtn: {
    flex: 1, backgroundColor: 'rgba(255,107,53,0.15)', borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderColor: ACCENT,
  },
  resumeBtnIcon: { fontSize: 22, color: ACCENT },
  resumeBtnText: { color: ACCENT, fontSize: 13, fontWeight: '700' },
  stopBtn: {
    flex: 1, backgroundColor: 'rgba(255,60,60,0.12)', borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderColor: 'rgba(255,60,60,0.4)',
  },
  stopBtnIcon: { fontSize: 22, color: '#FF4040' },
  stopBtnText: { color: '#FF4040', fontSize: 13, fontWeight: '600' },

  // 모달
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalBox: {
    backgroundColor: '#fff', borderRadius: 24,
    padding: 24, width: '88%',
  },
  modalTitle: {
    fontSize: 20, fontWeight: 'bold', textAlign: 'center',
    marginBottom: 20, color: '#111',
  },
  modalStats: {
    backgroundColor: '#F8F8F8', borderRadius: 14,
    paddingHorizontal: 16, marginBottom: 20,
  },
  modalStatRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EFEFEF', gap: 10,
  },
  modalStatIcon: { fontSize: 18, width: 28 },
  modalStatLabel: { flex: 1, fontSize: 14, color: '#888' },
  modalStatValue: { fontSize: 16, fontWeight: 'bold', color: '#111' },
  finishBtn: {
    backgroundColor: ACCENT, borderRadius: 12,
    padding: 16, alignItems: 'center', marginBottom: 8,
  },
  finishBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  continueBtn: { padding: 12, alignItems: 'center' },
  continueBtnText: { color: '#999', fontSize: 15 },

  // 저장 중 오버레이
  savingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 100,
  },
  savingBox: {
    backgroundColor: '#1a1a2e', borderRadius: 20,
    padding: 32, alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: '#2a2a4e',
    minWidth: 200,
  },
  savingText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  savingHint: { color: '#666', fontSize: 13 },
});
