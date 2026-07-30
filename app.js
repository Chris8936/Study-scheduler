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

function showToast(message, type) {
  if (!type) type = "success";
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "show " + type;
  setTimeout(function() { toast.className = ""; }, 3000);
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
    console.log("Supabase connected");

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
}

async function createSession() {
  if (!supabaseClient) {
    showToast("Still connecting... please wait", "error");
    return;
  }

  const title = document.getElementById("session-title").value.trim();
  const timeInput = document.getElementById("session-time").value;

  if (!title || !timeInput) {
    showToast("Please enter both a title and a time", "error");
    return;
  }

  const localDate = new Date(timeInput);
  const isoTime = localDate.toISOString();

  const { error } = await supabaseClient.from("sessions").insert([{
    title: title,
    time: isoTime,
    members: [],
    notes: ""
  }]);

  if (error) {
    showToast("Error: " + error.message, "error");
    return;
  }

  document.getElementById("session-title").value = "";
  document.getElementById("session-time").value = "";
  showToast("Session created successfully");
}

function renderSessions() {
  const container = document.getElementById("sessions");
  container.innerHTML = "";

  if (sessions.length === 0) {
    container.innerHTML = "<p class='empty'>No sessions yet.<br>Create one above!</p>";
    return;
  }

  const currentName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "";

  sessions.forEach(function(session) {
    let membersHtml = "No one yet";
    let isMember = false;

    if (session.members && session.members.length > 0) {
      membersHtml = session.members.map(function(name) {
        return "• " + name;
      }).join("<br>");

      isMember = session.members.some(function(m) {
        return m.toLowerCase() === currentName.toLowerCase();
      });
    }

    let actionButtons = "<button onclick='openJoin(" + session.id + ")'>Join</button>";
    if (isMember) {
      actionButtons += "<button onclick='leaveSession(" + session.id + ")' style='background:#64748b;'>Leave</button>";
    }
    actionButtons += "<button onclick='openChat(" + session.id + ")'>Chat</button>";
    actionButtons += "<button onclick='openDelete(" + session.id + ")'>Delete</button>";

    const div = document.createElement("div");
    div.className = "session-card";
    div.innerHTML =
      "<strong>" + session.title + "</strong>" +
      "<div class='meta'>Starts: " + new Date(session.time).toLocaleString() + "</div>" +
      "<span class='countdown' id='countdown-" + session.id + "'>Calculating...</span>" +
      "<div class='members'>Members:<br>" + membersHtml + "</div>" +
      "<div class='card-actions'>" + actionButtons + "</div>";

    container.appendChild(div);
  });
}

function updateCountdowns() {
  const now = new Date();
  sessions.forEach(function(session) {
    const el = document.getElementById("countdown-" + session.id);
    if (!el) return;

    const target = new Date(session.time);
    const diff = target - now;

    if (diff <= 0) {
      el.textContent = "Session started!";
      el.style.color = "#4ade80";
    } else {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);
      el.textContent = "Starts in: " + hours + "h " + mins + "m " + secs + "s";
      el.style.color = "#f87171";
    }
  });
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
    return m.toLowerCase() === name.toLowerCase();
  });

  if (nameExists) {
    errorEl.textContent = '"' + name + '" is already in this session.';
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
    return m.toLowerCase() !== currentName.toLowerCase();
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

/* ==================== CHAT ==================== */

async function openChat(sessionId) {
  currentChatSessionId = sessionId;
  const session = sessions.find(function(s) { return s.id === sessionId; });
  document.getElementById("chat-title").textContent = session ? session.title : "Group Chat";
  document.getElementById("chat-modal").style.display = "block";
  document.getElementById("chat-messages").innerHTML = "<p style='text-align:center;color:var(--muted);padding:20px;'>Loading messages...</p>";

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
    container.innerHTML = "<p style='text-align:center;color:var(--muted);padding:30px 10px;'>No messages yet.<br>Say hello!</p>";
    return;
  }

  container.innerHTML = "";

  messages.forEach(function(msg) {
    const isMine = msg.user_name && msg.user_name.toLowerCase() === currentName.toLowerCase();
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement("div");
    div.className = "message " + (isMine ? "sent" : "received");
    div.innerHTML =
      (isMine ? "" : "<div class='message-name'>" + msg.user_name + "</div>") +
      "<div>" + msg.message + "</div>" +
      "<div class='message-time'>" + time + "</div>";

    container.appendChild(div);
  });

  // Auto scroll to bottom
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
        // Add new message without reloading everything
        const msg = payload.new;
        const container = document.getElementById("chat-messages");
        const currentName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || "";
        const isMine = msg.user_name && msg.user_name.toLowerCase() === currentName.toLowerCase();
        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Remove "No messages" placeholder if present
        if (container.querySelector("p")) container.innerHTML = "";

        const div = document.createElement("div");
        div.className = "message " + (isMine ? "sent" : "received");
        div.innerHTML =
          (isMine ? "" : "<div class='message-name'>" + msg.user_name + "</div>") +
          "<div>" + msg.message + "</div>" +
          "<div class='message-time'>" + time + "</div>";

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