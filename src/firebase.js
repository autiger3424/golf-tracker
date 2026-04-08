// Firebase configuration for Grady GolfTrack
// To set up:
// 1. Go to https://console.firebase.google.com
// 2. Create a project (or use an existing one)
// 3. Add a Web app — copy the firebaseConfig values below
// 4. Enable Firestore Database (Build → Firestore Database → Create → Start in test mode)
// 5. Enable Authentication (Build → Authentication → Get Started → Google → Enable)
// 6. Replace the placeholder values below with your real config, then redeploy

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
