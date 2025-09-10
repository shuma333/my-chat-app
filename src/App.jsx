import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from './firebase.js';
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  arrayUnion
} from 'firebase/firestore';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';

function App() {
  // States
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showNicknameInput, setShowNicknameInput] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [userProfiles, setUserProfiles] = useState({});
  const [isWindowActive, setIsWindowActive] = useState(true);
  const [silentMode, setSilentMode] = useState(false);
  
  // Refs
  const messagesEndRef = useRef(null);
  const lastMessageCountRef = useRef(0);

  // Monitor window active state
  useEffect(() => {
    const handleFocus = () => setIsWindowActive(true);
    const handleBlur = () => setIsWindowActive(false);
    const handleVisibilityChange = () => setIsWindowActive(!document.hidden);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Request notification permission & setup PWA notifications
  useEffect(() => {
    if (user && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        console.log('Notification permission:', permission);
        if (permission === 'granted' && 'serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then(registration => {
            console.log('PWA notifications ready');
          });
        }
      });
    }
  }, [user]);

  // Monitor auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log('Auth state changed:', currentUser?.email || 'logged out');
      setUser(currentUser);
      
      if (currentUser) {
        await loadUserProfile(currentUser.uid);
      } else {
        setUserProfile(null);
      }
    });
    return unsubscribe;
  }, []);

  // Load user profile
  const loadUserProfile = async (uid) => {
    try {
      const profileDoc = await getDoc(doc(db, 'users', uid));
      if (profileDoc.exists()) {
        const profile = profileDoc.data();
        setUserProfile(profile);
        console.log('Profile loaded:', profile);
      } else {
        console.log('No profile found, need to create one');
        setShowNicknameInput(true);
      }
    } catch (error) {
      console.error('Profile load error:', error);
    }
  };

  // Save nickname
  const saveNickname = async () => {
    if (!nicknameInput.trim() || !user) return;

    try {
      const profile = {
        uid: user.uid,
        email: user.email,
        nickname: nicknameInput.trim(),
        createdAt: serverTimestamp()
      };

      await setDoc(doc(db, 'users', user.uid), profile);
      setUserProfile(profile);
      setShowNicknameInput(false);
      setNicknameInput('');
      console.log('Nickname saved:', profile);
    } catch (error) {
      console.error('Nickname save error:', error);
      alert('Failed to save nickname');
    }
  };

  // Show notification (PWA compatible)
  const showNotification = (message) => {
    if (!isWindowActive && 'Notification' in window && Notification.permission === 'granted') {
      // Skip notification for silent messages
      if (message.silent) {
        console.log('Skipping notification for silent message');
        return;
      }

      const notificationOptions = {
        body: message.text,
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        tag: 'chat-message',
        requireInteraction: false,
        silent: false,
        vibrate: [100, 50, 100],
        data: {
          messageId: message.id,
          timestamp: Date.now()
        }
      };

      // PWA notification (via service worker)
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => {
          registration.showNotification(
            `${getUserDisplayName(message)} sent a message`,
            notificationOptions
          );
        }).catch(() => {
          // Fallback to basic notification
          showBasicNotification(message, notificationOptions);
        });
      } else {
        showBasicNotification(message, notificationOptions);
      }
    }
  };

  // Basic notification fallback
  const showBasicNotification = (message, options) => {
    const notification = new Notification(
      `${getUserDisplayName(message)} sent a message`,
      options
    );

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    setTimeout(() => notification.close(), 5000);
  };

  // Mark message as read
  const markMessageAsRead = async (messageId) => {
    if (!user) return;

    try {
      const messageRef = doc(db, 'messages', messageId);
      await updateDoc(messageRef, {
        readBy: arrayUnion(user.uid)
      });
    } catch (error) {
      console.error('Read mark error:', error);
    }
  };

  // Mark visible messages as read
  const markVisibleMessagesAsRead = () => {
    if (!user || !messages.length) return;

    messages.forEach(message => {
      if (message.uid !== user.uid && (!message.readBy || !message.readBy.includes(user.uid))) {
        markMessageAsRead(message.id);
      }
    });
  };

  // Mark messages read when window becomes active
  useEffect(() => {
    if (isWindowActive) {
      markVisibleMessagesAsRead();
    }
  }, [isWindowActive, messages]);

  // Listen to messages
  useEffect(() => {
    if (!user || !userProfile) {
      setMessages([]);
      return;
    }

    console.log('Setting up message listener...');
    const messagesRef = collection(db, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      console.log('Messages updated:', snapshot.docs.length, 'messages');
      const newMessages = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      }));
      
      // Check for new messages (for notifications)
      const newMessageCount = newMessages.length;
      if (lastMessageCountRef.current > 0 && newMessageCount > lastMessageCountRef.current) {
        const latestMessage = newMessages[newMessages.length - 1];
        if (latestMessage.uid !== user.uid) {
          showNotification(latestMessage);
        }
      }
      lastMessageCountRef.current = newMessageCount;
      
      // Load user profiles for messages
      const userIds = [...new Set(newMessages.map(msg => msg.uid))];
      const profiles = {};
      
      for (const uid of userIds) {
        if (!userProfiles[uid] && uid !== user.uid) {
          try {
            const profileDoc = await getDoc(doc(db, 'users', uid));
            if (profileDoc.exists()) {
              profiles[uid] = profileDoc.data();
            }
          } catch (error) {
            console.error('Profile fetch error:', error);
          }
        }
      }
      
      setUserProfiles(prev => ({ ...prev, ...profiles }));
      setMessages(newMessages);
      
      // Mark as read if window is active
      if (isWindowActive) {
        setTimeout(markVisibleMessagesAsRead, 100);
      }
      
      // Scroll to bottom
      setTimeout(scrollToBottom, 100);
    }, (error) => {
      console.error('Message fetch error:', error);
    });

    return unsubscribe;
  }, [user, userProfile]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Get user display name
  const getUserDisplayName = (msg) => {
    if (msg.uid === user?.uid) return null;
    
    if (msg.nickname) return msg.nickname;
    if (userProfiles[msg.uid]?.nickname) return userProfiles[msg.uid].nickname;
    return msg.email;
  };

  // Get read status
  const getReadStatus = (msg) => {
    if (msg.uid !== user?.uid) return null;
    
    if (!msg.readBy || msg.readBy.length === 0) return 'Unread';
    
    const othersReadCount = msg.readBy.filter(uid => uid !== user.uid).length;
    
    if (othersReadCount === 0) return 'Unread';
    if (othersReadCount === 1) return 'Read';
    return `Read by ${othersReadCount}`;
  };

  // Login
  const login = async () => {
    const email = prompt('Enter email address:');
    const password = prompt('Enter password:');
    if (!email || !password) return;

    try {
      console.log('Attempting login...');
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      console.log('Login successful:', userCredential.user.email);
    } catch (error) {
      console.log('Login failed, attempting to create account...');
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        console.log('Account created:', userCredential.user.email);
      } catch (createError) {
        console.error('Account creation error:', createError);
        alert('Login or account creation failed');
      }
    }
  };

  // Logout
  const logout = async () => {
    console.log('Logging out...');
    await signOut(auth);
    setUser(null);
    setUserProfile(null);
    setMessages([]);
    setShowNicknameInput(false);
  };

  // Send message
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading || !userProfile) return;

    setLoading(true);
    console.log('Sending message:', input.trim(), silentMode ? '(silent)' : '');

    try {
      await addDoc(collection(db, 'messages'), {
        text: input.trim(),
        createdAt: serverTimestamp(),
        uid: user.uid,
        email: user.email,
        nickname: userProfile.nickname,
        readBy: [user.uid],
        silent: silentMode
      });
      console.log('Message sent successfully', silentMode ? '(silent)' : '');
      setInput('');
    } catch (error) {
      console.error('Message send error:', error);
      alert('Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  // Change nickname
  const changeNickname = () => {
    const newNickname = prompt('Enter new nickname:', userProfile?.nickname || '');
    if (newNickname && newNickname.trim() !== userProfile?.nickname) {
      setNicknameInput(newNickname.trim());
      setShowNicknameInput(true);
    }
  };

  // Render login screen
  if (!user) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{
          background: 'white',
          padding: '40px',
          borderRadius: '20px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          textAlign: 'center'
        }}>
          <h1 style={{ 
            color: '#333', 
            marginBottom: '20px',
            fontSize: '28px'
          }}>
            💬 PWA Chat App
          </h1>
          <p style={{ 
            color: '#666', 
            marginBottom: '30px',
            fontSize: '16px'
          }}>
            Real-time messaging with notifications & silent mode
          </p>
          <button 
            onClick={login}
            style={{
              padding: '15px 30px',
              fontSize: '18px',
              borderRadius: '25px',
              border: 'none',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 'bold',
              transition: 'transform 0.2s',
              boxShadow: '0 4px 15px 0 rgba(116, 75, 162, 0.3)'
            }}
            onMouseEnter={(e) => e.target.style.transform = 'translateY(-2px)'}
            onMouseLeave={(e) => e.target.style.transform = 'translateY(0)'}
          >
            🚀 Login / Sign Up
          </button>
        </div>
      </div>
    );
  }

  // Render nickname input screen
  if (showNicknameInput) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{
          background: 'white',
          padding: '40px',
          borderRadius: '20px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          textAlign: 'center',
          minWidth: '300px'
        }}>
          <h2 style={{ color: '#333', marginBottom: '20px' }}>
            🏷️ Set Your Nickname
          </h2>
          <input
            type="text"
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            placeholder="Enter your nickname"
            style={{
              padding: '15px',
              fontSize: '16px',
              borderRadius: '25px',
              border: '2px solid #e1e5e9',
              width: '100%',
              boxSizing: 'border-box',
              marginBottom: '20px',
              outline: 'none'
            }}
            onKeyDown={(e) => e.key === 'Enter' && saveNickname()}
            autoFocus
          />
          <button 
            onClick={saveNickname}
            disabled={!nicknameInput.trim()}
            style={{
              padding: '15px 30px',
              fontSize: '16px',
              borderRadius: '25px',
              border: 'none',
              background: nicknameInput.trim() 
                ? 'linear-gradient(135deg, #28a745 0%, #20c997 100%)' 
                : '#ccc',
              color: 'white',
              cursor: nicknameInput.trim() ? 'pointer' : 'not-allowed',
              fontWeight: 'bold'
            }}
          >
            💾 Save Nickname
          </button>
        </div>
      </div>
    );
  }

  // Loading screen
  if (!userProfile) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif' 
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>💬</div>
          <div>Loading...</div>
        </div>
      </div>
    );
  }

  // Main chat interface
  return (
    <div style={{ 
      maxWidth: '800px', 
      margin: '0 auto', 
      fontFamily: 'system-ui, -apple-system, sans-serif',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        padding: '15px 20px',
        borderBottom: '1px solid #e1e5e9',
        background: 'white',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <div>
          <span style={{ 
            fontWeight: 'bold', 
            color: '#667eea',
            fontSize: '18px'
          }}>
            {userProfile.nickname}
          </span>
          <span style={{ 
            fontSize: '12px', 
            color: '#666', 
            marginLeft: '8px' 
          }}>
            ({user.email})
          </span>
          {!isWindowActive && (
            <span style={{ 
              fontSize: '12px', 
              color: '#ff6b6b', 
              marginLeft: '8px',
              fontWeight: 'bold'
            }}>
              📵 Background
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={changeNickname} 
            style={{ 
              padding: '8px 16px', 
              borderRadius: '20px',
              border: '1px solid #667eea',
              backgroundColor: 'white',
              color: '#667eea',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 'bold'
            }}
          >
            ✏️ Change Name
          </button>
          <button 
            onClick={logout} 
            style={{ 
              padding: '8px 16px', 
              borderRadius: '20px',
              border: '1px solid #ccc',
              backgroundColor: '#f8f9fa',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            🚪 Logout
          </button>
        </div>
      </div>

      {/* Notification warning */}
      {Notification.permission === 'denied' && (
        <div style={{
          padding: '10px 20px',
          backgroundColor: '#fff3cd',
          color: '#856404',
          border: '1px solid #ffeaa7',
          fontSize: '12px'
        }}>
          📢 Notifications are disabled. Please enable them in browser settings.
        </div>
      )}

      {/* Chat messages */}
      <div style={{ 
        flex: 1,
        padding: '20px',
        overflowY: 'auto',
        background: '#f8f9fa'
      }}>
        <div style={{
          background: 'white',
          borderRadius: '20px',
          padding: '20px',
          height: '100%',
          overflowY: 'auto',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          {messages.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              color: '#666', 
              paddingTop: '50px',
              fontSize: '16px'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '20px' }}>💬</div>
              No messages yet. Send the first one!
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} style={{
                display: 'flex',
                justifyContent: msg.uid === user.uid ? 'flex-end' : 'flex-start',
                marginBottom: '15px'
              }}>
                <div style={{
                  background: msg.uid === user.uid 
                    ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' 
                    : '#fff',
                  color: msg.uid === user.uid ? 'white' : '#333',
                  padding: '12px 18px',
                  borderRadius: '20px',
                  maxWidth: '70%',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  border: msg.uid !== user.uid ? '1px solid #e1e5e9' : 'none'
                }}>
                  {msg.uid !== user.uid && (
                    <div style={{ 
                      fontSize: '12px', 
                      color: '#667eea', 
                      marginBottom: '5px',
                      fontWeight: 'bold'
                    }}>
                      {getUserDisplayName(msg)}
                    </div>
                  )}
                  <div style={{ 
                    opacity: msg.silent ? 0.7 : 1,
                    fontStyle: msg.silent ? 'italic' : 'normal'
                  }}>
                    {msg.silent && (
                      <span style={{ 
                        fontSize: '12px', 
                        marginRight: '6px',
                        opacity: 0.6
                      }}>
                        🔇
                      </span>
                    )}
                    {msg.text}
                  </div>
                  <div style={{
                    fontSize: '10px',
                    opacity: 0.7,
                    marginTop: '5px',
                    textAlign: msg.uid === user.uid ? 'right' : 'left',
                    display: 'flex',
                    justifyContent: msg.uid === user.uid ? 'flex-end' : 'flex-start',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    {msg.createdAt && (
                      <span>
                        {new Date(msg.createdAt.toDate()).toLocaleTimeString()}
                      </span>
                    )}
                    {msg.uid === user.uid && (
                      <span style={{ 
                        fontSize: '9px',
                        color: msg.readBy && msg.readBy.filter(uid => uid !== user.uid).length > 0 
                          ? (msg.uid === user.uid ? 'rgba(255,255,255,0.8)' : '#667eea')
                          : 'rgba(255,255,255,0.5)'
                      }}>
                        {getReadStatus(msg)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Message input */}
      <div style={{ 
        padding: '20px',
        background: 'white',
        borderTop: '1px solid #e1e5e9'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Silent mode toggle */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            padding: '5px',
            fontSize: '14px',
            color: '#666'
          }}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              cursor: 'pointer',
              gap: '8px'
            }}>
              <input
                type="checkbox"
                checked={silentMode}
                onChange={(e) => setSilentMode(e.target.checked)}
                style={{ margin: 0 }}
              />
              🔇 Silent Mode {silentMode ? 'ON' : 'OFF'}
              <span style={{ fontSize: '12px', color: '#999' }}>
                (send without notifications)
              </span>
            </label>
          </div>
          
          <form onSubmit={sendMessage} style={{ display: 'flex', gap: '10px' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={silentMode ? 'Type silent message...' : 'Type your message...'}
              disabled={loading}
              style={{ 
                flex: 1, 
                padding: '12px 18px', 
                borderRadius: '25px', 
                border: silentMode ? '2px solid #ffa500' : '2px solid #e1e5e9',
                outline: 'none',
                fontSize: '14px',
                backgroundColor: silentMode ? '#fff8dc' : 'white'
              }}
            />
            <button 
              type="submit" 
              disabled={loading || !input.trim()}
              style={{ 
                padding: '12px 24px',
                borderRadius: '25px',
                border: 'none',
                background: loading || !input.trim() 
                  ? '#ccc' 
                  : silentMode 
                    ? 'linear-gradient(135deg, #ffa500 0%, #ff8c00 100%)'
                    : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 'bold'
              }}
            >
              {loading ? '⏳ Sending...' : silentMode ? '🔇 Send' : '🚀 Send'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;