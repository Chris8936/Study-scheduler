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
    return s.members && s.members.some(function(m) {
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
      "<strong>" + session.title + "</strong>" +
      (session.course ? "<div class='meta' style='color:var(--accent);'>" + session.course + "</div>" : "") +
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

/* ==================== NOTIFICATIONS ==================== */
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
        return "<div class='member-line'>" + createAvatarHtml(name, "avatar-sm") + " " + dot + name + "</div>";
      }).join("");
      isMember = session.members.some(function(m) {
        return normalizeName(m) === normalizeName(currentName);
      });
    }

    const notifyOn = isNotifyEnabled(session.id);
    const notifyBtnClass = notifyOn ? "btn-notify enabled" : "btn-notify";
    const notifyBtnText = notifyOn ? "🔔 On" : "🔔 Notify";

    // No Chat button here — chats live in the Chats tab
    let actionButtons = "<button onclick='event.stopPropagation();openJoin(" + session.id + ")'>Join</button>";
    if (isMember) {
      actionButtons += "<button onclick='event.stopPropagation();leaveSession(" + session.id + ")' style='background:#ef4444;'>Leave</button>";
    }
    actionButtons += "<button class='" + notifyBtnClass + "' onclick='event.stopPropagation();toggleNotify(" + session.id + ")'>" + notifyBtnText + "</button>";
    actionButtons += "<button onclick='event.stopPropagation();openDelete(" + session.id + ")'>Delete</button>";

    const startText = new Date(session.time).toLocaleString();
    const endText = session.end_time ? new Date(session.end_time).toLocaleString() : "—";
    const onlineText = onlineCount > 0 ? "<div class='online-count'>● " + onlineCount + " online</div>" : "";
    const courseText = session.course ? "<div class='meta' style='color:var(--accent);'>" + session.course + "</div>" : "";

    const div = document.createElement("div");
    div.className = "session-card";
    div.innerHTML =
      "<strong>" + session.title + "</strong>" + courseText +
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
  if (error) showToast("Error leaving session", "error");
  else showToast("You left the session");
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

async function openChat(sessionId) {
  if (!currentUser) {
    showToast("Please login first", "error");
    return;
  }

  const currentName = (currentUser.user_metadata && currentUser.user_metadata.name) || "";
  const session = sessions.find(function(s) { return s.id === sessionId; });

  if (!session) {
    showToast("Session not found", "error");
    return;
  }

  const isMember = session.members && session.members.some(function(m) {
    return normalizeName(m) === normalizeName(currentName);
  });

  if (!isMember) {
    showToast("Join the session first to access the group chat", "error");
    return;
  }

  currentChatSessionId = sessionId;
  document.getElementById("chat-title").textContent = session.title || "Group Chat";
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
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const div = document.createElement("div");
    div.className = "message " + (isMine ? "sent" : "received");
    let ticks = isMine ? "<span class='ticks read'>✓✓</span>" : "";
    let header = "";
    if (!isMine) {
      header = "<div class='message-header'>" + createAvatarHtml(msg.user_name, "avatar-sm") +
               "<div class='message-name'>" + msg.user_name + "</div></div>";
    }
    div.innerHTML = header + "<div>" + msg.message + "</div>" +
      "<div class='message-meta'><span class='message-time'>" + time + "</span>" + ticks + "</div>";
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
    }, function(payload) {
      const msg = payload.new;
      const container = document.getElementById("chat-messages");
      const currentName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "";
      const isMine = msg.user_name && normalizeName(msg.user_name) === normalizeName(currentName);
      const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (container.querySelector("p")) container.innerHTML = "";
      const div = document.createElement("div");
      div.className = "message " + (isMine ? "sent" : "received");
      let ticks = isMine ? "<span class='ticks read'>✓✓</span>" : "";
      let header = "";
      if (!isMine) {
        header = "<div class='message-header'>" + createAvatarHtml(msg.user_name, "avatar-sm") +
                 "<div class='message-name'>" + msg.user_name + "</div></div>";
      }
      div.innerHTML = header + "<div>" + msg.message + "</div>" +
        "<div class='message-meta'><span class='message-time'>" + time + "</span>" + ticks + "</div>";
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    })
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

  if (error) showToast("Failed to send message", "error");
  else {
    input.value = "";
    input.focus();
  }
}

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