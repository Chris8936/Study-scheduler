const SUPABASE_URL = "https://qzjlqhggspgggaugerme.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6amxxaGdnc3BnZ2dhdWdlcm1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjc3MTgsImV4cCI6MjEwMDc0MzcxOH0.VGPinQ6GdN8Y1myp0XN_o_yGt6oPd9kaHjXxbIrLiP8";

let supabaseClient = null;
let sessions = [];
let currentDeleteId = null;
let currentChatSessionId = null;
let currentUser = null;
let realtimeReady = false;
let chatChannel = null;
let presenceChannel = null;
let globalMsgChannel = null;
let onlineUsers = {};
let notifiedSessions = {};
let notifiedSoon = {};
let replyToText = null;
let replyToName = null;
let selectedMsg = null;

const AVATAR_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899",
  "#06b6d4", "#84cc16", "#f59e0b", "#6366f1"
];

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getAvatarInitial(name) {
  if (!name) return "?";
  return name.trim().charAt(0).toUpperCase();
}

function createAvatarHtml(name, sizeClass) {
  const initial = getAvatarInitial(name);
  const color = getAvatarColor(name);
  return "<span class='avatar " + (sizeClass || "") + "' style='background:" + color + "'>" + initial + "</span>";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(message, type) {
  if (!type) type = "success";
  const toast = document.getElementById("toast");
  if (!toast) return;
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

function getUserDept() {
  return (currentUser && currentUser.user_metadata && currentUser.user_metadata.department) || "";
}

function getUserLevel() {
  return (currentUser && currentUser.user_metadata && currentUser.user_metadata.level) || "";
}

/* ==================== TABS ==================== */
function switchTab(tab) {
  ["home", "sessions", "chats", "profile"].forEach(function(t) {
    const page = document.getElementById("tab-" + t);
    const nav = document.getElementById("nav-" + t);
    if (page) page.classList.remove("active");
    if (nav) nav.classList.remove("active");
  });
  const page = document.getElementById("tab-" + tab);
  const nav = document.getElementById("nav-" + tab);
  if (page) page.classList.add("active");
  if (nav) nav.classList.add("active");
  if (tab === "chats") renderMyChats();
  if (tab === "profile") renderProfile();
  if (tab === "sessions") renderSessions();
}

function renderMyChats() {
  const container = document.getElementById("my-chats");
  if (!container) return;
  const currentName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "";
  const joined = sessions.filter(function(s) {
    return Array.isArray(s.members) && s.members.some(function(m) {
      return normalizeName(m) === normalizeName(currentName);
    });
  });
  if (joined.length === 0) {
    container.innerHTML = "<p class='empty'>Join a session to see its chat here.</p>";
    return;
  }
  container.innerHTML = "";
  joined.forEach(function(session) {
    const div = document.createElement("div");
    div.className = "session-card";
    div.style.cursor = "pointer";
    div.onclick = function() { openChat(session.id); };
    div.innerHTML =
      "<strong>" + escapeHtml(session.title) + "</strong>" +
      (session.course ? "<div class='meta' style='color:var(--accent);'>" + escapeHtml(session.course) + "</div>" : "") +
      "<div class='meta'>" + (session.members ? session.members.length : 0) + " members · Tap to open chat</div>";
    container.appendChild(div);
  });
}

function renderProfile() {
  if (!currentUser) return;
  const name = (currentUser.user_metadata && currentUser.user_metadata.name) || "User";
  const email = currentUser.email || "—";
  const dept = getUserDept() || "—";
  const level = getUserLevel() ? getUserLevel() + " Level" : "—";
  const nameEl = document.getElementById("profile-name");
  const emailEl = document.getElementById("profile-email");
  const deptEl = document.getElementById("profile-dept");
  const levelEl = document.getElementById("profile-level");
  const avatarEl = document.getElementById("profile-avatar");
  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = email;
  if (deptEl) deptEl.textContent = dept;
  if (levelEl) levelEl.textContent = level;
  if (avatarEl) {
    avatarEl.textContent = getAvatarInitial(name);
    avatarEl.style.background = getAvatarColor(name);
  }
}

/* ==================== SETTINGS ==================== */
function openSettings() {
  const dept = getUserDept();
  const level = getUserLevel();
  const name = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "";
  document.getElementById("settings-name").textContent = name || "—";
  document.getElementById("settings-dept").value = dept || "";
  document.getElementById("settings-level").value = level || "";
  document.getElementById("settings-modal").style.display = "block";
}

function closeSettings() {
  document.getElementById("settings-modal").style.display = "none";
}

async function saveSettings() {
  const dept = document.getElementById("settings-dept").value;
  const level = document.getElementById("settings-level").value;
  if (!dept || !level) {
    showToast("Please select Department and Level", "error");
    return;
  }
  const { error } = await supabaseClient.auth.updateUser({
    data: { department: dept, level: level }
  });
  if (error) {
    showToast("Error updating profile: " + error.message, "error");
    return;
  }
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) currentUser = session.user;
  renderProfile();
  closeSettings();
  showToast("Profile updated successfully");
}

/* ==================== SESSION NOTIFICATIONS ==================== */
function getNotifyList() {
  try { return JSON.parse(localStorage.getItem("notifySessions") || "[]"); }
  catch (e) { return []; }
}
function saveNotifyList(list) {
  localStorage.setItem("notifySessions", JSON.stringify(list));
}
function isNotifyEnabled(sessionId) {
  return getNotifyList().indexOf(String(sessionId)) !== -1;
}
function sendBrowserNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body: body, icon: "logo.png", badge: "logo.png" });
  } catch (e) {}
}
async function toggleNotify(sessionId) {
  sessionId = String(sessionId);
  let list = getNotifyList();
  if (list.indexOf(sessionId) !== -1) {
    list = list.filter(function(id) { return id !== sessionId; });
    saveNotifyList(list);
    showToast("Notifications turned off for this session");
    renderSessions();
    return;
  }
  if ("Notification" in window && Notification.permission !== "granted") {
    try { await Notification.requestPermission(); } catch (e) {}
  }
  list.push(sessionId);
  saveNotifyList(list);
  showToast("You will be notified when this session starts");
  renderSessions();
}

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "🙈";
  } else {
    input.type = "password";
    btn.textContent = "👁";
  }
}

