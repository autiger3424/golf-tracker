// Firebase configuration for Grady GolfTrack
// Shared family database — no accounts needed, everyone reads and writes together.
//
// Setup (one time):
// 1. Go to https://console.firebase.google.com → Create a project
// 2. Build → Firestore Database → Create database → Start in test mode
// 3. Project Settings (gear icon) → Your apps → Add web app → copy firebaseConfig values below
// 4. In Firestore → Rules tab, paste and publish:
//
//    rules_version = '2';
//    service cloud.firestore {
//      match /databases/{database}/documents {
//        match /{document=**} {
//          allow read, write: if true;
//        }
//      }
//    }
//
// 5. Replace the placeholder values below with your real config, then redeploy.

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// Only initialize if the config has been filled in — otherwise fall back to localStorage
const isConfigured = firebaseConfig.projectId !== "YOUR_PROJECT_ID";

export const db = isConfigured ? getFirestore(initializeApp(firebaseConfig)) : null;
