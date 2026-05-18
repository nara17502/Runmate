import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { useProfileContext } from '../_layout';

import { ACCENT, ACCENT_LIGHT, BG } from '../../constants/colors';

const REGIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

const STEPS = [
  { key: 'welcome', title: '반갑습니다! 👋', subtitle: 'RunMate와 함께 달릴 준비를 해봐요' },
  { key: 'profile', title: '나를 소개해주세요', subtitle: '그룹 매칭과 랭킹에 활용돼요' },
  { key: 'region', title: '주로 어디서 달리나요?', subtitle: '내 지역 러닝 그룹을 쉽게 찾을 수 있어요' },
];

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const { markProfileComplete } = useProfileContext();

  const [step, setStep] = useState(0);
  const [nickname, setNickname] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);
  const [checkingNick, setCheckingNick] = useState(false);

  const isStep0Valid = true;
  const isStep1Valid = nickname.trim().length > 0 && age.length > 0 && gender.length > 0;
  const canNext = step === 0 ? isStep0Valid : step === 1 ? isStep1Valid : true;

  const isNicknameUnique = async (nick: string): Promise<boolean> => {
    const snap = await getDocs(
      query(collection(db, 'users'), where('nickname', '==', nick.trim()))
    );
    return snap.empty;
  };

  const handleNext = async () => {
    if (step < STEPS.length - 1) {
      if (step === 1) {
        if (!isStep1Valid) {
          Alert.alert('입력 필요', '닉네임, 나이, 성별을 모두 입력해주세요');
          return;
        }
        setCheckingNick(true);
        const unique = await isNicknameUnique(nickname);
        setCheckingNick(false);
        if (!unique) {
          Alert.alert('닉네임 중복', '이미 사용 중인 닉네임이에요.\n다른 닉네임을 입력해주세요 😊');
          return;
        }
      }
      setStep(s => s + 1);
      return;
    }

    // 마지막 단계 — 저장
    setSaving(true);
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) throw new Error('no user');
      await setDoc(doc(db, 'users', userId), {
        nickname: nickname.trim(),
        age,
        gender,
        region: region || '',
        records: [],
      });
      markProfileComplete();
    } catch (e) {
      Alert.alert('오류', '저장에 실패했어요. 다시 시도해주세요');
    }
    setSaving(false);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: BG }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 브랜드 */}
        <View style={styles.brand}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>🏃</Text>
          </View>
          <Text style={styles.logoTitle}>RunMate</Text>
        </View>

        {/* 스텝 인디케이터 */}
        <View style={styles.stepRow}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.stepDot,
                i === step && styles.stepDotActive,
                i < step && styles.stepDotDone,
              ]}
            />
          ))}
        </View>

        {/* 스텝 헤더 */}
        <Text style={styles.stepTitle}>{STEPS[step].title}</Text>
        <Text style={styles.stepSubtitle}>{STEPS[step].subtitle}</Text>

        {/* ── 스텝 0: 환영 ── */}
        {step === 0 && (
          <View style={styles.card}>
            <View style={styles.featureRow}>
              <Text style={styles.featureEmoji}>👟</Text>
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>신발 온도 시스템</Text>
                <Text style={styles.featureDesc}>달릴수록 신발이 뜨거워져요. 꾸준히 달려서 최고온도를 달성해보세요!</Text>
              </View>
            </View>
            <View style={styles.featureRow}>
              <Text style={styles.featureEmoji}>🐌</Text>
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>동물 캐릭터 성장</Text>
                <Text style={styles.featureDesc}>누적 거리가 쌓일수록 달팽이 → 치타 → 독수리로 진화해요!</Text>
              </View>
            </View>
            <View style={[styles.featureRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.featureEmoji}>👥</Text>
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>그룹 러닝</Text>
                <Text style={styles.featureDesc}>내 지역 러닝 크루를 찾거나 직접 만들어 함께 달려요!</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── 스텝 1: 기본 정보 ── */}
        {step === 1 && (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>닉네임 *</Text>
            <TextInput
              style={styles.input}
              placeholder="달리기할 때 불릴 이름"
              placeholderTextColor="#ccc"
              value={nickname}
              onChangeText={setNickname}
              maxLength={12}
              autoFocus
            />
            <Text style={styles.fieldHint}>{nickname.length}/12자</Text>

            <Text style={styles.fieldLabel}>나이 *</Text>
            <TextInput
              style={styles.input}
              placeholder="나이 입력 (예: 28)"
              placeholderTextColor="#ccc"
              value={age}
              onChangeText={v => setAge(v.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              maxLength={3}
            />

            <Text style={styles.fieldLabel}>성별 *</Text>
            <View style={styles.chipRow}>
              {['남성', '여성'].map(g => (
                <TouchableOpacity
                  key={g}
                  style={[styles.chip, gender === g && styles.chipActive]}
                  onPress={() => setGender(g)}
                >
                  <Text style={[styles.chipText, gender === g && styles.chipTextActive]}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.infoBox}>
              <Text style={styles.infoText}>💡 나이와 성별은 그룹 참여 조건 및 연령대 랭킹에 활용됩니다</Text>
            </View>
          </View>
        )}

        {/* ── 스텝 2: 지역 선택 ── */}
        {step === 2 && (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>주 활동 지역 (선택)</Text>
            <View style={styles.regionGrid}>
              {REGIONS.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.regionChip, region === r && styles.regionChipActive]}
                  onPress={() => setRegion(prev => prev === r ? '' : r)}
                >
                  <Text style={[styles.regionChipText, region === r && styles.regionChipTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!region && (
              <Text style={styles.skipHint}>건너뛰어도 나중에 프로필에서 설정할 수 있어요</Text>
            )}
          </View>
        )}

        {/* 버튼 */}
        <TouchableOpacity
          style={[styles.nextBtn, (!canNext || saving || checkingNick) && styles.nextBtnDisabled]}
          onPress={handleNext}
          disabled={saving || checkingNick}
          activeOpacity={0.85}
        >
          {(saving || checkingNick) ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.nextBtnText}>
              {step < STEPS.length - 1 ? '다음' : '시작하기 🚀'}
            </Text>
          )}
        </TouchableOpacity>

        {/* 이전 버튼 */}
        {step > 0 && (
          <TouchableOpacity style={styles.backBtn} onPress={() => setStep(s => s - 1)}>
            <Text style={styles.backBtnText}>← 이전</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },

  // 브랜드
  brand: { alignItems: 'center', marginBottom: 28 },
  logoCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: ACCENT,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 10,
    shadowColor: ACCENT, shadowOpacity: 0.35,
    shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  logoEmoji: { fontSize: 34 },
  logoTitle: { fontSize: 24, fontWeight: 'bold', color: '#111' },

  // 스텝 인디케이터
  stepRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E0E0E0' },
  stepDotActive: { width: 24, backgroundColor: ACCENT },
  stepDotDone: { backgroundColor: ACCENT_LIGHT },

  // 스텝 헤더
  stepTitle: { fontSize: 24, fontWeight: 'bold', color: '#111', marginBottom: 6, textAlign: 'center' },
  stepSubtitle: { fontSize: 14, color: '#aaa', textAlign: 'center', marginBottom: 24, lineHeight: 20 },

  // 카드
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 4, marginBottom: 20,
  },

  // 기능 소개 (스텝 0)
  featureRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  featureEmoji: { fontSize: 30, width: 40, textAlign: 'center', marginTop: 2 },
  featureText: { flex: 1 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 4 },
  featureDesc: { fontSize: 13, color: '#888', lineHeight: 18 },

  // 폼 (스텝 1)
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#888', marginBottom: 8, marginTop: 14 },
  fieldHint: { fontSize: 11, color: '#ccc', textAlign: 'right', marginTop: 2 },
  input: {
    borderWidth: 1.5, borderColor: '#EDEDED', borderRadius: 12,
    paddingVertical: 13, paddingHorizontal: 14,
    fontSize: 15, color: '#111', backgroundColor: '#FAFAFA',
  },
  chipRow: { flexDirection: 'row', gap: 10 },
  chip: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#EDEDED',
    alignItems: 'center', backgroundColor: '#FAFAFA',
  },
  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 15, fontWeight: '600', color: '#666' },
  chipTextActive: { color: '#fff' },
  infoBox: {
    backgroundColor: ACCENT_LIGHT, borderRadius: 10,
    padding: 12, marginTop: 16,
  },
  infoText: { fontSize: 12, color: '#FF8C60', lineHeight: 18 },

  // 지역 (스텝 2)
  regionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  regionChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#EDEDED', backgroundColor: '#FAFAFA',
  },
  regionChipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  regionChipText: { fontSize: 14, fontWeight: '600', color: '#666' },
  regionChipTextActive: { color: '#fff' },
  skipHint: { fontSize: 12, color: '#ccc', textAlign: 'center', marginTop: 16 },

  // 버튼
  nextBtn: {
    backgroundColor: ACCENT, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
    shadowColor: ACCENT, shadowOpacity: 0.3,
    shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  nextBtnDisabled: { backgroundColor: '#FFB89A', shadowOpacity: 0 },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  backBtn: { alignItems: 'center', paddingVertical: 14 },
  backBtnText: { color: '#bbb', fontSize: 15 },
});
