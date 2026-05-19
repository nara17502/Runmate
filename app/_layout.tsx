import { useEffect, useState, createContext, useContext } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { getDoc, doc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { initNotifications } from '../constants/notifications';
import '../constants/locationTask'; // registers background location task on every boot

type ProfileCtx = { markProfileComplete: () => void };
export const ProfileContext = createContext<ProfileCtx>({ markProfileComplete: () => {} });
export const useProfileContext = () => useContext(ProfileContext);

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profileDone, setProfileDone] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    initNotifications();
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setIsLoggedIn(false);
        setProfileDone(false);
        setReady(true);
        return;
      }

      setIsLoggedIn(true);
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        setProfileDone(snap.exists() && !!snap.data()?.nickname?.trim());
      } catch {
        setProfileDone(false);
      }
      setReady(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!ready) return;

    const inAuth = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';

    if (!isLoggedIn) {
      if (!inAuth) router.replace('/(auth)/login');
      return;
    }

    if (!profileDone) {
      if (!inOnboarding) router.replace('/(onboarding)/setup');
      return;
    }

    if (inAuth || inOnboarding) router.replace('/(tabs)');
  }, [ready, isLoggedIn, profileDone, segments]);

  return (
    <ProfileContext.Provider value={{ markProfileComplete: () => setProfileDone(true) }}>
      <Slot />
    </ProfileContext.Provider>
  );
}
