import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert, KeyboardAvoidingView, Platform,
  RefreshControl, ActivityIndicator, Clipboard, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection, doc, getDoc, setDoc, addDoc,
  query, where, getDocs, arrayUnion, arrayRemove,
  deleteDoc, serverTimestamp,
  onSnapshot, orderBy, limit, documentId,
} from 'firebase/firestore';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import MapView, { Marker, MapPressEvent } from 'react-native-maps';
import { auth, db } from '../../firebase/config';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from '../../constants/cloudinary';

import { ACCENT, ACCENT_LIGHT } from '../../constants/colors';
import { fmtDateTime } from '../../constants/dateUtils';

const generateCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const AGE_OPTIONS = ['전체', '20대', '30대', '40대', '50대', '60대+'];
const GENDER_OPTIONS = ['전체', '남성만', '여성만'];
const MEMBER_OPTIONS = Array.from({ length: 39 }, (_, i) => i + 2);
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = ['00', '10', '20', '30', '40', '50'];
const REGIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];
const LEVEL_OPTIONS = ['초보', '중급', '고급'] as const;
const PACE_MIN_OPTIONS = ['4', '5', '6', '7', '8', '9', '10', '11', '12'];
const PACE_SEC_OPTIONS = ['00', '10', '20', '30', '40', '50'];
const DATE_FILTER_OPTIONS = ['전체', '오늘', '이번 주'] as const;
const DIST_FILTER_OPTIONS = ['전체', '~5km', '5~10km', '10km+'] as const;
const LEVEL_COLORS: Record<string, string> = { '초보': '#00C853', '중급': '#FF8C00', '고급': '#F44336' };

const makeDefaultForm = () => {
  const t = new Date();
  const h = String(t.getHours()).padStart(2, '0');
  const min = String(Math.floor(t.getMinutes() / 10) * 10).padStart(2, '0');
  const endT = new Date(t.getTime() + 2 * 60 * 60 * 1000);
  const endH = String(endT.getHours()).padStart(2, '0');
  const endMin = String(Math.floor(endT.getMinutes() / 10) * 10).padStart(2, '0');
  return {
    name: '', regionMain: '', regionDetail: '',
    startYear: String(t.getFullYear()),
    startMonth: String(t.getMonth() + 1),
    startDay: String(t.getDate()),
    startHour: h, startMin: min,
    endYear: String(endT.getFullYear()),
    endMonth: String(endT.getMonth() + 1),
    endDay: String(endT.getDate()),
    endHour: endH, endMin: endMin,
    maxMembers: 10, password: '', genderLimit: '전체',
    ageLimit: ['전체'] as string[],
    level: '중급', distanceKm: '', paceMin: '6', paceSec: '00', description: '',
  };
};

const getDday = (startDateTime: string) => {
  if (!startDateTime) return null;
  const s = new Date(startDateTime);
  const t = new Date();
  const startDay = new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime();
  const todayDay = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const diff = Math.round((startDay - todayDay) / 86400000);
  if (diff < 0) return '종료';
  if (diff === 0) return 'D-day';
  return `D-${diff}`;
};

const getStatus = (group: any) => {
  const now = Date.now();
  const start = new Date(group.startDateTime).getTime();
  const end = new Date(group.endDateTime).getTime();
  const isFull = (group.members?.length ?? 0) >= group.maxMembers;
  if (now > end)   return { label: '종료',   color: '#999999' };
  if (now >= start) return { label: '진행중', color: '#2979FF' };
  if (isFull)       return { label: '마감',   color: '#FF4040' };
  return              { label: '모집중', color: '#00C853' };
};

