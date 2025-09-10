// Firebase Cloud Messaging Service Worker
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';

// Firebase設定（あなたの設定に置き換えてください）
const firebaseConfig = {
  apiKey: "AIzaSyASSBhQDpVDxj651Q8CdKExjiJAKqkOcc4",
  authDomain: "chat-cdbe4.firebaseapp.com",
  projectId: "chat-cdbe4",
  storageBucket: "chat-cdbe4.firebasestorage.app",
  messagingSenderId: "1065013893555",
  appId: "1:1065013893555:web:a5206056669d12cde693c6"
};

// Firebase初期化
const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

// バックグラウンドメッセージの処理
onBackgroundMessage(messaging, (payload) => {
  console.log('FCM: Background message received', payload);

  const notificationTitle = payload.notification?.title || 'チャットアプリ';
  const notificationOptions = {
    body: payload.notification?.body || '新着メッセージがあります',
    icon: payload.notification?.icon || '/icon-192.png',
    badge: '/icon-72.png',
    tag: 'chat-message',
    requireInteraction: true,
    actions: [
      {
        action: 'open',
        title: '開く',
        icon: '/icon-72.png'
      },
      {
        action: 'close',
        title: '閉じる'
      }
    ],
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

console.log('FCM: Service Worker loaded');