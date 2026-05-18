import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCVwmaLiColqicDRk1MWYmDQlADYRmsXjw",
  authDomain: "runmate-1beee.firebaseapp.com",
  projectId: "runmate-1beee",
  storageBucket: "runmate-1beee.firebasestorage.app",
  messagingSenderId: "855614468338",
  appId: "1:855614468338:web:bfdf1217db5da29fa3e06b"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
