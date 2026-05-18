import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACCENT, ACCENT_LIGHT, BG } from '../../constants/colors';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Modal,
  KeyboardAvoidingView, Platform, Dimensions, Switch,
  Image, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import { auth, db } from '../../firebase/config';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from '../../constants/cloudinary';
import { updateTempAfterRace } from '../../firebase/temperature';
import {
  getReminderSettings, setDailyReminder,
  requestNotificationPermission, getNotificationPermission,
} from '../../constants/notifications';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── 타입 ────────────────────────────────────────────────────────
type MarathonRecord = {
  event: string;
  year: string;
  month: string;
  day: string;
  distance: '풀' | '하프' | '10km';
  timeMin: string;
  timeSec: string;
  photos?: string[];
};

type Profile = {
  nickname: string;
  age: string;
  gender: string;
  region: string;
  records: MarathonRecord[];
  photoURL?: string;
  weight?: string;
};

const defaultProfile: Profile = {
  nickname: '', age: '', gender: '', region: '', records: [], photoURL: '', weight: '',
};

const REGIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];
const defaultRecord: MarathonRecord = {
  event: '', year: '', month: '', day: '',
  distance: '풀', timeMin: '', timeSec: '',
};

// ─── 배지 정의 ───────────────────────────────────────────────────
interface BadgeDef {
  id: string; emoji: string; name: string; desc: string;
}
const BADGE_DEFS: BadgeDef[] = [
  { id: 'first_run',   emoji: '🌱', name: '첫 러닝',      desc: '처음으로 달렸어요' },
  { id: 'run_5k',      emoji: '🐾', name: '5km 완주',     desc: '한 번에 5km 이상 달렸어요' },
  { id: 'run_10k',     emoji: '🏃', name: '10km 달성',    desc: '한 번에 10km 이상 달렸어요' },
  { id: 'run_half',    emoji: '🏅', name: '하프마라톤',   desc: '한 번에 21km 이상 달렸어요' },
  { id: 'streak_3',    emoji: '🔥', name: '3일 연속',     desc: '3일 연속으로 달렸어요' },
  { id: 'streak_7',    emoji: '💪', name: '7일 연속',     desc: '7일 연속으로 달렸어요' },
  { id: 'runs_10',     emoji: '📅', name: '10회 러닝',    desc: '총 10번 달렸어요' },
  { id: 'runs_50',     emoji: '🏆', name: '50회 러닝',    desc: '총 50번 달렸어요' },
  { id: 'km_100',      emoji: '🌟', name: '100km 달성',   desc: '누적 100km를 달렸어요' },
  { id: 'km_500',      emoji: '🦁', name: '500km 달성',   desc: '누적 500km를 달렸어요' },
];

// ─── 동물 캐릭터 ─────────────────────────────────────────────────
const getAnimal = (km: number) => {
  if (km < 50)    return { emoji: '🐌', name: '달팽이' };
  if (km < 100)   return { emoji: '🐢', name: '거북이' };
  if (km < 200)   return { emoji: '🐹', name: '햄스터' };
  if (km < 300)   return { emoji: '🦝', name: '너구리' };
  if (km < 400)   return { emoji: '🐕', name: '강아지' };
  if (km < 500)   return { emoji: '🐈', name: '고양이' };
  if (km < 700)   return { emoji: '🐗', name: '멧돼지' };
  if (km < 1000)  return { emoji: '🐰', name: '토끼' };
  if (km < 2000)  return { emoji: '🐎', name: '말' };
  if (km < 5000)  return { emoji: '🦁', name: '사자' };
  if (km < 10000) return { emoji: '🫎', name: '영양' };
  if (km < 20000) return { emoji: '🐆', name: '치타' };
  return { emoji: '🦅', name: '독수리' };
};

// ─── 헬퍼 ────────────────────────────────────────────────────────
const getBestRecord = (records: MarathonRecord[], distance: '풀' | '하프' | '10km') => {
  const filtered = records.filter(r => r.distance === distance);
  if (!filtered.length) return null;
  return filtered.reduce((b, r) => {
    const bT = parseInt(b.timeMin || '0') * 60 + parseInt(b.timeSec || '0');
    const rT = parseInt(r.timeMin || '0') * 60 + parseInt(r.timeSec || '0');
    return rT < bT ? r : b;
  });
};

const fmtRecord = (r: MarathonRecord | null) => {
  if (!r) return '-';
  return `${r.timeMin}'${(r.timeSec || '0').padStart(2, '0')}"`;
};

const formatDate = (r: MarathonRecord) => {
  if (!r.year) return '';
  return `${r.year}.${r.month.padStart(2, '0')}.${r.day.padStart(2, '0')}`;
};

const DISTANCE_LABELS = { '풀': '풀마라톤', '하프': '하프마라톤', '10km': '10km' };
const DISTANCE_KM = { '풀': 42.195, '하프': 21.0975, '10km': 10 };

