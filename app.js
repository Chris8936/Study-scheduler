const SUPABASE_URL = "https://qzjlqhggspgggaugerme.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6amxxaGdnc3BnZ2dhdWdlcm1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjc3MTgsImV4cCI6MjEwMDc0MzcxOH0.VGPinQ6GdN8Y1myp0XN_o_yGt6oPd9kaHjXxbIrLiP8";

let supabaseClient = null;
let sessions = [];
let currentJoinId = null;
let currentDeleteId = null;
let currentChatSessionId = null;
let currentUser = null;
let realtimeReady = false;
let chatChannel = null;
let presenceChannel = null;
let onlineUsers = {};
let notifiedSessions = {};
let notifiedSoon = {};

const AVATAR_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899",
  "#06b6d4", "#84cc16", "#f59e0b", "#6366f1"
];

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getAvatarInitial(name) {
  if (!name) return "?";
  return name.trim().charAt(0).toUpperCase();
}

function createAvatarHtml(name, sizeClass) {
  const initial = getAvatarInitial(name);
  const color = getAvatarColor(name);
  const size = sizeClass || "";
  return "<span class='avatar " + size + "' style='background:" + color + "'>" + initial + "</span>";
}

function showToast(message, type) {
  if (!type) type = "success";
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "show " + type;
  setTimeout(function() { toast.className = ""; }, 3500);
}

function normalizeName(name) {
  return (name || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(1175, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
  } catch (e) {}
}

/* ==================== NOTIFICATIONS ==================== */
function getNotifyList() {
  try {
    return JSON.parse(localStorage.getItem("notifySessions") || "[]");
  } catch (e) {
    return [];
  }
}

function saveNotifyList(list) {
  localStorage.setItem("notifySessions", JSON.stringify(list));
}

function isNotifyEnabled(sessionId) {
  return getNotifyList().indexOf(String(sessionId)) !== -1;
}

function sendBrowserNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    new Notification(title, {
      body: body,
      icon: "logo.png",
      badge: "logo.png"
    });
  } catch (e) {}
}

async function toggleNotify(sessionId) {
  sessionId = String(sessionId);
  let list = getNotifyList();

  // Turn OFF
  if (list.indexOf(sessionId) !== -1) {
    list = list.filter(function(id) { return id !== sessionId; });
    saveNotifyList(list);
    showToast("Notifications turned off for this session");
    renderSessions();
    return;
  }

  // Turn ON
  if ("Notification" in window) {
    if (Notification.permission === "denied") {
      showToast("Please allow notifications in browser settings", "error");
    } else if (Notification.permission !== "granted") {
      try {
        await Notification.requestPermission();
      } catch (e) {}
    }
  }

  list.push(sessionId);
  saveNotifyList(list);
  showToast("You will be notified when this session starts");
  renderSessions();
}

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "🙈";
  } else {
    input.type = "password";
    btn.textContent = "👁";
  }
}

function updateThemeIcons(isLight) {
  const icon1 = document.getElementById("theme-icon");
  const icon2 = document.getElementById("theme-icon-auth");
  const icon = isLight ? "☀️" : "🌙";
  if (icon1) icon1.textContent = icon;
  if (icon2) icon2.textContent = icon;
}

function toggleTheme() {
  document.body.classList.toggle("light");
  const isLight = document.body.classList.contains("light");
  updateThemeIcons(isLight);
  localStorage.setItem("theme", isLight ? "light" : "dark");
}

function showLogin() {
  document.getElementById("login-form").style.display = "block";
  document.getElementById("signup-form").style.display = "none";
}

function showSignup() {
  document.getElementById("login-form").style.display = "none";
  document.getElementById("signup-form").style.display = "block";
}

function showApp() {
  document.getElementById("auth-screen").style.display = "none";
  document.getElementById("app-screen").style.display = "block";

  const name = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name)
    ? currentUser.user_metadata.name
    : (currentUser ? currentUser.email : "User");

  document.getElementById("user-name").textContent = "Hi, " + name;
  loadSessions();
  setupRealtime();
  setupGlobalPresence();
}

function showAuth() {
  document.getElementById("auth-screen").style.display = "block";
  document.getElementById("app-screen").style.display = "none";
}

