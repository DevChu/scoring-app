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
let scoreRows = [];
let currentScoreMode = "EXP";
let canEditSpreadsheet = false;
let refreshTimer = 0;
let silentLoginAttempt = false;
const teamCount = 6;
const loginStateKey = "mipScoring.hasSignedIn";
const guildOptions = ["", "守護公會", "偵察公會", "鍛造公會", "吟遊詩人公會", "魔法師公會"];

const abilityDefs = [
  { key: "completion", label: "任務完成度", color: "#f3c76a" },
  { key: "courage", label: "勇氣", color: "#d8554a" },
  { key: "wisdom", label: "智慧", color: "#3a8a55" },
  { key: "service", label: "服務", color: "#3f87c9" },
  { key: "creativity", label: "創意", color: "#a2419a" },
  { key: "cooperation", label: "合作", color: "#7bb84a" }
];
const teamLineColors = [
  "#f3c76a", "#d8554a", "#3f87c9", "#7bb84a", "#a2419a", "#2e8f69",
  "#d98d35", "#8d6ac8", "#4fb6c4", "#c45f8a", "#6b73d6", "#8a6a3a"
];

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  $("appTitle").textContent = config.appTitle || "2026 MIP挑戰營計分系統";
  bindTabs();
  bindScoreControls();
  $("loginGateBtn").addEventListener("click", login);
  $("loginBtn").addEventListener("click", login);
  $("logoutBtn").addEventListener("click", logout);
  $("projectorLogoutBtn").addEventListener("click", logout);
  $("refreshBtn").addEventListener("click", loadAll);
  $("fullscreenBtn").addEventListener("click", toggleProjectorFullscreen);
  $("scoreForm").addEventListener("submit", submitScore);
  $("teamsForm").addEventListener("submit", saveTeams);
  document.addEventListener("fullscreenchange", () => {
    $("fullscreenBtn").textContent = document.fullscreenElement ? "退出全螢幕" : "全螢幕";
  });

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
          if (!silentLoginAttempt) setStatus(`登入失敗：${response.error}`);
          silentLoginAttempt = false;
          return;
        }
        silentLoginAttempt = false;
        accessToken = response.access_token;
        try {
          canEditSpreadsheet = await verifyAccess();
          applyAccessMode(canEditSpreadsheet);
          await loadAll();
          localStorage.setItem(loginStateKey, "1");
          startAutoRefresh();
        } catch (error) {
          setStatus(`登入後檢查失敗：${error.message}`);
        }
      }
    });
    attemptSilentLogin();
  };

  if (window.google?.accounts?.oauth2) init();
  else window.addEventListener("load", init);
});

function bindTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activateView(tab.dataset.view);
    });
  });
}

function bindScoreControls() {
  ["completion", "courage", "wisdom", "cooperation", "creativity", "service"].forEach((id) => {
    const input = $(id);
    const out = $(`${id}Out`);
    out.value = input.value;
  });
  $("bonusPointsOut").value = $("bonusPoints").value;
  document.querySelectorAll(".stepper button").forEach((button) => {
    button.addEventListener("click", () => {
      const stepper = button.closest(".stepper");
      const input = $(stepper.dataset.for);
      const out = $(`${stepper.dataset.for}Out`);
      const min = Number(input.min || 0);
      const max = Number(input.max || 99);
      const next = Math.max(min, Math.min(max, Number(input.value || 0) + Number(button.dataset.step || 0)));
      input.value = String(next);
      out.value = String(next);
      updateTotal();
    });
  });
  document.querySelectorAll('input[name="scoreMode"]').forEach((input) => {
    input.addEventListener("change", () => {
      resetScoresForMode(getScoreMode());
      syncModeUI();
      updateTotal();
    });
  });
  syncModeUI();
  updateTotal();
}

function login() {
  if (!tokenClient) {
    setStatus("Google 登入元件尚未載入，請稍後再試");
    return;
  }
  tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
}

function attemptSilentLogin() {
  if (localStorage.getItem(loginStateKey) !== "1") return;
  if (!tokenClient || accessToken) return;
  silentLoginAttempt = true;
  tokenClient.requestAccessToken({ prompt: "" });
}

function logout() {
  localStorage.removeItem(loginStateKey);
  canEditSpreadsheet = false;
  profile = { name: "", email: "" };
  teams = [];
  missions = [];
  leaderboard = [];
  scoreRows = [];
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = 0;
  }

  const tokenToRevoke = accessToken;
  accessToken = "";
  $("submitBtn").disabled = true;
  $("saveTeamsBtn").disabled = true;
  setStatus("尚未登入");
  document.body.classList.remove("editor-mode", "viewer-mode");
  document.body.classList.add("signed-out");

  if (tokenToRevoke && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(tokenToRevoke, () => {});
  }
}

