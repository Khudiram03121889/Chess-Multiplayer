import { initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { getDatabase, ref, onValue } from 'firebase/database';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: "AIzaSyBp8hIlxYuJJPELWGlK87cOApBNfHVuRO4",
  authDomain: "chess-web-app-26069.firebaseapp.com",
  databaseURL: "https://chess-web-app-26069-default-rtdb.firebaseio.com",
  projectId: "chess-web-app-26069",
  storageBucket: "chess-web-app-26069.firebasestorage.app",
  messagingSenderId: "619379564323",
  appId: "1:619379564323:web:f385235399e04ee04c7696"
};

const app = initializeApp(firebaseConfig);

const initializeFirebaseAuth = (): Auth => {
  const { initializeAuth, getAuth, browserLocalPersistence } = FirebaseAuth;
  const getReactNativePersistence = (FirebaseAuth as any).getReactNativePersistence as
    | ((storage: typeof AsyncStorage) => unknown)
    | undefined;

  try {
    const persistence =
      Platform.OS === 'web'
        ? browserLocalPersistence
        : typeof getReactNativePersistence === 'function'
          ? getReactNativePersistence(AsyncStorage)
          : undefined;

    return persistence
      ? initializeAuth(app, { persistence: persistence as any })
      : initializeAuth(app);
  } catch (error: any) {
    if (error?.code !== 'auth/already-initialized') {
      console.warn(
        'Firebase Auth persistence unavailable; falling back to default auth.',
        error?.message || error
      );
    }
    return getAuth(app);
  }
};

export const auth = initializeFirebaseAuth();

export const db = getDatabase(app);

export let serverTimeOffset = 0;
try {
  onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    serverTimeOffset = snap.val() || 0;
  });
} catch (e) {
  console.warn("Failed to attach serverTimeOffset listener");
}

export const getServerTime = () => Date.now() + serverTimeOffset;