async function initSupabase() {
  if (localStorage.getItem("theme") === "light") {
    document.body.classList.add("light");
    updateThemeIcons(true);
  }

  if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      currentUser = session.user;
      showApp();
    } else {
      showAuth();
    }

    supabaseClient.auth.onAuthStateChange(function(event, session) {
      if (session) {
        currentUser = session.user;
        showApp();
      } else {
        currentUser = null;
        showAuth();
      }
    });
  } else {
    setTimeout(initSupabase, 400);
  }
}

async function signup() {
  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  if (!name || !email || !password) {
    showToast("Please fill all fields", "error");
    return;
  }
  if (password.length < 6) {
    showToast("Password must be at least 6 characters", "error");
    return;
  }

  const { error } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
    options: { data: { name: name } }
  });

  if (error) {
    showToast(error.message, "error");
    return;
  }
  showToast("Account created! You can now login.");
  showLogin();
}

async function login() {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  if (!email || !password) {
    showToast("Please enter email and password", "error");
    return;
  }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    showToast(error.message, "error");
    return;
  }
  showToast("Logged in successfully");
}

async function logout() {
  if (presenceChannel) {
    try {
      await presenceChannel.untrack();
      await supabaseClient.removeChannel(presenceChannel);
    } catch (e) {}
    presenceChannel = null;
  }
  await supabaseClient.auth.signOut();
  showToast("Logged out");
}

function setupRealtime() {
  if (realtimeReady || !supabaseClient) return;
  realtimeReady = true;

  supabaseClient
    .channel("sessions-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, function() {
      loadSessions();
    })
    .subscribe();
}

function setupGlobalPresence() {
  if (!supabaseClient || !currentUser) return;
  if (presenceChannel) return;

  const userName = (currentUser.user_metadata && currentUser.user_metadata.name) || "Anonymous";

  presenceChannel = supabaseClient.channel("online-users", {
    config: { presence: { key: currentUser.id } }
  });

  presenceChannel.on("presence", { event: "sync" }, function() {
    const state = presenceChannel.presenceState();
    onlineUsers = {};

    Object.keys(state).forEach(function(key) {
      const presences = state[key];
      presences.forEach(function(p) {
        if (p.session_id && p.user_name) {
          if (!onlineUsers[p.session_id]) onlineUsers[p.session_id] = {};
          onlineUsers[p.session_id][p.user_name] = true;
        }
      });
    });

    renderSessions();
    updateChatOnlineStatus();
    updateDashboard();
  });

  presenceChannel.subscribe(async function(status) {
    if (status === "SUBSCRIBED") {
      await presenceChannel.track({
        user_name: userName,
        online_at: new Date().toISOString()
      });
    }
  });
}

async function trackSessionPresence(sessionId) {
  if (!presenceChannel || !currentUser) return;
  const userName = (currentUser.user_metadata && currentUser.user_metadata.name) || "Anonymous";
  await presenceChannel.track({
    user_name: userName,
    session_id: sessionId,
    online_at: new Date().toISOString()
  });
}

function isUserOnline(sessionId, name) {
  return onlineUsers[sessionId] && onlineUsers[sessionId][name];
}

function getOnlineCount(sessionId) {
  if (!onlineUsers[sessionId]) return 0;
  return Object.keys(onlineUsers[sessionId]).length;
}

function updateChatOnlineStatus() {
  const el = document.getElementById("chat-online");
  if (!el || !currentChatSessionId) return;
  const count = getOnlineCount(currentChatSessionId);
  if (count === 0) el.textContent = "No one online";
  else if (count === 1) el.textContent = "1 online";
  else el.textContent = count + " online";
}

function updateDashboard() {
  const totalEl = document.getElementById("stat-total");
  const joinedEl = document.getElementById("stat-joined");
  const liveEl = document.getElementById("stat-live");
  const onlineEl = document.getElementById("stat-online");

  if (!totalEl) return;

  const currentName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "";
  const now = new Date();

  let total = sessions.length;
  let joined = 0;
  let live = 0;
  let onlineTotal = 0;

  sessions.forEach(function(session) {
    if (session.members && session.members.some(function(m) {
      return normalizeName(m) === normalizeName(currentName);
    })) {
      joined++;
    }

    const start = new Date(session.time);
    const end = session.end_time ? new Date(session.end_time) : null;
    if (now >= start && (!end || now <= end)) {
      live++;
    }

    onlineTotal += getOnlineCount(session.id);
  });

  totalEl.textContent = total;
  joinedEl.textContent = joined;
  liveEl.textContent = live;
  onlineEl.textContent = onlineTotal;
}