function updateThemeIcons(isLight) {
  const icon = isLight ? "☀️" : "🌙";
  const icon1 = document.getElementById("theme-icon");
  const icon2 = document.getElementById("theme-icon-auth");
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
  const userEl = document.getElementById("user-name");
  if (userEl) userEl.textContent = "Hi, " + name;
  switchTab("home");
  loadSessions();
  setupRealtime();
  setupGlobalPresence();
  setupGlobalMessageListener();
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
  const dept = document.getElementById("signup-dept").value;
  const level = document.getElementById("signup-level").value;
  if (!name || !email || !password) {
    showToast("Please fill all fields", "error");
    return;
  }
  if (!dept || !level) {
    showToast("Please select Department and Level", "error");
    return;
  }
  if (password.length < 6) {
    showToast("Password must be at least 6 characters", "error");
    return;
  }
  const { error } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
    options: { data: { name: name, department: dept, level: level } }
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
  if (globalMsgChannel) {
    try { await supabaseClient.removeChannel(globalMsgChannel); } catch (e) {}
    globalMsgChannel = null;
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

function setupGlobalMessageListener() {
  if (!supabaseClient || !currentUser || globalMsgChannel) return;
  globalMsgChannel = supabaseClient
    .channel("all-messages")
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "messages"
    }, function(payload) {
      const msg = payload.new;
      if (msg.user_name === "system") return;
      const currentName = (currentUser.user_metadata && currentUser.user_metadata.name) || "";
      if (msg.user_name && normalizeName(msg.user_name) === normalizeName(currentName)) return;
      const session = sessions.find(function(s) { return s.id === msg.session_id; });
      if (!session || !session.members) return;
      const isMember = session.members.some(function(m) {
        return normalizeName(m) === normalizeName(currentName);
      });
      if (!isMember) return;
      if (currentChatSessionId === msg.session_id) return;
      const preview = (msg.message || "").length > 40
        ? msg.message.substring(0, 40) + "…"
        : msg.message;
      showToast(msg.user_name + ": " + preview);
      playNotificationSound();
      sendBrowserNotification(session.title || "New message", msg.user_name + ": " + preview);
    })
    .subscribe();
}

