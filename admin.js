(function () {
  "use strict";

  var statusEl = document.getElementById("admin-status");
  var charactersEl = document.getElementById("characters-list");
  var guildsEl = document.getElementById("guilds-list");
  var chatEl = document.getElementById("chat-list");
  var refreshBtn = document.getElementById("admin-refresh");

  if (!statusEl || !charactersEl || !guildsEl || !chatEl || !refreshBtn) return;

  function sanitize(value) {
    return String(value || "").replace(/[<>]/g, "");
  }

  async function api(url, options) {
    var res = await fetch(url, options || {});
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      throw new Error(data && data.error ? data.error : "Erreur serveur");
    }
    return data;
  }

  function emptyState(host, text) {
    host.innerHTML = '<div class="admin__meta">' + sanitize(text) + "</div>";
  }

  function makeDeleteButton(label, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin__danger";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  async function loadCharacters() {
    var data = await api("/api/admin/characters");
    var rows = Array.isArray(data.characters) ? data.characters : [];
    charactersEl.innerHTML = "";
    if (!rows.length) return emptyState(charactersEl, "Aucun personnage.");
    rows.forEach(function (row) {
      var line = document.createElement("div");
      line.className = "admin__row";
      var meta = document.createElement("div");
      meta.className = "admin__meta";
      meta.textContent =
        sanitize(row.playerName) +
        " | race: " +
        sanitize(row.raceId) +
        " | classe: " +
        sanitize(row.classId) +
        " | userId: " +
        sanitize(row.userId);
      line.appendChild(meta);
      line.appendChild(
        makeDeleteButton("Supprimer personnage", async function () {
          if (!window.confirm("Supprimer ce personnage ?")) return;
          await api("/api/admin/characters/" + encodeURIComponent(row.userId), { method: "DELETE" });
          await refreshAll();
        })
      );
      charactersEl.appendChild(line);
    });
  }

  async function loadGuilds() {
    var data = await api("/api/admin/guilds");
    var rows = Array.isArray(data.guilds) ? data.guilds : [];
    guildsEl.innerHTML = "";
    if (!rows.length) return emptyState(guildsEl, "Aucune guilde.");
    rows.forEach(function (row) {
      var line = document.createElement("div");
      line.className = "admin__row";
      var meta = document.createElement("div");
      meta.className = "admin__meta";
      meta.textContent =
        sanitize(row.name) +
        " | membres: " +
        sanitize(String(row.memberCount || 0)) +
        " | id: " +
        sanitize(row.id);
      line.appendChild(meta);
      line.appendChild(
        makeDeleteButton("Supprimer guilde", async function () {
          if (!window.confirm("Supprimer cette guilde ?")) return;
          await api("/api/admin/guilds/" + encodeURIComponent(row.id), { method: "DELETE" });
          await refreshAll();
        })
      );
      guildsEl.appendChild(line);
    });
  }

  async function loadChat() {
    var data = await api("/api/admin/chat/messages?limit=120");
    var rows = Array.isArray(data.messages) ? data.messages : [];
    chatEl.innerHTML = "";
    if (!rows.length) return emptyState(chatEl, "Aucun message.");
    rows.forEach(function (row) {
      var line = document.createElement("div");
      line.className = "admin__row";
      var meta = document.createElement("div");
      meta.className = "admin__meta";
      meta.textContent =
        "[" +
        new Date(row.createdAt || Date.now()).toLocaleString() +
        "] " +
        sanitize(row.name) +
        ": " +
        sanitize(row.text);
      line.appendChild(meta);
      line.appendChild(
        makeDeleteButton("Supprimer message", async function () {
          if (!window.confirm("Supprimer ce message ?")) return;
          await api("/api/admin/chat/messages/" + encodeURIComponent(row.id), { method: "DELETE" });
          await refreshAll();
        })
      );
      chatEl.appendChild(line);
    });
  }

  async function refreshAll() {
    statusEl.textContent = "Chargement...";
    try {
      var me = await api("/api/admin/me");
      if (!me.admin) {
        statusEl.textContent = "Acces admin refuse.";
        emptyState(charactersEl, "Non autorise.");
        emptyState(guildsEl, "Non autorise.");
        emptyState(chatEl, "Non autorise.");
        return;
      }
      statusEl.textContent = "Connecte en admin.";
      await Promise.all([loadCharacters(), loadGuilds(), loadChat()]);
    } catch (error) {
      statusEl.textContent = "Erreur: " + sanitize(error.message);
      emptyState(charactersEl, "Impossible de charger.");
      emptyState(guildsEl, "Impossible de charger.");
      emptyState(chatEl, "Impossible de charger.");
    }
  }

  refreshBtn.addEventListener("click", function () {
    refreshAll();
  });

  refreshAll();
})();
