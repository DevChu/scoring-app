const config = window.SCORING_CONFIG || {};
const scopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly"
].join(" ");

let tokenClient;
let accessToken = "";
let profile = { name: "", email: "" };
let teams = [];
let missions = [];
let leaderboard = [];

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  $("appTitle").textContent = config.appTitle || "2026 MIP挑戰營計分系統";
  bindTabs();
  bindScoreControls();
  $("loginBtn").addEventListener("click", login);
  $("refreshBtn").addEventListener("click", loadAll);
  $("scoreForm").addEventListener("submit", submitScore);

  if (!config.googleClientId || !config.spreadsheetId) {
    setStatus("請先建立 config.js 並填入 Google OAuth Client ID 與 Spreadsheet ID");
    return;
  }

  const init = () => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: scopes,
      callback: async (response) => {
        if (response.error) {
          setStatus(`登入失敗：${response.error}`);
          return;
        }
        accessToken = response.access_token;
        try {
          await verifyAccess();
          await loadAll();
        } catch (error) {
          setStatus(`登入後檢查失敗：${error.message}`);
        }
      }
    });
  };

  if (window.google?.accounts?.oauth2) init();
  else window.addEventListener("load", init);
});

function bindTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab, .view").forEach((el) => el.classList.remove("active"));
      tab.classList.add("active");
      $(tab.dataset.view).classList.add("active");
    });
  });
}

function bindScoreControls() {
  ["completion", "courage", "wisdom", "cooperation", "creativity", "service"].forEach((id) => {
    const input = $(id);
    const out = $(`${id}Out`);
    input.addEventListener("input", () => {
      out.value = input.value;
      updateTotal();
    });
  });
  ["eventBonus", "spiritBonus", "scoreType"].forEach((id) => $(id).addEventListener("input", updateTotal));
  updateTotal();
}

function login() {
  if (!tokenClient) {
    setStatus("Google 登入元件尚未載入，請稍後再試");
    return;
  }
  tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
}

async function verifyAccess() {
  const file = await api(`https://www.googleapis.com/drive/v3/files/${config.spreadsheetId}?fields=id,name,capabilities(canEdit)`);
  if (!file.capabilities?.canEdit) {
    $("submitBtn").disabled = true;
    setStatus(`已登入，但此帳號沒有編輯「${file.name || "指定試算表"}」的權限`);
    return;
  }
  profile = await api("https://www.googleapis.com/oauth2/v3/userinfo");
  $("submitBtn").disabled = false;
  setStatus(`已登入：${profile.email}，可編輯試算表`);
}

async function loadAll() {
  if (!accessToken) return;
  const ranges = ["Teams!A2:F", "Missions!A2:F", "Leaderboard!A2:G"];
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values:batchGet?ranges=${ranges.map(encodeURIComponent).join("&ranges=")}`;
  const data = await api(url);

  teams = (data.valueRanges?.[0]?.values || [])
    .filter((row) => row[0] && String(row[3]).toUpperCase() !== "FALSE")
    .map((row) => ({ id: row[0], name: row[1], guild: row[2] || "", members: row[4] || "", note: row[5] || "" }));

  missions = (data.valueRanges?.[1]?.values || [])
    .filter((row) => row[0])
    .map((row) => ({ id: row[0], node: row[1], name: row[2], category: row[3], bonus: Number(row[4] || 0), description: row[5] || "" }));

  leaderboard = (data.valueRanges?.[2]?.values || [])
    .filter((row) => row[0])
    .map((row) => ({ rank: row[0], teamId: row[1], team: row[2], guild: row[3], total: Number(row[4] || 0), exp: Number(row[5] || 0), spirit: Number(row[6] || 0) }))
    .sort((a, b) => b.total - a.total);

  renderOptions();
  renderLeaderboard();
}

function renderOptions() {
  $("teamSelect").innerHTML = teams.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)} ${team.guild ? `(${escapeHtml(team.guild)})` : ""}</option>`).join("");
  $("missionSelect").innerHTML = missions.map((mission) => `<option value="${escapeHtml(mission.id)}">${escapeHtml(mission.node)} ${escapeHtml(mission.name)}</option>`).join("");
  $("guildStrip").innerHTML = teams.map((team) => `<div class="guild-card"><strong>${escapeHtml(team.name)}</strong><span>${escapeHtml(team.guild || "未選公會")}</span></div>`).join("");
}

function renderLeaderboard() {
  $("leaderboardList").innerHTML = leaderboard.slice(0, 10).map((item) => (
    `<li>${escapeHtml(item.team)} <span>${item.total}</span></li>`
  )).join("");
}

async function submitScore(event) {
  event.preventDefault();
  const team = teams.find((item) => item.id === $("teamSelect").value);
  const mission = missions.find((item) => item.id === $("missionSelect").value);
  if (!team || !mission) return;

  const row = [
    new Date().toISOString(),
    crypto.randomUUID(),
    profile.name || "",
    profile.email || "",
    team.id,
    team.name,
    mission.id,
    $("scoreType").value,
    Number($("completion").value),
    Number($("courage").value),
    Number($("wisdom").value),
    Number($("cooperation").value),
    Number($("creativity").value),
    Number($("service").value),
    Number($("eventBonus").value || 0),
    Number($("spiritBonus").value || 0),
    Number($("totalPreview").value || 0),
    $("note").value.trim()
  ];

  $("submitBtn").disabled = true;
  try {
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/Scores!A:R:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({ values: [row] })
    });
    $("note").value = "";
    setStatus(`已送出：${team.name} +${row[16]}`);
    await loadAll();
  } catch (error) {
    setStatus(`送出失敗：${error.message}`);
  } finally {
    $("submitBtn").disabled = false;
  }
}

function updateTotal() {
  const base = ["completion", "courage", "wisdom", "cooperation", "creativity", "service"]
    .reduce((sum, id) => sum + Number($(id).value || 0), 0);
  $("totalPreview").value = base + Number($("eventBonus").value || 0) + Number($("spiritBonus").value || 0);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || response.statusText);
  }
  return response.json();
}

function setStatus(message) {
  $("statusText").textContent = message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}