async function verifyAccess() {
  const file = await api(`https://www.googleapis.com/drive/v3/files/${config.spreadsheetId}?fields=id,name,capabilities(canEdit)`);
  profile = await api("https://www.googleapis.com/oauth2/v3/userinfo");
  if (!file.capabilities?.canEdit) {
    $("submitBtn").disabled = true;
    $("saveTeamsBtn").disabled = true;
    setStatus(`已登入：${profile.email}，檢視模式`);
    return false;
  }
  $("submitBtn").disabled = false;
  $("saveTeamsBtn").disabled = false;
  setStatus(`已登入：${profile.email}，可編輯試算表`);
  return true;
}

async function loadAll() {
  if (!accessToken) return;
  const ranges = ["Teams!A2:F", "Missions!A2:F", "Leaderboard!A2:G", "Scores!A2:R"];
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values:batchGet?ranges=${ranges.map(encodeURIComponent).join("&ranges=")}`;
  const data = await api(url);

  teams = (data.valueRanges?.[0]?.values || [])
    .filter((row) => row[0] && String(row[3]).toUpperCase() !== "FALSE")
    .slice(0, teamCount)
    .map((row) => ({ id: row[0], name: row[1], guild: row[2] || "", members: row[4] || "", note: row[5] || "" }));
  const activeTeamIds = new Set(teams.map((team) => team.id));

  missions = (data.valueRanges?.[1]?.values || [])
    .filter((row) => row[0])
    .map((row) => ({ id: row[0], node: row[1], name: row[2], category: row[3], bonus: Number(row[4] || 0), description: row[5] || "" }));

  leaderboard = (data.valueRanges?.[2]?.values || [])
    .filter((row) => row[0])
    .map((row) => ({ rank: row[0], teamId: row[1], team: row[2], guild: row[3], total: Number(row[4] || 0), exp: Number(row[5] || 0), spirit: Number(row[6] || 0) }))
    .filter((row) => activeTeamIds.has(row.teamId))
    .sort((a, b) => b.total - a.total);

  scoreRows = (data.valueRanges?.[3]?.values || []).map((row) => ({
    teamId: row[4] || "",
    completion: Number(row[8] || 0),
    courage: Number(row[9] || 0),
    wisdom: Number(row[10] || 0),
    cooperation: Number(row[11] || 0),
    creativity: Number(row[12] || 0),
    service: Number(row[13] || 0)
  })).filter((row) => row.teamId);

  renderOptions();
  renderTeamsEditor();
  renderLeaderboard();
}

function renderOptions() {
  $("teamSelect").innerHTML = teams.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)} ${team.guild ? `(${escapeHtml(team.guild)})` : ""}</option>`).join("");
  $("missionSelect").innerHTML = missions
    .filter((mission) => mission.id !== "SPIRIT_BONUS")
    .map((mission) => `<option value="${escapeHtml(mission.id)}">${escapeHtml(mission.node)} ${escapeHtml(mission.name)}</option>`)
    .join("");
  $("guildStrip").innerHTML = teams.map((team) => `<div class="guild-card"><strong>${escapeHtml(team.name)}</strong><span>${escapeHtml(team.guild || "未選公會")}</span></div>`).join("");
}

function renderTeamsEditor() {
  $("teamsEditor").innerHTML = teams.map((team, index) => {
    const guildSelect = guildOptions.map((guild) => (
      `<option value="${escapeHtml(guild)}" ${guild === team.guild ? "selected" : ""}>${escapeHtml(guild || "尚未決定")}</option>`
    )).join("");
    return `<section class="team-editor-card" data-team-index="${index}">
      <strong>${escapeHtml(team.id)}</strong>
      <label>組別名稱<input name="teamName" value="${escapeHtml(team.name)}" required></label>
      <label>職業公會<select name="guild">${guildSelect}</select></label>
      <label>成員/備註<input name="members" value="${escapeHtml(team.members)}"></label>
      <label>內部備註<input name="note" value="${escapeHtml(team.note)}"></label>
    </section>`;
  }).join("");
}

function renderLeaderboard() {
  $("leaderboardList").innerHTML = leaderboard.slice(0, 10).map((item, index) => (
    `<li><em>${index + 1}</em><span>${escapeHtml(item.team)}</span><strong>${item.total}</strong></li>`
  )).join("");
  renderAbilityCharts();
}

