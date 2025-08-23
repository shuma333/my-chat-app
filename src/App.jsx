import { useEffect, useState, useRef } from "react";
import { db, auth } from "./firebase.js";
import {
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp,
  doc, setDoc, getDoc
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
  const [userProfiles, setUserProfiles] = useState({}); // 全ユーザーのプロフィール
  const messagesEndRef = useRef(null);

  // ログイン状態を保持
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log("認証状態変更:", currentUser?.email || "ログアウト");
      setUser(currentUser);
      
      if (currentUser) {
        // ユーザープロフィールを取得
        await loadUserProfile(currentUser.uid);
      } else {
        setUserProfile(null);
      }
    });
    return unsubscribe;
  }, []);

  // ユーザープロフィールを読み込み
  const loadUserProfile = async (uid) => {
    try {
      const profileDoc = await getDoc(doc(db, "users", uid));
      if (profileDoc.exists()) {
        const profile = profileDoc.data();
        setUserProfile(profile);
        console.log("プロフィール読み込み:", profile);
      } else {
        console.log("プロフィールが見つかりません。新規作成が必要です。");
        setShowNicknameInput(true);
      }
    } catch (error) {
      console.error("プロフィール読み込みエラー:", error);
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
        createdAt: serverTimestamp()
      };

      await setDoc(doc(db, "users", user.uid), profile);
      setUserProfile(profile);
      setShowNicknameInput(false);
      setNicknameInput("");
      console.log("ニックネーム保存成功:", profile);
    } catch (error) {
      console.error("ニックネーム保存エラー:", error);
      alert("ニックネームの保存に失敗しました");
    }
  };

  // メッセージをリアルタイム取得（ユーザーがログインしている時のみ）
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
      
      // メッセージに含まれるユーザーのプロフィールを取得
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
            console.error("プロフィール取得エラー:", error);
          }
        }
      }
      
      setUserProfiles(prev => ({ ...prev, ...profiles }));
      setMessages(newMessages);
      
      // 少し遅延してスクロール（DOMの更新を待つ）
      setTimeout(scrollToBottom, 100);
    }, (error) => {
      console.error("メッセージ取得エラー:", error);
    });

    return unsubscribe;
  }, [user, userProfile]); // userProfileも依存に追加

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // ユーザー名を取得する関数
  const getUserDisplayName = (msg) => {
    if (msg.uid === user.uid) {
      return null; // 自分のメッセージには名前を表示しない
    }
    
    // メッセージにニックネームが含まれている場合
    if (msg.nickname) {
      return msg.nickname;
    }
    
    // プロフィールからニックネームを取得
    if (userProfiles[msg.uid]?.nickname) {
      return userProfiles[msg.uid].nickname;
    }
    
    // フォールバックとしてメールアドレス
    return msg.email;
  };

  // ログイン
  const login = async () => {
    const email = prompt("メールアドレスを入力");
    const password = prompt("パスワードを入力");
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
        alert("ログインまたはアカウント作成に失敗しました");
      }
    }
  };

  // ログアウト
  const logout = async () => {
    console.log("ログアウト中...");
    await signOut(auth);
    setUser(null);
    setUserProfile(null);
    setMessages([]);
    setShowNicknameInput(false);
  };

  // メッセージ送信
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading || !userProfile) return;

    setLoading(true);
    console.log("メッセージ送信中:", input.trim());

    try {
      await addDoc(collection(db, "messages"), {
        text: input.trim(),
        createdAt: serverTimestamp(),
        uid: user.uid,
        email: user.email,
        nickname: userProfile.nickname, // ニックネームも保存
      });
      console.log("メッセージ送信成功");
      setInput(""); // 入力欄をクリア
    } catch (error) {
      console.error("メッセージ送信エラー:", error);
      alert("メッセージの送信に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  // ニックネーム変更
  const changeNickname = () => {
    const newNickname = prompt("新しいニックネームを入力", userProfile?.nickname || "");
    if (newNickname && newNickname.trim() !== userProfile?.nickname) {
      setNicknameInput(newNickname.trim());
      setShowNicknameInput(true);
    }
  };

  // ログインしていない場合
  if (!user) {
    return (
      <div style={{ 
        display: "flex", 
        justifyContent: "center", 
        alignItems: "center", 
        height: "100vh",
        fontFamily: "sans-serif" 
      }}>
        <button 
          onClick={login}
          style={{
            padding: "12px 24px",
            fontSize: "16px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: "#007bff",
            color: "white",
            cursor: "pointer"
          }}
        >
          ログイン / サインアップ
        </button>
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
        fontFamily: "sans-serif",
        gap: "20px"
      }}>
        <h2>ニックネームを設定してください</h2>
        <input
          type="text"
          value={nicknameInput}
          onChange={(e) => setNicknameInput(e.target.value)}
          placeholder="ニックネームを入力"
          style={{
            padding: "12px",
            fontSize: "16px",
            borderRadius: "8px",
            border: "1px solid #ccc",
            width: "300px"
          }}
          onKeyDown={(e) => e.key === 'Enter' && saveNickname()}
          autoFocus
        />
        <button 
          onClick={saveNickname}
          disabled={!nicknameInput.trim()}
          style={{
            padding: "12px 24px",
            fontSize: "16px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: nicknameInput.trim() ? "#28a745" : "#ccc",
            color: "white",
            cursor: nicknameInput.trim() ? "pointer" : "not-allowed"
          }}
        >
          保存
        </button>
      </div>
    );
  }

  // プロフィール読み込み中
  if (!userProfile) {
    return (
      <div style={{ 
        display: "flex", 
        justifyContent: "center", 
        alignItems: "center", 
        height: "100vh",
        fontFamily: "sans-serif" 
      }}>
        読み込み中...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: "20px auto", fontFamily: "sans-serif" }}>
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        padding: "10px 0",
        borderBottom: "1px solid #eee",
        marginBottom: "10px"
      }}>
        <div>
          <span style={{ fontWeight: "bold", color: "#007bff" }}>
            {userProfile.nickname}
          </span>
          <span style={{ fontSize: "12px", color: "#666", marginLeft: "8px" }}>
            ({user.email})
          </span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button 
            onClick={changeNickname} 
            style={{ 
              padding: "6px 12px", 
              borderRadius: "4px",
              border: "1px solid #007bff",
              backgroundColor: "white",
              color: "#007bff",
              cursor: "pointer",
              fontSize: "12px"
            }}
          >
            名前変更
          </button>
          <button 
            onClick={logout} 
            style={{ 
              padding: "6px 12px", 
              borderRadius: "4px",
              border: "1px solid #ccc",
              backgroundColor: "#f8f9fa",
              cursor: "pointer",
              fontSize: "12px"
            }}
          >
            ログアウト
          </button>
        </div>
      </div>

      {/* チャット画面 */}
      <div style={{ padding: 10 }}>
        <div style={{
          border: "1px solid #ccc",
          padding: 10,
          height: 400,
          overflowY: "auto",
          borderRadius: 10,
          marginBottom: 10,
          backgroundColor: "#f9f9f9"
        }}>
          {messages.length === 0 ? (
            <div style={{ 
              textAlign: "center", 
              color: "#666", 
              paddingTop: "50px" 
            }}>
              メッセージがありません。最初のメッセージを送信してみましょう！
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} style={{
                display: "flex",
                justifyContent: msg.uid === user.uid ? "flex-end" : "flex-start",
                marginBottom: 8
              }}>
                <div style={{
                  background: msg.uid === user.uid ? "#DCF8C6" : "#FFF",
                  padding: "8px 12px",
                  borderRadius: 15,
                  maxWidth: "70%",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.2)"
                }}>
                  {msg.uid !== user.uid && (
                    <div style={{ 
                      fontSize: 12, 
                      color: "#666", 
                      marginBottom: 3,
                      fontWeight: "bold"
                    }}>
                      {getUserDisplayName(msg)}
                    </div>
                  )}
                  <div>{msg.text}</div>
                  {msg.createdAt && (
                    <div style={{
                      fontSize: 10,
                      color: "#999",
                      marginTop: 2,
                      textAlign: msg.uid === user.uid ? "right" : "left"
                    }}>
                      {new Date(msg.createdAt.toDate()).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={sendMessage} style={{ display: "flex", gap: "8px" }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="メッセージを入力..."
            disabled={loading}
            style={{ 
              flex: 1, 
              padding: "10px", 
              borderRadius: "20px", 
              border: "1px solid #ccc",
              outline: "none",
              fontSize: "14px"
            }}
          />
          <button 
            type="submit" 
            disabled={loading || !input.trim()}
            style={{ 
              padding: "10px 20px",
              borderRadius: "20px",
              border: "none",
              backgroundColor: loading || !input.trim() ? "#ccc" : "#007bff",
              color: "white",
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              fontSize: "14px"
            }}
          >
            {loading ? "送信中..." : "送信"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;