function setupGlobalPresence() {
  if (!supabaseClient || !currentUser || presenceChannel) return;
  const userName = (currentUser.user_metadata && currentUser.user_metadata.name) || "Anonymous";
  presenceChannel = supabaseClient.channel("online-users", {
    config: { presence: { key: currentUser.id } }
  });
  presenceChannel.on("presence", { event: "sync" }, function() {
    const state = presenceChannel.presenceState();
    onlineUsers = {};
    Object.keys(state).forEach(function(key) {
      state[key].forEach(function(p) {
        if (p.session_id && p.user_name) {
          if (!onlineUsers[p.session_id]) onlineUsers[p.session_id] = {};
          onlineUsers[p.session_id][p.user_name] = true;
        }
      });
    });
    renderSessions();
    updateChatOnlineStatus();
    updateDashboard();
    renderMyChats();
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
  el.textContent = count === 0 ? "No one online" : count === 1 ? "1 online" : count + " online";
}

function updateDashboard() {
  const totalEl = document.getElementById("stat-total");
  if (!totalEl) return;
  const currentName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "";
  const now = new Date();
  let total = sessions.length, joined = 0, live = 0, onlineTotal = 0;
  sessions.forEach(function(session) {
    if (session.members && session.members.some(function(m) {
      return normalizeName(m) === normalizeName(currentName);
    })) joined++;
    const start = new Date(session.time);
    const end = session.end_time ? new Date(session.end_time) : null;
    if (now >= start && (!end || now <= end)) live++;
    onlineTotal += getOnlineCount(session.id);
  });
  totalEl.textContent = total;
  document.getElementById("stat-joined").textContent = joined;
  document.getElementById("stat-live").textContent = live;
  document.getElementById("stat-online").textContent = onlineTotal;
}

async function loadSessions() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("sessions")
    .select("*")
    .order("time", { ascending: true });
  if (error) {
    const el = document.getElementById("sessions");
    if (el) el.innerHTML = "<p class='empty'>Error loading sessions</p>";
    return;
  }
  sessions = data || [];
  renderSessions();
  updateDashboard();
  renderMyChats();
}

async function createSession() {
  if (!supabaseClient) {
    showToast("Still connecting... please wait", "error");
    return;
  }
  const title = document.getElementById("session-title").value.trim();
  const course = document.getElementById("session-course").value.trim();
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
    course: course || null,
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
  document.getElementById("session-course").value = "";
  document.getElementById("session-time").value = "";
  document.getElementById("session-end-time").value = "";
  showToast("Session created successfully");
  switchTab("sessions");
}

function renderSessions() {
  const container = document.getElementById("sessions");
  if (!container) return;
  container.innerHTML = "";
  const searchEl = document.getElementById("session-search");
  const search = searchEl ? searchEl.value.trim().toLowerCase() : "";
  let filtered = sessions;
  if (search) {
    filtered = sessions.filter(function(s) {
      const title = (s.title || "").toLowerCase();
      const course = (s.course || "").toLowerCase();
      return title.indexOf(search) !== -1 || course.indexOf(search) !== -1;
    });
  }
  if (filtered.length === 0) {
    container.innerHTML = "<p class='empty'>No sessions found.<br>Create one on the Home tab!</p>";
    updateDashboard();
    return;
  }
  const currentName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "";
  filtered.forEach(function(session) {
    let membersHtml = "No one yet";
    let isMember = false;
    let onlineCount = getOnlineCount(session.id);
    if (session.members && session.members.length > 0) {
      membersHtml = session.members.map(function(name) {
        const online = isUserOnline(session.id, name);
        const dot = online ? "<span class='online-dot'></span>" : "";
        return "<div class='member-line'>" + createAvatarHtml(name, "avatar-sm") + " " + dot + escapeHtml(name) + "</div>";
      }).join("");
      isMember = session.members.some(function(m) {
        return normalizeName(m) === normalizeName(currentName);
      });
    }
    const notifyOn = isNotifyEnabled(session.id);
    const notifyBtnClass = notifyOn ? "btn-notify enabled" : "btn-notify";
    const notifyBtnText = notifyOn ? "🔔 On" : "🔔 Notify";
    let actionButtons = "<button onclick='event.stopPropagation();openJoin(" + session.id + ")'>Join</button>";
    if (isMember) {
      actionButtons += "<button onclick='event.stopPropagation();leaveSession(" + session.id + ")' style='background:#ef4444;'>Leave</button>";
    }
    actionButtons += "<button class='" + notifyBtnClass + "' onclick='event.stopPropagation();toggleNotify(" + session.id + ")'>" + notifyBtnText + "</button>";
    actionButtons += "<button onclick='event.stopPropagation();openDelete(" + session.id + ")'>Delete</button>";
    const startText = new Date(session.time).toLocaleString();
    const endText = session.end_time ? new Date(session.end_time).toLocaleString() : "—";
    const onlineText = onlineCount > 0 ? "<div class='online-count'>● " + onlineCount + " online</div>" : "";
    const courseText = session.course ? "<div class='meta' style='color:var(--accent);'>" + escapeHtml(session.course) + "</div>" : "";
    const div = document.createElement("div");
    div.className = "session-card";
    div.innerHTML =
      "<strong>" + escapeHtml(session.title) + "</strong>" + courseText +
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
    const fiveMin = 5 * 60 * 1000;
    if (notifyEnabled && !notifiedSoon[session.id] && now < start) {
      const diff = start - now;
      if (diff <= fiveMin && diff > 0) {
        notifiedSoon[session.id] = true;
        showToast("\"" + session.title + "\" starts in a few minutes!");
        playNotificationSound();
        sendBrowserNotification("Session starting soon", session.title + " starts in about 5 minutes");
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
        if (notifyEnabled) sendBrowserNotification("Session started", session.title + " is now live!");
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

function openJoin(id) { confirmJoinDirect(id); }

async function confirmJoinDirect(sessionId) {
  if (!supabaseClient || !currentUser) {
    showToast("Please login first", "error");
    return;
  }
  const name = (currentUser.user_metadata && currentUser.user_metadata.name)
    ? currentUser.user_metadata.name.trim() : "";
  if (!name) {
    showToast("Your account has no name.", "error");
    return;
  }
  const session = sessions.find(function(s) { return s.id === sessionId; });
  if (!session) return;

  let members = session.members || [];
  if (members.some(function(m) { return normalizeName(m) === normalizeName(name); })) {
    showToast("You are already in this session");
    openChat(sessionId);
    return;
  }

  members.push(name);
  const { error } = await supabaseClient
    .from("sessions")
    .update({ members: members })
    .eq("id", sessionId);

  if (error) {
    showToast("Error joining: " + error.message, "error");
    return;
  }

  await supabaseClient.from("messages").insert([{
    session_id: sessionId,
    user_name: "system",
    message: name + " joined",
    reply_to: null,
    reactions: "{}"
  }]);

  showToast("Joined successfully as " + name);
  openChat(sessionId);
}

async function leaveSession(id) {
  if (!supabaseClient || !currentUser) return;
  const currentName = (currentUser.user_metadata && currentUser.user_metadata.name) || "";
  if (!currentName) return;
  const session = sessions.find(function(s) { return s.id === id; });
  if (!session) return;

  let members = (session.members || []).filter(function(m) {
    return normalizeName(m) !== normalizeName(currentName);
  });

  const { error } = await supabaseClient.from("sessions").update({ members: members }).eq("id", id);
  if (error) {
    showToast("Error leaving session", "error");
    return;
  }

  await supabaseClient.from("messages").insert([{
    session_id: id,
    user_name: "system",
    message: currentName + " left",
    reply_to: null,
    reactions: "{}"
  }]);

  if (currentChatSessionId === id) {
    closeChat();
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
  const { error } = await supabaseClient.from("sessions").delete().eq("id", currentDeleteId);
  if (error) showToast("Error deleting session", "error");
  else showToast("Session deleted");
  closeDelete();
}

/* ==================== MESSAGE ACTIONS ==================== */
function hideMsgActions() {
  const menu = document.getElementById("msg-actions");
  if (menu) menu.classList.remove("show");
  document.querySelectorAll(".message.selected").forEach(function(el) {
    el.classList.remove("selected");
  });
}

function showMsgActions(e, msgId, userName, text, isMine, el) {
  if (e && e.preventDefault) e.preventDefault();
  if (e && e.stopPropagation) e.stopPropagation();
  hideMsgActions();

  selectedMsg = { id: msgId, user_name: userName, message: text, isMine: isMine };

  const menu = document.getElementById("msg-actions");
  if (!menu) return;

  const delBtn = document.getElementById("msg-delete-btn");
  if (delBtn) delBtn.style.display = isMine ? "block" : "none";

  const msgEl = el || (e && e.currentTarget) || (e && e.target);
  if (msgEl && msgEl.classList) msgEl.classList.add("selected");

  if (msgEl && typeof msgEl.getBoundingClientRect === "function") {
    const rect = msgEl.getBoundingClientRect();
    menu.style.transform = "";
    menu.style.top = Math.min(rect.top, window.innerHeight - 260) + "px";
    menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 200)) + "px";
  } else {
    menu.style.top = "40%";
    menu.style.left = "50%";
    menu.style.transform = "translateX(-50%)";
  }
  menu.classList.add("show");
}

function actionReply() {
  if (!selectedMsg) return;
  setReply(selectedMsg.user_name, selectedMsg.message);
  hideMsgActions();
}

function actionCopy() {
  if (!selectedMsg) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(selectedMsg.message || "").then(function() {
      showToast("Message copied");
    }).catch(function() {
      showToast("Could not copy", "error");
    });
  } else {
    showToast("Copy not supported", "error");
  }
  hideMsgActions();
}

async function pickReaction(emoji) {
  if (!selectedMsg || !selectedMsg.id) {
    showToast("Tap a message first, then choose an emoji", "error");
    return;
  }
  if (!currentUser || !supabaseClient) {
    showToast("Not ready", "error");
    return;
  }

  const myName = (currentUser.user_metadata && currentUser.user_metadata.name) || "User";
  const msgId = selectedMsg.id;

  showToast("Saving " + emoji + "...");

  try {
    const { data, error } = await supabaseClient
      .from("messages")
      .select("reactions")
      .eq("id", msgId)
      .single();

    if (error) {
      showToast("Load failed: " + error.message, "error");
      return;
    }

    let reactions = {};
    try {
      if (data && data.reactions) {
        reactions = typeof data.reactions === "string"
          ? JSON.parse(data.reactions || "{}")
          : (data.reactions || {});
      }
    } catch (err) {
      reactions = {};
    }

    let alreadyHadThis = false;
    if (reactions[emoji] && reactions[emoji].indexOf(myName) >= 0) {
      alreadyHadThis = true;
    }

    // One reaction per person
    Object.keys(reactions).forEach(function(key) {
      if (!Array.isArray(reactions[key])) return;
      reactions[key] = reactions[key].filter(function(n) { return n !== myName; });
      if (reactions[key].length === 0) delete reactions[key];
    });

    if (!alreadyHadThis) {
      if (!Array.isArray(reactions[emoji])) reactions[emoji] = [];
      reactions[emoji].push(myName);
      showToast(emoji + " added");
    } else {
      showToast("Reaction removed");
    }

    const payload = JSON.stringify(reactions);

    const { error: upErr } = await supabaseClient
      .from("messages")
      .update({ reactions: payload })
      .eq("id", msgId);

    if (upErr) {
      showToast("Save failed: " + upErr.message, "error");
      return;
    }

    hideMsgActions();
    if (currentChatSessionId) await loadMessages(currentChatSessionId);
  } catch (err) {
    showToast("Reaction error", "error");
    console.error(err);
  }
}

function actionDelete() {
  if (!selectedMsg || !selectedMsg.isMine || !selectedMsg.id) {
    showToast("You can only delete your own messages", "error");
    hideMsgActions();
    return;
  }
  hideMsgActions();
  document.getElementById("delete-msg-modal").style.display = "block";
}

function closeDeleteMessage() {
  document.getElementById("delete-msg-modal").style.display = "none";
}

async function confirmDeleteMessage() {
  if (!selectedMsg || !selectedMsg.id) {
    closeDeleteMessage();
    return;
  }
  const { error } = await supabaseClient
    .from("messages")
    .delete()
    .eq("id", selectedMsg.id);

  if (error) {
    showToast("Failed to delete: " + error.message, "error");
  } else {
    showToast("Message deleted");
    if (currentChatSessionId) loadMessages(currentChatSessionId);
  }
  selectedMsg = null;
  closeDeleteMessage();
}

function setReply(name, text) {
  replyToName = name || "Someone";
  replyToText = text || "";
  const bar = document.getElementById("reply-bar");
  const nameEl = document.getElementById("reply-bar-name");
  const textEl = document.getElementById("reply-bar-text");
  if (bar) bar.style.display = "block";
  if (nameEl) nameEl.textContent = "Replying to " + replyToName;
  if (textEl) textEl.textContent = replyToText;
  const input = document.getElementById("chat-input");
  if (input) input.focus();
}

function cancelReply() {
  replyToName = null;
  replyToText = null;
  const bar = document.getElementById("reply-bar");
  if (bar) bar.style.display = "none";
}

/* ==================== CHAT ==================== */
async function openChat(sessionId) {
  if (!currentUser) {
    showToast("Please login first", "error");
    return;
  }

  // Fresh members list
  await loadSessions();

  const currentName = (currentUser.user_metadata && currentUser.user_metadata.name) || "";
  const session = sessions.find(function(s) { return s.id === sessionId; });

  if (!session) {
    showToast("Session not found", "error");
    return;
  }

  const isMember = Array.isArray(session.members) && session.members.some(function(m) {
    return normalizeName(m) === normalizeName(currentName);
  });

  if (!isMember) {
    showToast("Join the session first to access the group chat", "error");
    return;
  }

  currentChatSessionId = sessionId;
  cancelReply();
  hideMsgActions();
  document.getElementById("chat-title").textContent = session.title || "Group Chat";
  document.getElementById("chat-modal").style.display = "block";
  document.getElementById("chat-messages").innerHTML =
    "<p style='text-align:center;color:#8696a0;padding:20px;'>Loading messages...</p>";

  await trackSessionPresence(sessionId);
  updateChatOnlineStatus();
  await loadMessages(sessionId);
  setupChatRealtime(sessionId);
}

function closeChat() {
  document.getElementById("chat-modal").style.display = "none";
  currentChatSessionId = null;
  cancelReply();
  hideMsgActions();
  if (chatChannel) {
    supabaseClient.removeChannel(chatChannel);
    chatChannel = null;
  }
  if (presenceChannel && currentUser) {
    const userName = (currentUser.user_metadata && currentUser.user_metadata.name) || "Anonymous";
    presenceChannel.track({ user_name: userName, online_at: new Date().toISOString() });
  }
}

async function loadMessages(sessionId) {
  const { data, error } = await supabaseClient
    .from("messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) {
    document.getElementById("chat-messages").innerHTML =
      "<p style='text-align:center;color:#f87171;'>Error loading messages</p>";
    return;
  }
  renderMessages(data || []);
}

function buildMessageHtml(msg, currentName) {
  if (msg.user_name === "system") {
    return {
      isMine: false,
      isSystem: true,
      html: "<div class='system-pill'>" + escapeHtml(msg.message || "") + "</div>"
    };
  }

  const isMine = msg.user_name && normalizeName(msg.user_name) === normalizeName(currentName);
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  let quoteHtml = "";
  if (msg.reply_to) {
    quoteHtml = "<div class='message-reply-quote'>" + escapeHtml(msg.reply_to) + "</div>";
  }

  let ticks = isMine ? "<span class='ticks read'>✓✓</span>" : "";
  let header = "";
  if (!isMine) {
    header = "<div class='message-header'>" + createAvatarHtml(msg.user_name, "avatar-sm") +
             "<div class='message-name'>" + escapeHtml(msg.user_name) + "</div></div>";
  }

  let reactionsHtml = "";
  try {
    const reactions = msg.reactions ? JSON.parse(msg.reactions) : {};
    const keys = Object.keys(reactions);
    if (keys.length > 0) {
      reactionsHtml = "<div class='msg-reactions'>";
      keys.forEach(function(emoji) {
        reactionsHtml += "<span class='msg-reaction'>" + emoji + " " + reactions[emoji].length + "</span>";
      });
      reactionsHtml += "</div>";
    }
  } catch (e) {}

  return {
    isMine: isMine,
    isSystem: false,
    html: header + quoteHtml +
          "<div>" + escapeHtml(msg.message || "") + "</div>" +
          reactionsHtml +
          "<div class='message-meta'><span class='message-time'>" + time + "</span>" + ticks + "</div>"
  };
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
    const built = buildMessageHtml(msg, currentName);
    const div = document.createElement("div");

    if (built.isSystem) {
      div.className = "message system";
      div.innerHTML = built.html;
    } else {
      div.className = "message " + (built.isMine ? "sent" : "received");
      div.innerHTML = built.html;

      div.addEventListener("click", function(e) {
        showMsgActions(e, msg.id, msg.user_name, msg.message, built.isMine, div);
      });

      let pressTimer;
      div.addEventListener("touchstart", function(e) {
        const el = div;
        pressTimer = setTimeout(function() {
          showMsgActions(e, msg.id, msg.user_name, msg.message, built.isMine, el);
        }, 500);
      });
      div.addEventListener("touchend", function() { clearTimeout(pressTimer); });
      div.addEventListener("touchmove", function() { clearTimeout(pressTimer); });
    }

    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

function setupChatRealtime(sessionId) {
  if (chatChannel) supabaseClient.removeChannel(chatChannel);
  chatChannel = supabaseClient
    .channel("chat-" + sessionId)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "messages",
      filter: "session_id=eq." + sessionId
    }, function() {
      if (currentChatSessionId === sessionId) loadMessages(sessionId);
    })
    .on("postgres_changes", {
      event: "UPDATE", schema: "public", table: "messages",
      filter: "session_id=eq." + sessionId
    }, function() {
      if (currentChatSessionId === sessionId) loadMessages(sessionId);
    })
    .on("postgres_changes", {
      event: "DELETE", schema: "public", table: "messages",
      filter: "session_id=eq." + sessionId
    }, function() {
      if (currentChatSessionId === sessionId) loadMessages(sessionId);
    })
    .subscribe();
}

async function sendMessage() {
  if (!supabaseClient || !currentChatSessionId) return;
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  const userName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "Anonymous";
  let replyTo = null;
  if (replyToText) {
    replyTo = (replyToName || "Someone") + ": " + replyToText;
  }
  const { error } = await supabaseClient.from("messages").insert([{
    session_id: currentChatSessionId,
    user_name: userName,
    message: text,
    reply_to: replyTo,
    reactions: "{}"
  }]);
  if (error) {
    showToast("Failed to send message", "error");
    return;
  }
  input.value = "";
  cancelReply();
  input.focus();
}

document.addEventListener("click", function(e) {
  const menu = document.getElementById("msg-actions");
  if (menu && menu.classList.contains("show")) {
    if (!menu.contains(e.target) && !e.target.closest(".message")) {
      hideMsgActions();
    }
  }
});

initSupabase();
setInterval(updateCountdowns, 1000);

// Globals
window.openJoin = openJoin;
window.leaveSession = leaveSession;
window.openChat = openChat;
window.toggleNotify = toggleNotify;
window.openDelete = openDelete;
window.closeDelete = closeDelete;
window.confirmDelete = confirmDelete;
window.closeChat = closeChat;
window.sendMessage = sendMessage;
window.createSession = createSession;
window.login = login;
window.signup = signup;
window.logout = logout;
window.toggleTheme = toggleTheme;
window.togglePassword = togglePassword;
window.showLogin = showLogin;
window.showSignup = showSignup;
window.renderSessions = renderSessions;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.switchTab = switchTab;
window.renderMyChats = renderMyChats;
window.renderProfile = renderProfile;
window.setReply = setReply;
window.cancelReply = cancelReply;
window.actionReply = actionReply;
window.actionCopy = actionCopy;
window.actionDelete = actionDelete;
window.pickReaction = pickReaction;
window.hideMsgActions = hideMsgActions;
window.closeDeleteMessage = closeDeleteMessage;
window.confirmDeleteMessage = confirmDeleteMessage;