function renderAbilityCharts() {
  const stats = buildTeamStats();
  renderBarChart(stats);
  renderRadarChart(stats);
}

function buildTeamStats() {
  const byTeam = new Map(teams.map((team) => [team.id, {
    id: team.id,
    name: team.name,
    guild: team.guild,
    completion: 0,
    courage: 0,
    wisdom: 0,
    cooperation: 0,
    creativity: 0,
    service: 0
  }]));

  scoreRows.forEach((row) => {
    const stat = byTeam.get(row.teamId);
    if (!stat) return;
    abilityDefs.forEach((ability) => {
      stat[ability.key] += row[ability.key] || 0;
    });
  });

  return teams.map((team) => byTeam.get(team.id)).filter(Boolean);
}

function renderBarChart(stats) {
  const chart = $("barChart");
  if (!stats.length) {
    chart.innerHTML = `<p class="empty-chart">尚無計分資料</p>`;
    return;
  }

  const maxValue = Math.max(10, ...stats.flatMap((team) => abilityDefs.map((ability) => team[ability.key])));
  const rows = stats.map((team) => {
    const bars = abilityDefs.map((ability) => {
      const value = team[ability.key];
      const height = Math.round((value / maxValue) * 100);
      return `<div class="ability-bar" title="${escapeHtml(ability.label)} ${value}">
        <span style="height:${height}%; min-height:${value > 0 ? 3 : 0}px; background:${ability.color}"></span>
        <b style="bottom:calc(${height}% + 4px)">${value}</b>
      </div>`;
    }).join("");
    return `<div class="bar-team">
      <div class="bar-cluster">${bars}</div>
      <strong>${escapeHtml(team.name)}</strong>
    </div>`;
  }).join("");

  const legend = abilityDefs.map((ability) => (
    `<span><i style="background:${ability.color}"></i>${escapeHtml(ability.label)}</span>`
  )).join("");

  chart.innerHTML = `<div class="bar-stage">${rows}</div><div class="chart-legend">${legend}</div>`;
}

