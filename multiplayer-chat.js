(function () {
  "use strict";

  var MAX_MESSAGES = 120;
  var GAME_SAVE_KEY = "nordhaven-save-v3";

  var root = document.getElementById("mp-chat");
  if (!root) return;

  var toggleBtn = document.getElementById("mp-chat-toggle");
  var panel = document.getElementById("mp-chat-panel");
  var messagesEl = document.getElementById("mp-chat-messages");
  var form = document.getElementById("mp-chat-form");
  var messageInput = document.getElementById("mp-chat-input");
  var authStatusEl = document.getElementById("mp-chat-auth-status");
  var gateGoogleButtonHost = document.getElementById("google-login-gate-button");
  var gateRoot = document.getElementById("login-gate");
  var gateStatusEl = document.getElementById("gate-auth-status");
  var gateEnterBtn = document.getElementById("gate-enter-btn");
  var authConnectedEl = document.getElementById("authbar-connected");
  var authPlayerEl = document.getElementById("authbar-player");
  var logoutBtn = document.getElementById("authbar-logout");
  var profilePeekRoot = document.getElementById("player-peek");
  var profilePeekBody = document.getElementById("player-peek-body");
  var profilePeekClose = document.getElementById("player-peek-close");

  if (
    !toggleBtn ||
    !panel ||
    !messagesEl ||
    !form ||
    !messageInput ||
    !authStatusEl ||
    !gateGoogleButtonHost ||
    !gateRoot ||
    !gateStatusEl ||
    !gateEnterBtn ||
    !authConnectedEl ||
    !authPlayerEl ||
    !logoutBtn ||
    !profilePeekRoot ||
    !profilePeekBody ||
    !profilePeekClose
  ) {
    return;
  }

  var state = {
    me: null,
    messages: []
  };

  var socket = null;

  function sanitize(text) {
    return String(text || "").replace(/[<>]/g, "");
  }

  function getCharacterNameFromSave() {
    try {
      var raw = localStorage.getItem(GAME_SAVE_KEY);
      if (!raw) return "";
      var save = JSON.parse(raw);
      var name = save && save.player && save.player.name ? String(save.player.name).trim() : "";
      return sanitize(name).slice(0, 40);
    } catch (_) {
      return "";
    }
  }

  function fmtTime(timestamp) {
    var d = new Date(timestamp || Date.now());
    var hh = String(d.getHours()).padStart(2, "0");
    var mm = String(d.getMinutes()).padStart(2, "0");
    return hh + ":" + mm;
  }

  function setAuthUi() {
    var logged = !!state.me;
    authConnectedEl.hidden = !logged;
    messageInput.disabled = !logged;
    gateEnterBtn.disabled = !logged;

    if (logged) {
      authPlayerEl.textContent = "Connecte avec Google: " + sanitize(state.me.name);
      authStatusEl.textContent = "Vous discutez en tant que " + sanitize(state.me.name) + ".";
      messageInput.placeholder = "Ecrire un message...";
      gateStatusEl.textContent = "Connecte en tant que " + sanitize(state.me.name) + ".";
      gateRoot.classList.remove("gate--open");
    } else {
      authPlayerEl.textContent = "";
      authStatusEl.textContent = "Connectez-vous avec Google pour discuter.";
      messageInput.placeholder = "Connexion Google requise";
      gateStatusEl.textContent = "Connexion requise.";
      gateRoot.classList.add("gate--open");
    }
    window.dispatchEvent(
      new CustomEvent("nordhaven:auth-changed", {
        detail: { user: state.me || null }
      })
    );
  }

  function profileRow(label, value) {
    return (
      '<div class="player-peek__row"><span class="player-peek__k">' +
      sanitize(label) +
      '</span><span class="player-peek__v">' +
      sanitize(value || "—") +
      "</span></div>"
    );
  }

  function openProfilePeek(profile) {
    if (!profile) return;
    var icon = profile.iconUrl
      ? '<img class="player-peek__avatar-img" src="' + sanitize(profile.iconUrl) + '" alt="" />'
      : '<span class="player-peek__avatar-fallback" aria-hidden="true">👤</span>';
    var stuff = profile.stuff || {};
    var stats = profile.stats || {};
    profilePeekBody.innerHTML = [
      '<header class="player-peek__head">',
      '<div class="player-peek__avatar">' + icon + "</div>",
      '<div class="player-peek__meta">',
      '<h3 class="player-peek__name">' + sanitize(profile.playerName || "Joueur") + "</h3>",
      '<p class="player-peek__lvl">Niveau ' + sanitize(String(profile.level || 1)) + "</p>",
      "</div>",
      "</header>",
      '<section class="player-peek__section"><h4 class="player-peek__title">Stats</h4>',
      profileRow("Vitalite", stats.vitalite),
      profileRow("Intelligence", stats.intelligence),
      profileRow("Endurance", stats.endurance),
      profileRow("Degats", String(stats.attackMin || 0) + " - " + String(stats.attackMax || 0)),
      profileRow("Defense", stats.defense),
      "</section>",
      '<section class="player-peek__section"><h4 class="player-peek__title">Equipement</h4>',
      profileRow("Arme", stuff.weapon || "Aucune"),
      profileRow("Armure", stuff.armor || "Aucune"),
      profileRow("Collier", stuff.necklace || "Aucun"),
      "</section>"
    ].join("");
    profilePeekRoot.hidden = false;
  }

  function closeProfilePeek() {
    profilePeekRoot.hidden = true;
  }

  function renderMessage(item) {
    var row = document.createElement("div");
    var own = state.me && item.userId === state.me.id;
    row.className = "mp-chat__msg" + (own ? " mp-chat__msg--out" : "");

    var meta = document.createElement("div");
    meta.className = "mp-chat__meta";
    var nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "mp-chat__name";
    nameBtn.textContent = sanitize(item.name);
    nameBtn.addEventListener("click", function () {
      api("/api/profile/" + encodeURIComponent(item.userId))
        .then(function (data) {
          if (data && data.profile) openProfilePeek(data.profile);
        })
        .catch(function () {
          authStatusEl.textContent = "Profil joueur indisponible.";
        });
    });
    var when = document.createElement("span");
    when.className = "mp-chat__time";
    when.textContent = " · " + fmtTime(item.createdAt);
    meta.appendChild(nameBtn);
    meta.appendChild(when);

    var txt = document.createElement("p");
    txt.className = "mp-chat__text";
    txt.textContent = sanitize(item.text);

    row.appendChild(meta);
    row.appendChild(txt);
    messagesEl.appendChild(row);
  }

  function repaintMessages() {
    messagesEl.innerHTML = "";
    state.messages.slice(-MAX_MESSAGES).forEach(renderMessage);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function api(url, options) {
    var response = await fetch(url, options || {});
    var data = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      var message = data && data.error ? data.error : "Erreur serveur";
      throw new Error(message);
    }
    return data;
  }

  async function loadSession() {
    try {
      var data = await api("/api/me");
      state.me = data.user || null;
    } catch (_) {
      state.me = null;
    }
    setAuthUi();
  }

  async function loadMessages() {
    try {
      var data = await api("/api/chat/messages?limit=" + MAX_MESSAGES);
      if (Array.isArray(data.messages)) {
        state.messages = data.messages;
        repaintMessages();
      }
    } catch (_) {
      // Keep chat empty if server unavailable.
    }
  }

  function connectSocket() {
    if (typeof io !== "function" || socket) return;
    socket = io();

    socket.on("chat:message", function (msg) {
      if (!msg || typeof msg !== "object") return;
      state.messages.push(msg);
      state.messages = state.messages.slice(-MAX_MESSAGES);
      repaintMessages();
    });
  }

  async function loginWithGoogle(idToken) {
    await api("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: idToken })
    });
    await loadSession();
    await loadMessages();
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    connectSocket();
  }

  async function logout() {
    await api("/api/logout", { method: "POST" });
    state.me = null;
    setAuthUi();
  }

  function initGoogleButton() {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) return false;
    if (!window.__GOOGLE_CLIENT_ID__) {
      authStatusEl.textContent = "GOOGLE_CLIENT_ID non configure cote serveur.";
      gateStatusEl.textContent = "GOOGLE_CLIENT_ID non configure cote serveur.";
      return true;
    }

    window.google.accounts.id.initialize({
      client_id: window.__GOOGLE_CLIENT_ID__ || "",
      callback: function (response) {
        if (!response || !response.credential) return;
        loginWithGoogle(response.credential).catch(function (error) {
          authStatusEl.textContent = "Connexion Google impossible: " + sanitize(error.message);
        });
      }
    });

    window.google.accounts.id.renderButton(gateGoogleButtonHost, {
      theme: "filled_black",
      size: "large",
      shape: "pill",
      text: "signin_with",
      width: 290
    });
    return true;
  }

  function waitGoogleInit() {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (initGoogleButton() || tries > 40) {
        clearInterval(timer);
      }
    }, 150);
  }

  function openPanel() {
    panel.hidden = false;
    toggleBtn.setAttribute("aria-expanded", "true");
    root.classList.add("mp-chat--open");
    if (!messageInput.disabled) messageInput.focus();
  }

  function closePanel() {
    panel.hidden = true;
    toggleBtn.setAttribute("aria-expanded", "false");
    root.classList.remove("mp-chat--open");
  }

  toggleBtn.addEventListener("click", function () {
    if (panel.hidden) openPanel();
    else closePanel();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!state.me) {
      authStatusEl.textContent = "Connectez-vous d'abord avec Google.";
      return;
    }

    var text = sanitize(messageInput.value.trim()).slice(0, 220);
    if (!text) return;

    if (socket) {
      socket.emit("chat:send", {
        text: text,
        characterName: getCharacterNameFromSave()
      });
    }
    messageInput.value = "";
    messageInput.focus();
  });

  logoutBtn.addEventListener("click", function () {
    logout().catch(function (error) {
      authStatusEl.textContent = "Deconnexion impossible: " + sanitize(error.message);
    });
  });

  gateEnterBtn.addEventListener("click", function () {
    if (!state.me) return;
    gateRoot.classList.remove("gate--open");
  });
  profilePeekClose.addEventListener("click", closeProfilePeek);
  profilePeekRoot.addEventListener("click", function (event) {
    if (event.target === profilePeekRoot) closeProfilePeek();
  });

  setAuthUi();
  waitGoogleInit();
  loadSession().then(function () {
    loadMessages();
    connectSocket();
  });
})();