// ═══════════════════════════════════════════════════════════════
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [editingRecordIndex, setEditingRecordIndex] = useState<number | null>(null);
  const [newRecord, setNewRecord] = useState<MarathonRecord>(defaultRecord);
  const [editForm, setEditForm] = useState<Profile>(defaultProfile);

  // 실제 러닝 통계 (Firebase runningRecords 기반)
  const [realTotalKm, setRealTotalKm] = useState(0);
  const [realRunCount, setRealRunCount] = useState(0);
  const [realAvgPace, setRealAvgPace] = useState('');
  const [earnedBadges, setEarnedBadges] = useState<Set<string>>(new Set());

  // 사진 업로드
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [photoModalIndex, setPhotoModalIndex] = useState<number | null>(null);

  // 알림 설정
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [notifHour, setNotifHour] = useState(7);
  const [notifMinute, setNotifMinute] = useState(0);
  const [notifPermission, setNotifPermission] = useState(false);

  const userId = auth.currentUser?.uid;

  useEffect(() => {
    loadProfile();
    loadRealStats();
    loadNotifSettings();
  }, []);

  const loadProfile = async () => {
    if (!userId) return;
    const snap = await getDoc(doc(db, 'users', userId));
    if (snap.exists()) {
      const d = snap.data();
      setProfile({
        nickname: d.nickname || '',
        age: d.age || '',
        gender: d.gender || '',
        region: d.region || '',
        records: d.records || [],
        photoURL: d.photoURL || '',
        weight: d.weight || '',
      });
    }
  };

  const loadRealStats = async () => {
    if (!userId) return;
    try {
      const snap = await getDocs(
        query(collection(db, 'runningRecords'), where('userId', '==', userId))
      );
      let totalKm = 0, count = 0;
      snap.docs.forEach(d => {
        const data = d.data();
        totalKm += data.distanceKm || 0;
        count++;
      });
      // 대회기록도 합산
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        (userDoc.data()?.records || []).forEach((r: MarathonRecord) => {
          totalKm += DISTANCE_KM[r.distance] || 0;
        });
      }
      setRealTotalKm(parseFloat(totalKm.toFixed(2)));
      setRealRunCount(count);

      // 평균 페이스: 1km 이상 러닝만, 최근 5회 기준 1km당 평균
      const recentValid = snap.docs
        .map(d => d.data())
        .filter(d => (d.distanceKm || 0) >= 1)
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
        .slice(0, 5);

      if (recentValid.length > 0) {
        const totalPaceSec = recentValid.reduce(
          (sum, d) => sum + (d.duration || 0) / (d.distanceKm || 1), 0
        );
        const avgPaceSec = totalPaceSec / recentValid.length;
        const pm = Math.floor(avgPaceSec / 60);
        const ps = Math.floor(avgPaceSec % 60);
        setRealAvgPace(`${pm}'${String(ps).padStart(2, '0')}"`);
      }

      // ─── 배지 계산 ─────────────────────────────────────────
      const runs = snap.docs.map(d => d.data());
      const runKmList = runs.map(d => d.distanceKm || 0);
      const allDates = Array.from(new Set(runs.map(d => d.date as string).filter(Boolean))).sort().reverse();
      let streak = 0;
      let cur = new Date(); cur.setHours(0, 0, 0, 0);
      for (const ds of allDates) {
        const d = new Date(ds); d.setHours(0, 0, 0, 0);
        if (Math.round((cur.getTime() - d.getTime()) / 86400000) <= 1) { streak++; cur = d; } else break;
      }
      const km = runs.reduce((s, d) => s + (d.distanceKm || 0), 0);
      const earned = new Set<string>();
      if (runs.length >= 1)                         earned.add('first_run');
      if (runKmList.some(k => k >= 5))              earned.add('run_5k');
      if (runKmList.some(k => k >= 10))             earned.add('run_10k');
      if (runKmList.some(k => k >= 21))             earned.add('run_half');
      if (streak >= 3)                              earned.add('streak_3');
      if (streak >= 7)                              earned.add('streak_7');
      if (runs.length >= 10)                        earned.add('runs_10');
      if (runs.length >= 50)                        earned.add('runs_50');
      if (km >= 100)                                earned.add('km_100');
      if (km >= 500)                                earned.add('km_500');
      setEarnedBadges(earned);
    } catch (e) { console.log('stats 오류:', e); }
  };

  // ─── 프로필 저장 ─────────────────────────────────────────────
  const saveProfile = async () => {
    if (!userId) return;
    if (!editForm.nickname.trim()) {
      Alert.alert('입력 오류', '닉네임을 입력해주세요');
      return;
    }
    if (editForm.nickname.trim() !== profile.nickname) {
      try {
        const snap = await getDocs(
          query(collection(db, 'users'), where('nickname', '==', editForm.nickname.trim()))
        );
        if (!snap.empty) {
          Alert.alert('닉네임 중복', '이미 사용 중인 닉네임이에요.\n다른 닉네임을 입력해주세요 😊');
          return;
        }
      } catch { /* 오류 시 중복 체크 건너뜀 */ }
    }
    try {
      // totalKm, avgPaceMin, avgPaceSec 등 자동계산 필드는 저장하지 않음
      const { nickname, age, gender, region, records, weight } = editForm;
      const photoURL = profile.photoURL || '';
      await setDoc(doc(db, 'users', userId), { nickname: nickname.trim(), age, gender, region, records, photoURL, weight: weight || '' });
      setProfile({ nickname: nickname.trim(), age, gender, region, records, photoURL, weight: weight || '' });
      setShowEditModal(false);
      Alert.alert('저장 완료! 😊', '프로필이 업데이트됐어요');
    } catch (e) { Alert.alert('오류', '저장에 실패했어요'); }
  };

  // ─── 대회 기록 ───────────────────────────────────────────────
  const openAddRecord = () => {
    setEditingRecordIndex(null);
    setNewRecord(defaultRecord);
    setShowRecordModal(true);
  };

  const openEditRecord = (i: number) => {
    setEditingRecordIndex(i);
    setNewRecord(profile.records[i]);
    setShowRecordModal(true);
  };

  const saveRecord = async () => {
    if (!newRecord.event || !newRecord.timeMin) {
      Alert.alert('입력 오류', '대회명과 기록을 입력해주세요');
      return;
    }
    const isNew = editingRecordIndex === null;
    const updatedRecords = isNew
      ? [...profile.records, newRecord]
      : profile.records.map((r, i) => i === editingRecordIndex ? newRecord : r);
    const updated = { ...profile, records: updatedRecords };
    setProfile(updated);
    if (userId) {
      await setDoc(doc(db, 'users', userId), updated);
      if (isNew) {
        await updateTempAfterRace(userId, newRecord.distance);
        Alert.alert('🏅 대회 기록 저장!', `${newRecord.distance} 완주!\n신발 온도가 올라갔어요 🔥`);
      }
    }
    setShowRecordModal(false);
    loadRealStats();
  };

  const deleteRecord = (i: number) => {
    Alert.alert('삭제 확인', '이 기록을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive', onPress: async () => {
          const updated = { ...profile, records: profile.records.filter((_, idx) => idx !== i) };
          setProfile(updated);
          if (userId) await setDoc(doc(db, 'users', userId), updated);
          loadRealStats();
        },
      },
    ]);
  };

  // ─── 이미지 업로드 헬퍼 ─────────────────────────────────────
  const uploadImage = async (uri: string, folder: string): Promise<string> => {
    const formData = new FormData();
    const filename = uri.split('/').pop() ?? 'photo.jpg';
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
    const mime = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : 'image/jpeg';
    formData.append('file', { uri, type: mime, name: filename } as any);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('folder', folder);
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: 'POST', body: formData }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? 'Upload failed');
    return data.secure_url;
  };

  const pickImage = async (square = false): Promise<string | null> => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요해요');
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: square,
      aspect: square ? [1, 1] : undefined,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return null;
    return result.assets[0].uri;
  };

  const pickProfilePhoto = async () => {
    const uri = await pickImage(true);
    if (!uri || !userId) return;
    setPhotoUploading(true);
    try {
      const url = await uploadImage(uri, `runmate/users/${userId}/profile`);
      const updated = { ...profile, photoURL: url };
      setProfile(updated);
      await setDoc(doc(db, 'users', userId), updated);
    } catch (e: any) {
      Alert.alert('업로드 실패', e?.message ?? '사진 업로드에 실패했어요');
    }
    setPhotoUploading(false);
  };

  const deleteProfilePhoto = () => {
    if (!profile.photoURL || !userId) return;
    Alert.alert('프로필 사진 삭제', '사진을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive', onPress: async () => {
          const updated = { ...profile, photoURL: '' };
          setProfile(updated);
          await setDoc(doc(db, 'users', userId), updated);
        },
      },
    ]);
  };

  const handleAvatarPress = () => {
    if (profile.photoURL) {
      Alert.alert('프로필 사진', '어떻게 할까요?', [
        { text: '사진 변경', onPress: pickProfilePhoto },
        { text: '사진 삭제', style: 'destructive', onPress: deleteProfilePhoto },
        { text: '취소', style: 'cancel' },
      ]);
    } else {
      pickProfilePhoto();
    }
  };

  const addMarathonPhoto = async (recordIndex: number) => {
    const uri = await pickImage(false);
    if (!uri || !userId) return;
    setPhotoUploading(true);
    try {
      const url = await uploadImage(uri, `runmate/users/${userId}/marathon`);
      const updatedRecords = profile.records.map((r, i) =>
        i === recordIndex ? { ...r, photos: [...(r.photos || []), url] } : r
      );
      const updated = { ...profile, records: updatedRecords };
      setProfile(updated);
      await setDoc(doc(db, 'users', userId), updated);
    } catch (e: any) {
      Alert.alert('업로드 실패', e?.message ?? '사진 업로드에 실패했어요');
    }
    setPhotoUploading(false);
  };

  const deleteMarathonPhoto = (recordIndex: number, photoIndex: number) => {
    Alert.alert('사진 삭제', '이 사진을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive', onPress: async () => {
          if (!userId) return;
          const updatedRecords = profile.records.map((r, i) =>
            i === recordIndex
              ? { ...r, photos: (r.photos || []).filter((_, pi) => pi !== photoIndex) }
              : r
          );
          const updated = { ...profile, records: updatedRecords };
          setProfile(updated);
          await setDoc(doc(db, 'users', userId), updated);
        },
      },
    ]);
  };

  const loadNotifSettings = async () => {
    const settings = await getReminderSettings();
    setNotifEnabled(settings.enabled);
    setNotifHour(settings.hour);
    setNotifMinute(settings.minute);
    const granted = await getNotificationPermission();
    setNotifPermission(granted);
  };

  const handleToggleNotif = async (val: boolean) => {
    if (val && !notifPermission) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        Alert.alert('알림 권한 필요', '기기 설정에서 RunMate의 알림 권한을 허용해주세요');
        return;
      }
      setNotifPermission(true);
    }
    setNotifEnabled(val);
    await setDailyReminder(val, notifHour, notifMinute);
  };

  const handleNotifHourChange = async (delta: number) => {
    const next = (notifHour + delta + 24) % 24;
    setNotifHour(next);
    if (notifEnabled) await setDailyReminder(true, next, notifMinute);
  };

  const handleNotifMinuteToggle = async () => {
    const next = notifMinute === 0 ? 30 : 0;
    setNotifMinute(next);
    if (notifEnabled) await setDailyReminder(true, notifHour, next);
  };

  const handleLogout = () => {
    Alert.alert('로그아웃', '정말 로그아웃 할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃', style: 'destructive', onPress: async () => {
          await AsyncStorage.removeItem('runmate_auto_login');
          signOut(auth);
        },
      },
    ]);
  };

  const animal = getAnimal(realTotalKm);

  // ═══════════════════════════════════════════════════════════════
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── 프로필 히어로 카드 ─────────────────────────────── */}
        <View style={styles.heroCard}>
          {/* 배경 장식 원 */}
          <View style={styles.heroBgCircle1} />
          <View style={styles.heroBgCircle2} />

          {/* 상단: 타이틀 + 편집 */}
          <View style={styles.heroTopRow}>
            <Text style={styles.heroTopLabel}>내 프로필</Text>
            <TouchableOpacity
              style={styles.editBtnPill}
              onPress={() => { setEditForm(profile); setShowEditModal(true); }}
            >
              <Text style={styles.editBtnPillText}>편집</Text>
            </TouchableOpacity>
          </View>

          {/* 프로필 사진 + 이름 */}
          <View style={styles.avatarRow}>
            <TouchableOpacity onPress={handleAvatarPress} style={styles.avatarCircle} activeOpacity={0.85}>
              {profile.photoURL ? (
                <Image source={{ uri: profile.photoURL }} style={styles.avatarPhoto} />
              ) : (
                <Text style={styles.avatarEmoji}>{animal.emoji}</Text>
              )}
              {photoUploading ? (
                <View style={styles.avatarOverlay}>
                  <ActivityIndicator color="#fff" size="small" />
                </View>
              ) : (
                <View style={styles.cameraBadge}>
                  <Text style={styles.cameraBadgeIcon}>📷</Text>
                </View>
              )}
            </TouchableOpacity>
            <View style={styles.avatarInfo}>
              <Text style={styles.heroNickname}>
                {profile.nickname || '닉네임 없음'}
              </Text>
              <View style={styles.animalBadge}>
                <Text style={styles.animalBadgeText}>{animal.name} 등급</Text>
              </View>
              <Text style={styles.heroMeta}>
                {profile.gender || '-'} · {profile.age ? `${profile.age}세` : '-'} · {profile.region || '-'}
              </Text>
            </View>
          </View>

          {/* 핵심 통계 3개 */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{realTotalKm.toLocaleString()}</Text>
              <Text style={styles.statLabel}>누적 km</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{realRunCount}</Text>
              <Text style={styles.statLabel}>총 러닝</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{realAvgPace || '-'}</Text>
              <Text style={styles.statLabel}>평균 페이스</Text>
            </View>
          </View>
        </View>

        {/* ── 베스트 기록 ───────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🏅 베스트 기록</Text>
          <View style={styles.bestGrid}>
            {(['풀', '하프', '10km'] as const).map(d => {
              const best = getBestRecord(profile.records, d);
              return (
                <View key={d} style={styles.bestCard}>
                  <Text style={styles.bestDist}>{DISTANCE_LABELS[d]}</Text>
                  <Text style={[styles.bestTime, !best && styles.bestTimeEmpty]}>
                    {fmtRecord(best)}
                  </Text>
                  {best && (
                    <Text style={styles.bestEvent} numberOfLines={1}>{best.event}</Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* ── 도전 배지 ─────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎖 도전 배지</Text>
          <Text style={{ fontSize: 12, color: '#aaa', marginBottom: 12 }}>
            {earnedBadges.size}/{BADGE_DEFS.length}개 획득
          </Text>
          <View style={styles.badgeGrid}>
            {BADGE_DEFS.map(b => {
              const earned = earnedBadges.has(b.id);
              return (
                <View key={b.id} style={[styles.badgeCard, !earned && styles.badgeCardLocked]}>
                  <Text style={[styles.badgeEmoji, !earned && { opacity: 0.3 }]}>{b.emoji}</Text>
                  <Text style={[styles.badgeName, !earned && styles.badgeNameLocked]}>{b.name}</Text>
                  <Text style={[styles.badgeDesc, !earned && styles.badgeDescLocked]} numberOfLines={2}>{b.desc}</Text>
                  {!earned && <Text style={styles.badgeLock}>🔒</Text>}
                </View>
              );
            })}
          </View>
        </View>

        {/* ── 대회 기록 ─────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>📋 대회 기록</Text>
            <TouchableOpacity style={styles.addBtnPill} onPress={openAddRecord}>
              <Text style={styles.addBtnPillText}>+ 추가</Text>
            </TouchableOpacity>
          </View>

          {profile.records.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyEmoji}>🏁</Text>
              <Text style={styles.emptyText}>아직 대회 기록이 없어요</Text>
              <Text style={styles.emptyHint}>완주한 대회를 추가하면 신발 온도가 올라가요!</Text>
            </View>
          ) : (
            profile.records.map((r, i) => (
              <View key={i} style={[
                styles.recordCard,
                i === profile.records.length - 1 && { marginBottom: 0 },
              ]}>
                {/* 왼쪽: 종목 뱃지 */}
                <View style={[styles.distBadge,
                  r.distance === '풀' ? styles.distFull :
                  r.distance === '하프' ? styles.distHalf : styles.distTen
                ]}>
                  <Text style={styles.distBadgeText}>{r.distance}</Text>
                </View>
                {/* 중간: 대회명 + 날짜 */}
                <View style={styles.recordMid}>
                  <Text style={styles.recordEvent} numberOfLines={1}>{r.event}</Text>
                  <Text style={styles.recordDate}>{formatDate(r)}</Text>
                </View>
                {/* 기록 */}
                <Text style={styles.recordTime}>
                  {r.timeMin}'{(r.timeSec || '0').padStart(2, '0')}"
                </Text>
                {/* 액션 버튼 */}
                <View style={styles.recordActions}>
                  <TouchableOpacity
                    onPress={() => { setPhotoModalIndex(i); setShowPhotoModal(true); }}
                    style={styles.iconBtn}
                  >
                    <View style={styles.photoIconWrap}>
                      <Text style={styles.iconBtnText}>📷</Text>
                      {(r.photos?.length ?? 0) > 0 && (
                        <View style={styles.photoBadge}>
                          <Text style={styles.photoBadgeText}>{r.photos!.length}</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => openEditRecord(i)} style={styles.iconBtn}>
                    <Text style={styles.iconBtnText}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteRecord(i)} style={styles.iconBtn}>
                    <Text style={styles.iconBtnText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        {/* ── 알림 설정 ─────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔔 알림 설정</Text>

          {/* 일일 러닝 리마인더 */}
          <View style={styles.notifRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.notifLabel}>일일 러닝 리마인더</Text>
              <Text style={styles.notifDesc}>매일 설정한 시간에 달리기를 알려줘요</Text>
            </View>
            <Switch
              value={notifEnabled}
              onValueChange={handleToggleNotif}
              trackColor={{ false: '#E0E0E0', true: ACCENT }}
              thumbColor="#fff"
            />
          </View>

          {/* 시간 선택 (활성화 시만 표시) */}
          {notifEnabled && (
            <View style={styles.notifTimePicker}>
              <Text style={styles.notifTimeLabel}>알림 시간</Text>
              <View style={styles.notifTimeRow}>
                <TouchableOpacity style={styles.timeArrowBtn} onPress={() => handleNotifHourChange(-1)}>
                  <Text style={styles.timeArrowText}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.timeValue}>
                  {String(notifHour).padStart(2, '0')}:{String(notifMinute).padStart(2, '0')}
                </Text>
                <TouchableOpacity style={styles.timeArrowBtn} onPress={() => handleNotifHourChange(1)}>
                  <Text style={styles.timeArrowText}>›</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.minuteToggleBtn} onPress={handleNotifMinuteToggle}>
                  <Text style={styles.minuteToggleText}>:{String(notifMinute).padStart(2, '0')} 전환</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* 스트릭 경고 안내 */}
          <View style={styles.notifInfoRow}>
            <Text style={styles.notifInfoIcon}>🔥</Text>
            <Text style={styles.notifInfoText}>
              연속 달리기 기록이 끊길 것 같으면 저녁 8시에 자동으로 알림이 와요
            </Text>
          </View>
        </View>

        {/* ── 로그아웃 ───────────────────────────────────────── */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>

        <View style={{ height: 40 + insets.bottom }} />
      </ScrollView>

      {/* ══ 프로필 편집 모달 ════════════════════════════════════ */}
      <Modal visible={showEditModal} animationType="slide" onRequestClose={() => setShowEditModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            {/* 모달 헤더 */}
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <Text style={styles.modalCancel}>취소</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>프로필 편집</Text>
              <TouchableOpacity onPress={saveProfile}>
                <Text style={styles.modalDone}>저장</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">

              {/* 자동계산 통계 안내 */}
              <View style={styles.autoStatsNotice}>
                <Text style={styles.autoStatsIcon}>📊</Text>
                <Text style={styles.autoStatsText}>
                  누적 km · 총 러닝 · 평균 페이스는{'\n'}러닝 기록에서 자동으로 계산돼요
                </Text>
              </View>

              <Text style={styles.fieldLabel}>닉네임 *</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.nickname}
                onChangeText={v => setEditForm({ ...editForm, nickname: v })}
                placeholder="닉네임 입력"
                placeholderTextColor="#ccc"
                maxLength={12}
              />
              <Text style={styles.fieldHint}>{editForm.nickname.length}/12자</Text>

              <Text style={styles.fieldLabel}>나이</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.age}
                onChangeText={v => setEditForm({ ...editForm, age: v.replace(/[^0-9]/g, '') })}
                placeholder="나이"
                placeholderTextColor="#ccc"
                keyboardType="numeric"
                maxLength={3}
              />

              <Text style={styles.fieldLabel}>체중 (kg)</Text>
              <TextInput
                style={styles.fieldInput}
                value={editForm.weight}
                onChangeText={v => setEditForm({ ...editForm, weight: v.replace(/[^0-9]/g, '') })}
                placeholder="체중 입력 (칼로리 계산에 사용)"
                placeholderTextColor="#ccc"
                keyboardType="numeric"
                maxLength={3}
              />

              <Text style={styles.fieldLabel}>성별</Text>
              <View style={styles.chipRow}>
                {['남성', '여성'].map(g => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.chip, editForm.gender === g && styles.chipActive]}
                    onPress={() => setEditForm({ ...editForm, gender: g })}
                  >
                    <Text style={[styles.chipText, editForm.gender === g && styles.chipTextActive]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>주 활동 지역</Text>
              <View style={styles.regionGrid}>
                {REGIONS.map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.regionChip, editForm.region === r && styles.regionChipActive]}
                    onPress={() => setEditForm({ ...editForm, region: editForm.region === r ? '' : r })}
                  >
                    <Text style={[styles.regionChipText, editForm.region === r && styles.regionChipTextActive]}>
                      {r}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ height: 40 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ══ 대회 사진 갤러리 모달 ═══════════════════════════════ */}
      <Modal
        visible={showPhotoModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPhotoModal(false)}
      >
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, { paddingBottom: 32 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.photoModalHeader}>
              <Text style={styles.sheetTitle}>
                {photoModalIndex !== null ? profile.records[photoModalIndex]?.event || '대회 사진' : '대회 사진'}
              </Text>
              <TouchableOpacity onPress={() => setShowPhotoModal(false)}>
                <Text style={styles.modalCancel}>닫기</Text>
              </TouchableOpacity>
            </View>

            {photoModalIndex !== null && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.photoScrollContent}
              >
                {(profile.records[photoModalIndex]?.photos || []).map((url, pi) => (
                  <View key={pi} style={styles.photoThumbWrap}>
                    <Image source={{ uri: url }} style={styles.photoThumb} />
                    <TouchableOpacity
                      style={styles.photoDeleteBtn}
                      onPress={() => deleteMarathonPhoto(photoModalIndex, pi)}
                    >
                      <Text style={styles.photoDeleteText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity
                  style={styles.addPhotoBtn}
                  onPress={() => addMarathonPhoto(photoModalIndex)}
                  disabled={photoUploading}
                >
                  {photoUploading ? (
                    <ActivityIndicator color={ACCENT} />
                  ) : (
                    <>
                      <Text style={styles.addPhotoBtnIcon}>+</Text>
                      <Text style={styles.addPhotoBtnLabel}>사진 추가</Text>
                    </>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}

            {photoModalIndex !== null &&
              (profile.records[photoModalIndex]?.photos?.length ?? 0) === 0 &&
              !photoUploading && (
              <View style={styles.photoEmptyBox}>
                <Text style={styles.photoEmptyText}>아직 등록된 사진이 없어요</Text>
                <Text style={styles.photoEmptyHint}>기록확인서, 메달, 완주샷 등을 추가해보세요</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ══ 대회 기록 추가/수정 모달 ════════════════════════════ */}
      <Modal visible={showRecordModal} transparent animationType="slide" onRequestClose={() => setShowRecordModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.sheetOverlay}>
            <View style={styles.sheet}>
              {/* 핸들 */}
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>
                {editingRecordIndex !== null ? '대회 기록 수정' : '대회 기록 추가'}
              </Text>

              <Text style={styles.fieldLabel}>대회명</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="예: 서울마라톤"
                placeholderTextColor="#ccc"
                value={newRecord.event}
                onChangeText={v => setNewRecord({ ...newRecord, event: v })}
              />

              <Text style={styles.fieldLabel}>대회 날짜</Text>
              <View style={styles.dateRow}>
                <TextInput
                  style={[styles.fieldInput, { flex: 2, textAlign: 'center' }]}
                  placeholder="년도"
                  placeholderTextColor="#ccc"
                  value={newRecord.year}
                  onChangeText={v => setNewRecord({ ...newRecord, year: v.replace(/[^0-9]/g, '') })}
                  keyboardType="numeric"
                  maxLength={4}
                />
                <Text style={styles.dateSep}>/</Text>
                <TextInput
                  style={[styles.fieldInput, { flex: 1, textAlign: 'center' }]}
                  placeholder="월"
                  placeholderTextColor="#ccc"
                  value={newRecord.month}
                  onChangeText={v => setNewRecord({ ...newRecord, month: v.replace(/[^0-9]/g, '') })}
                  keyboardType="numeric"
                  maxLength={2}
                />
                <Text style={styles.dateSep}>/</Text>
                <TextInput
                  style={[styles.fieldInput, { flex: 1, textAlign: 'center' }]}
                  placeholder="일"
                  placeholderTextColor="#ccc"
                  value={newRecord.day}
                  onChangeText={v => setNewRecord({ ...newRecord, day: v.replace(/[^0-9]/g, '') })}
                  keyboardType="numeric"
                  maxLength={2}
                />
              </View>

              <Text style={styles.fieldLabel}>종목</Text>
              <View style={styles.chipRow}>
                {(['풀', '하프', '10km'] as const).map(d => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.chip, newRecord.distance === d && styles.chipActive]}
                    onPress={() => setNewRecord({ ...newRecord, distance: d })}
                  >
                    <Text style={[styles.chipText, newRecord.distance === d && styles.chipTextActive]}>
                      {DISTANCE_LABELS[d]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>기록</Text>
              <View style={styles.timeRow}>
                <TextInput
                  style={[styles.fieldInput, { flex: 1, textAlign: 'center' }]}
                  placeholder="분"
                  placeholderTextColor="#ccc"
                  value={newRecord.timeMin}
                  onChangeText={v => setNewRecord({ ...newRecord, timeMin: v.replace(/[^0-9]/g, '') })}
                  keyboardType="numeric"
                  maxLength={3}
                />
                <Text style={styles.timeSep}>'</Text>
                <TextInput
                  style={[styles.fieldInput, { flex: 1, textAlign: 'center' }]}
                  placeholder="초"
                  placeholderTextColor="#ccc"
                  value={newRecord.timeSec}
                  onChangeText={v => setNewRecord({ ...newRecord, timeSec: v.replace(/[^0-9]/g, '') })}
                  keyboardType="numeric"
                  maxLength={2}
                />
                <Text style={styles.timeSep}>"</Text>
              </View>

              <TouchableOpacity style={styles.sheetSaveBtn} onPress={saveRecord}>
                <Text style={styles.sheetSaveBtnText}>
                  {editingRecordIndex !== null ? '수정 완료' : '저장하기'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowRecordModal(false)} style={styles.sheetCancelBtn}>
                <Text style={styles.sheetCancelText}>취소</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },

  // ── 히어로 카드
  heroCard: {
    backgroundColor: ACCENT,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    overflow: 'hidden',
  },
  heroBgCircle1: {
    position: 'absolute', width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.07)',
    top: -60, right: -40,
  },
  heroBgCircle2: {
    position: 'absolute', width: 140, height: 140, borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.05)',
    bottom: -30, left: -20,
  },
  heroTopRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 20,
  },
  heroTopLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  editBtnPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  editBtnPillText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  avatarCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
  },
  avatarPhoto: { width: 72, height: 72, borderRadius: 36 },
  avatarEmoji: { fontSize: 40 },
  avatarOverlay: {
    position: 'absolute', width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', alignItems: 'center',
  },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  cameraBadgeIcon: { fontSize: 11 },
  avatarInfo: { flex: 1 },
  heroNickname: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 6 },
  animalBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 10, marginBottom: 6,
  },
  animalBadgeText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  heroMeta: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },

  // 통계
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16, padding: 16,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 3 },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  statDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.2)' },

  // ── 섹션
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 20, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#111', marginBottom: 14 },
  sectionTitleRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 14,
  },
  addBtnPill: {
    backgroundColor: ACCENT_LIGHT,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12,
  },
  addBtnPillText: { color: ACCENT, fontSize: 13, fontWeight: '700' },

  // 베스트 기록 그리드
  // 배지
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badgeCard: {
    width: '30%', backgroundColor: '#FFF5F0', borderRadius: 14,
    padding: 10, alignItems: 'center', borderWidth: 1.5, borderColor: ACCENT + '33',
  },
  badgeCardLocked: { backgroundColor: '#F5F5F5', borderColor: '#E5E5E5' },
  badgeEmoji: { fontSize: 28, marginBottom: 6 },
  badgeName: { fontSize: 11, fontWeight: '700', color: '#333', textAlign: 'center', marginBottom: 3 },
  badgeNameLocked: { color: '#bbb' },
  badgeDesc: { fontSize: 9.5, color: '#888', textAlign: 'center', lineHeight: 13 },
  badgeDescLocked: { color: '#ccc' },
  badgeLock: { fontSize: 12, marginTop: 4 },

  bestGrid: { flexDirection: 'row', gap: 10 },
  bestCard: {
    flex: 1, backgroundColor: BG,
    borderRadius: 14, padding: 12, alignItems: 'center',
  },
  bestDist: { fontSize: 11, color: '#aaa', fontWeight: '700', marginBottom: 6 },
  bestTime: { fontSize: 18, fontWeight: 'bold', color: ACCENT, marginBottom: 4 },
  bestTimeEmpty: { color: '#ddd' },
  bestEvent: { fontSize: 10, color: '#bbb', textAlign: 'center' },

  // 대회 기록 카드
  recordCard: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, gap: 10,
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
    marginBottom: 0,
  },
  distBadge: {
    width: 38, height: 38, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  distFull: { backgroundColor: '#FFE9E0' },
  distHalf: { backgroundColor: '#E8F4FF' },
  distTen: { backgroundColor: '#E8FFE8' },
  distBadgeText: { fontSize: 11, fontWeight: '800', color: '#555' },
  recordMid: { flex: 1 },
  recordEvent: { fontSize: 14, fontWeight: '700', color: '#111', marginBottom: 2 },
  recordDate: { fontSize: 12, color: '#bbb' },
  recordTime: { fontSize: 15, fontWeight: 'bold', color: ACCENT, minWidth: 56, textAlign: 'right' },
  recordActions: { flexDirection: 'row', gap: 4 },
  iconBtn: { padding: 4 },
  iconBtnText: { fontSize: 16 },
  photoIconWrap: { position: 'relative' },
  photoBadge: {
    position: 'absolute', top: -4, right: -6,
    backgroundColor: ACCENT,
    borderRadius: 8, minWidth: 16, height: 16,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3,
  },
  photoBadgeText: { fontSize: 9, color: '#fff', fontWeight: 'bold' },

  // 빈 상태
  emptyCard: { alignItems: 'center', paddingVertical: 28 },
  emptyEmoji: { fontSize: 40, marginBottom: 10 },
  emptyText: { fontSize: 15, color: '#bbb', fontWeight: '600', marginBottom: 4 },
  emptyHint: { fontSize: 12, color: '#ddd', textAlign: 'center' },

  // 알림 설정
  notifRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 4, marginBottom: 4,
  },
  notifLabel: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 3 },
  notifDesc: { fontSize: 12, color: '#aaa' },
  notifTimePicker: {
    backgroundColor: '#F5F5F7', borderRadius: 14,
    padding: 14, marginTop: 8, marginBottom: 4,
  },
  notifTimeLabel: { fontSize: 12, color: '#aaa', fontWeight: '600', marginBottom: 10 },
  notifTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeArrowBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  timeArrowText: { fontSize: 22, color: ACCENT, fontWeight: '300', lineHeight: 26 },
  timeValue: { fontSize: 28, fontWeight: 'bold', color: '#111', minWidth: 80, textAlign: 'center' },
  minuteToggleBtn: {
    backgroundColor: ACCENT_LIGHT, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6, marginLeft: 4,
  },
  minuteToggleText: { fontSize: 12, color: ACCENT, fontWeight: '700' },
  notifInfoRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#FFFBF0', borderRadius: 12,
    padding: 12, marginTop: 8,
  },
  notifInfoIcon: { fontSize: 18 },
  notifInfoText: { flex: 1, fontSize: 12, color: '#888', lineHeight: 18 },

  // 로그아웃
  logoutBtn: {
    marginHorizontal: 16, marginTop: 16,
    paddingVertical: 16, borderRadius: 16,
    borderWidth: 1.5, borderColor: '#FFD5C8',
    alignItems: 'center', backgroundColor: '#fff',
  },
  logoutText: { color: '#FF8060', fontWeight: '700', fontSize: 15 },

  // ── 편집 모달 공통
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  modalTitle: { fontSize: 17, fontWeight: 'bold', color: '#111' },
  modalCancel: { fontSize: 16, color: '#999' },
  modalDone: { fontSize: 16, color: ACCENT, fontWeight: 'bold' },
  modalScroll: { padding: 20 },

  // 대회 기록 바텀시트
  sheetOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#E0E0E0', alignSelf: 'center', marginBottom: 16,
  },
  sheetTitle: { fontSize: 18, fontWeight: 'bold', color: '#111', marginBottom: 16 },
  sheetSaveBtn: {
    backgroundColor: ACCENT, borderRadius: 14,
    paddingVertical: 15, alignItems: 'center', marginTop: 16,
  },
  sheetSaveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  sheetCancelBtn: { alignItems: 'center', marginTop: 12, paddingVertical: 8 },
  sheetCancelText: { color: '#bbb', fontSize: 15 },

  // 공통 폼 요소
  fieldLabel: { fontSize: 13, color: '#999', fontWeight: '600', marginBottom: 6, marginTop: 14 },
  fieldHint: { fontSize: 11, color: '#ccc', textAlign: 'right', marginTop: 2 },
  fieldInput: {
    borderWidth: 1.5, borderColor: '#EDEDED', borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 14,
    fontSize: 15, color: '#111', backgroundColor: '#FAFAFA',
    marginBottom: 2,
  },
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  chip: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#EDEDED',
    alignItems: 'center', backgroundColor: '#FAFAFA',
  },
  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 14, color: '#666', fontWeight: '600' },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  // 지역 그리드
  regionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 2 },
  regionChip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#EDEDED', backgroundColor: '#FAFAFA',
  },
  regionChipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  regionChipText: { fontSize: 13, fontWeight: '600', color: '#666' },
  regionChipTextActive: { color: '#fff' },

  // 자동계산 통계 안내
  autoStatsNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: ACCENT_LIGHT, borderRadius: 12,
    padding: 14, marginBottom: 4, marginTop: 4,
  },
  autoStatsIcon: { fontSize: 22 },
  autoStatsText: { flex: 1, fontSize: 13, color: '#FF8C60', lineHeight: 19, fontWeight: '500' },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateSep: { fontSize: 16, color: '#aaa' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeSep: { fontSize: 18, color: '#aaa', fontWeight: '300' },

  // 대회 사진 모달
  photoModalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  photoScrollContent: {
    paddingHorizontal: 4, paddingBottom: 8, gap: 10, alignItems: 'flex-start',
  },
  photoThumbWrap: { position: 'relative' },
  photoThumb: {
    width: 140, height: 140, borderRadius: 12,
    backgroundColor: '#F0F0F0',
  },
  photoDeleteBtn: {
    position: 'absolute', top: 6, right: 6,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },
  photoDeleteText: { color: '#fff', fontSize: 16, fontWeight: '300', lineHeight: 18 },
  addPhotoBtn: {
    width: 140, height: 140, borderRadius: 12,
    borderWidth: 2, borderColor: '#E8E8E8', borderStyle: 'dashed',
    backgroundColor: '#FAFAFA',
    justifyContent: 'center', alignItems: 'center', gap: 6,
  },
  addPhotoBtnIcon: { fontSize: 28, color: '#ccc' },
  addPhotoBtnLabel: { fontSize: 13, color: '#bbb', fontWeight: '600' },
  photoEmptyBox: { alignItems: 'center', paddingVertical: 20 },
  photoEmptyText: { fontSize: 15, color: '#bbb', fontWeight: '600', marginBottom: 6 },
  photoEmptyHint: { fontSize: 12, color: '#ddd', textAlign: 'center', lineHeight: 18 },
});