async function loadSessions() {
  if (!supabaseClient) return;

  const { data, error } = await supabaseClient
    .from("sessions")
    .select("*")
    .order("time", { ascending: true });

  if (error) {
    console.error(error);
    document.getElementById("sessions").innerHTML = "<p class='empty'>Error loading sessions</p>";
    return;
  }

  sessions = data || [];
  renderSessions();
  updateDashboard();
}

async function createSession() {
  if (!supabaseClient) {
    showToast("Still connecting... please wait", "error");
    return;
  }

  const title = document.getElementById("session-title").value.trim();
  const timeInput = document.getElementById("session-time").value;
  const endTimeInput = document.getElementById("session-end-time").value;

  if (!title || !timeInput || !endTimeInput) {
    showToast("Please fill title, start time and end time", "error");
    return;
  }

  const startDate = new Date(timeInput);
  const endDate = new Date(endTimeInput);

  if (endDate <= startDate) {
    showToast("End time must be after start time", "error");
    return;
  }

  const { error } = await supabaseClient.from("sessions").insert([{
    title: title,
    time: startDate.toISOString(),
    end_time: endDate.toISOString(),
    members: [],
    notes: ""
  }]);

  if (error) {
    showToast("Error: " + error.message, "error");
    return;
  }

  document.getElementById("session-title").value = "";
  document.getElementById("session-time").value = "";
  document.getElementById("session-end-time").value = "";
  showToast("Session created successfully");
}

function renderSessions() {
  const container = document.getElementById("sessions");
  container.innerHTML = "";

  if (sessions.length === 0) {
    container.innerHTML = "<p class='empty'>No sessions yet.<br>Create one above!</p>";
    updateDashboard();
    return;
  }

  const currentName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "";

  sessions.forEach(function(session) {
    let membersHtml = "No one yet";
    let isMember = false;
    let onlineCount = getOnlineCount(session.id);

    if (session.members && session.members.length > 0) {
      membersHtml = session.members.map(function(name) {
        const online = isUserOnline(session.id, name);
        const dot = online ? "<span class='online-dot'></span>" : "";
        const avatar = createAvatarHtml(name, "avatar-sm");
        return "<div class='member-line'>" + avatar + " " + dot + name + "</div>";
      }).join("");

      isMember = session.members.some(function(m) {
        return normalizeName(m) === normalizeName(currentName);
      });
    }

    const notifyOn = isNotifyEnabled(session.id);
    const notifyBtnClass = notifyOn ? "btn-notify enabled" : "btn-notify";
    const notifyBtnText = notifyOn ? "🔔 On" : "🔔 Notify";

    let actionButtons = "<button onclick='openJoin(" + session.id + ")'>Join</button>";
    if (isMember) {
      actionButtons += "<button onclick='leaveSession(" + session.id + ")' style='background:#64748b;'>Leave</button>";
    }
    actionButtons += "<button onclick='openChat(" + session.id + ")'>Chat</button>";
    actionButtons += "<button class='" + notifyBtnClass + "' onclick='toggleNotify(" + session.id + ")'>" + notifyBtnText + "</button>";
    actionButtons += "<button onclick='openDelete(" + session.id + ")'>Delete</button>";

    const startText = new Date(session.time).toLocaleString();
    const endText = session.end_time ? new Date(session.end_time).toLocaleString() : "—";

    const onlineText = onlineCount > 0
      ? "<div class='online-count'>● " + onlineCount + " online</div>"
      : "";

    const div = document.createElement("div");
    div.className = "session-card";
    div.innerHTML =
      "<strong>" + session.title + "</strong>" +
      "<div class='meta'>Starts: " + startText + "</div>" +
      "<div class='meta'>Ends: " + endText + "</div>" +
      "<span class='countdown' id='countdown-" + session.id + "'>Calculating...</span>" +
      onlineText +
      "<div class='members'>Members:<br>" + membersHtml + "</div>" +
      "<div class='card-actions'>" + actionButtons + "</div>";

    container.appendChild(div);
  });

  updateDashboard();
}

