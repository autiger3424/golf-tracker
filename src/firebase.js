import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDIcbwdqUC_LA-GROS1zGnwq3R2ChwXoA0",
  authDomain: "grady-golftrack.firebaseapp.com",
  projectId: "grady-golftrack",
  storageBucket: "grady-golftrack.firebasestorage.app",
  messagingSenderId: "447455043481",
  appId: "1:447455043481:web:44b6c6aa95afad61017d08",
  measurementId: "G-ECNY9RCLLQ"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
