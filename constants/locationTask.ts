import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LOCATION_TASK = 'runmate-bg-location';
const BG_LOCS_KEY = 'runmate_bg_locs';

// Set by the running screen when foregrounded; null when backgrounded
export let onLocation: ((lat: number, lon: number) => void) | null = null;
export const setOnLocation = (cb: ((lat: number, lon: number) => void) | null) => {
  onLocation = cb;
};

export const clearBgLocations = () =>
  AsyncStorage.removeItem(BG_LOCS_KEY).catch(() => {});

export const getBgLocations = async (): Promise<[number, number][]> => {
  try {
    const s = await AsyncStorage.getItem(BG_LOCS_KEY);
    return s ? JSON.parse(s) : [];
  } catch {
    return [];
  }
};

TaskManager.defineTask(LOCATION_TASK, ({ data, error }: TaskManager.TaskManagerTaskBody) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  for (const loc of locations) {
    const lat = loc.coords.latitude;
    const lon = loc.coords.longitude;
    if (onLocation) {
      onLocation(lat, lon);
    } else {
      // Backgrounded: buffer to AsyncStorage so the screen can merge on resume
      AsyncStorage.getItem(BG_LOCS_KEY)
        .then(s => {
          const arr: [number, number][] = s ? JSON.parse(s) : [];
          arr.push([lat, lon]);
          return AsyncStorage.setItem(BG_LOCS_KEY, JSON.stringify(arr));
        })
        .catch(() => {});
    }
  }
});
