import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform, StatusBar,
  Dimensions, ScrollView, TextInput as RNTextInput, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '../../firebase/config';

const SAVED_EMAIL_KEY = 'runmate_saved_email';
const AUTO_LOGIN_KEY  = 'runmate_auto_login';

import { ACCENT } from '../../constants/colors';
const { width } = Dimensions.get('window');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const getKoreanError = (code: string): string => {
  switch (code) {
    case 'auth/invalid-email':        return '이메일 형식이 올바르지 않아요';
    case 'auth/user-not-found':
    case 'auth/invalid-credential':   return '이메일 또는 비밀번호를 확인해주세요';
    case 'auth/wrong-password':       return '비밀번호가 틀렸어요';
    case 'auth/email-already-in-use': return '이미 사용 중인 이메일이에요';
    case 'auth/weak-password':        return '비밀번호는 6자리 이상이어야 해요';
    case 'auth/too-many-requests':    return '로그인 시도가 너무 많아요. 잠시 후 다시 시도해주세요';
    case 'auth/network-request-failed': return '네트워크 연결을 확인해주세요';
    default:                          return '문제가 발생했어요. 다시 시도해주세요';
  }
};

export default function LoginScreen() {
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [isSignUp, setIsSignUp]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [saveEmail, setSaveEmail] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);
  const [showPw, setShowPw]       = useState(false);
  const [errorMsg, setErrorMsg]   = useState('');

  const pwRef = useRef<RNTextInput>(null);

  useEffect(() => {
    (async () => {
      const [savedEmail, savedAuto] = await Promise.all([
        AsyncStorage.getItem(SAVED_EMAIL_KEY),
        AsyncStorage.getItem(AUTO_LOGIN_KEY),
      ]);
      if (savedEmail) { setEmail(savedEmail); setSaveEmail(true); }
      if (savedAuto === 'true') setAutoLogin(true);
    })();
  }, []);

  const validateEmail = (value: string) => EMAIL_REGEX.test(value.trim());

  const handleAuth = async () => {
    setErrorMsg('');

    if (!email.trim()) {
      setErrorMsg('이메일을 입력해주세요'); return;
    }
    if (!validateEmail(email)) {
      setErrorMsg('이메일 형식이 올바르지 않아요 (예: name@email.com)'); return;
    }
    if (!password) {
      setErrorMsg('비밀번호를 입력해주세요'); return;
    }
    if (isSignUp && password.length < 6) {
      setErrorMsg('비밀번호는 6자리 이상이어야 해요'); return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }

      // 이메일 저장
      if (saveEmail || autoLogin) {
        await AsyncStorage.setItem(SAVED_EMAIL_KEY, email.trim());
      } else {
        await AsyncStorage.removeItem(SAVED_EMAIL_KEY);
      }

      // 자동 로그인 체크박스 상태 기억 (Firebase 세션은 자체 유지됨)
      if (autoLogin) {
        await AsyncStorage.setItem(AUTO_LOGIN_KEY, 'true');
      } else {
        await AsyncStorage.removeItem(AUTO_LOGIN_KEY);
      }
    } catch (error: any) {
      setErrorMsg(getKoreanError(error?.code ?? ''));
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setErrorMsg('');
    if (!email.trim()) {
      setErrorMsg('비밀번호를 재설정할 이메일을 입력해주세요'); return;
    }
    if (!validateEmail(email)) {
      setErrorMsg('이메일 형식이 올바르지 않아요'); return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      Alert.alert(
        '이메일 발송 완료',
        `${email.trim()} 으로\n비밀번호 재설정 링크를 보냈어요.\n\n스팸 폴더도 확인해주세요.`,
        [{ text: '확인' }]
      );
    } catch (error: any) {
      const code = error?.code ?? '';
      if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
        setErrorMsg('등록되지 않은 이메일이에요');
      } else {
        setErrorMsg(getKoreanError(code));
      }
    }
  };

  const toggleAutoLogin = (v: boolean) => {
    setAutoLogin(v);
    if (v) setSaveEmail(true);
  };

  const handleTabSwitch = (signup: boolean) => {
    setIsSignUp(signup);
    setErrorMsg('');
    setPassword('');
    setShowPw(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" />

      {/* ── 상단 컬러 배경 ── */}
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

      {/* ── 폼 ── */}
      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 탭 */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabBtn, !isSignUp && styles.tabBtnActive]}
            onPress={() => handleTabSwitch(false)}
          >
            <Text style={[styles.tabBtnText, !isSignUp && styles.tabBtnTextActive]}>로그인</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, isSignUp && styles.tabBtnActive]}
            onPress={() => handleTabSwitch(true)}
          >
            <Text style={[styles.tabBtnText, isSignUp && styles.tabBtnTextActive]}>회원가입</Text>
          </TouchableOpacity>
        </View>

        {/* 이메일 */}
        <View style={styles.fieldWrap}>
          <Text style={styles.fieldLabel}>이메일</Text>
          <View style={[styles.inputBox, !!errorMsg && errorMsg.includes('이메일') && styles.inputBoxError]}>
            <Text style={styles.inputIcon}>✉️</Text>
            <TextInput
              style={styles.input}
              placeholder="example@email.com"
              placeholderTextColor="#C7C7CC"
              value={email}
              onChangeText={t => { setEmail(t); setErrorMsg(''); }}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
              onSubmitEditing={() => pwRef.current?.focus()}
              editable={!loading}
            />
          </View>
        </View>

        {/* 비밀번호 */}
        <View style={styles.fieldWrap}>
          <Text style={styles.fieldLabel}>비밀번호</Text>
          <View style={[styles.inputBox, !!errorMsg && errorMsg.includes('비밀번호') && styles.inputBoxError]}>
            <Text style={styles.inputIcon}>🔑</Text>
            <TextInput
              ref={pwRef}
              style={styles.input}
              placeholder={isSignUp ? '6자리 이상 입력' : '비밀번호 입력'}
              placeholderTextColor="#C7C7CC"
              value={password}
              onChangeText={t => { setPassword(t); setErrorMsg(''); }}
              secureTextEntry={!showPw}
              returnKeyType="done"
              onSubmitEditing={handleAuth}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowPw(v => !v)} style={styles.eyeBtn}>
              <Text style={styles.eyeIcon}>{showPw ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 에러 메시지 */}
        {!!errorMsg && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠ {errorMsg}</Text>
          </View>
        )}

        {/* 체크박스 행 + 비밀번호 찾기 (로그인 탭만) */}
        {!isSignUp && (
          <>
            <View style={styles.checkRow}>
              <TouchableOpacity
                style={styles.checkItem}
                onPress={() => setSaveEmail(v => !v)}
                activeOpacity={0.7}
                disabled={autoLogin}
              >
                <View style={[styles.checkbox, (saveEmail || autoLogin) && styles.checkboxOn]}>
                  {(saveEmail || autoLogin) && <Text style={styles.checkTick}>✓</Text>}
                </View>
                <Text style={[styles.checkLabel, autoLogin && { color: '#BBBBBB' }]}>이메일 저장</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.checkItem}
                onPress={() => toggleAutoLogin(!autoLogin)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, autoLogin && styles.checkboxOn]}>
                  {autoLogin && <Text style={styles.checkTick}>✓</Text>}
                </View>
                <Text style={styles.checkLabel}>자동 로그인</Text>
              </TouchableOpacity>
            </View>

            {/* 비밀번호 재설정 */}
            <TouchableOpacity
              style={styles.forgotBtn}
              onPress={handleResetPassword}
              activeOpacity={0.7}
            >
              <Text style={styles.forgotText}>비밀번호를 잊으셨나요?</Text>
            </TouchableOpacity>
          </>
        )}

        {/* 로그인/가입 버튼 */}
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleAuth}
          activeOpacity={0.85}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.buttonText}>{isSignUp ? '가입하기' : '로그인'}</Text>
          }
        </TouchableOpacity>

        {/* 모드 전환 */}
        <TouchableOpacity onPress={() => handleTabSwitch(!isSignUp)} style={styles.switchRow}>
          <Text style={styles.switchText}>
            {isSignUp ? '이미 계정이 있으신가요? ' : '아직 계정이 없으신가요? '}
            <Text style={styles.switchLink}>{isSignUp ? '로그인' : '회원가입'}</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ACCENT },

  topBg: {
    height: 280, backgroundColor: ACCENT,
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
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  logoEmoji: { fontSize: 34 },
  brand:     { fontSize: 32, fontWeight: 'bold', color: '#fff', letterSpacing: 1, marginBottom: 4 },
  tagline:   { fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },

  formScroll: {
    flex: 1, backgroundColor: '#F5F5F7',
    borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -20,
  },
  formContent: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 40 },

  tabRow: {
    flexDirection: 'row', backgroundColor: '#E9E9EE',
    borderRadius: 14, padding: 4, marginBottom: 24,
  },
  tabBtn:           { flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: 'center' },
  tabBtnActive:     { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  tabBtnText:       { fontSize: 15, fontWeight: '600', color: '#999' },
  tabBtnTextActive: { color: '#111' },

  fieldWrap:  { marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 7 },
  inputBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, borderWidth: 1.5, borderColor: '#EBEBEB', paddingHorizontal: 12,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  inputBoxError: { borderColor: ACCENT },
  inputIcon: { fontSize: 16, marginRight: 8 },
  input:     { flex: 1, paddingVertical: 14, fontSize: 15, color: '#111' },
  eyeBtn:    { padding: 6 },
  eyeIcon:   { fontSize: 17 },

  errorBox: {
    backgroundColor: '#FFF0EB', borderRadius: 10, padding: 10,
    marginBottom: 12, borderLeftWidth: 3, borderLeftColor: ACCENT,
  },
  errorText: { fontSize: 13, color: '#CC4400', fontWeight: '500' },

  checkRow:  { flexDirection: 'row', gap: 20, marginBottom: 4, marginTop: 4 },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  checkbox: {
    width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: '#DEDEDE',
    backgroundColor: '#F7F7F7', justifyContent: 'center', alignItems: 'center',
  },
  checkboxOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  checkTick:  { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  checkLabel: { fontSize: 13, color: '#555', fontWeight: '500' },

  forgotBtn:  { alignSelf: 'flex-end', marginBottom: 18, marginTop: 8 },
  forgotText: { fontSize: 13, color: ACCENT, fontWeight: '600' },

  button: {
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    shadowColor: ACCENT, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  buttonDisabled: { backgroundColor: '#FFBFA6', shadowOpacity: 0 },
  buttonText:     { color: '#fff', fontSize: 17, fontWeight: 'bold', letterSpacing: 0.3 },

  switchRow:  { marginTop: 20, alignItems: 'center' },
  switchText: { fontSize: 13, color: '#999' },
  switchLink: { color: ACCENT, fontWeight: '700' },
});
