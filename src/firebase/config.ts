import { initializeApp } from 'firebase/app';
// @ts-ignore
import { initializeAuth, getReactNativePersistence, browserLocalPersistence } from 'firebase/auth';
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

export const auth = initializeAuth(app, {
  persistence: Platform.OS === 'web' ? browserLocalPersistence : getReactNativePersistence(AsyncStorage)
});

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
