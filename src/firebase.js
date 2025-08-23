import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyASSBhQDpVDxj651Q8CdKExjiJAKqkOcc4",
  authDomain: "chat-cdbe4.firebaseapp.com",
  projectId: "chat-cdbe4",
  storageBucket: "chat-cdbe4.firebasestorage.app",
  messagingSenderId: "1065013893555",
  appId: "1:1065013893555:web:a5206056669d12cde693c6"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);   // 名前付きエクスポート
export const auth = getAuth(app);      // 名前付きエクスポート