function updateCountdowns() {
  const now = new Date();

  sessions.forEach(function(session) {
    const el = document.getElementById("countdown-" + session.id);
    if (!el) return;

    const start = new Date(session.time);
    const end = session.end_time ? new Date(session.end_time) : null;
    const notifyEnabled = isNotifyEnabled(session.id);

    // 5 minutes before start
    const fiveMin = 5 * 60 * 1000;
    if (notifyEnabled && !notifiedSoon[session.id] && now < start) {
      const diff = start - now;
      if (diff <= fiveMin && diff > 0) {
        notifiedSoon[session.id] = true;
        showToast("\"" + session.title + "\" starts in a few minutes!");
        playNotificationSound();
        sendBrowserNotification(
          "Session starting soon",
          session.title + " starts in about 5 minutes"
        );
      }
    }

    if (end && now > end) {
      el.textContent = "Session ended";
      el.style.color = "#94a3b8";
    } else if (now >= start) {
      el.textContent = "● Live – In progress";
      el.style.color = "#4ade80";

      if (!notifiedSessions[session.id]) {
        notifiedSessions[session.id] = true;
        showToast("Session \"" + session.title + "\" has started!");
        playNotificationSound();

        if (notifyEnabled) {
          sendBrowserNotification(
            "Session started",
            session.title + " is now live. Join the study session!"
          );
        }
      }
    } else {
      const diff = start - now;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);
      el.textContent = "Starts in: " + hours + "h " + mins + "m " + secs + "s";
      el.style.color = "#f87171";
    }
  });

  updateDashboard();
}

function openJoin(id) {
  currentJoinId = id;
  const name = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "";
  document.getElementById("join-name").value = name;
  document.getElementById("join-error").style.display = "none";
  document.getElementById("join-modal").style.display = "block";
}

function closeJoin() {
  document.getElementById("join-modal").style.display = "none";
  currentJoinId = null;
}

async function confirmJoin() {
  if (!supabaseClient || !currentJoinId) return;

  const name = document.getElementById("join-name").value.trim();
  const errorEl = document.getElementById("join-error");

  if (!name) {
    errorEl.textContent = "Please enter your name.";
    errorEl.style.display = "block";
    return;
  }

  const session = sessions.find(function(s) { return s.id === currentJoinId; });
  if (!session) return;

  let members = session.members || [];

  const nameExists = members.some(function(m) {
    return normalizeName(m) === normalizeName(name);
  });

  if (nameExists) {
    errorEl.textContent = "This name (or a very similar one) is already in the session.";
    errorEl.style.display = "block";
    return;
  }

  members.push(name);

  const { error } = await supabaseClient
    .from("sessions")
    .update({ members: members })
    .eq("id", currentJoinId);

  if (error) {
    errorEl.textContent = "Error joining: " + error.message;
    errorEl.style.display = "block";
    return;
  }

  closeJoin();
  showToast("Joined successfully");
}

async function leaveSession(id) {
  if (!supabaseClient || !currentUser) return;

  const currentName = (currentUser.user_metadata && currentUser.user_metadata.name) || "";
  if (!currentName) {
    showToast("Could not find your name", "error");
    return;
  }

  const session = sessions.find(function(s) { return s.id === id; });
  if (!session) return;

  let members = (session.members || []).filter(function(m) {
    return normalizeName(m) !== normalizeName(currentName);
  });

  const { error } = await supabaseClient
    .from("sessions")
    .update({ members: members })
    .eq("id", id);

  if (error) {
    showToast("Error leaving session", "error");
    return;
  }
  showToast("You left the session");
}

function openDelete(id) {
  currentDeleteId = id;
  document.getElementById("delete-modal").style.display = "block";
}

function closeDelete() {
  document.getElementById("delete-modal").style.display = "none";
  currentDeleteId = null;
}

async function confirmDelete() {
  if (!supabaseClient || !currentDeleteId) return;

  const { error } = await supabaseClient
    .from("sessions")
    .delete()
    .eq("id", currentDeleteId);

  if (error) {
    showToast("Error deleting session", "error");
    closeDelete();
    return;
  }
  closeDelete();
  showToast("Session deleted");
}

