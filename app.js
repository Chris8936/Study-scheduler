const SUPABASE_URL = "https://qzjlqhggspgggaugerme.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6amxxaGdnc3BnZ2dhdWdlcm1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjc3MTgsImV4cCI6MjEwMDc0MzcxOH0.VGPinQ6GdN8Y1myp0XN_o_yGt6oPd9kaHjXxbIrLiP8";

let supabaseClient = null;
let sessions = [];
let currentNotesId = null;

function initSupabase() {
  if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log("Supabase connected");
    loadSessions();
  } else {
    setTimeout(initSupabase, 400);
  }
}

async function loadSessions() {
  if (!supabaseClient) return;

  const { data, error } = await supabaseClient
    .from("sessions")
    .select("*")
    .order("time", { ascending: true });

  if (error) {
    console.error(error);
    document.getElementById("sessions").innerHTML = "<p>Error loading sessions</p>";
    return;
  }

  sessions = data || [];
  renderSessions();
}

async function createSession() {
  if (!supabaseClient) {
    alert("Still connecting... wait 2 seconds and try again");
    return;
  }

  const title = document.getElementById("session-title").value.trim();
  const timeInput = document.getElementById("session-time").value;

  if (!title || !timeInput) {
    alert("Please enter both a title and a time");
    return;
  }

  // Timezone fix: treat the selected time as local time
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
    alert("Error: " + error.message);
    return;
  }

  document.getElementById("session-title").value = "";
  document.getElementById("session-time").value = "";
  loadSessions();
}

function renderSessions() {
  const container = document.getElementById("sessions");
  container.innerHTML = "";

  if (sessions.length === 0) {
    container.innerHTML = "<p>No sessions yet.</p>";
    return;
  }

  sessions.forEach(session => {
    const div = document.createElement("div");
    div.className = "session-card";
    div.innerHTML = `
      <strong>${session.title}</strong><br>
      Starts: ${new Date(session.time).toLocaleString()}<br>
      <span class="countdown" id="countdown-${session.id}">Calculating...</span><br>
      <button onclick="joinSession(${session.id})">Join</button>
      <button onclick="openNotes(${session.id})">Notes</button>
      <button onclick="deleteSession(${session.id})">Delete</button>
    `;
    container.appendChild(div);
  });
}

function updateCountdowns() {
  const now = new Date();

  sessions.forEach(session => {
    const el = document.getElementById(`countdown-${session.id}`);
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
      el.textContent = `Starts in: ${hours}h ${mins}m ${secs}s`;
      el.style.color = "#f87171";
    }
  });
}

async function joinSession(id) {
  if (!supabaseClient) return;

  const session = sessions.find(s => s.id === id);
  if (!session) return;

  const name = prompt("Enter your name:");
  if (!name) return;

  let members = session.members || [];
  if (!members.includes(name)) {
    members.push(name);

    const { error } = await supabaseClient
      .from("sessions")
      .update({ members: members })
      .eq("id", id);

    if (error) {
      alert("Error joining: " + error.message);
      return;
    }

    alert("Joined! Members: " + members.join(", "));
    loadSessions();
  } else {
    alert("You already joined.");
  }
}

async function deleteSession(id) {
  if (!supabaseClient) return;
  if (!confirm("Delete this session?")) return;

  const { error } = await supabaseClient
    .from("sessions")
    .delete()
    .eq("id", id);

  if (error) {
    alert("Error deleting: " + error.message);
    return;
  }

  loadSessions();
}

function openNotes(id) {
  const session = sessions.find(s => s.id === id);
  if (!session) return;

  currentNotesId = id;
  document.getElementById("notes-title").textContent = "Notes – " + session.title;
  document.getElementById("notes-text").value = session.notes || "";
  document.getElementById("notes-modal").style.display = "block";
}

async function saveNotes() {
  if (!supabaseClient) return;

  const notes = document.getElementById("notes-text").value;

  const { error } = await supabaseClient
    .from("sessions")
    .update({ notes: notes })
    .eq("id", currentNotesId);

  if (error) {
    alert("Error saving notes: " + error.message);
    return;
  }

  closeNotes();
  alert("Notes saved!");
  loadSessions();
}

function closeNotes() {
  document.getElementById("notes-modal").style.display = "none";
  currentNotesId = null;
}

initSupabase();
setInterval(updateCountdowns, 1000);
setInterval(() => {
  if (supabaseClient) loadSessions();
}, 10000);