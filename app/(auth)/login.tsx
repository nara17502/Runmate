import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform, StatusBar,
  Dimensions, ScrollView,
} from 'react-native';
import { FirebaseRecaptchaVerifierModal } from 'expo-firebase-recaptcha';
import { signInWithPhoneNumber, ConfirmationResult } from 'firebase/auth';
import { auth, app } from '../../firebase/config';
import { ACCENT } from '../../constants/colors';

const { width } = Dimensions.get('window');

const RESEND_COOLDOWN = 60;  // seconds
const OTP_EXPIRY     = 180; // seconds (3 min)

// 010-1234-5678 형식으로 자동 하이픈 삽입
const formatPhone = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3)  return d;
  if (d.length <= 7)  return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
};

// 010-1234-5678 → +821012345678 (E.164)
const toE164 = (phone: string): string => {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('0') ? `+82${d.slice(1)}` : `+82${d}`;
};

const isValidPhone = (phone: string): boolean => {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 || d.length === 11;
};

const getPhoneError = (code: string): string => {
  switch (code) {
    case 'auth/invalid-phone-number':    return '전화번호 형식이 올바르지 않아요';
    case 'auth/too-many-requests':       return '너무 많은 시도가 있었어요. 잠시 후 다시 해주세요';
    case 'auth/quota-exceeded':          return 'SMS 한도에 도달했어요. 잠시 후 다시 시도해주세요';
    case 'auth/network-request-failed':  return '네트워크 연결을 확인해주세요';
    case 'auth/captcha-check-failed':    return 'reCAPTCHA 인증에 실패했어요. 다시 시도해주세요';
    default:                             return '오류가 발생했어요. 다시 시도해주세요';
  }
};

const getOtpError = (code: string): string => {
  switch (code) {
    case 'auth/invalid-verification-code': return '인증번호가 올바르지 않아요';
    case 'auth/code-expired':              return '인증번호가 만료됐어요. 재발송해주세요';
    case 'auth/too-many-requests':         return '너무 많은 시도가 있었어요. 잠시 후 다시 해주세요';
    case 'auth/network-request-failed':    return '네트워크 연결을 확인해주세요';
    default:                               return '인증에 실패했어요. 다시 시도해주세요';
  }
};

type Phase = 'phone' | 'otp';