function renderRadarChart(stats) {
  const chart = $("radarChart");
  const displayTeams = stats.filter((team) => abilityDefs.some((ability) => team[ability.key] > 0));
  if (!displayTeams.length) {
    chart.innerHTML = `<p class="empty-chart">尚無能力分數</p>`;
    return;
  }

  const size = 520;
  const center = size / 2;
  const radius = 170;
  const maxValue = Math.max(10, ...displayTeams.flatMap((team) => abilityDefs.map((ability) => team[ability.key])));
  const angles = abilityDefs.map((_, index) => -Math.PI / 2 + (Math.PI * 2 * index / abilityDefs.length));
  const rings = [0.25, 0.5, 0.75, 1].map((ratio) => polygonPoints(angles.map((angle) => point(center, radius * ratio, angle))));
  const axes = angles.map((angle, index) => {
    const end = point(center, radius, angle);
    const label = point(center, radius + 34, angle);
    return `<line x1="${center}" y1="${center}" x2="${end.x}" y2="${end.y}" />
      <text x="${label.x}" y="${label.y}" text-anchor="middle">${escapeHtml(abilityDefs[index].label)}</text>`;
  }).join("");

  const polygons = displayTeams.map((team, index) => {
    const color = teamLineColors[index % teamLineColors.length];
    const points = polygonPoints(angles.map((angle, abilityIndex) => {
      const ability = abilityDefs[abilityIndex];
      return point(center, radius * ((team[ability.key] || 0) / maxValue), angle);
    }));
    return `<polygon points="${points}" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-width="5" />
      <circle cx="${center}" cy="${center}" r="3" fill="${color}" />`;
  }).join("");

  const legend = displayTeams.map((team, index) => (
    `<span><i style="background:${teamLineColors[index % teamLineColors.length]}"></i>${escapeHtml(team.name)}</span>`
  )).join("");

  chart.innerHTML = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="各組能力雷達圖">
      <g class="radar-grid">
        ${rings.map((points) => `<polygon points="${points}" />`).join("")}
        ${axes}
      </g>
      <g class="radar-series">${polygons}</g>
    </svg>
    <div class="chart-legend">${legend}</div>`;
}

function point(center, distance, angle) {
  return {
    x: Math.round((center + Math.cos(angle) * distance) * 10) / 10,
    y: Math.round((center + Math.sin(angle) * distance) * 10) / 10
  };
}

function polygonPoints(points) {
  return points.map((item) => `${item.x},${item.y}`).join(" ");
}

async function toggleProjectorFullscreen() {
  const projector = $("projector");
  if (!document.fullscreenElement) {
    await projector.requestFullscreen();
    $("fullscreenBtn").textContent = "退出全螢幕";
  } else {
    await document.exitFullscreen();
    $("fullscreenBtn").textContent = "全螢幕";
  }
}

async function submitScore(event) {
  event.preventDefault();
  const team = teams.find((item) => item.id === $("teamSelect").value);
  const scoreMode = getScoreMode();
  const mission = scoreMode === "EXP"
    ? missions.find((item) => item.id === $("missionSelect").value)
    : { id: "SPIRIT_BONUS" };
  if (!team || !mission) return;
  const bonusPoints = Number($("bonusPoints").value || 0);
  if (scoreMode !== "EXP" && bonusPoints < 1) {
    setStatus("精神加分至少要 1 分才可以送出");
    return;
  }

  const row = [
    new Date().toISOString(),
    crypto.randomUUID(),
    profile.name || "",
    profile.email || "",
    team.id,
    team.name,
    mission.id,
    scoreMode,
    scoreMode === "EXP" ? Number($("completion").value) : 0,
    Number($("courage").value),
    Number($("wisdom").value),
    Number($("cooperation").value),
    Number($("creativity").value),
    Number($("service").value),
    0,
    scoreMode === "Spirit" ? bonusPoints : 0,
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

async function saveTeams(event) {
  event.preventDefault();
  if (!canEditSpreadsheet) return;
  const cards = Array.from(document.querySelectorAll(".team-editor-card"));
  const values = cards.map((card, index) => {
    const team = teams[index];
    return [
      team.id,
      card.querySelector('[name="teamName"]').value.trim() || team.name,
      card.querySelector('[name="guild"]').value,
      "TRUE",
      card.querySelector('[name="members"]').value.trim(),
      card.querySelector('[name="note"]').value.trim()
    ];
  });

  $("saveTeamsBtn").disabled = true;
  try {
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/Teams!A2:F${teamCount + 1}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values })
    });
    setStatus("組別設定已儲存");
    await loadAll();
  } catch (error) {
    setStatus(`儲存組別失敗：${error.message}`);
  } finally {
    $("saveTeamsBtn").disabled = !accessToken || !canEditSpreadsheet;
  }
}

function applyAccessMode(canEdit) {
  document.body.classList.remove("signed-out", "editor-mode", "viewer-mode");
  document.body.classList.add(canEdit ? "editor-mode" : "viewer-mode");
  if (canEdit) {
    activateView("scoreView");
  } else {
    activateView("boardView");
  }
}

function activateView(viewId) {
  document.querySelectorAll(".tab, .view").forEach((el) => el.classList.remove("active"));
  const tab = document.querySelector(`.tab[data-view="${viewId}"]`);
  if (tab) tab.classList.add("active");
  $(viewId).classList.add("active");
}

function startAutoRefresh() {
  if (refreshTimer) window.clearInterval(refreshTimer);
  const interval = Number(config.refreshIntervalMs || 30000);
  if (interval > 0) {
    refreshTimer = window.setInterval(() => {
      if (accessToken) loadAll().catch((error) => setStatus(`更新失敗：${error.message}`));
    }, interval);
  }
}

function updateTotal() {
  const scoreIds = getScoreMode() === "EXP"
    ? ["completion", "courage", "wisdom", "cooperation", "creativity", "service"]
    : ["courage", "wisdom", "cooperation", "creativity", "service"];
  const base = scoreIds
    .reduce((sum, id) => sum + Number($(id).value || 0), 0);
  const total = base + Number($("bonusPoints").value || 0);
  $("totalPreview").value = total;
  $("stickyTotal").textContent = total;
}

function getScoreMode() {
  return document.querySelector('input[name="scoreMode"]:checked')?.value || "EXP";
}

function syncModeUI() {
  const isMissionScore = getScoreMode() === "EXP";
  $("missionField").hidden = !isMissionScore;
  $("missionSelect").required = isMissionScore;
  $("completionStepper").hidden = !isMissionScore;
}

function resetScoresForMode(scoreMode) {
  if (scoreMode === currentScoreMode) return;
  currentScoreMode = scoreMode;
  if (scoreMode === "EXP") {
    setScoreValue("completion", 5);
    ["courage", "wisdom", "cooperation", "creativity", "service"].forEach((id) => setScoreValue(id, 3));
  } else {
    ["courage", "wisdom", "cooperation", "creativity", "service", "bonusPoints"].forEach((id) => setScoreValue(id, 0));
  }
}

function setScoreValue(id, value) {
  $(id).value = String(value);
  $(`${id}Out`).value = String(value);
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
