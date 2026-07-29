const SUPABASE_URL = "https://qzjlqhggspgggaugerme.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6amxxaGdnc3BnZ2dhdWdlcm1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjc3MTgsImV4cCI6MjEwMDc0MzcxOH0.VGPinQ6GdN8Y1myp0XN_o_yGt6oPd9kaHjXxbIrLiP8";

let supabaseClient = null;
let sessions = [];
let currentNotesId = null;
let currentJoinId = null;
let currentDeleteId = null;

function showToast(message, type) {
  if (!type) type = "success";
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "show " + type;
  setTimeout(function() {
    toast.className = "";
  }, 3000);
}

function initSupabase() {
  if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log("Supabase connected");
    loadSessions();
    setupRealtime();
  } else {
    setTimeout(initSupabase, 400);
  }
}

function setupRealtime() {
  supabaseClient
    .channel("sessions-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sessions" },
      function() {
        loadSessions();
      }
    )
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

  const { error } = await supabaseClient.from("sessions").insert([
    {
      title: title,
      time: isoTime,
      members: [],
      notes: ""
    }
  ]);

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

  sessions.forEach(function(session) {
    let membersHtml = "No one yet";
    if (session.members && session.members.length > 0) {
      membersHtml = session.members.map(function(name) {
        return "• " + name;
      }).join("<br>");
    }

    let notesBtnText = "Notes";
    let notesPreview = "";

    if (session.notes && session.notes.trim().length > 0) {
      notesBtnText = "View Notes";
      // Strip HTML for preview
      const temp = document.createElement("div");
      temp.innerHTML = session.notes;
      const plain = temp.textContent || temp.innerText || "";
      const preview = plain.trim().substring(0, 80);
      notesPreview = "<div class='notes-preview'>" + preview + (plain.length > 80 ? "..." : "") + "</div>";
    }

    const div = document.createElement("div");
    div.className = "session-card";

    div.innerHTML =
      "<strong>" + session.title + "</strong>" +
      "<div class='meta'>Starts: " + new Date(session.time).toLocaleString() + "</div>" +
      "<span class='countdown' id='countdown-" + session.id + "'>Calculating...</span>" +
      "<div class='members'>Members:<br>" + membersHtml + "</div>" +
      notesPreview +
      "<div>" +
        "<button onclick='openJoin(" + session.id + ")'>Join</button>" +
        "<button onclick='openNotes(" + session.id + ")'>" + notesBtnText + "</button>" +
        "<button onclick='openDelete(" + session.id + ")'>Delete</button>" +
      "</div>";

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
  document.getElementById("join-name").value = "";
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

  const session = sessions.find(function(s) {
    return s.id === currentJoinId;
  });
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

function openNotes(id) {
  const session = sessions.find(function(s) {
    return s.id === id;
  });
  if (!session) return;

  currentNotesId = id;
  document.getElementById("notes-title").textContent = "Notes – " + session.title;
  document.getElementById("notes-editor").innerHTML = session.notes || "";

  if (session.created_at) {
    document.getElementById("notes-updated").textContent =
      "Last updated: " + new Date(session.created_at).toLocaleString();
  } else {
    document.getElementById("notes-updated").textContent = "Last updated: —";
  }

  document.getElementById("notes-modal").style.display = "block";
}

async function saveNotes() {
  if (!supabaseClient) return;

  const notes = document.getElementById("notes-editor").innerHTML;

  const { error } = await supabaseClient
    .from("sessions")
    .update({ notes: notes })
    .eq("id", currentNotesId);

  if (error) {
    showToast("Error saving notes", "error");
    return;
  }

  closeNotes();
  showToast("Notes saved successfully");
}

function closeNotes() {
  document.getElementById("notes-modal").style.display = "none";
  currentNotesId = null;
}

function formatNotes(command) {
  document.execCommand(command, false, null);
  document.getElementById("notes-editor").focus();
}

initSupabase();
setInterval(updateCountdowns, 1000);