export default function LoginScreen() {
  const recaptchaVerifierRef = useRef<FirebaseRecaptchaVerifierModal>(null);
  const otpInputRef = useRef<TextInput>(null);

  const [phase, setPhase]             = useState<Phase>('phone');
  const [phone, setPhone]             = useState('');
  const [otp, setOtp]                 = useState('');
  const [loading, setLoading]         = useState(false);
  const [errorMsg, setErrorMsg]       = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [resendTimer, setResendTimer] = useState(0);
  const [expiryTimer, setExpiryTimer] = useState(OTP_EXPIRY);

  const resendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      clearInterval(resendIntervalRef.current ?? undefined);
      clearInterval(expiryIntervalRef.current ?? undefined);
    };
  }, []);

  const startTimers = () => {
    // 재발송 쿨다운
    setResendTimer(RESEND_COOLDOWN);
    clearInterval(resendIntervalRef.current ?? undefined);
    resendIntervalRef.current = setInterval(() => {
      setResendTimer(prev => {
        if (prev <= 1) { clearInterval(resendIntervalRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);

    // 인증번호 만료 카운트다운
    setExpiryTimer(OTP_EXPIRY);
    clearInterval(expiryIntervalRef.current ?? undefined);
    expiryIntervalRef.current = setInterval(() => {
      setExpiryTimer(prev => {
        if (prev <= 1) { clearInterval(expiryIntervalRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const sendOtp = async () => {
    setErrorMsg('');
    if (!isValidPhone(phone)) {
      setErrorMsg('올바른 전화번호를 입력해주세요 (예: 010-1234-5678)');
      return;
    }
    setLoading(true);
    try {
      const result = await signInWithPhoneNumber(auth, toE164(phone), recaptchaVerifierRef.current!);
      setConfirmation(result);
      setPhase('otp');
      setOtp('');
      startTimers();
      setTimeout(() => otpInputRef.current?.focus(), 300);
    } catch (err: any) {
      setErrorMsg(getPhoneError(err?.code ?? ''));
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setErrorMsg('');
    if (otp.length !== 6) {
      setErrorMsg('6자리 인증번호를 입력해주세요');
      return;
    }
    if (!confirmation) return;
    setLoading(true);
    try {
      await confirmation.confirm(otp);
      // onAuthStateChanged in _layout.tsx handles navigation
    } catch (err: any) {
      setErrorMsg(getOtpError(err?.code ?? ''));
      setLoading(false);
    }
  };

  const handlePhoneChange = (text: string) => {
    setPhone(formatPhone(text));
    setErrorMsg('');
  };

  const fmtExpiry = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const maskedPhone = phone.replace(/(\d{3})-(\d{4})-(\d{4})/, '$1-****-$3');

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" />

      {/* reCAPTCHA 모달 (화면에 보이지 않음, 인증 시 자동 팝업) */}
      <FirebaseRecaptchaVerifierModal
        ref={recaptchaVerifierRef}
        firebaseConfig={app.options}
        attemptInvisibleVerification
      />

      {/* 상단 브랜드 배너 */}
      <View style={styles.topBg}>
        <View style={styles.deco1} />
        <View style={styles.deco2} />
        <View style={styles.logoWrap}>
          <View style={styles.logoRing}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoEmoji}>🏃</Text>
            </View>
          </View>
          <Text style={styles.brand}>RunMate</Text>
          <Text style={styles.tagline}>함께 달리면 더 멀리</Text>
        </View>
      </View>

      {/* 폼 */}
      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── 전화번호 입력 단계 ── */}
        {phase === 'phone' && (
          <>
            <Text style={styles.stepTitle}>전화번호로 시작하기</Text>
            <Text style={styles.stepSub}>본인 명의 휴대폰 번호를 입력해주세요{'\n'}인증번호 SMS를 보내드려요</Text>

            <View style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>휴대폰 번호</Text>
              <View style={[styles.inputBox, !!errorMsg && styles.inputBoxError]}>
                <Text style={styles.inputIcon}>📱</Text>
                <TextInput
                  style={styles.input}
                  placeholder="010-0000-0000"
                  placeholderTextColor="#C7C7CC"
                  value={phone}
                  onChangeText={handlePhoneChange}
                  keyboardType="phone-pad"
                  returnKeyType="done"
                  onSubmitEditing={sendOtp}
                  editable={!loading}
                  maxLength={13}
                />
              </View>
            </View>

            {!!errorMsg && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠ {errorMsg}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, (loading || !isValidPhone(phone)) && styles.buttonDisabled]}
              onPress={sendOtp}
              activeOpacity={0.85}
              disabled={loading || !isValidPhone(phone)}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.buttonText}>인증번호 받기</Text>
              }
            </TouchableOpacity>

            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>
                💬 인증번호 SMS가 발송됩니다.{'\n'}
                수신되지 않으면 스팸 차단 여부를 확인해주세요.
              </Text>
            </View>
          </>
        )}

        {/* ── OTP 인증 단계 ── */}
        {phase === 'otp' && (
          <>
            <Text style={styles.stepTitle}>인증번호 입력</Text>
            <Text style={styles.stepSub}>
              <Text style={styles.boldPhone}>{maskedPhone}</Text>
              {'\n'}으로 전송된 6자리 번호를 입력해주세요
            </Text>

            <View style={styles.fieldWrap}>
              <View style={styles.otpLabelRow}>
                <Text style={styles.fieldLabel}>인증번호</Text>
                <Text style={[styles.expiryText, expiryTimer <= 30 && styles.expiryTextUrgent]}>
                  {expiryTimer > 0 ? `⏱ ${fmtExpiry(expiryTimer)}` : '만료됨'}
                </Text>
              </View>
              <View style={[styles.inputBox, !!errorMsg && styles.inputBoxError]}>
                <Text style={styles.inputIcon}>🔢</Text>
                <TextInput
                  ref={otpInputRef}
                  style={styles.input}
                  placeholder="6자리 숫자"
                  placeholderTextColor="#C7C7CC"
                  value={otp}
                  onChangeText={t => { setOtp(t.replace(/\D/g, '').slice(0, 6)); setErrorMsg(''); }}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onSubmitEditing={verifyOtp}
                  editable={!loading}
                  maxLength={6}
                />
              </View>
            </View>

            {!!errorMsg && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠ {errorMsg}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, (loading || otp.length !== 6) && styles.buttonDisabled]}
              onPress={verifyOtp}
              activeOpacity={0.85}
              disabled={loading || otp.length !== 6}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.buttonText}>확인</Text>
              }
            </TouchableOpacity>

            {/* 재발송 + 번호 변경 */}
            <View style={styles.resendRow}>
              <TouchableOpacity
                onPress={sendOtp}
                disabled={resendTimer > 0 || loading}
                activeOpacity={0.7}
              >
                <Text style={[styles.resendText, resendTimer > 0 && styles.resendTextDisabled]}>
                  {resendTimer > 0 ? `재발송 (${resendTimer}s)` : '인증번호 재발송'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.dividerDot}> · </Text>
              <TouchableOpacity
                onPress={() => { setPhase('phone'); setOtp(''); setErrorMsg(''); }}
                activeOpacity={0.7}
              >
                <Text style={styles.changePhoneText}>번호 변경</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ACCENT },

  topBg: {
    height: 260, backgroundColor: ACCENT,
    justifyContent: 'flex-end', alignItems: 'center',
    paddingBottom: 32, overflow: 'hidden',
  },
  deco1: {
    position: 'absolute', width: width * 1.6, height: width * 1.6,
    borderRadius: width * 0.8, backgroundColor: 'rgba(255,255,255,0.06)',
    top: -width * 0.9, left: -width * 0.3,
  },
  deco2: {
    position: 'absolute', width: width * 1.2, height: width * 1.2,
    borderRadius: width * 0.6, backgroundColor: 'rgba(255,255,255,0.08)',
    top: -width * 0.3, right: -width * 0.4,
  },
  logoWrap:   { alignItems: 'center' },
  logoRing:   {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  logoCircle: {
    width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  logoEmoji: { fontSize: 34 },
  brand:     { fontSize: 32, fontWeight: 'bold', color: '#fff', letterSpacing: 1, marginBottom: 4 },
  tagline:   { fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },

  formScroll: {
    flex: 1, backgroundColor: '#F5F5F7',
    borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -20,
  },
  formContent: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 40 },

  stepTitle: { fontSize: 22, fontWeight: 'bold', color: '#111', marginBottom: 8, textAlign: 'center' },
  stepSub:   { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  boldPhone: { fontWeight: '700', color: '#111' },

  fieldWrap:  { marginBottom: 8 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 },
  inputBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, borderWidth: 1.5, borderColor: '#EBEBEB', paddingHorizontal: 12,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  inputBoxError: { borderColor: ACCENT },
  inputIcon: { fontSize: 16, marginRight: 8 },
  input:     { flex: 1, paddingVertical: 14, fontSize: 15, color: '#111' },

  otpLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  expiryText: { fontSize: 13, color: '#888', fontWeight: '600' },
  expiryTextUrgent: { color: '#FF4040' },

  errorBox: {
    backgroundColor: '#FFF0EB', borderRadius: 10, padding: 10,
    marginBottom: 12, borderLeftWidth: 3, borderLeftColor: ACCENT,
  },
  errorText: { fontSize: 13, color: '#CC4400', fontWeight: '500' },

  button: {
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    shadowColor: ACCENT, shadowOpacity: 0.35, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 5, marginTop: 8,
  },
  buttonDisabled: { backgroundColor: '#FFBFA6', shadowOpacity: 0 },
  buttonText:     { color: '#fff', fontSize: 17, fontWeight: 'bold', letterSpacing: 0.3 },

  resendRow: {
    flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', marginTop: 18,
  },
  resendText:         { fontSize: 14, color: ACCENT, fontWeight: '600' },
  resendTextDisabled: { color: '#BBBBBB' },
  dividerDot:         { fontSize: 14, color: '#CCCCCC' },
  changePhoneText:    { fontSize: 14, color: '#999', fontWeight: '500' },

  noticeBox: {
    backgroundColor: '#F0F0F5', borderRadius: 12,
    padding: 14, marginTop: 20,
  },
  noticeText: { fontSize: 12, color: '#888', lineHeight: 19, textAlign: 'center' },
});