const fmtCardDate = (dt: string) => {
  if (!dt) return { date: '-', time: '-' };
  const d = new Date(dt);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return {
    date: `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`,
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
};

const validateDate = (y: string, m: string, d: string): boolean => {
  const yn = parseInt(y), mn = parseInt(m), dn = parseInt(d);
  if (!yn || !mn || !dn) return false;
  if (mn < 1 || mn > 12) return false;
  if (dn < 1 || dn > 31) return false;
  const dt = new Date(yn, mn - 1, dn);
  return dt.getFullYear() === yn && dt.getMonth() === mn - 1 && dt.getDate() === dn;
};

const formatChatTime = (ts: any) => {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// ─── 인라인 드롭다운 ─────────────────────────────────────────────
function InlineDropdown({ label, value, options, open, onToggle, onSelect, renderLabel }: any) {
  return (
    <View>
      <TouchableOpacity style={styles.selectBtn} onPress={onToggle}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: value !== '' && value !== null && value !== undefined ? '#222' : '#bbb', fontSize: 15 }}>
            {value !== '' && value !== null && value !== undefined
              ? (renderLabel ? renderLabel(value) : String(value))
              : label}
          </Text>
          <Text style={{ color: '#aaa', fontSize: 13 }}>{open ? '▲' : '▼'}</Text>
        </View>
      </TouchableOpacity>
      {open && (
        <View style={styles.dropdownList}>
          <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
            {options.map((opt: any) => (
              <TouchableOpacity key={String(opt)} style={styles.dropdownItem} onPress={() => onSelect(opt)}>
                <Text style={[styles.dropdownText, value === opt && styles.dropdownTextActive]}>
                  {renderLabel ? renderLabel(opt) : String(opt)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.label}>{text}</Text>;
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────
export default function GroupScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'mine' | 'all'>('all');
  const [myGroups, setMyGroups] = useState<any[]>([]);
  const [allGroups, setAllGroups] = useState<any[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [myProfile, setMyProfile] = useState<any>(null);
  const [createForm, setCreateForm] = useState(makeDefaultForm());
  const [editForm, setEditForm] = useState<any>(makeDefaultForm());
  const [openDropdown, setOpenDropdown] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 지도 (모달 내부 페이지 방식)
  const [showMapPage, setShowMapPage] = useState(false);
  const [mapTarget, setMapTarget] = useState<'create' | 'edit'>('create');
  const [pinnedCoord, setPinnedCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [pinnedAddress, setPinnedAddress] = useState('');
  const [mapRegion, setMapRegion] = useState<any>(null);
  const [createCoord, setCreateCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [editCoord, setEditCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [mapSearchText, setMapSearchText] = useState('');
  const [mapSearchResults, setMapSearchResults] = useState<any[]>([]);
  const [mapSearching, setMapSearching] = useState(false);
  const mapViewRef = useRef<any>(null);

  // 채팅
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatText, setChatText] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const chatUnsubRef = useRef<any>(null);
  const chatScrollRef = useRef<ScrollView>(null);

  // 초대 코드 입력
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [searchingCode, setSearchingCode] = useState(false);

  // 멤버 프로필
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [loadingMemberProfile, setLoadingMemberProfile] = useState(false);

  const [filterDate, setFilterDate] = useState<typeof DATE_FILTER_OPTIONS[number]>('전체');
  const [filterLevel, setFilterLevel] = useState('전체');
  const [filterDist, setFilterDist] = useState<typeof DIST_FILTER_OPTIONS[number]>('전체');
  const [photoUploading, setPhotoUploading] = useState(false);

  const userId = auth.currentUser?.uid;

  useEffect(() => {
    loadAll();
    return () => cleanupChat();
  }, []);

  const loadAll = async () => {
    await Promise.all([loadMyProfile(), loadMyGroups(), loadAllGroups()]);
    setLoadingGroups(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadMyGroups(), loadAllGroups()]);
    setRefreshing(false);
  };

  const loadMyProfile = async () => {
    if (!userId) return;
    const snap = await getDoc(doc(db, 'users', userId));
    if (snap.exists()) setMyProfile(snap.data());
  };

  const sortGroups = (list: any[]) => {
    const active = list
      .filter((g: any) => getStatus(g).label !== '종료')
      .sort((a: any, b: any) => new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime());
    const ended = list
      .filter((g: any) => getStatus(g).label === '종료')
      .sort((a: any, b: any) => new Date(b.endDateTime).getTime() - new Date(a.endDateTime).getTime());
    return [...active, ...ended];
  };

  const loadMyGroups = async () => {
    if (!userId) return;
    try {
      const snap = await getDocs(query(collection(db, 'groups'), where('members', 'array-contains', userId)));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMyGroups(sortGroups(list));
    } catch (e) { console.log('내 그룹 로드 오류:', e); }
  };

  const loadAllGroups = async () => {
    try {
      const snap = await getDocs(collection(db, 'groups'));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const sorted = sortGroups(list);
      setAllGroups(sorted.map((g, i) => ({ ...g, groupNo: i + 1 })));
    } catch (e) { console.log('전체 그룹 로드 오류:', e); }
  };

  // ─── 지도 주소 검색 ──────────────────────────────────────────
  const searchMapAddress = async () => {
    const q = mapSearchText.trim();
    if (!q) return;
    setMapSearching(true);
    setMapSearchResults([]);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&countrycodes=kr&limit=6&accept-language=ko`,
        { headers: { 'User-Agent': 'RunMateApp/1.0' } }
      );
      const data = await res.json();
      if (data.length === 0) Alert.alert('검색 결과 없음', '다른 검색어를 입력해보세요');
      setMapSearchResults(data);
    } catch {
      Alert.alert('검색 오류', '주소 검색에 실패했어요. 잠시 후 다시 시도해주세요');
    }
    setMapSearching(false);
  };

  const selectMapSearchResult = (result: any) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    const coord = { latitude: lat, longitude: lng };
    const parts = result.display_name.split(',');
    const label = parts.slice(0, 3).join(',').trim();
    setPinnedCoord(coord);
    setPinnedAddress(label);
    setMapSearchResults([]);
    setMapSearchText('');
    mapViewRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: 0.008, longitudeDelta: 0.008 },
      500
    );
  };

  const handleMapTap = async (e: MapPressEvent) => {
    const coord = e.nativeEvent.coordinate;
    setPinnedCoord(coord);
    setMapSearchResults([]);
    try {
      const addr = await Location.reverseGeocodeAsync(coord);
      if (addr.length > 0) {
        const a = addr[0];
        const label = [a.district, a.street, a.name].filter(Boolean).join(' ');
        setPinnedAddress(label || `${coord.latitude.toFixed(5)}, ${coord.longitude.toFixed(5)}`);
      }
    } catch {
      setPinnedAddress(`${coord.latitude.toFixed(5)}, ${coord.longitude.toFixed(5)}`);
    }
  };

  const moveToMyLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      mapViewRef.current?.animateToRegion(
        { latitude: loc.coords.latitude, longitude: loc.coords.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        500
      );
    } catch { /* ignore */ }
  };

  // ─── 지도 페이지 열기 ────────────────────────────────────────
  const openMapPageFor = async (target: 'create' | 'edit') => {
    setMapTarget(target);
    setMapSearchText('');
    setMapSearchResults([]);
    setPinnedAddress('');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        const coord = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setPinnedCoord(coord);
        setMapRegion({ ...coord, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      } else {
        const coord = { latitude: 37.5665, longitude: 126.9780 };
        setPinnedCoord(coord);
        setMapRegion({ ...coord, latitudeDelta: 0.05, longitudeDelta: 0.05 });
        Alert.alert('위치 권한 없음', '기기 설정에서 위치 권한을 허용하면 현재 위치가 자동으로 설정돼요.\n지금은 서울 중심으로 지도가 열려요.');
      }
    } catch {
      const coord = { latitude: 37.5665, longitude: 126.9780 };
      setPinnedCoord(coord);
      setMapRegion({ ...coord, latitudeDelta: 0.05, longitudeDelta: 0.05 });
    }
    setShowMapPage(true);
  };

  const confirmMapSelection = async () => {
    if (!pinnedCoord) { setShowMapPage(false); return; }
    let detail = pinnedAddress;
    if (!detail) {
      try {
        const addr = await Location.reverseGeocodeAsync(pinnedCoord);
        if (addr.length > 0) {
          const a = addr[0];
          detail = [a.district, a.street, a.name].filter(Boolean).join(' ');
        }
      } catch { /* ignore */ }
    }
    if (mapTarget === 'create') {
      setCreateForm((prev: any) => ({ ...prev, regionDetail: detail }));
      setCreateCoord({ lat: pinnedCoord.latitude, lng: pinnedCoord.longitude });
    } else {
      setEditForm((prev: any) => ({ ...prev, regionDetail: detail }));
      setEditCoord({ lat: pinnedCoord.latitude, lng: pinnedCoord.longitude });
    }
    setShowMapPage(false);
  };

  const toggleDropdown = (key: string) => setOpenDropdown(prev => prev === key ? '' : key);

  const normalizeAgeLimit = (raw: any): string[] => {
    if (Array.isArray(raw)) return raw.length === 0 ? ['전체'] : raw;
    if (typeof raw === 'string') return [raw];
    return ['전체'];
  };

  const buildDateTime = (y: string, m: string, d: string, h: string, min: string) => {
    const pad = (v: string) => v.padStart(2, '0');
    return `${y}-${pad(m)}-${pad(d)}T${h}:${min}:00`;
  };

  // ─── 그룹 생성 ───────────────────────────────────────────────
  const handleCreate = async () => {
    const f = createForm;
    if (!f.name.trim()) { Alert.alert('입력 오류', '그룹명을 입력해주세요'); return; }
    if (!f.regionMain) { Alert.alert('입력 오류', '시/도를 선택해주세요'); return; }
    if (!validateDate(f.startYear, f.startMonth, f.startDay)) {
      Alert.alert('입력 오류', '러닝 날짜가 올바르지 않아요'); return;
    }
    const startDT = buildDateTime(f.startYear, f.startMonth, f.startDay, f.startHour, f.startMin);
    const endDT = buildDateTime(
      f.endYear || f.startYear, f.endMonth || f.startMonth, f.endDay || f.startDay,
      f.endHour, f.endMin,
    );
    if (new Date(endDT) <= new Date(startDT)) {
      Alert.alert('입력 오류', '종료 시간이 시작 시간보다 빨라요'); return;
    }
    setSubmitting(true);
    try {
      let code = generateCode();
      const codeSnap = await getDocs(query(collection(db, 'groups'), where('code', '==', code)));
      if (!codeSnap.empty) code = generateCode();
      const region = `${f.regionMain} ${f.regionDetail}`.trim();
      await addDoc(collection(db, 'groups'), {
        name: f.name.trim(), region, regionMain: f.regionMain,
        startDateTime: startDT, endDateTime: endDT,
        maxMembers: f.maxMembers, password: f.password,
        genderLimit: f.genderLimit, ageLimit: normalizeAgeLimit(f.ageLimit),
        code, ownerId: userId, members: [userId], createdAt: serverTimestamp(),
        lat: createCoord?.lat ?? null, lng: createCoord?.lng ?? null,
        level: f.level || '중급',
        distanceKm: f.distanceKm ? parseFloat(f.distanceKm) : null,
        paceMin: f.paceMin || '', paceSec: f.paceSec || '00',
        description: f.description?.trim() || '',
      });
      setShowCreateModal(false);
      setCreateForm(makeDefaultForm());
      setCreateCoord(null);
      setActiveTab('mine');
      await Promise.all([loadMyGroups(), loadAllGroups()]);
      Alert.alert('그룹 생성 완료! 🎉', `초대코드: ${code}\n\n탭하면 코드를 복사해요`, [
        { text: '코드 복사', onPress: () => Clipboard.setString(code) },
        { text: '확인' },
      ]);
    } catch (e) {
      Alert.alert('오류', '그룹 생성에 실패했어요');
    }
    setSubmitting(false);
  };

  // ─── 그룹 수정 ───────────────────────────────────────────────
  const handleEdit = async () => {
    if (!editForm || !selectedGroup) return;
    const f = editForm;
    if (!f.name.trim()) { Alert.alert('입력 오류', '그룹명을 입력해주세요'); return; }
    if (!validateDate(f.startYear, f.startMonth, f.startDay)) {
      Alert.alert('입력 오류', '러닝 날짜가 올바르지 않아요'); return;
    }
    if (!validateDate(f.endYear, f.endMonth, f.endDay)) {
      Alert.alert('입력 오류', '종료 날짜가 올바르지 않아요'); return;
    }
    const startDT = buildDateTime(f.startYear, f.startMonth, f.startDay, f.startHour, f.startMin);
    const endDT = buildDateTime(f.endYear, f.endMonth, f.endDay, f.endHour, f.endMin);
    if (new Date(endDT) <= new Date(startDT)) {
      Alert.alert('입력 오류', '종료 시간이 시작 시간보다 빨라요'); return;
    }
    setSubmitting(true);
    try {
      const region = `${f.regionMain} ${f.regionDetail}`.trim();
      await setDoc(doc(db, 'groups', selectedGroup.id), {
        ...selectedGroup, name: f.name.trim(), region,
        regionMain: f.regionMain, startDateTime: startDT, endDateTime: endDT,
        maxMembers: f.maxMembers, password: f.password,
        genderLimit: f.genderLimit, ageLimit: normalizeAgeLimit(f.ageLimit),
        lat: editCoord?.lat ?? selectedGroup.lat ?? null,
        lng: editCoord?.lng ?? selectedGroup.lng ?? null,
        level: f.level || '중급',
        distanceKm: f.distanceKm ? parseFloat(f.distanceKm) : null,
        paceMin: f.paceMin || '', paceSec: f.paceSec || '00',
        description: f.description?.trim() || '',
      }, { merge: true });
      setShowEditModal(false);
      setEditCoord(null);
      await Promise.all([loadMyGroups(), loadAllGroups()]);
      Alert.alert('수정 완료!');
    } catch (e) {
      Alert.alert('오류', '수정에 실패했어요');
    }
    setSubmitting(false);
  };

  const checkJoinEligibility = (group: any) => {
    if (!myProfile) return { ok: false, reason: '프로필을 먼저 설정해주세요' };
    if (group.genderLimit !== '전체') {
      const required = group.genderLimit === '남성만' ? '남성' : '여성';
      if (myProfile.gender !== required) return { ok: false, reason: `${group.genderLimit} 참여 가능` };
    }
    const ageLimits = normalizeAgeLimit(group.ageLimit);
    if (!ageLimits.includes('전체')) {
      const age = parseInt(myProfile.age);
      const map: { [k: string]: [number, number] } = {
        '20대': [20, 29], '30대': [30, 39], '40대': [40, 49], '50대': [50, 59], '60대+': [60, 999],
      };
      const ok = ageLimits.some((a: string) => {
        const [min, max] = map[a] || [0, 999];
        return age >= min && age <= max;
      });
      if (!ok) return { ok: false, reason: `${ageLimits.join('/')} 참여 가능` };
    }
    if (group.members.length >= group.maxMembers) return { ok: false, reason: '인원 가득 참' };
    if (group.members.includes(userId)) return { ok: false, reason: '이미 참여 중' };
    return { ok: true, reason: '' };
  };

  const handleJoin = async (group: any) => {
    const { ok, reason } = checkJoinEligibility(group);
    if (!ok) { Alert.alert('참여 불가', reason); return; }
    if (group.password && group.password !== joinPassword) {
      Alert.alert('오류', '비밀번호가 틀렸어요'); return;
    }
    try {
      await setDoc(doc(db, 'groups', group.id), { members: arrayUnion(userId) }, { merge: true });
      Alert.alert('가입 완료! 🎉', `${group.name} 그룹에 합류했어요!`);
      setJoinPassword('');
      setShowDetailModal(false);
      setSelectedGroup(null);
      cleanupChat();
      await Promise.all([loadMyGroups(), loadAllGroups()]);
    } catch (e) { Alert.alert('오류', '그룹 참여에 실패했어요'); }
  };

  // ─── 그룹 탈퇴 ──────────────────────────────────────────────
  const handleLeave = (group: any) => {
    Alert.alert(
      '그룹 탈퇴',
      `${group.name}에서 탈퇴할까요?\n탈퇴 후 재참여가 가능해요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '탈퇴', style: 'destructive',
          onPress: async () => {
            try {
              await setDoc(doc(db, 'groups', group.id), { members: arrayRemove(userId) }, { merge: true });
              closeDetailModal();
              await Promise.all([loadMyGroups(), loadAllGroups()]);
            } catch {
              Alert.alert('오류', '탈퇴에 실패했어요. 다시 시도해주세요');
            }
          },
        },
      ]
    );
  };

  // ─── 그룹 삭제 ──────────────────────────────────────────────
  const handleDelete = (group: any) => {
    Alert.alert(
      '그룹 삭제',
      `"${group.name}" 그룹을 삭제할까요?\n삭제된 그룹과 채팅은 복구되지 않아요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제', style: 'destructive',
          onPress: async () => {
            try {
              // 채팅 메시지 일괄 삭제
              const msgsSnap = await getDocs(collection(db, 'groups', group.id, 'messages'));
              await Promise.all(msgsSnap.docs.map(d => deleteDoc(d.ref)));
              // 그룹 문서 삭제
              await deleteDoc(doc(db, 'groups', group.id));
              closeDetailModal();
              await Promise.all([loadMyGroups(), loadAllGroups()]);
            } catch {
              Alert.alert('오류', '삭제에 실패했어요. 다시 시도해주세요');
            }
          },
        },
      ]
    );
  };

  // ─── 초대 코드로 그룹 찾기 ──────────────────────────────────
  const handleJoinByCode = async () => {
    const code = codeInput.trim().toUpperCase();
    if (code.length !== 6) {
      Alert.alert('입력 오류', '초대 코드는 6자리예요');
      return;
    }
    setSearchingCode(true);
    try {
      const snap = await getDocs(query(collection(db, 'groups'), where('code', '==', code)));
      if (snap.empty) {
        Alert.alert('찾을 수 없음', '해당 코드의 그룹이 없어요.\n코드를 다시 확인해주세요.');
        setSearchingCode(false);
        return;
      }
      const groupDoc = snap.docs[0];
      const group = { id: groupDoc.id, ...groupDoc.data() };
      setShowCodeModal(false);
      setCodeInput('');
      // 그룹 번호 붙이기 (전체 목록에서 인덱스 찾기)
      const idx = allGroups.findIndex((g: any) => g.id === groupDoc.id);
      const groupWithNo = { ...group, groupNo: idx >= 0 ? allGroups[idx].groupNo : '-' };
      await openGroupDetail(groupWithNo);
    } catch {
      Alert.alert('오류', '그룹을 찾는 중 오류가 발생했어요');
    }
    setSearchingCode(false);
  };

  // ─── 채팅 ────────────────────────────────────────────────────
  const cleanupChat = () => {
    if (chatUnsubRef.current) {
      chatUnsubRef.current();
      chatUnsubRef.current = null;
    }
    setChatMessages([]);
    setChatText('');
  };

  const setupChatListener = (groupId: string) => {
    cleanupChat();
    const msgsQ = query(
      collection(db, 'groups', groupId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(100)
    );
    chatUnsubRef.current = onSnapshot(msgsQ, (snap) => {
      setChatMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
    });
  };

  const sendChat = async () => {
    if (!chatText.trim() || !selectedGroup || sendingChat) return;
    setSendingChat(true);
    try {
      await addDoc(collection(db, 'groups', selectedGroup.id, 'messages'), {
        userId,
        nickname: myProfile?.nickname || '익명',
        text: chatText.trim(),
        createdAt: serverTimestamp(),
      });
      setChatText('');
    } catch { /* ignore */ }
    setSendingChat(false);
  };

  // ─── 그룹 상세 열기 ──────────────────────────────────────────
  const openGroupDetail = async (group: any) => {
    setLoadingDetail(true);
    setShowDetailModal(true);
    try {
      const meetupDate = group.startDateTime
        ? group.startDateTime.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const isPast = group.startDateTime
        ? new Date(group.startDateTime) < new Date()
        : false;

      const memberUids: string[] = group.members;
      const profileMap: Record<string, any> = {};
      const runMap: Record<string, number> = {};
      if (memberUids.length > 0) {
        const chunks: string[][] = [];
        for (let i = 0; i < memberUids.length; i += 30) chunks.push(memberUids.slice(i, i + 30));
        const [profileSnaps, runSnaps] = await Promise.all([
          Promise.all(chunks.map(c => getDocs(query(collection(db, 'users'), where(documentId(), 'in', c))))),
          Promise.all(chunks.map(c => getDocs(query(
            collection(db, 'runningRecords'), where('userId', 'in', c), where('date', '==', meetupDate),
          )))),
        ]);
        profileSnaps.forEach(s => s.docs.forEach(d => { profileMap[d.id] = d.data(); }));
        runSnaps.forEach(s => s.docs.forEach(d => {
          const data = d.data();
          runMap[data.userId] = (runMap[data.userId] || 0) + (data.distanceKm || 0);
        }));
      }
      const memberDetails = memberUids.map((uid: string) => {
        const profile = profileMap[uid] || {};
        const meetupKm = runMap[uid] || 0;
        return {
          uid,
          nickname: profile.nickname || '익명',
          age: profile.age || '-',
          gender: profile.gender || '-',
          region: profile.region || '-',
          todayKm: parseFloat(meetupKm.toFixed(2)),
          isMe: uid === userId,
          isOwner: uid === group.ownerId,
          completed: meetupKm > 0,
        };
      });
      memberDetails.sort((a, b) => b.todayKm - a.todayKm);

      // 대기자 프로필 로드
      const waitlistUids: string[] = group.waitlist || [];
      const waitProfileMap: Record<string, any> = {};
      if (waitlistUids.length > 0) {
        const chunks: string[][] = [];
        for (let i = 0; i < waitlistUids.length; i += 30) chunks.push(waitlistUids.slice(i, i + 30));
        const snaps = await Promise.all(
          chunks.map(c => getDocs(query(collection(db, 'users'), where(documentId(), 'in', c))))
        );
        snaps.forEach(s => s.docs.forEach(d => { waitProfileMap[d.id] = d.data(); }));
      }
      const waitlistDetails = waitlistUids.map((uid: string) => ({
        uid,
        nickname: (waitProfileMap[uid] || {}).nickname || '익명',
        isMe: uid === userId,
      }));

      setSelectedGroup({ ...group, memberDetails, waitlistDetails, isPast, meetupDate });
      setupChatListener(group.id);
    } catch (e) { console.log('그룹 상세 오류:', e); }
    setLoadingDetail(false);
  };

  const closeDetailModal = () => {
    setShowDetailModal(false);
    setSelectedGroup(null);
    setSelectedMember(null);
    cleanupChat();
  };

  // ─── 멤버 프로필 열기 ────────────────────────────────────────
  const openMemberProfile = async (member: any) => {
    setSelectedMember({ ...member, totalRuns: null, totalKm: null });
    setLoadingMemberProfile(true);
    try {
      const userDoc = await getDoc(doc(db, 'users', member.uid));
      const profile = userDoc.exists() ? userDoc.data() : {};
      const runSnap = await getDocs(query(collection(db, 'runningRecords'), where('userId', '==', member.uid)));
      const totalRuns = runSnap.size;
      const totalKm = runSnap.docs.reduce((sum, d) => sum + (d.data().distanceKm || 0), 0);
      setSelectedMember((prev: any) => ({
        ...prev, ...profile,
        totalRuns,
        totalKm: totalKm.toFixed(1),
      }));
    } catch { /* ignore */ }
    setLoadingMemberProfile(false);
  };

  // ─── 대기자 관련 ─────────────────────────────────────────────
  const handleJoinWaitlist = async (group: any) => {
    try {
      await setDoc(doc(db, 'groups', group.id), { waitlist: arrayUnion(userId) }, { merge: true });
      Alert.alert('대기 신청 완료', '자리가 생기면 방장이 승인할 수 있어요');
      closeDetailModal();
      await Promise.all([loadMyGroups(), loadAllGroups()]);
    } catch { Alert.alert('오류', '대기 신청에 실패했어요'); }
  };

  const handleLeaveWaitlist = async (group: any) => {
    Alert.alert('대기 취소', '대기 신청을 취소할까요?', [
      { text: '아니요', style: 'cancel' },
      {
        text: '취소하기', style: 'destructive', onPress: async () => {
          try {
            await setDoc(doc(db, 'groups', group.id), { waitlist: arrayRemove(userId) }, { merge: true });
            closeDetailModal();
            await Promise.all([loadMyGroups(), loadAllGroups()]);
          } catch { Alert.alert('오류', '대기 취소에 실패했어요'); }
        },
      },
    ]);
  };

  const handlePromoteFromWaitlist = (group: any, targetUid: string, targetNickname: string) => {
    Alert.alert(
      `${targetNickname}님 승인`,
      '인원을 확대하고 참가 승인을 할까요?',
      [
        {
          text: '승인',
          onPress: async () => {
            try {
              await setDoc(doc(db, 'groups', group.id), {
                members: arrayUnion(targetUid),
                waitlist: arrayRemove(targetUid),
                maxMembers: (group.maxMembers ?? selectedGroup?.maxMembers ?? 10) + 1,
              }, { merge: true });
              const freshSnap = await getDoc(doc(db, 'groups', group.id));
              if (freshSnap.exists()) await openGroupDetail({ id: group.id, ...freshSnap.data(), groupNo: group.groupNo });
            } catch { Alert.alert('오류', '승인에 실패했어요'); }
          },
        },
        { text: '취소', style: 'cancel' },
      ]
    );
  };

  // ─── 모임 사진 ───────────────────────────────────────────────
  const uploadGroupPhoto = async () => {
    if (!selectedGroup || !userId) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요해요'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    setPhotoUploading(true);
    try {
      const uri = result.assets[0].uri;
      const filename = uri.split('/').pop() ?? 'photo.jpg';
      const formData = new FormData();
      formData.append('file', { uri, type: 'image/jpeg', name: filename } as any);
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      formData.append('folder', `runmate/groups/${selectedGroup.id}`);
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        { method: 'POST', body: formData }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Upload failed');
      const updatedPhotos = [...(selectedGroup.groupPhotos || []), data.secure_url];
      await setDoc(doc(db, 'groups', selectedGroup.id), { groupPhotos: updatedPhotos }, { merge: true });
      setSelectedGroup((prev: any) => ({ ...prev, groupPhotos: updatedPhotos }));
    } catch (e: any) {
      Alert.alert('업로드 실패', e?.message ?? '사진 업로드에 실패했어요');
    }
    setPhotoUploading(false);
  };

  const deleteGroupPhoto = (photoIndex: number) => {
    Alert.alert('사진 삭제', '이 사진을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive', onPress: async () => {
          if (!selectedGroup) return;
          const updatedPhotos = (selectedGroup.groupPhotos || []).filter((_: any, i: number) => i !== photoIndex);
          await setDoc(doc(db, 'groups', selectedGroup.id), { groupPhotos: updatedPhotos }, { merge: true });
          setSelectedGroup((prev: any) => ({ ...prev, groupPhotos: updatedPhotos }));
        },
      },
    ]);
  };

  // ─── 수정 모달 열기 ──────────────────────────────────────────
  const openEditModal = (group: any) => {
    const parseDateTime = (dt: string) => {
      if (!dt) return { y: '', m: '', d: '', h: '06', min: '00' };
      const date = new Date(dt);
      return {
        y: String(date.getFullYear()), m: String(date.getMonth() + 1),
        d: String(date.getDate()), h: String(date.getHours()).padStart(2, '0'),
        min: String(date.getMinutes()).padStart(2, '0'),
      };
    };
    const start = parseDateTime(group.startDateTime);
    const end = parseDateTime(group.endDateTime);
    setEditForm({
      name: group.name, regionMain: group.regionMain || '',
      regionDetail: group.region?.replace(group.regionMain || '', '').trim() || '',
      startYear: start.y, startMonth: start.m, startDay: start.d,
      startHour: start.h, startMin: start.min,
      endYear: end.y, endMonth: end.m, endDay: end.d,
      endHour: end.h, endMin: end.min,
      maxMembers: group.maxMembers, password: group.password || '',
      genderLimit: group.genderLimit || '전체',
      ageLimit: normalizeAgeLimit(group.ageLimit),
      level: group.level || '중급',
      distanceKm: group.distanceKm ? String(group.distanceKm) : '',
      paceMin: group.paceMin || '6', paceSec: group.paceSec || '00',
      description: group.description || '',
    });
    if (group.lat && group.lng) setEditCoord({ lat: group.lat, lng: group.lng });
    setOpenDropdown('');
    setShowMapPage(false);
    setShowDetailModal(false);
    setTimeout(() => setShowEditModal(true), 300);
  };


  const formatAgeLimitDisplay = (ageLimit: any) => normalizeAgeLimit(ageLimit).join(' · ');
  const isMember = (group: any) => group.members?.includes(userId);
  const isOwner = (group: any) => group.ownerId === userId;

  const filteredGroups = useMemo(() => {
    let list = activeTab === 'mine' ? myGroups : allGroups;
    if (filterDate === '오늘') {
      const today = new Date().toDateString();
      list = list.filter((g: any) => new Date(g.startDateTime).toDateString() === today);
    } else if (filterDate === '이번 주') {
      const weekEnd = new Date(Date.now() + 7 * 86400000);
      list = list.filter((g: any) => new Date(g.startDateTime) <= weekEnd);
    }
    if (filterLevel !== '전체') list = list.filter((g: any) => g.level === filterLevel);
    if (filterDist !== '전체') {
      list = list.filter((g: any) => {
        const km = parseFloat(g.distanceKm) || 0;
        if (filterDist === '~5km')   return km > 0 && km <= 5;
        if (filterDist === '5~10km') return km > 5 && km <= 10;
        if (filterDist === '10km+')  return km > 10;
        return true;
      });
    }
    if (searchText) {
      list = list.filter((g: any) =>
        g.name?.includes(searchText) ||
        g.region?.includes(searchText) ||
        String(g.groupNo)?.includes(searchText)
      );
    }
    return list;
  }, [activeTab, myGroups, allGroups, filterDate, filterLevel, filterDist, searchText]);

  // ─── 지도 페이지 렌더 ────────────────────────────────────────
  const renderMapPage = () => (
    <View style={{ flex: 1 }}>
      {/* 헤더 */}
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={() => setShowMapPage(false)}>
          <Text style={styles.modalHeaderCancel}>← 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.modalHeaderTitle}>러닝 장소 선택</Text>
        <TouchableOpacity
          onPress={confirmMapSelection}
          style={[styles.mapConfirmBtn, !pinnedCoord && { opacity: 0.4 }]}
          disabled={!pinnedCoord}
        >
          <Text style={styles.mapConfirmBtnText}>✓ 확정</Text>
        </TouchableOpacity>
      </View>

      {/* 검색바 */}
      <View style={styles.mapSearchBar}>
        <TextInput
          style={styles.mapSearchInput}
          placeholder="장소명 또는 주소 검색 (예: 한강공원)"
          placeholderTextColor="#bbb"
          value={mapSearchText}
          onChangeText={setMapSearchText}
          onSubmitEditing={searchMapAddress}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <TouchableOpacity style={styles.mapSearchBtn} onPress={searchMapAddress} disabled={mapSearching}>
          {mapSearching
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.mapSearchBtnText}>검색</Text>}
        </TouchableOpacity>
      </View>

      {/* 검색 결과 드롭다운 */}
      {mapSearchResults.length > 0 && (
        <View style={styles.mapSearchResults}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 220 }}>
            {mapSearchResults.map((r: any, i: number) => {
              const parts = r.display_name.split(',');
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.mapSearchResultItem, i < mapSearchResults.length - 1 && styles.mapSearchResultDivider]}
                  onPress={() => selectMapSearchResult(r)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.mapSearchResultIcon}>📍</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mapSearchResultTitle} numberOfLines={1}>{parts[0]?.trim()}</Text>
                    <Text style={styles.mapSearchResultSub} numberOfLines={1}>{parts.slice(1, 4).join(',').trim()}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* 지도 */}
      <View style={{ flex: 1, position: 'relative' }}>
        {mapRegion ? (
          <MapView
            ref={mapViewRef}
            style={{ flex: 1 }}
            initialRegion={mapRegion}
            onPress={handleMapTap}
            showsUserLocation
            showsMyLocationButton={false}
            showsCompass
          >
            {pinnedCoord && (
              <Marker coordinate={pinnedCoord} pinColor={ACCENT} title="러닝 장소" description={pinnedAddress} />
            )}
          </MapView>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={ACCENT} size="large" />
            <Text style={{ color: '#999', marginTop: 8 }}>지도 불러오는 중...</Text>
          </View>
        )}

        {/* 내 위치 버튼 */}
        <TouchableOpacity style={styles.myLocBtn} onPress={moveToMyLocation} activeOpacity={0.85}>
          <Text style={styles.myLocBtnText}>⊙ 내 위치</Text>
        </TouchableOpacity>

        {/* 힌트 (핀 없을 때만) */}
        {!pinnedCoord && mapRegion && (
          <View style={styles.mapFloatHint}>
            <Text style={styles.mapFloatHintText}>지도를 탭하거나 위에서 주소를 검색하세요</Text>
          </View>
        )}
      </View>

      {/* 선택된 주소 하단 바 */}
      {pinnedCoord && (
        <View style={styles.mapSelectedBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.mapSelectedLabel}>선택한 장소</Text>
            <Text style={styles.mapSelectedAddr} numberOfLines={2}>{pinnedAddress || `${pinnedCoord.latitude.toFixed(5)}, ${pinnedCoord.longitude.toFixed(5)}`}</Text>
          </View>
          <TouchableOpacity style={styles.mapConfirmBarBtn} onPress={confirmMapSelection} activeOpacity={0.85}>
            <Text style={styles.mapConfirmBarBtnText}>이 위치로 설정</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  // ─── 공통 폼 렌더 ────────────────────────────────────────────
  const renderForm = (form: any, setForm: any, prefix: string) => {
    const ageLimitArr = normalizeAgeLimit(form.ageLimit);
    const handleAgeToggle = (a: string) => {
      if (a === '전체') { setForm({ ...form, ageLimit: ['전체'] }); return; }
      const current = ageLimitArr.filter((x: string) => x !== '전체');
      const next = current.includes(a) ? current.filter((x: string) => x !== a) : [...current, a];
      setForm({ ...form, ageLimit: next.length === 0 ? ['전체'] : next });
    };

    return (
      <View>
        <SectionLabel text="그룹명 *" />
        <TextInput
          style={styles.input}
          placeholder="예: 마포 새벽 러닝크루"
          placeholderTextColor="#ccc"
          value={form.name}
          onChangeText={v => setForm({ ...form, name: v })}
        />

        <SectionLabel text="시/도 *" />
        <InlineDropdown
          label="시/도 선택"
          value={form.regionMain}
          options={REGIONS}
          open={openDropdown === `${prefix}_region`}
          onToggle={() => toggleDropdown(`${prefix}_region`)}
          onSelect={(v: string) => { setForm({ ...form, regionMain: v }); setOpenDropdown(''); }}
        />

        <SectionLabel text="상세 위치" />
        <View style={styles.locationRow}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="예: 한강공원 반포지구"
            placeholderTextColor="#ccc"
            value={form.regionDetail}
            onChangeText={v => setForm({ ...form, regionDetail: v })}
          />
          <TouchableOpacity
            style={styles.locationBtn}
            onPress={() => openMapPageFor(prefix as 'create' | 'edit')}
          >
            <Text style={styles.locationBtnText}>🗺 지도선택</Text>
          </TouchableOpacity>
        </View>

        <SectionLabel text="러닝 날짜 *" />
        <View style={styles.dateRow}>
          <TextInput
            style={[styles.input, styles.yearInput]}
            placeholder="년도"
            placeholderTextColor="#ccc"
            value={form.startYear}
            keyboardType="numeric"
            maxLength={4}
            onChangeText={v => {
              const val = v.replace(/[^0-9]/g, '');
              setForm({ ...form, startYear: val, endYear: val });
            }}
          />
          <Text style={styles.dateSep}>/</Text>
          <TextInput
            style={[styles.input, styles.smallInput]}
            placeholder="월"
            placeholderTextColor="#ccc"
            value={form.startMonth}
            keyboardType="numeric"
            maxLength={2}
            onChangeText={v => {
              const val = v.replace(/[^0-9]/g, '');
              setForm({ ...form, startMonth: val, endMonth: val });
            }}
          />
          <Text style={styles.dateSep}>/</Text>
          <TextInput
            style={[styles.input, styles.smallInput]}
            placeholder="일"
            placeholderTextColor="#ccc"
            value={form.startDay}
            keyboardType="numeric"
            maxLength={2}
            onChangeText={v => {
              const val = v.replace(/[^0-9]/g, '');
              setForm({ ...form, startDay: val, endDay: val });
            }}
          />
        </View>

        <SectionLabel text="시작 시간 *" />
        <View style={styles.timeRow}>
          <View style={{ flex: 1 }}>
            <InlineDropdown
              label="시" value={form.startHour} options={HOURS}
              open={openDropdown === `${prefix}_startHour`}
              onToggle={() => toggleDropdown(`${prefix}_startHour`)}
              onSelect={(v: string) => { setForm({ ...form, startHour: v }); setOpenDropdown(''); }}
              renderLabel={(v: string) => `${v}시`}
            />
          </View>
          <Text style={styles.dateSep}>:</Text>
          <View style={{ flex: 1 }}>
            <InlineDropdown
              label="분" value={form.startMin} options={MINUTES}
              open={openDropdown === `${prefix}_startMin`}
              onToggle={() => toggleDropdown(`${prefix}_startMin`)}
              onSelect={(v: string) => { setForm({ ...form, startMin: v }); setOpenDropdown(''); }}
              renderLabel={(v: string) => `${v}분`}
            />
          </View>
        </View>

        <SectionLabel text="종료 시간" />
        <View style={styles.timeRow}>
          <View style={{ flex: 1 }}>
            <InlineDropdown
              label="시" value={form.endHour} options={HOURS}
              open={openDropdown === `${prefix}_endHour`}
              onToggle={() => toggleDropdown(`${prefix}_endHour`)}
              onSelect={(v: string) => { setForm({ ...form, endHour: v }); setOpenDropdown(''); }}
              renderLabel={(v: string) => `${v}시`}
            />
          </View>
          <Text style={styles.dateSep}>:</Text>
          <View style={{ flex: 1 }}>
            <InlineDropdown
              label="분" value={form.endMin} options={MINUTES}
              open={openDropdown === `${prefix}_endMin`}
              onToggle={() => toggleDropdown(`${prefix}_endMin`)}
              onSelect={(v: string) => { setForm({ ...form, endMin: v }); setOpenDropdown(''); }}
              renderLabel={(v: string) => `${v}분`}
            />
          </View>
        </View>

        <SectionLabel text="최대 인원 *" />
        <InlineDropdown
          label="인원 선택" value={form.maxMembers} options={MEMBER_OPTIONS}
          open={openDropdown === `${prefix}_members`}
          onToggle={() => toggleDropdown(`${prefix}_members`)}
          onSelect={(v: number) => { setForm({ ...form, maxMembers: v }); setOpenDropdown(''); }}
          renderLabel={(v: number) => `${v}명`}
        />

        <SectionLabel text="성별 제한" />
        <View style={styles.chipRow}>
          {GENDER_OPTIONS.map(g => (
            <TouchableOpacity
              key={g}
              style={[styles.chip, form.genderLimit === g && styles.chipActive]}
              onPress={() => setForm({ ...form, genderLimit: g })}
            >
              <Text style={[styles.chipText, form.genderLimit === g && styles.chipTextActive]}>{g}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <SectionLabel text="연령대 제한 (복수 선택 가능)" />
        <View style={styles.chipRow}>
          {AGE_OPTIONS.map(a => {
            const selected = ageLimitArr.includes(a);
            return (
              <TouchableOpacity
                key={a}
                style={[styles.chip, selected && styles.chipActive]}
                onPress={() => handleAgeToggle(a)}
              >
                <Text style={[styles.chipText, selected && styles.chipTextActive]}>{a}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <SectionLabel text="난이도" />
        <View style={styles.chipRow}>
          {LEVEL_OPTIONS.map(l => (
            <TouchableOpacity
              key={l}
              style={[styles.chip, form.level === l && styles.chipActive]}
              onPress={() => setForm({ ...form, level: l })}
            >
              <Text style={[styles.chipText, form.level === l && styles.chipTextActive]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <SectionLabel text="예상 거리 (km)" />
        <TextInput
          style={styles.input}
          placeholder="예: 5"
          placeholderTextColor="#ccc"
          value={form.distanceKm}
          onChangeText={v => setForm({ ...form, distanceKm: v.replace(/[^0-9.]/g, '') })}
          keyboardType="decimal-pad"
          maxLength={5}
        />

        <SectionLabel text="예상 페이스 (분/km)" />
        <View style={styles.timeRow}>
          <View style={{ flex: 1 }}>
            <InlineDropdown
              label="분" value={form.paceMin} options={PACE_MIN_OPTIONS}
              open={openDropdown === `${prefix}_paceMin`}
              onToggle={() => toggleDropdown(`${prefix}_paceMin`)}
              onSelect={(v: string) => { setForm({ ...form, paceMin: v }); setOpenDropdown(''); }}
              renderLabel={(v: string) => `${v}분`}
            />
          </View>
          <Text style={styles.dateSep}>'</Text>
          <View style={{ flex: 1 }}>
            <InlineDropdown
              label="초" value={form.paceSec} options={PACE_SEC_OPTIONS}
              open={openDropdown === `${prefix}_paceSec`}
              onToggle={() => toggleDropdown(`${prefix}_paceSec`)}
              onSelect={(v: string) => { setForm({ ...form, paceSec: v }); setOpenDropdown(''); }}
              renderLabel={(v: string) => `${v}초`}
            />
          </View>
          <Text style={[styles.dateSep, { fontSize: 13 }]}>/km</Text>
        </View>

        <SectionLabel text="모임 소개" />
        <TextInput
          style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
          placeholder="모임에 대해 자유롭게 소개해주세요"
          placeholderTextColor="#ccc"
          value={form.description}
          onChangeText={v => setForm({ ...form, description: v })}
          multiline
          maxLength={200}
        />

        <SectionLabel text="비밀번호 (선택)" />
        <TextInput
          style={styles.input}
          placeholder="없으면 비워두세요"
          placeholderTextColor="#ccc"
          value={form.password}
          onChangeText={v => setForm({ ...form, password: v })}
          secureTextEntry
        />
      </View>
    );
  };

  // ─── 그룹 카드 ───────────────────────────────────────────────
  const renderGroupCard = (g: any) => {
    const ageLimitDisplay = formatAgeLimitDisplay(g.ageLimit);
    const memberRatio = Math.min(g.members.length / g.maxMembers, 1);
    const isFull = memberRatio >= 1;
    const isAlmostFull = memberRatio >= 0.8 && !isFull;
    const dday = getDday(g.startDateTime);
    const status = getStatus(g);
    const { date: cardDate, time: cardTime } = fmtCardDate(g.startDateTime);
    const levelColor = LEVEL_COLORS[g.level] ?? ACCENT;

    const isEnded = status.label === '종료';

    return (
      <TouchableOpacity
        key={g.id}
        style={[styles.groupCard, isEnded && styles.groupCardEnded]}
        onPress={() => openGroupDetail(g)}
        activeOpacity={0.85}
      >
        {/* 상단: 상태 + D-day + 번호/뱃지 */}
        <View style={styles.cardTopRow}>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <View style={[styles.statusBadge, { backgroundColor: status.color + '22' }]}>
              <Text style={[styles.statusBadgeText, { color: status.color }]}>{status.label}</Text>
            </View>
            {dday && dday !== '종료' && dday !== 'D-day' && (
              <Text style={styles.ddayText}>{dday}</Text>
            )}
            {dday === 'D-day' && (
              <View style={styles.ddayTodayBadge}>
                <Text style={styles.ddayTodayText}>오늘!</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            {isMember(g) && <View style={styles.badge}><Text style={styles.badgeText}>✓ 참여중</Text></View>}
            {isOwner(g) && <View style={[styles.badge, styles.badgeOwner]}><Text style={[styles.badgeText, styles.badgeOwnerText]}>👑</Text></View>}
            <Text style={styles.groupNoText}>#{g.groupNo}</Text>
          </View>
        </View>

        {/* 날짜/시간 히어로 */}
        <View style={styles.cardDateRow}>
          <Text style={[styles.cardDateText, isEnded && { color: '#AAAAAA' }]}>{cardDate}</Text>
          <Text style={[styles.cardTimeText, isEnded && { color: '#BBBBBB' }]}>{cardTime}</Text>
          <Text style={{ fontSize: 15, marginLeft: 4, opacity: isEnded ? 0.4 : 1 }}>{g.password ? '🔒' : '🔓'}</Text>
        </View>

        {/* 그룹명 */}
        <Text style={[styles.groupName, isEnded && { color: '#999999' }]} numberOfLines={1}>{g.name}</Text>

        {/* 위치 */}
        <View style={[styles.groupInfoItem, { marginBottom: 8 }]}>
          <Text style={[styles.groupInfoIcon, isEnded && { opacity: 0.4 }]}>📍</Text>
          <Text style={[styles.groupInfoText, isEnded && { color: '#AAAAAA' }]} numberOfLines={1}>{g.region}</Text>
        </View>

        {/* 난이도 · 거리 · 페이스 */}
        <View style={styles.cardMetaRow}>
          {g.level && (
            <View style={[styles.levelBadge, isEnded ? { backgroundColor: '#EEEEEE' } : { backgroundColor: levelColor + '18' }]}>
              <Text style={[styles.levelBadgeText, isEnded ? { color: '#AAAAAA' } : { color: levelColor }]}>{g.level}</Text>
            </View>
          )}
          {g.distanceKm && <Text style={[styles.cardMetaText, isEnded && { color: '#AAAAAA' }]}>🏃 {g.distanceKm}km</Text>}
          {g.paceMin && <Text style={[styles.cardMetaText, isEnded && { color: '#AAAAAA' }]}>⏱ {g.paceMin}'{g.paceSec || '00'}"/km</Text>}
        </View>

        {/* 멤버바 */}
        <View style={styles.memberBarSection}>
          <View style={styles.memberBarTrack}>
            <View style={[
              styles.memberBarFill,
              isEnded ? { backgroundColor: '#CCCCCC' } : isFull ? styles.memberBarFull : isAlmostFull ? styles.memberBarAlmost : null,
              { width: `${memberRatio * 100}%` as any },
            ]} />
          </View>
          <Text style={[styles.memberCount, isFull && !isEnded && { color: '#FF4040' }, isEnded && { color: '#AAAAAA' }]}>
            {g.members.length}/{g.maxMembers}명
          </Text>
        </View>

        <View style={styles.tagRow}>
          <Text style={[styles.tagChip, isEnded && { color: '#AAAAAA', borderColor: '#CCCCCC' }]}>{g.genderLimit}</Text>
          <Text style={[styles.tagChip, isEnded && { color: '#AAAAAA', borderColor: '#CCCCCC' }]}>{ageLimitDisplay}</Text>
          {(g.waitlist?.length ?? 0) > 0 && (
            <View style={[styles.waitlistCountChip, isEnded && { backgroundColor: '#E0E0E0' }]}>
              <Text style={[styles.waitlistCountChipText, isEnded && { color: '#AAAAAA' }]}>⏳ 대기 {g.waitlist.length}명</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ═══════════════════════════════════════════════════════════════
  return (
    <View style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" progressBackgroundColor={ACCENT} />
        }
      >
        {/* 헤더 */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View>
            <Text style={styles.headerSubtitle}>함께 달리기</Text>
            <Text style={styles.headerTitle}>👥 그룹 러닝</Text>
          </View>
          <TouchableOpacity style={styles.headerBtn} onPress={() => { setCreateForm(makeDefaultForm()); setShowCreateModal(true); }}>
            <Text style={styles.headerBtnText}>+ 만들기</Text>
          </TouchableOpacity>
        </View>

        {/* 검색 */}
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="그룹명, 지역, 번호 검색"
            placeholderTextColor="#bbb"
            value={searchText}
            onChangeText={setSearchText}
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')} style={{ padding: 4 }}>
              <Text style={{ color: '#bbb', fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 초대 코드 참여 배너 */}
        <TouchableOpacity
          style={styles.codeBanner}
          onPress={() => { setCodeInput(''); setShowCodeModal(true); }}
          activeOpacity={0.85}
        >
          <Text style={styles.codeBannerEmoji}>🔑</Text>
          <Text style={styles.codeBannerText}>초대 코드로 비공개 그룹 참여하기</Text>
          <Text style={styles.codeBannerArrow}>›</Text>
        </TouchableOpacity>

        {/* 탭 */}
        <View style={styles.tabRow}>
          {(['all', 'mine'] as const).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'all' ? `전체 그룹 (${allGroups.length})` : `내 그룹 (${myGroups.length})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 필터 바 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filterBarContent}
        >
          <Text style={styles.filterLabel}>날짜</Text>
          {DATE_FILTER_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt}
              style={[styles.filterChip, filterDate === opt && styles.filterChipActive]}
              onPress={() => setFilterDate(opt)}
            >
              <Text style={[styles.filterChipText, filterDate === opt && styles.filterChipTextActive]}>{opt}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.filterDivider} />
          <Text style={styles.filterLabel}>난이도</Text>
          {(['전체', ...LEVEL_OPTIONS] as string[]).map(opt => (
            <TouchableOpacity
              key={opt}
              style={[styles.filterChip, filterLevel === opt && styles.filterChipActive]}
              onPress={() => setFilterLevel(opt)}
            >
              <Text style={[styles.filterChipText, filterLevel === opt && styles.filterChipTextActive]}>{opt}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.filterDivider} />
          <Text style={styles.filterLabel}>거리</Text>
          {DIST_FILTER_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt}
              style={[styles.filterChip, filterDist === opt && styles.filterChipActive]}
              onPress={() => setFilterDist(opt)}
            >
              <Text style={[styles.filterChipText, filterDist === opt && styles.filterChipTextActive]}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* 그룹 목록 */}
        {loadingGroups ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={ACCENT} size="large" />
            <Text style={styles.loadingText}>그룹 불러오는 중...</Text>
          </View>
        ) : filteredGroups.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>👟</Text>
            <Text style={styles.emptyText}>
              {searchText
                ? '검색 결과가 없어요'
                : activeTab === 'mine' ? '참여한 그룹이 없어요' : '개설된 그룹이 없어요'}
            </Text>
            <Text style={styles.emptySubText}>
              {searchText
                ? '다른 검색어를 시도해보세요'
                : activeTab === 'mine' ? '전체 그룹 탭에서 참여해보세요!' : '첫 번째 그룹을 만들어보세요!'}
            </Text>
            {activeTab === 'all' && !searchText && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowCreateModal(true)}>
                <Text style={styles.emptyBtnText}>그룹 만들기</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={{ paddingBottom: 20 }}>
            {filteredGroups.map(renderGroupCard)}
          </View>
        )}
      </ScrollView>

      {/* ─── 그룹 상세 모달 ──────────────────────────────────── */}
      <Modal visible={showDetailModal} animationType="slide" onRequestClose={closeDetailModal}>
        <View style={styles.safeArea}>
          <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

            {/* 상세 헤더 */}
            <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
              <TouchableOpacity onPress={closeDetailModal} style={styles.backBtnWrap}>
                <Text style={styles.backBtn}>‹</Text>
              </TouchableOpacity>
              <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 18, fontWeight: 'bold' }}>
                {selectedGroup?.name ?? ''}
              </Text>
              {selectedGroup && isOwner(selectedGroup) ? (
                <TouchableOpacity onPress={() => openEditModal(selectedGroup)} style={styles.editBtnWrap}>
                  <Text style={styles.editBtnText}>수정</Text>
                </TouchableOpacity>
              ) : <View style={{ width: 48 }} />}
            </View>

            {loadingDetail ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={ACCENT} size="large" />
                <Text style={styles.loadingText}>멤버 정보 불러오는 중...</Text>
              </View>
            ) : selectedGroup && (
              <>
                {/* 지도 미리보기 */}
                {selectedGroup.lat && selectedGroup.lng && (
                  <View style={styles.detailMapWrap}>
                    <MapView
                      style={{ flex: 1 }}
                      initialRegion={{
                        latitude: selectedGroup.lat,
                        longitude: selectedGroup.lng,
                        latitudeDelta: 0.008,
                        longitudeDelta: 0.008,
                      }}
                      scrollEnabled={false}
                      zoomEnabled={false}
                      pitchEnabled={false}
                      rotateEnabled={false}
                    >
                      <Marker
                        coordinate={{ latitude: selectedGroup.lat, longitude: selectedGroup.lng }}
                        pinColor={ACCENT}
                        title={selectedGroup.name}
                        description={selectedGroup.region}
                      />
                    </MapView>
                    <View style={styles.detailMapLabel}>
                      <Text style={styles.detailMapLabelText}>📍 {selectedGroup.region}</Text>
                    </View>
                  </View>
                )}

                {/* 그룹 정보 카드 */}
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>📋 그룹 정보</Text>

                  {/* 상태 + 레벨 뱃지 */}
                  {(() => {
                    const st = getStatus(selectedGroup);
                    const lc = LEVEL_COLORS[selectedGroup.level] ?? ACCENT;
                    return (
                      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                        <View style={[styles.statusBadge, { backgroundColor: st.color + '22' }]}>
                          <Text style={[styles.statusBadgeText, { color: st.color }]}>{st.label}</Text>
                        </View>
                        {selectedGroup.level && (
                          <View style={[styles.levelBadge, { backgroundColor: lc + '18' }]}>
                            <Text style={[styles.levelBadgeText, { color: lc }]}>{selectedGroup.level}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })()}

                  {/* 소개글 */}
                  {!!selectedGroup.description && (
                    <View style={styles.descriptionBox}>
                      <Text style={styles.descriptionText}>{selectedGroup.description}</Text>
                    </View>
                  )}

                  {[
                    ['No.', `#${selectedGroup.groupNo ?? '-'}`],
                    ['📍 지역', selectedGroup.region],
                    ['🗓 시작', fmtDateTime(selectedGroup.startDateTime)],
                    ['🏁 종료', fmtDateTime(selectedGroup.endDateTime)],
                    ['👥 인원', `${selectedGroup.members.length}/${selectedGroup.maxMembers}명`],
                    ['⏳ 대기자', `${selectedGroup.waitlist?.length ?? 0}명`],
                    ['🏃 거리', selectedGroup.distanceKm ? `${selectedGroup.distanceKm}km` : '-'],
                    ['⏱ 페이스', selectedGroup.paceMin ? `${selectedGroup.paceMin}'${selectedGroup.paceSec || '00'}"/km` : '-'],
                    ['제한', `${selectedGroup.genderLimit} · ${formatAgeLimitDisplay(selectedGroup.ageLimit)}`],
                    ['방 종류', selectedGroup.password ? '🔒 비밀방' : '🔓 공개방'],
                  ].map(([label, value]) => (
                    <View key={label} style={styles.infoRow}>
                      <Text style={styles.infoLabel}>{label}</Text>
                      <Text style={styles.infoValue}>{value}</Text>
                    </View>
                  ))}
                  {isOwner(selectedGroup) && (
                    <TouchableOpacity
                      style={styles.codeRow}
                      onPress={() => {
                        Clipboard.setString(selectedGroup.code);
                        Alert.alert('복사 완료!', `초대코드 ${selectedGroup.code}가 복사됐어요`);
                      }}
                    >
                      <Text style={styles.codeLabel}>🔑 초대코드</Text>
                      <View style={styles.codeValueWrap}>
                        <Text style={styles.codeValue}>{selectedGroup.code}</Text>
                        <Text style={styles.codeCopyHint}>탭하여 복사</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                </View>

                {/* 참여하기 / 대기 신청 */}
                {!isMember(selectedGroup) && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>🏃 그룹 참여</Text>
                    {selectedGroup.password ? (
                      <>
                        <SectionLabel text="🔐 비밀번호" />
                        <TextInput
                          style={styles.input}
                          placeholder="비밀번호 입력"
                          placeholderTextColor="#ccc"
                          value={joinPassword}
                          onChangeText={setJoinPassword}
                          secureTextEntry
                        />
                      </>
                    ) : null}
                    {(() => {
                      const { ok, reason } = checkJoinEligibility(selectedGroup);
                      const isWaitlisted = (selectedGroup.waitlist || []).includes(userId);
                      const isFull = selectedGroup.members.length >= selectedGroup.maxMembers;

                      if (isWaitlisted) {
                        return (
                          <View>
                            <View style={styles.waitlistNotice}>
                              <Text style={styles.waitlistNoticeText}>대기 중이에요. 방장 승인 시 참여 확정됩니다.</Text>
                            </View>
                            <TouchableOpacity style={styles.waitlistCancelBtn} onPress={() => handleLeaveWaitlist(selectedGroup)}>
                              <Text style={styles.waitlistCancelText}>대기 취소</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      }
                      if (!ok && isFull) {
                        return (
                          <TouchableOpacity style={styles.waitlistBtn} onPress={() => handleJoinWaitlist(selectedGroup)} activeOpacity={0.85}>
                            <Text style={styles.waitlistBtnText}>대기 신청하기</Text>
                          </TouchableOpacity>
                        );
                      }
                      return (
                        <TouchableOpacity
                          style={[styles.button, !ok && styles.buttonDisabled]}
                          onPress={() => ok ? handleJoin(selectedGroup) : Alert.alert('참여 불가', reason)}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.buttonText}>{ok ? '🏃 그룹 참여하기' : `❌ ${reason}`}</Text>
                        </TouchableOpacity>
                      );
                    })()}
                  </View>
                )}

                {/* 참여 멤버 */}
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>👥 참여 멤버 ({selectedGroup.memberDetails?.length ?? 0}명)</Text>
                  {selectedGroup.memberDetails?.map((m: any, i: number) => (
                    <TouchableOpacity
                      key={m.uid}
                      style={[
                        styles.memberRow,
                        m.isMe && styles.memberRowMe,
                        i === selectedGroup.memberDetails.length - 1 && { borderBottomWidth: 0 },
                      ]}
                      onPress={() => openMemberProfile(m)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.memberAvatarWrap}>
                        <Text style={styles.memberAvatar}>
                          {m.isOwner ? '👑' : '🏃'}
                        </Text>
                      </View>
                      <View style={styles.memberInfo}>
                        <Text style={[styles.memberName, m.isMe && styles.memberNameMe]}>
                          {m.nickname}{m.isMe ? ' (나)' : ''}
                        </Text>
                        <Text style={styles.memberSub}>{m.region} · {m.age}세 · {m.gender}</Text>
                      </View>
                      <View style={styles.memberKmWrap}>
                        {m.todayKm > 0 && (
                          <>
                            {selectedGroup.isPast && m.completed && (
                              <View style={styles.completedBadge}>
                                <Text style={styles.completedBadgeText}>완주</Text>
                              </View>
                            )}
                            <Text style={[styles.memberKm, m.isMe && { color: ACCENT }]}>{m.todayKm}</Text>
                            <Text style={styles.memberKmUnit}>km</Text>
                          </>
                        )}
                        <Text style={styles.memberArrow}>›</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* 대기자 목록 (방장에게만 표시) */}
                {isOwner(selectedGroup) && (selectedGroup.waitlistDetails?.length ?? 0) > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>⏳ 대기자 ({selectedGroup.waitlistDetails.length}명)</Text>
                    <Text style={{ fontSize: 12, color: '#999', marginBottom: 10 }}>대기자를 눌러 인원 확대 후 승인하세요</Text>
                    {selectedGroup.waitlistDetails.map((m: any, i: number) => (
                      <TouchableOpacity
                        key={m.uid}
                        style={[styles.memberRow, i === selectedGroup.waitlistDetails.length - 1 && { borderBottomWidth: 0 }]}
                        onPress={() => handlePromoteFromWaitlist(selectedGroup, m.uid, m.nickname)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.memberAvatarWrap}>
                          <Text style={styles.memberAvatar}>🙋</Text>
                        </View>
                        <View style={styles.memberInfo}>
                          <Text style={styles.memberName}>{m.nickname}{m.isMe ? ' (나)' : ''}</Text>
                        </View>
                        <Text style={{ fontSize: 20, color: '#CCCCCC' }}>›</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* 모임 사진첩 */}
                <View style={styles.card}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <Text style={styles.cardTitle}>📷 모임 사진</Text>
                    {isMember(selectedGroup) && (
                      <TouchableOpacity onPress={uploadGroupPhoto} disabled={photoUploading} style={styles.photoUploadBtn}>
                        {photoUploading
                          ? <ActivityIndicator color={ACCENT} size="small" />
                          : <Text style={styles.photoUploadBtnText}>+ 사진 추가</Text>
                        }
                      </TouchableOpacity>
                    )}
                  </View>
                  {(selectedGroup.groupPhotos?.length ?? 0) === 0 ? (
                    <View style={styles.photoEmptyBox}>
                      <Text style={styles.photoEmptyText}>아직 등록된 사진이 없어요</Text>
                      {isMember(selectedGroup) && (
                        <Text style={styles.photoEmptyHint}>모임 사진을 공유해보세요!</Text>
                      )}
                    </View>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                      {selectedGroup.groupPhotos.map((url: string, pi: number) => (
                        <TouchableOpacity
                          key={pi}
                          onLongPress={() => isMember(selectedGroup) && deleteGroupPhoto(pi)}
                          activeOpacity={0.9}
                        >
                          <Image source={{ uri: url }} style={styles.groupPhotoThumb} />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                  {isMember(selectedGroup) && (selectedGroup.groupPhotos?.length ?? 0) > 0 && (
                    <Text style={styles.photoLongPressHint}>사진을 길게 누르면 삭제할 수 있어요</Text>
                  )}
                </View>

                {/* 채팅 */}
                {isMember(selectedGroup) ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>💬 그룹 채팅</Text>
                    <ScrollView
                      ref={chatScrollRef}
                      style={styles.chatMsgArea}
                      nestedScrollEnabled
                      onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: false })}
                    >
                      {chatMessages.length === 0 ? (
                        <Text style={styles.chatEmpty}>첫 메시지를 보내보세요 👋</Text>
                      ) : (
                        chatMessages.map((msg: any) => {
                          const isMe = msg.userId === userId;
                          return (
                            <View key={msg.id} style={[styles.chatBubbleWrap, isMe && styles.chatBubbleWrapMe]}>
                              {!isMe && <Text style={styles.chatNickname}>{msg.nickname}</Text>}
                              <View style={[styles.chatBubble, isMe && styles.chatBubbleMe]}>
                                <Text style={[styles.chatText, isMe && styles.chatTextMe]}>{msg.text}</Text>
                              </View>
                              <Text style={styles.chatTime}>{formatChatTime(msg.createdAt)}</Text>
                            </View>
                          );
                        })
                      )}
                    </ScrollView>
                    <View style={styles.chatInputRow}>
                      <TextInput
                        style={styles.chatInput}
                        placeholder="메시지를 입력하세요..."
                        placeholderTextColor="#bbb"
                        value={chatText}
                        onChangeText={setChatText}
                        multiline
                        maxLength={200}
                        onSubmitEditing={sendChat}
                      />
                      <TouchableOpacity
                        style={[styles.chatSendBtn, (!chatText.trim() || sendingChat) && styles.chatSendBtnDisabled]}
                        onPress={sendChat}
                        disabled={!chatText.trim() || sendingChat}
                      >
                        {sendingChat
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <Text style={styles.chatSendText}>전송</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={[styles.card, { alignItems: 'center', paddingVertical: 20 }]}>
                    <Text style={{ fontSize: 20, marginBottom: 8 }}>💬</Text>
                    <Text style={{ fontSize: 14, color: '#aaa' }}>그룹에 참여하면 채팅에 참여할 수 있어요</Text>
                  </View>
                )}

                {/* 탈퇴 / 삭제 버튼 */}
                {selectedGroup && isMember(selectedGroup) && (
                  <View style={styles.dangerArea}>
                    {isOwner(selectedGroup) ? (
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        onPress={() => handleDelete(selectedGroup)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.deleteBtnText}>🗑 그룹 삭제</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={styles.leaveBtn}
                        onPress={() => handleLeave(selectedGroup)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.leaveBtnText}>🚪 그룹 탈퇴</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                <View style={{ height: 32 }} />
              </>
            )}
          </ScrollView>

          {/* 멤버 프로필 오버레이 */}
          {selectedMember && (
            <View style={styles.profileOverlay}>
              <TouchableOpacity style={styles.profileBg} onPress={() => setSelectedMember(null)} activeOpacity={1} />
              <View style={styles.profileCard}>
                <TouchableOpacity style={styles.profileCloseBtn} onPress={() => setSelectedMember(null)}>
                  <Text style={styles.profileCloseText}>✕</Text>
                </TouchableOpacity>
                <View style={styles.profileHeader}>
                  <Text style={styles.profileEmoji}>{selectedMember.isOwner ? '👑' : '🏃'}</Text>
                  <Text style={styles.profileNickname}>{selectedMember.nickname}</Text>
                  {selectedMember.isMe && <Text style={styles.profileMeBadge}>나</Text>}
                </View>
                {loadingMemberProfile ? (
                  <ActivityIndicator color={ACCENT} style={{ marginVertical: 20 }} />
                ) : (
                  <>
                    <View style={styles.profileInfoRow}>
                      <View style={styles.profileInfoItem}>
                        <Text style={styles.profileInfoLabel}>나이</Text>
                        <Text style={styles.profileInfoValue}>{selectedMember.age}세</Text>
                      </View>
                      <View style={styles.profileInfoItem}>
                        <Text style={styles.profileInfoLabel}>성별</Text>
                        <Text style={styles.profileInfoValue}>{selectedMember.gender || '-'}</Text>
                      </View>
                      <View style={styles.profileInfoItem}>
                        <Text style={styles.profileInfoLabel}>지역</Text>
                        <Text style={styles.profileInfoValue}>{selectedMember.region || '-'}</Text>
                      </View>
                    </View>
                    <View style={styles.profileStatsRow}>
                      <View style={styles.profileStatBox}>
                        <Text style={styles.profileStatValue}>{selectedMember.totalRuns ?? '-'}</Text>
                        <Text style={styles.profileStatLabel}>총 러닝</Text>
                      </View>
                      <View style={styles.profileStatBox}>
                        <Text style={styles.profileStatValue}>{selectedMember.totalKm ?? '-'}</Text>
                        <Text style={styles.profileStatLabel}>총 km</Text>
                      </View>
                      <View style={styles.profileStatBox}>
                        <Text style={[styles.profileStatValue, { color: ACCENT }]}>{selectedMember.todayKm}</Text>
                        <Text style={styles.profileStatLabel}>오늘 km</Text>
                      </View>
                    </View>
                  </>
                )}
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* ─── 그룹 만들기 모달 ────────────────────────────────── */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        onRequestClose={() => { setShowCreateModal(false); setShowMapPage(false); }}
      >
        <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top }}>
          {showMapPage && mapTarget === 'create' ? (
            renderMapPage()
          ) : (
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => { setShowCreateModal(false); setShowMapPage(false); }}>
                  <Text style={styles.modalHeaderCancel}>취소</Text>
                </TouchableOpacity>
                <Text style={styles.modalHeaderTitle}>그룹 만들기</Text>
                <TouchableOpacity onPress={handleCreate} disabled={submitting}>
                  {submitting
                    ? <ActivityIndicator color={ACCENT} size="small" />
                    : <Text style={styles.modalHeaderDone}>완료</Text>
                  }
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.formScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {renderForm(createForm, setCreateForm, 'create')}
                <View style={{ height: 80 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          )}
        </View>
      </Modal>

      {/* ─── 그룹 수정 모달 ──────────────────────────────────── */}
      <Modal
        visible={showEditModal}
        animationType="slide"
        onRequestClose={() => { setShowEditModal(false); setShowMapPage(false); }}
      >
        <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top }}>
          {showMapPage && mapTarget === 'edit' ? (
            renderMapPage()
          ) : (
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => { setShowEditModal(false); setShowMapPage(false); }}>
                  <Text style={styles.modalHeaderCancel}>취소</Text>
                </TouchableOpacity>
                <Text style={styles.modalHeaderTitle}>그룹 수정</Text>
                <TouchableOpacity onPress={handleEdit} disabled={submitting}>
                  {submitting
                    ? <ActivityIndicator color={ACCENT} size="small" />
                    : <Text style={styles.modalHeaderDone}>완료</Text>
                  }
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.formScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {renderForm(editForm, setEditForm, 'edit')}
                <View style={{ height: 80 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          )}
        </View>
      </Modal>
      {/* ─── 초대 코드 입력 모달 ─────────────────────────────── */}
      <Modal
        visible={showCodeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCodeModal(false)}
      >
        <TouchableOpacity
          style={styles.codeModalBackdrop}
          activeOpacity={1}
          onPress={() => setShowCodeModal(false)}
        />
        <KeyboardAvoidingView
          style={styles.codeModalWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.codeModalCard, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.codeModalTitle}>🔑 초대 코드로 참여</Text>
            <Text style={styles.codeModalSub}>방장에게 받은 6자리 코드를 입력하세요</Text>
            <TextInput
              style={styles.codeModalInput}
              placeholder="예: ABC123"
              placeholderTextColor="#ccc"
              value={codeInput}
              onChangeText={v => setCodeInput(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              autoCapitalize="characters"
              maxLength={6}
              autoFocus
              onSubmitEditing={handleJoinByCode}
            />
            <Text style={styles.codeModalCount}>{codeInput.length}/6</Text>
            <TouchableOpacity
              style={[styles.codeModalBtn, (codeInput.length !== 6 || searchingCode) && styles.codeModalBtnDisabled]}
              onPress={handleJoinByCode}
              disabled={codeInput.length !== 6 || searchingCode}
              activeOpacity={0.85}
            >
              {searchingCode
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.codeModalBtnText}>그룹 찾기</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCodeModal(false)} style={styles.codeModalCancel}>
              <Text style={styles.codeModalCancelText}>취소</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F5F7' },
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  formScroll: { padding: 20, backgroundColor: '#fff' },

  // 헤더
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 20,
    backgroundColor: ACCENT,
  },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '600', letterSpacing: 1, marginBottom: 2 },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  headerBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  headerBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  backBtnWrap: { width: 48, justifyContent: 'center' },
  backBtn: { color: '#fff', fontSize: 28, lineHeight: 32 },
  editBtnWrap: { width: 48, alignItems: 'flex-end', justifyContent: 'center' },
  editBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },

  // 모달 헤더
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
    minHeight: 52,
  },
  modalHeaderTitle: { fontSize: 17, fontWeight: 'bold', color: '#111' },
  modalHeaderCancel: { fontSize: 16, color: '#999' },
  modalHeaderDone: { fontSize: 16, color: ACCENT, fontWeight: 'bold' },

  // 검색
  searchBox: {
    flexDirection: 'row', alignItems: 'center',
    margin: 16, marginBottom: 0,
    backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 13, fontSize: 15, color: '#222' },

  // 탭
  tabRow: {
    flexDirection: 'row', margin: 16, marginBottom: 0,
    backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { backgroundColor: ACCENT },
  tabText: { fontSize: 14, color: '#aaa', fontWeight: '600' },
  tabTextActive: { color: '#fff' },

  // 로딩 / 빈 상태
  loadingBox: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 14, color: '#bbb' },
  emptyBox: { alignItems: 'center', padding: 48, margin: 16, backgroundColor: '#fff', borderRadius: 20 },
  emptyEmoji: { fontSize: 52, marginBottom: 14 },
  emptyText: { fontSize: 17, fontWeight: 'bold', color: '#222', marginBottom: 6 },
  emptySubText: { fontSize: 13, color: '#aaa', textAlign: 'center', marginBottom: 20 },
  emptyBtn: { backgroundColor: ACCENT, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },

  // 필터 바
  filterBar: { marginTop: 10, marginBottom: 2 },
  filterBarContent: { paddingHorizontal: 16, paddingVertical: 8, gap: 6, alignItems: 'center' },
  filterLabel: { fontSize: 11, color: '#aaa', fontWeight: '700', marginRight: 2 },
  filterDivider: { width: 1, height: 18, backgroundColor: '#E0E0E0', marginHorizontal: 6 },
  filterChip: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20,
    backgroundColor: '#F0F0F0',
  },
  filterChipActive: { backgroundColor: ACCENT },
  filterChipText: { fontSize: 12, color: '#666', fontWeight: '600' },
  filterChipTextActive: { color: '#fff', fontWeight: '700' },

  // 그룹 카드
  groupCard: {
    backgroundColor: '#fff', margin: 16, marginBottom: 0,
    borderRadius: 18, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
    overflow: 'hidden',
  },
  groupCardEnded: {
    backgroundColor: '#F2F2F2',
    opacity: 0.75,
    shadowOpacity: 0.03,
    elevation: 1,
  },
  // 카드 새 요소
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  statusBadgeText: { fontSize: 12, fontWeight: '800' },
  ddayText: { fontSize: 12, color: '#555', fontWeight: '700' },
  ddayTodayBadge: { backgroundColor: '#FFF3E0', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  ddayTodayText: { fontSize: 12, color: '#FF8C00', fontWeight: '800' },
  cardDateRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  cardDateText: { fontSize: 20, fontWeight: 'bold', color: '#111' },
  cardTimeText: { fontSize: 17, fontWeight: '700', color: ACCENT },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardMetaText: { fontSize: 12, color: '#777', fontWeight: '600' },
  levelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  levelBadgeText: { fontSize: 12, fontWeight: '800' },
  descriptionBox: {
    backgroundColor: '#F8F8F8', borderRadius: 10,
    padding: 12, marginBottom: 12,
  },
  descriptionText: { fontSize: 14, color: '#555', lineHeight: 20 },

  cardBadgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  groupNoText: { fontSize: 12, color: '#bbb', fontWeight: '700' },
  badge: { backgroundColor: ACCENT_LIGHT, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, color: ACCENT, fontWeight: '700' },
  badgeOwner: { backgroundColor: '#FFF8E1' },
  badgeOwnerText: { color: '#F59E0B' },
  badgeFull: { backgroundColor: '#FFE9E9' },
  badgeFullText: { color: '#FF4040' },
  badgeDday: { backgroundColor: '#E8F4FF' },
  badgeDdayText: { color: '#2979FF' },
  groupNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  groupName: { fontSize: 17, fontWeight: 'bold', color: '#111', flex: 1 },
  groupInfoRow: { flexDirection: 'row', gap: 16, marginBottom: 10 },
  groupInfoItem: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  groupInfoIcon: { fontSize: 13 },
  groupInfoText: { fontSize: 13, color: '#777', flex: 1 },
  memberBarSection: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  memberBarTrack: { flex: 1, height: 5, backgroundColor: '#F0F0F0', borderRadius: 3, overflow: 'hidden' },
  memberBarFill: { height: '100%', backgroundColor: ACCENT, borderRadius: 3 },
  memberBarFull: { backgroundColor: '#FF4040' },
  memberBarAlmost: { backgroundColor: '#FF8C00' },
  memberCount: { fontSize: 12, color: '#999', fontWeight: '600', minWidth: 40, textAlign: 'right' },
  tagRow: { flexDirection: 'row', gap: 6 },
  tagChip: { fontSize: 11, color: '#888', backgroundColor: '#F5F5F5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },

  // 카드 (상세)
  card: {
    backgroundColor: '#fff', margin: 16, marginBottom: 0, borderRadius: 18, padding: 18,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#111', marginBottom: 14 },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  infoLabel: { fontSize: 14, color: '#888' },
  infoValue: { fontSize: 14, fontWeight: '600', color: '#222', flex: 1, textAlign: 'right' },

  // 지도 미리보기 (상세)
  detailMapWrap: {
    height: 200, margin: 16, marginBottom: 0,
    borderRadius: 18, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  detailMapLabel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 8, paddingHorizontal: 14,
  },
  detailMapLabelText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // 초대코드
  codeRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, marginTop: 4,
    backgroundColor: ACCENT_LIGHT, borderRadius: 12, paddingHorizontal: 14,
  },
  codeLabel: { fontSize: 14, color: ACCENT, fontWeight: '700' },
  codeValueWrap: { alignItems: 'flex-end' },
  codeValue: { fontSize: 20, color: ACCENT, letterSpacing: 4, fontWeight: 'bold' },
  codeCopyHint: { fontSize: 10, color: '#FFAA88', marginTop: 2 },

  // 멤버 목록
  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  memberRowMe: { backgroundColor: ACCENT_LIGHT, borderRadius: 10, paddingHorizontal: 10, marginHorizontal: -10 },
  memberAvatarWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  memberAvatar: { fontSize: 20 },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '700', color: '#111' },
  memberNameMe: { color: ACCENT },
  memberSub: { fontSize: 12, color: '#aaa', marginTop: 2 },
  memberKmWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  memberKm: { fontSize: 16, fontWeight: 'bold', color: '#222' },
  memberKmUnit: { fontSize: 11, color: '#aaa', marginRight: 4 },
  memberArrow: { fontSize: 18, color: '#ccc' },
  completedBadge: {
    backgroundColor: '#E8F5E9', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, marginRight: 4,
  },
  completedBadgeText: { fontSize: 10, color: '#00C853', fontWeight: '800' },
  promoteBtn: {
    backgroundColor: ACCENT, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  promoteBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  waitlistNotice: {
    backgroundColor: '#FFF8E1', borderRadius: 10,
    padding: 12, marginBottom: 10,
  },
  waitlistNoticeText: { fontSize: 13, color: '#F59E0B', fontWeight: '600' },
  waitlistBtn: {
    borderWidth: 1.5, borderColor: ACCENT,
    borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4,
  },
  waitlistBtnText: { color: ACCENT, fontWeight: 'bold', fontSize: 16 },
  waitlistCancelBtn: { alignItems: 'center', paddingVertical: 12 },
  waitlistCancelText: { color: '#bbb', fontSize: 14 },
  photoUploadBtn: {
    backgroundColor: ACCENT_LIGHT, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  photoUploadBtnText: { color: ACCENT, fontSize: 13, fontWeight: '700' },
  groupPhotoThumb: { width: 140, height: 140, borderRadius: 12, backgroundColor: '#F0F0F0' },
  photoEmptyBox: { alignItems: 'center', paddingVertical: 20 },
  photoEmptyText: { fontSize: 14, color: '#bbb', fontWeight: '600', marginBottom: 4 },
  photoEmptyHint: { fontSize: 12, color: '#ddd' },
  photoLongPressHint: { fontSize: 11, color: '#ccc', textAlign: 'center', marginTop: 10 },

  // 멤버 프로필 오버레이
  profileOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'flex-end',
  },
  profileBg: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  profileCard: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  profileCloseBtn: {
    position: 'absolute', top: 16, right: 20,
    width: 30, height: 30, justifyContent: 'center', alignItems: 'center',
  },
  profileCloseText: { fontSize: 18, color: '#aaa' },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  profileEmoji: { fontSize: 36 },
  profileNickname: { fontSize: 22, fontWeight: 'bold', color: '#111', flex: 1 },
  profileMeBadge: {
    backgroundColor: ACCENT, color: '#fff', fontSize: 12,
    fontWeight: 'bold', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  profileInfoRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  profileInfoItem: {
    flex: 1, backgroundColor: '#F8F8F8', borderRadius: 12,
    padding: 12, alignItems: 'center',
  },
  profileInfoLabel: { fontSize: 11, color: '#aaa', marginBottom: 4 },
  profileInfoValue: { fontSize: 15, fontWeight: '700', color: '#222' },
  profileStatsRow: { flexDirection: 'row', gap: 12 },
  profileStatBox: {
    flex: 1, backgroundColor: ACCENT_LIGHT, borderRadius: 12,
    padding: 14, alignItems: 'center',
  },
  profileStatValue: { fontSize: 20, fontWeight: 'bold', color: '#222' },
  profileStatLabel: { fontSize: 11, color: '#aaa', marginTop: 4 },

  // 채팅
  chatMsgArea: { maxHeight: 280, marginBottom: 12 },
  chatEmpty: { color: '#bbb', textAlign: 'center', paddingVertical: 20, fontSize: 14 },
  chatBubbleWrap: { marginBottom: 10, alignItems: 'flex-start' },
  chatBubbleWrapMe: { alignItems: 'flex-end' },
  chatNickname: { fontSize: 11, color: '#aaa', marginBottom: 3, marginLeft: 4 },
  chatBubble: {
    backgroundColor: '#F0F0F0', borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14, paddingVertical: 9, maxWidth: '80%',
  },
  chatBubbleMe: {
    backgroundColor: ACCENT, borderRadius: 16,
    borderBottomRightRadius: 4,
  },
  chatText: { fontSize: 14, color: '#222', lineHeight: 20 },
  chatTextMe: { color: '#fff' },
  chatTime: { fontSize: 10, color: '#ccc', marginTop: 3, marginHorizontal: 4 },
  chatInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  chatInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#EDEDED', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, backgroundColor: '#FAFAFA',
    maxHeight: 80, color: '#222',
  },
  chatSendBtn: {
    backgroundColor: ACCENT, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center',
  },
  chatSendBtnDisabled: { backgroundColor: '#E0E0E0' },
  chatSendText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  // 폼
  label: { fontSize: 13, color: '#999', marginBottom: 6, marginTop: 16, fontWeight: '600' },
  input: {
    borderWidth: 1.5, borderColor: '#EDEDED', borderRadius: 12,
    padding: 13, fontSize: 15, marginBottom: 4,
    backgroundColor: '#FAFAFA', color: '#222',
  },
  selectBtn: {
    borderWidth: 1.5, borderColor: '#EDEDED', borderRadius: 12,
    padding: 13, marginBottom: 4, backgroundColor: '#FAFAFA',
  },
  dropdownList: {
    borderWidth: 1.5, borderColor: '#EDEDED', borderRadius: 12,
    backgroundColor: '#fff', marginBottom: 4,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 8, zIndex: 999,
  },
  dropdownItem: { paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  dropdownText: { fontSize: 15, color: '#333', textAlign: 'center' },
  dropdownTextActive: { color: ACCENT, fontWeight: 'bold' },
  locationRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 4 },
  locationBtn: { backgroundColor: ACCENT, padding: 13, borderRadius: 12 },
  locationBtnText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  yearInput: { flex: 2, textAlign: 'center' },
  smallInput: { flex: 1, textAlign: 'center' },
  dateSep: { fontSize: 18, color: '#aaa', fontWeight: '300' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#EDEDED', backgroundColor: '#FAFAFA',
  },
  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 14, color: '#666', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  button: { backgroundColor: ACCENT, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 14 },
  buttonDisabled: { backgroundColor: '#E0E0E0' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  // 초대 코드 배너
  codeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 10,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    borderWidth: 1.5, borderColor: ACCENT_LIGHT,
  },
  codeBannerEmoji: { fontSize: 18 },
  codeBannerText: { flex: 1, fontSize: 14, color: ACCENT, fontWeight: '600' },
  codeBannerArrow: { fontSize: 20, color: ACCENT, fontWeight: '300' },

  // 초대 코드 입력 모달
  codeModalBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  codeModalWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  codeModalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 28,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  codeModalTitle: { fontSize: 20, fontWeight: 'bold', color: '#111', marginBottom: 6 },
  codeModalSub: { fontSize: 13, color: '#aaa', marginBottom: 20 },
  codeModalInput: {
    borderWidth: 2, borderColor: ACCENT,
    borderRadius: 16, paddingVertical: 16, paddingHorizontal: 20,
    fontSize: 28, fontWeight: 'bold', color: '#111',
    textAlign: 'center', letterSpacing: 8,
    backgroundColor: ACCENT_LIGHT,
  },
  codeModalCount: { fontSize: 12, color: '#ccc', textAlign: 'right', marginTop: 4, marginBottom: 16 },
  codeModalBtn: {
    backgroundColor: ACCENT, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
    shadowColor: ACCENT, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  codeModalBtnDisabled: { backgroundColor: '#E0E0E0', shadowOpacity: 0 },
  codeModalBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  codeModalCancel: { alignItems: 'center', paddingVertical: 14 },
  codeModalCancelText: { color: '#bbb', fontSize: 15 },

  // 탈퇴 / 삭제 영역
  dangerArea: { margin: 16, marginBottom: 0, gap: 10 },
  leaveBtn: {
    borderWidth: 1.5, borderColor: '#FF4040',
    borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    backgroundColor: '#FFF5F5',
  },
  leaveBtnText: { color: '#FF4040', fontWeight: 'bold', fontSize: 15 },
  deleteBtn: {
    borderWidth: 1.5, borderColor: '#FF4040',
    borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    backgroundColor: '#FF4040',
  },
  deleteBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },

  // 지도 선택 페이지
  mapConfirmBtn: {
    backgroundColor: ACCENT, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
  },
  mapConfirmBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  mapSearchBar: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
    paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: 'center',
  },
  mapSearchInput: {
    flex: 1, height: 40, backgroundColor: '#F5F5F7', borderRadius: 10,
    paddingHorizontal: 12, fontSize: 14, color: '#222',
  },
  mapSearchBtn: {
    backgroundColor: ACCENT, borderRadius: 10,
    paddingHorizontal: 14, height: 40, justifyContent: 'center', alignItems: 'center',
  },
  mapSearchBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  mapSearchResults: {
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee',
    maxHeight: 220, zIndex: 10,
  },
  mapSearchResultItem: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 12, gap: 8,
  },
  mapSearchResultDivider: { borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  mapSearchResultIcon: { fontSize: 16, marginTop: 1 },
  mapSearchResultTitle: { fontSize: 14, fontWeight: '600', color: '#222', marginBottom: 2 },
  mapSearchResultSub: { fontSize: 12, color: '#888' },

  myLocBtn: {
    position: 'absolute', right: 12, bottom: 16,
    backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, elevation: 4,
  },
  myLocBtnText: { fontSize: 13, color: '#333', fontWeight: '600' },

  mapFloatHint: {
    position: 'absolute', bottom: 60, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  mapFloatHintText: { color: '#fff', fontSize: 12 },

  mapSelectedBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1A1A2E', paddingHorizontal: 16, paddingVertical: 14,
  },
  mapSelectedLabel: { color: '#aaa', fontSize: 11, marginBottom: 2 },
  mapSelectedAddr: { color: '#fff', fontSize: 13, fontWeight: '600' },
  mapConfirmBarBtn: {
    backgroundColor: ACCENT, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, minWidth: 90, alignItems: 'center',
  },
  mapConfirmBarBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },

  // (레거시 호환 - 사용 안 함)
  mapHintBox: { backgroundColor: '#FFF5F0', paddingVertical: 10, paddingHorizontal: 16 },
  mapHintText2: { fontSize: 13, color: '#FF6B35', fontWeight: '600', textAlign: 'center' },
  mapCoordBar: { backgroundColor: 'rgba(0,0,0,0.7)', paddingVertical: 10, paddingHorizontal: 16 },
  mapCoordText: { color: '#fff', fontSize: 12, textAlign: 'center' },
});
