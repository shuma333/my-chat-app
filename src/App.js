import { useEffect, useState, useRef } from "react";
import { db, auth } from "./firebase.js";
import {
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp,
  doc, setDoc, getDoc, updateDoc, arrayUnion
} from "firebase/firestore";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "firebase/auth";

function App() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showNicknameInput, setShowNicknameInput] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");
  const [userProfiles, setUserProfiles] = useState({});
  const [notificationPermission, setNotificationPermission] = useState('default');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const lastMessageIdRef = useRef(null);

  // PWA通知の初期化
  useEffect(() => {
    // Service Worker登録
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('Service Worker registered:', registration);
        })
        .catch((error) => {
          console.log('Service Worker registration failed:', error);
        });
    }

    // 通知権限の確認
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  // 通知権限をリクエスト
  const requestNotificationPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      return permission === 'granted';
    }
    return Notification.permission === 'granted';
  };

  // 通知を表示
  const showNotification = (title, body, icon = '/icon-192.png') => {
    if ('Notification' in window && Notification.permission === 'granted') {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        // Service Worker経由で通知
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          payload: { title, body, icon }
        });
      } else {
        // 直接通知
        // eslint-disable-next-line no-new
        new Notification(title, { body, icon });
      }
    }
  };

  // ログイン状態を保持
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log("認証状態変更:", currentUser?.email || "ログアウト");
      setUser(currentUser);
      
      if (currentUser) {
        await loadUserProfile(currentUser.uid);
        // ログイン時に通知権限をリクエスト
        await requestNotificationPermission();
      } else {
        setUserProfile(null);
      }
    });
    return unsubscribe;
  }, []);

  // ユーザープロファイルを読み込み
  const loadUserProfile = async (uid) => {
    try {
      const profileDoc = await getDoc(doc(db, "users", uid));
      if (profileDoc.exists()) {
        const profile = profileDoc.data();
        setUserProfile(profile);
        console.log("プロファイル読み込み:", profile);
      } else {
        console.log("プロファイルが見つかりません。新規作成が必要です。");
        setShowNicknameInput(true);
      }
    } catch (error) {
      console.error("プロファイル読み込みエラー:", error);
    }
  };

  // ニックネームを保存
  const saveNickname = async () => {
    if (!nicknameInput.trim() || !user) return;

    try {
      const profile = {
        uid: user.uid,
        email: user.email,
        nickname: nicknameInput.trim(),
        createdAt: serverTimestamp(),
        lastSeen: serverTimestamp()
      };

      await setDoc(doc(db, "users", user.uid), profile);
      setUserProfile(profile);
      setShowNicknameInput(false);
      setNicknameInput("");
      console.log("ニックネーム保存成功:", profile);
    } catch (error) {
      console.error("ニックネーム保存エラー:", error);
      window.alert("ニックネームの保存に失敗しました");
    }
  };

  // メッセージを既読にする
  const markAsRead = async (messageId) => {
    if (!user || !messageId) return;
    
    try {
      const messageRef = doc(db, "messages", messageId);
      await updateDoc(messageRef, {
        readBy: arrayUnion(user.uid)
      });
    } catch (error) {
      console.error("既読更新エラー:", error);
    }
  };

  // 最後のアクティブ時刻を更新
  const updateLastSeen = async () => {
    if (!user) return;
    
    try {
      await updateDoc(doc(db, "users", user.uid), {
        lastSeen: serverTimestamp()
      });
    } catch (error) {
      console.error("最終閲覧時刻更新エラー:", error);
    }
  };

  // ページがアクティブになった時の処理
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && user) {
        updateLastSeen();
        // 表示されているメッセージを既読にする
        messages.forEach(msg => {
          if (msg.uid !== user.uid && (!msg.readBy || !msg.readBy.includes(user.uid))) {
            markAsRead(msg.id);
          }
        });
      }
    };

    const handleBeforeUnload = () => {
      if (user) {
        updateLastSeen();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user, messages]);

  // メッセージをリアルタイム取得
  useEffect(() => {
    if (!user || !userProfile) {
      setMessages([]);
      return;
    }

    console.log("メッセージリスナーを設定中...");
    const messagesRef = collection(db, "messages");
    const q = query(messagesRef, orderBy("createdAt", "asc"));
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      console.log("メッセージ更新:", snapshot.docs.length, "件");
      const newMessages = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      }));
      
      // 新着メッセージの通知チェック
      if (lastMessageIdRef.current && newMessages.length > 0) {
        const lastIndex = newMessages.findIndex(msg => msg.id === lastMessageIdRef.current);
        if (lastIndex !== -1 && lastIndex < newMessages.length - 1) {
          // 新着メッセージがある
          const newMessagesOnly = newMessages.slice(lastIndex + 1);
          newMessagesOnly.forEach(msg => {
            if (msg.uid !== user.uid && document.hidden) {
              // 自分以外のメッセージで、画面が非表示の場合に通知
              const senderName = msg.nickname || userProfiles[msg.uid]?.nickname || msg.email;
              showNotification(
                `新着メッセージ from ${senderName}`,
                msg.text,
                '/icon-192.png'
              );
            }
          });
        }
      }
      
      // 最新メッセージIDを記録
      if (newMessages.length > 0) {
        lastMessageIdRef.current = newMessages[newMessages.length - 1].id;
      }
      
      // メッセージに含まれるユーザーのプロファイルを取得
      const userIds = [...new Set(newMessages.map(msg => msg.uid))];
      const profiles = {};
      
      for (const uid of userIds) {
        if (!userProfiles[uid] && uid !== user.uid) {
          try {
            const profileDoc = await getDoc(doc(db, "users", uid));
            if (profileDoc.exists()) {
              profiles[uid] = profileDoc.data();
            }
          } catch (error) {
            console.error("プロファイル取得エラー:", error);
          }
        }
      }
      
      setUserProfiles(prev => ({ ...prev, ...profiles }));
      setMessages(newMessages);
      
      // 画面がアクティブな場合、未読メッセージを既読にする
      if (!document.hidden) {
        setTimeout(() => {
          newMessages.forEach(msg => {
            if (msg.uid !== user.uid && (!msg.readBy || !msg.readBy.includes(user.uid))) {
              markAsRead(msg.id);
            }
          });
        }, 1000); // 1秒後に既読処理
      }
      
      setTimeout(scrollToBottom, 100);
    }, (error) => {
      console.error("メッセージ取得エラー:", error);
    });

    return unsubscribe;
  }, [user, userProfile, userProfiles]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // ユーザー名を取得する関数
  const getUserDisplayName = (msg) => {
    if (msg.uid === user.uid) {
      return null;
    }
    
    if (msg.nickname) {
      return msg.nickname;
    }
    
    if (userProfiles[msg.uid]?.nickname) {
      return userProfiles[msg.uid].nickname;
    }
    
    return msg.email;
  };

  // 既読状況を取得
  const getReadStatus = (msg) => {
    if (msg.uid === user.uid) {
      // 自分のメッセージの場合、他の人が読んだかチェック
      const readBy = msg.readBy || [];
      const otherUsers = Object.keys(userProfiles).filter(uid => uid !== user.uid);
      const readByOthers = readBy.filter(uid => uid !== user.uid);
      
      if (otherUsers.length === 0) return ""; // 他にユーザーがいない
      if (readByOthers.length === otherUsers.length) return "既読";
      if (readByOthers.length > 0) return `${readByOthers.length}人が既読`;
      return "未読";
    }
    return "";
  };

  // ログイン
  const login = async () => {
    // eslint-disable-next-line no-alert
    const email = window.prompt("メールアドレスを入力してください");
    // eslint-disable-next-line no-alert
    const password = window.prompt("パスワードを入力してください");
    if (!email || !password) return;

    try {
      console.log("ログイン試行中...");
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      console.log("ログイン成功:", userCredential.user.email);
    } catch (error) {
      console.log("ログイン失敗、アカウント作成を試行中...");
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        console.log("アカウント作成成功:", userCredential.user.email);
      } catch (createError) {
        console.error("アカウント作成エラー:", createError);
        // eslint-disable-next-line no-alert
        window.alert("ログインまたはアカウント作成に失敗しました。メールアドレスとパスワードを確認してください。");
      }
    }
  };

  // ログアウト
  const logout = async () => {
    // eslint-disable-next-line no-restricted-globals
    if (window.confirm("ログアウトしますか？")) {
      console.log("ログアウト中...");
      await updateLastSeen(); // ログアウト前に最終閲覧時刻を更新
      await signOut(auth);
      setUser(null);
      setUserProfile(null);
      setMessages([]);
      setShowNicknameInput(false);
    }
  };

  // メッセージ送信
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading || !userProfile) return;

    setLoading(true);
    const messageText = input.trim();
    setInput(""); // 先にクリアして反応を良くする

    try {
      await addDoc(collection(db, "messages"), {
        text: messageText,
        createdAt: serverTimestamp(),
        uid: user.uid,
        email: user.email,
        nickname: userProfile.nickname,
        readBy: [user.uid] // 送信者は自動的に既読
      });
      console.log("メッセージ送信成功");
      
      // 送信後、入力欄にフォーカスを戻す
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    } catch (error) {
      console.error("メッセージ送信エラー:", error);
      // eslint-disable-next-line no-alert
      window.alert("メッセージの送信に失敗しました");
      setInput(messageText); // エラー時は元に戻す
    } finally {
      setLoading(false);
    }
  };

  // ニックネーム変更
  const changeNickname = () => {
    // eslint-disable-next-line no-alert
    const newNickname = window.prompt("新しいニックネームを入力してください", userProfile?.nickname || "");
    if (newNickname && newNickname.trim() !== userProfile?.nickname) {
      setNicknameInput(newNickname.trim());
      setShowNicknameInput(true);
    }
  };

  // 日付フォーマット関数
  const formatDate = (timestamp) => {
    if (!timestamp) return "";
    
    const date = timestamp.toDate();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    const timeDiff = today.getTime() - messageDate.getTime();
    const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
    
    if (daysDiff === 0) {
      return date.toLocaleTimeString('ja-JP', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } else if (daysDiff === 1) {
      return "昨日 " + date.toLocaleTimeString('ja-JP', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } else if (daysDiff < 7) {
      const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
      return dayNames[date.getDay()] + "曜日 " + date.toLocaleTimeString('ja-JP', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } else {
      return date.toLocaleDateString('ja-JP') + " " + date.toLocaleTimeString('ja-JP', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    }
  };

  // Enterキーでの送信（Shift+Enterで改行）
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(e);
    }
  };

  // 通知テスト
  const testNotification = () => {
    if ('Notification' in window && Notification.permission === 'granted') {
      showNotification('テスト通知', 'チャットアプリの通知が正常に動作しています！');
    } else {
      requestNotificationPermission().then(granted => {
        if (granted) {
          showNotification('通知が有効になりました！', 'バックグラウンドでも通知を受け取れます。');
        }
      });
    }
  };

  // ログインしていない場合
  if (!user) {
    return (
      <div style={{ 
        display: "flex", 
        flexDirection: "column",
        justifyContent: "center", 
        alignItems: "center", 
        height: "100vh",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        backgroundColor: "#f5f5f5"
      }}>
        <div style={{
          backgroundColor: "white",
          padding: "40px",
          borderRadius: "16px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          textAlign: "center",
          maxWidth: "400px",
          width: "90%"
        }}>
          <h1 style={{ 
            margin: "0 0 20px 0", 
            color: "#333",
            fontSize: "28px"
          }}>
            💬 チャットアプリ
          </h1>
          <p style={{ 
            color: "#666", 
            marginBottom: "30px",
            lineHeight: "1.5"
          }}>
            リアルタイムでメッセージをやり取りしましょう<br/>
            <small>既読機能・プッシュ通知対応</small>
          </p>
          <button 
            onClick={login}
            style={{
              padding: "16px 32px",
              fontSize: "16px",
              borderRadius: "12px",
              border: "none",
              backgroundColor: "#007bff",
              color: "white",
              cursor: "pointer",
              fontWeight: "600",
              transition: "background-color 0.2s",
              width: "100%"
            }}
          >
            ログイン / 新規登録
          </button>
        </div>
      </div>
    );
  }

  // ニックネーム設定画面
  if (showNicknameInput) {
    return (
      <div style={{ 
        display: "flex", 
        flexDirection: "column",
        justifyContent: "center", 
        alignItems: "center", 
        height: "100vh",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        backgroundColor: "#f5f5f5"
      }}>
        <div style={{
          backgroundColor: "white",
          padding: "40px",
          borderRadius: "16px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          textAlign: "center",
          maxWidth: "400px",
          width: "90%"
        }}>
          <h2 style={{ 
            margin: "0 0 20px 0", 
            color: "#333",
            fontSize: "24px"
          }}>
            ニックネームを設定
          </h2>
          <p style={{ 
            color: "#666", 
            marginBottom: "20px",
            lineHeight: "1.5"
          }}>
            チャットで表示される名前を入力してください
          </p>
          <input
            type="text"
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            placeholder="ニックネームを入力"
            style={{
              width: "100%",
              padding: "16px",
              fontSize: "16px",
              borderRadius: "12px",
              border: "2px solid #e0e0e0",
              outline: "none",
              marginBottom: "20px",
              boxSizing: "border-box",
              transition: "border-color 0.2s"
            }}
            onKeyDown={(e) => e.key === 'Enter' && saveNickname()}
            autoFocus
          />
          <button 
            onClick={saveNickname}
            disabled={!nicknameInput.trim()}
            style={{
              width: "100%",
              padding: "16px",
              fontSize: "16px",
              borderRadius: "12px",
              border: "none",
              backgroundColor: nicknameInput.trim() ? "#28a745" : "#e0e0e0",
              color: nicknameInput.trim() ? "white" : "#999",
              cursor: nicknameInput.trim() ? "pointer" : "not-allowed",
              fontWeight: "600",
              transition: "background-color 0.2s"
            }}
          >
            開始する
          </button>
        </div>
      </div>
    );
  }

  // プロファイル読み込み中
  if (!userProfile) {
    return (
      <div style={{ 
        display: "flex", 
        justifyContent: "center", 
        alignItems: "center", 
        height: "100vh",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        backgroundColor: "#f5f5f5"
      }}>
        <div style={{
          backgroundColor: "white",
          padding: "40px",
          borderRadius: "16px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          textAlign: "center"
        }}>
          <div style={{ fontSize: "18px", color: "#666" }}>
            読み込み中...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      backgroundColor: "#f5f5f5"
    }}>
      {/* ヘッダー */}
      <div style={{ 
        backgroundColor: "white",
        borderBottom: "1px solid #e0e0e0",
        padding: "16px 20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: "40px",
            height: "40px",
            borderRadius: "50%",
            backgroundColor: "#007bff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontWeight: "bold",
            fontSize: "18px"
          }}>
            {userProfile.nickname.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: "600", color: "#333", fontSize: "16px" }}>
              {userProfile.nickname}
            </div>
            <div style={{ fontSize: "12px", color: "#666" }}>
              {user.email}
            </div>
          </div>
        </div>
        
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {/* 通知状態表示 */}
          <button
            onClick={testNotification}
            style={{
              padding: "8px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: notificationPermission === 'granted' ? "#28a745" : "#ffc107",
              color: "white",
              cursor: "pointer",
              fontSize: "14px"
            }}
            title={notificationPermission === 'granted' ? "通知テスト" : "通知を有効にする"}
          >
            {notificationPermission === 'granted' ? "🔔" : "🔕"}
          </button>
          
          <button 
            onClick={changeNickname} 
            style={{ 
              padding: "8px 16px", 
              borderRadius: "8px",
              border: "1px solid #007bff",
              backgroundColor: "white",
              color: "#007bff",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "500"
            }}
          >
            名前変更
          </button>
          <button 
            onClick={logout} 
            style={{ 
              padding: "8px 16px", 
              borderRadius: "8px",
              border: "1px solid #dc3545",
              backgroundColor: "white",
              color: "#dc3545",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "500"
            }}
          >
            ログアウト
          </button>
        </div>
      </div>

      {/* チャットエリア */}
      <div style={{ 
        flex: 1,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        maxWidth: "800px",
        margin: "0 auto",
        width: "100%"
      }}>
        {/* メッセージ一覧 */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px",
          backgroundColor: "#fafafa"
        }}>
          {messages.length === 0 ? (
            <div style={{ 
              textAlign: "center", 
              color: "#999", 
              padding: "60px 20px",
              fontSize: "16px"
            }}>
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>💬</div>
              <div>まだメッセージがありません</div>
              <div style={{ fontSize: "14px", marginTop: "8px" }}>
                最初のメッセージを送信してみましょう！
              </div>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} style={{
                display: "flex",
                justifyContent: msg.uid === user.uid ? "flex-end" : "flex-start",
                marginBottom: "16px"
              }}>
                <div style={{
                  maxWidth: "70%",
                  minWidth: "100px"
                }}>
                  {/* 相手のメッセージの場合、名前を表示 */}
                  {msg.uid !== user.uid && (
                    <div style={{ 
                      fontSize: "12px", 
                      color: "#666", 
                      marginBottom: "4px",
                      marginLeft: "12px",
                      fontWeight: "500"
                    }}>
                      {getUserDisplayName(msg)}
                    </div>
                  )}
                  
                  <div style={{
                    backgroundColor: msg.uid === user.uid ? "#007bff" : "white",
                    color: msg.uid === user.uid ? "white" : "#333",
                    padding: "12px 16px",
                    borderRadius: msg.uid === user.uid ? "20px 20px 4px 20px" : "20px 20px 20px 4px",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                    wordBreak: "break-word",
                    lineHeight: "1.4"
                  }}>
                    <div style={{ marginBottom: "4px" }}>{msg.text}</div>
                    
                    {/* 時刻と既読状況表示 */}
                    <div style={{
                      fontSize: "11px",
                      opacity: 0.7,
                      textAlign: msg.uid === user.uid ? "right" : "left",
                      marginTop: "4px",
                      display: "flex",
                      justifyContent: msg.uid === user.uid ? "flex-end" : "flex-start",
                      alignItems: "center",
                      gap: "8px"
                    }}>
                      {msg.createdAt && (
                        <span>{formatDate(msg.createdAt)}</span>
                      )}
                      {msg.uid === user.uid && getReadStatus(msg) && (
                        <span style={{
                          backgroundColor: "rgba(255,255,255,0.2)",
                          padding: "2px 6px",
                          borderRadius: "8px",
                          fontSize: "10px"
                        }}>
                          {getReadStatus(msg)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 入力エリア */}
        <div style={{
          backgroundColor: "white",
          borderTop: "1px solid #e0e0e0",
          padding: "20px"
        }}>
          <form onSubmit={sendMessage} style={{ 
            display: "flex", 
            gap: "12px", 
            alignItems: "flex-end" 
          }}>
            <div style={{ flex: 1 }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="メッセージを入力... (Enter: 送信, Shift+Enter: 改行)"
                disabled={loading}
                rows={1}
                style={{ 
                  width: "100%", 
                  padding: "12px 16px", 
                  borderRadius: "20px", 
                  border: "2px solid #e0e0e0",
                  outline: "none",
                  fontSize: "16px",
                  fontFamily: "inherit",
                  resize: "none",
                  minHeight: "48px",
                  maxHeight: "120px",
                  boxSizing: "border-box",
                  transition: "border-color 0.2s"
                }}
                onFocus={(e) => e.target.style.borderColor = "#007bff"}
                onBlur={(e) => e.target.style.borderColor = "#e0e0e0"}
              />
            </div>
            
            <button 
              type="submit" 
              disabled={loading || !input.trim()}
              style={{ 
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                border: "none",
                backgroundColor: (loading || !input.trim()) ? "#e0e0e0" : "#007bff",
                color: "white",
                cursor: (loading || !input.trim()) ? "not-allowed" : "pointer",
                fontSize: "18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background-color 0.2s",
                flexShrink: 0
              }}
              onMouseOver={(e) => {
                if (!loading && input.trim()) {
                  e.target.style.backgroundColor = "#0056b3";
                }
              }}
              onMouseOut={(e) => {
                if (!loading && input.trim()) {
                  e.target.style.backgroundColor = "#007bff";
                }
              }}
            >
              {loading ? "⏳" : "📤"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;