async function openChat(sessionId) {
  currentChatSessionId = sessionId;
  const session = sessions.find(function(s) { return s.id === sessionId; });
  document.getElementById("chat-title").textContent = session ? session.title : "Group Chat";
  document.getElementById("chat-modal").style.display = "block";
  document.getElementById("chat-messages").innerHTML = "<p style='text-align:center;color:#8696a0;padding:20px;'>Loading messages...</p>";

  await trackSessionPresence(sessionId);
  updateChatOnlineStatus();

  await loadMessages(sessionId);
  setupChatRealtime(sessionId);
}

function closeChat() {
  document.getElementById("chat-modal").style.display = "none";
  currentChatSessionId = null;

  if (chatChannel) {
    supabaseClient.removeChannel(chatChannel);
    chatChannel = null;
  }

  if (presenceChannel && currentUser) {
    const userName = (currentUser.user_metadata && currentUser.user_metadata.name) || "Anonymous";
    presenceChannel.track({
      user_name: userName,
      online_at: new Date().toISOString()
    });
  }
}

async function loadMessages(sessionId) {
  const { data, error } = await supabaseClient
    .from("messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    document.getElementById("chat-messages").innerHTML = "<p style='text-align:center;color:#f87171;'>Error loading messages</p>";
    return;
  }

  renderMessages(data || []);
}

function renderMessages(messages) {
  const container = document.getElementById("chat-messages");
  const currentName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "";

  if (messages.length === 0) {
    container.innerHTML = "<p style='text-align:center;color:#8696a0;padding:30px 10px;'>No messages yet.<br>Say hello!</p>";
    return;
  }

  container.innerHTML = "";

  messages.forEach(function(msg) {
    const isMine = msg.user_name && normalizeName(msg.user_name) === normalizeName(currentName);
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement("div");
    div.className = "message " + (isMine ? "sent" : "received");

    let ticks = "";
    if (isMine) ticks = "<span class='ticks read'>✓✓</span>";

    let header = "";
    if (!isMine) {
      const avatar = createAvatarHtml(msg.user_name, "avatar-sm");
      header = "<div class='message-header'>" + avatar + "<div class='message-name'>" + msg.user_name + "</div></div>";
    }

    div.innerHTML =
      header +
      "<div>" + msg.message + "</div>" +
      "<div class='message-meta'>" +
        "<span class='message-time'>" + time + "</span>" +
        ticks +
      "</div>";

    container.appendChild(div);
  });

  container.scrollTop = container.scrollHeight;
}

function setupChatRealtime(sessionId) {
  if (chatChannel) {
    supabaseClient.removeChannel(chatChannel);
  }

  chatChannel = supabaseClient
    .channel("chat-" + sessionId)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: "session_id=eq." + sessionId
      },
      function(payload) {
        const msg = payload.new;
        const container = document.getElementById("chat-messages");
        const currentName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "";
        const isMine = msg.user_name && normalizeName(msg.user_name) === normalizeName(currentName);
        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (container.querySelector("p")) container.innerHTML = "";

        const div = document.createElement("div");
        div.className = "message " + (isMine ? "sent" : "received");

        let ticks = "";
        if (isMine) ticks = "<span class='ticks read'>✓✓</span>";

        let header = "";
        if (!isMine) {
          const avatar = createAvatarHtml(msg.user_name, "avatar-sm");
          header = "<div class='message-header'>" + avatar + "<div class='message-name'>" + msg.user_name + "</div></div>";
        }

        div.innerHTML =
          header +
          "<div>" + msg.message + "</div>" +
          "<div class='message-meta'>" +
            "<span class='message-time'>" + time + "</span>" +
            ticks +
          "</div>";

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
      }
    )
    .subscribe();
}

async function sendMessage() {
  if (!supabaseClient || !currentChatSessionId) return;

  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;

  const userName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "Anonymous";

  const { error } = await supabaseClient.from("messages").insert([{
    session_id: currentChatSessionId,
    user_name: userName,
    message: text
  }]);

  if (error) {
    showToast("Failed to send message", "error");
    console.error(error);
    return;
  }

  input.value = "";
  input.focus();
}

initSupabase();
setInterval(updateCountdowns, 1000);