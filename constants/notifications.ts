import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const REMINDER_SETTINGS_KEY = 'notif_daily_reminder';
const STREAK_NOTIF_ID_KEY = 'notif_streak_id';

export type ReminderSettings = {
  enabled: boolean;
  hour: number;
  minute: number;
};

// 앱 시작 시 알림 핸들러 + 안드로이드 채널 초기화
export const initNotifications = async () => {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('runmate', {
      name: 'RunMate 알림',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF6B35',
    });
  }
};

// 알림 권한 요청
export const requestNotificationPermission = async (): Promise<boolean> => {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
};

// 권한 상태 확인
export const getNotificationPermission = async (): Promise<boolean> => {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
};

// 일일 리마인더 설정 불러오기
export const getReminderSettings = async (): Promise<ReminderSettings> => {
  try {
    const raw = await AsyncStorage.getItem(REMINDER_SETTINGS_KEY);
    if (!raw) return { enabled: false, hour: 7, minute: 0 };
    return JSON.parse(raw);
  } catch {
    return { enabled: false, hour: 7, minute: 0 };
  }
};

// 일일 리마인더 설정 저장 + 스케줄
export const setDailyReminder = async (enabled: boolean, hour: number, minute: number) => {
  await AsyncStorage.setItem(REMINDER_SETTINGS_KEY, JSON.stringify({ enabled, hour, minute }));

  // 기존 일일 알림 전체 취소
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if ((n.content.data as any)?.type === 'daily_reminder') {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  if (!enabled) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🏃 오늘 달릴 시간이에요!',
      body: '잠깐 달려도 충분해요. 신발 온도를 높여볼까요? 💪',
      sound: true,
      data: { type: 'daily_reminder' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    } as any,
  });
};

// 스트릭 경고 — 오늘 달리지 않은 경우 저녁 8시에 알림
export const scheduleStreakWarning = async (streak: number) => {
  if (streak === 0) return;

  // 기존 스트릭 알림 취소
  await cancelStreakWarning();

  const now = new Date();
  const eightPm = new Date();
  eightPm.setHours(20, 0, 0, 0);
  if (now >= eightPm) return; // 이미 오후 8시 지남

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: `🔥 ${streak}일 연속 달리기가 끊길 것 같아요!`,
      body: '오늘 조금만 달려서 연속 기록을 지켜보세요! 달팽이도 달릴 수 있어요 🐌',
      sound: true,
      data: { type: 'streak_warning' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: eightPm,
    } as any,
  });

  await AsyncStorage.setItem(STREAK_NOTIF_ID_KEY, id);
};

// 러닝 중 백그라운드 전환 알림
export const showRunningBgNotif = async () => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🏃 RunMate 러닝 기록 중',
        body: '앱으로 돌아오면 계속 기록돼요. GPS는 유지 중이에요!',
        sound: false,
        data: { type: 'running_bg' },
      },
      trigger: null,
    });
  } catch { /* ignore */ }
};

export const cancelRunningBgNotif = async () => {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) {
      if ((n.request.content.data as any)?.type === 'running_bg') {
        await Notifications.dismissNotificationAsync(n.request.identifier);
      }
    }
  } catch { /* ignore */ }
};

// 스트릭 경고 취소 (오늘 달린 경우)
export const cancelStreakWarning = async () => {
  try {
    const id = await AsyncStorage.getItem(STREAK_NOTIF_ID_KEY);
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id);
      await AsyncStorage.removeItem(STREAK_NOTIF_ID_KEY);
    }
  } catch { /* ignore */ }
};
