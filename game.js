 (function () {
  "use strict";

  var STORAGE_KEY = "nordhaven-save-v3";
  var NAME_RE = /^[A-Za-zÀ-ÿ' -]{2,24}$/;
  var combatAutoRafId = null;
  var LEGACY_RESET_MARKER = "nordhaven-editor-legacy-reset-v1";

  var CLASSES = {
    guerrier: { label: "Guerrier du Nord", vitalite: 16, intelligence: 5, endurance: 11, atkMin: 4, atkMax: 7 },
    mage: { label: "Arcaniste", vitalite: 9, intelligence: 16, endurance: 7, atkMin: 3, atkMax: 6 },
    rodeur: { label: "Rodeur des plaines", vitalite: 12, intelligence: 8, endurance: 12, atkMin: 3, atkMax: 7 }
  };

  var QUESTS = [];
  var QUESTS_TIER2 = [];
  var QUEST_INN_HOOKS = {};

  var SHOP_ITEMS =
    typeof NORDHAVEN_CATALOG !== "undefined" && NORDHAVEN_CATALOG.SHOP_ITEMS
      ? NORDHAVEN_CATALOG.SHOP_ITEMS.slice()
      : [];

  var EDITOR_WEAPONS_KEY = "nordhaven-editor-weapons-v1";
  var EDITOR_ITEMS_KEY = "nordhaven-editor-items-v1";
  var EDITOR_ARMORS_KEY = "nordhaven-editor-armors-v1";
  var EDITOR_RACE_ICONS_KEY = "nordhaven-editor-race-icons-v1";
  var EDITOR_RACES_EXTRA_KEY = "nordhaven-editor-races-extra-v1";
  var EDITOR_NAV_ICONS_KEY = "nordhaven-editor-nav-icons-v1";
  var EDITOR_CURSORS_KEY = "nordhaven-editor-cursors-v1";
  var EDITOR_VILLAGE_ART_KEY = "nordhaven-editor-village-art-v1";
  var EDITOR_SPELLS_KEY = "nordhaven-editor-spells-v1";
  var EDITOR_MONSTERS_KEY = "nordhaven-editor-monsters-v1";
  var EDITOR_QUESTS_KEY = "nordhaven-editor-quests-v1";
  var EDITOR_SOUNDS_KEY = "nordhaven-editor-sounds-v1";
  var EDITOR_SYNC_KEYS = [
    EDITOR_WEAPONS_KEY,
    EDITOR_ITEMS_KEY,
    EDITOR_SPELLS_KEY,
    EDITOR_ARMORS_KEY,
    EDITOR_RACE_ICONS_KEY,
    EDITOR_RACES_EXTRA_KEY,
    EDITOR_NAV_ICONS_KEY,
    "nordhaven-editor-skills-theme-v1",
    "nordhaven-editor-skills-v1",
    EDITOR_CURSORS_KEY,
    EDITOR_SOUNDS_KEY,
    EDITOR_VILLAGE_ART_KEY,
    EDITOR_MONSTERS_KEY,
    EDITOR_QUESTS_KEY
  ];
  var ENEMY_ATTACK_SPEED_MIN = 0.2;
  var ENEMY_ATTACK_SPEED_MAX = 8;
  var SKILL_MAX_LEVEL = 50;
  var shopBuyFilter = "all";
  var SKILL_DEFS = [
    { id: "oneHanded", label: "Arme a une main", hint: "Monte quand tu frappes en combat avec une arme de poing ou de main." },
    { id: "twoHanded", label: "Arme a deux mains", hint: "Monte avec les armes lourdes et lentes." },
    { id: "archery", label: "Tir a l'arc", hint: "Monte avec arcs et armes de trait." },
    { id: "destruction", label: "Destruction", hint: "Monte en lançant des sorts offensifs (ex. boule de feu)." },
    { id: "restoration", label: "Soins", hint: "Monte en lançant des soins ; augmente legerement leur efficacite." },
    { id: "speech", label: "Charisme", hint: "Monte en achetant au marchand ; reduit les prix (jusqu'a -10 %) et augmente l'or des quetes (+10 % au max)." }
  ];

  function hydrateEditorDataFromServer() {
    return fetch("/api/editor-config", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("http_" + res.status);
        return res.json();
      })
      .then(function (body) {
        var data = body && body.data && typeof body.data === "object" ? body.data : {};
        EDITOR_SYNC_KEYS.forEach(function (key) {
          if (!Object.prototype.hasOwnProperty.call(data, key)) return;
          localStorage.setItem(key, JSON.stringify(data[key]));
        });
      })
      .catch(function () {});
  }

  function makeDefaultSkills() {
    var o = {};
    SKILL_DEFS.forEach(function (d) {
      o[d.id] = { level: 0, xp: 0 };
    });
    return o;
  }

  function ensurePlayerSkills() {
    if (!state.player) return;
    if (!state.player.skills || typeof state.player.skills !== "object") {
      state.player.skills = makeDefaultSkills();
    }
    SKILL_DEFS.forEach(function (d) {
      var s = state.player.skills[d.id];
      if (!s || typeof s !== "object") {
        state.player.skills[d.id] = { level: 0, xp: 0 };
      } else {
        if (typeof s.level !== "number" || s.level < 0) s.level = 0;
        if (s.level > SKILL_MAX_LEVEL) s.level = SKILL_MAX_LEVEL;
        if (typeof s.xp !== "number" || s.xp < 0) s.xp = 0;
      }
    });
  }

  function getSkillLevel(skillId) {
    ensurePlayerSkills();
    var s = state.player.skills[skillId];
    if (!s) return 0;
    return Math.min(SKILL_MAX_LEVEL, Math.max(0, Math.floor(s.level)));
  }

  function skillXpNeededForNext(level) {
    if (level >= SKILL_MAX_LEVEL) return 0;
    return 16 + level * 3;
  }

  function addSkillXp(skillId, raw) {
    if (!state.player) return;
    ensurePlayerSkills();
    var amt = Number(raw);
    if (!isFinite(amt) || amt <= 0) return;
    var s = state.player.skills[skillId];
    if (!s || s.level >= SKILL_MAX_LEVEL) return;
    s.xp = (s.xp || 0) + amt;
    var need = skillXpNeededForNext(s.level);
    while (s.level < SKILL_MAX_LEVEL && need > 0 && s.xp >= need) {
      s.xp -= need;
      s.level += 1;
      need = skillXpNeededForNext(s.level);
    }
    if (s.level >= SKILL_MAX_LEVEL) {
      s.level = SKILL_MAX_LEVEL;
      s.xp = 0;
    }
  }

  function speechDiscountMult() {
    var lv = getSkillLevel("speech");
    return 1 - 0.1 * (lv / SKILL_MAX_LEVEL);
  }

  function applyQuestGoldBonus(baseGold) {
    var lv = getSkillLevel("speech");
    var mult = 1 + 0.1 * (lv / SKILL_MAX_LEVEL);
    return Math.max(0, Math.floor(Number(baseGold) * mult));
  }

  function shopBuyPrice(it) {
    var cost = Math.max(1, Math.floor(Number(it.cost) || 0));
    return Math.max(1, Math.floor(cost * speechDiscountMult()));
  }

  function inferWeaponType(w) {
    if (!w || w.kind !== "weapon") return "oneHanded";
    var raw = w.weaponType || w.weaponStyle || w.style;
    var t = String(raw || "").toLowerCase().replace(/\s+/g, "");
    if (t === "twohanded" || t === "deuxmains" || t === "2h") return "twoHanded";
    if (t === "bow" || t === "arc" || t === "archery" || t === "tir") return "archery";
    if (t === "onehanded" || t === "unemain" || t === "1h") return "oneHanded";
    var n = String(w.name || "").toLowerCase();
    if (/arc|arbalete|bow|longbow/.test(n)) return "archery";
    var spd = Number(w.attackSpeed);
    if (!isFinite(spd)) spd = 1;
    var mn = Number(w.atkMin) || 0;
    var mx = Number(w.atkMax) || 0;
    if (spd <= 0.72 && mn + mx >= 9) return "twoHanded";
    return "oneHanded";
  }

  function getWeaponCombatStyle(item) {
    if (!item || item.kind !== "weapon") return "oneHanded";
    if (item.weaponType === "twoHanded" || item.weaponType === "archery") return item.weaponType;
    if (item.weaponType === "oneHanded") return "oneHanded";
    return inferWeaponType(item);
  }

  function weaponStyleLabel(style) {
    if (style === "twoHanded") return "Deux mains";
    if (style === "archery") return "Arc";
    return "Une main";
  }

  function resetLegacyQuestsMonstersOnce() {
    try {
      if (localStorage.getItem(LEGACY_RESET_MARKER) === "1") return;
      localStorage.setItem(EDITOR_MONSTERS_KEY, JSON.stringify([]));
      localStorage.setItem(EDITOR_QUESTS_KEY, JSON.stringify([]));
      localStorage.setItem(LEGACY_RESET_MARKER, "1");
    } catch (_) {}
  }

  function loadEditorNavIcons() {
    try {
      var raw = localStorage.getItem(EDITOR_NAV_ICONS_KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (!o || typeof o !== "object") return {};
      var out = {};
      ["inventory", "shop", "forge", "inn", "map", "gold"].forEach(function (k) {
        if (isDataUrlIcon(o[k])) out[k] = o[k];
      });
      return out;
    } catch (_) {
      return {};
    }
  }

  function defaultSpellDefs() {
    return [
      {
        id: "heal",
        name: "Guerison",
        manaCost: 3,
        effect: "heal",
        powerMin: 10,
        powerMax: 13,
        scaleAttr: "intelligence",
        skillId: "restoration",
        xpGain: 6,
        description: "Soin qui augmente avec la competence Soins.",
        glyph: "✚"
      },
      {
        id: "fireball",
        name: "Boule de feu",
        manaCost: 3,
        effect: "damage",
        powerMin: 10,
        powerMax: 14,
        scaleAttr: "intelligence",
        skillId: "destruction",
        xpGain: 6,
        description: "Degats qui augmentent avec la competence Destruction.",
        glyph: "✹"
      }
    ];
  }

  function normalizeEditorSpell(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = String(raw.id || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 32);
    if (!id) return null;
    var effect = raw.effect === "heal" ? "heal" : "damage";
    var mn = Math.max(1, Math.floor(Number(raw.powerMin) || 1));
    var mx = Math.max(mn, Math.floor(Number(raw.powerMax) || mn));
    var scaleAttr = String(raw.scaleAttr || "intelligence");
    if (scaleAttr !== "intelligence" && scaleAttr !== "vitalite" && scaleAttr !== "endurance" && scaleAttr !== "none") {
      scaleAttr = "intelligence";
    }
    var skillId = String(raw.skillId || "none");
    if (skillId !== "restoration" && skillId !== "destruction" && skillId !== "none") skillId = "none";
    var iconDataUrl = isDataUrlIcon(raw.iconDataUrl) ? raw.iconDataUrl : "";
    return {
      id: id,
      name: String(raw.name || id).trim().slice(0, 48),
      manaCost: Math.max(0, Math.floor(Number(raw.manaCost) || 0)),
      effect: effect,
      powerMin: mn,
      powerMax: mx,
      scaleAttr: scaleAttr,
      skillId: skillId,
      xpGain: Math.max(0, Math.floor(Number(raw.xpGain) || 0)),
      description: String(raw.description || "").trim().slice(0, 220),
      glyph: String(raw.glyph || "✦").trim().slice(0, 2),
      iconDataUrl: iconDataUrl
    };
  }

  function loadEditorSpells() {
    try {
      var raw = localStorage.getItem(EDITOR_SPELLS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr
        .map(normalizeEditorSpell)
        .filter(function (s) { return !!s; });
    } catch (_) {
      return [];
    }
  }

  function getSpellCatalog() {
    var map = {};
    defaultSpellDefs().forEach(function (s) {
      map[s.id] = s;
    });
    loadEditorSpells().forEach(function (s) {
      map[s.id] = s;
    });
    return map;
  }

  function getSpellDef(id) {
    var map = getSpellCatalog();
    return map[id] || null;
  }

  function isNecklaceGear(it) {
    if (!it || it.kind !== "armor") return false;
    if (it.slot === "necklace") return true;
    return /collier|amulet|amulette|necklace/i.test(String(it.name || ""));
  }

  function loadEditorCursors() {
    try {
      var raw = localStorage.getItem(EDITOR_CURSORS_KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (!o || typeof o !== "object") return {};
      var out = {};
      ["default", "inventory", "shop", "forge", "inn", "map"].forEach(function (k) {
        if (isDataUrlIcon(o[k])) out[k] = o[k];
      });
      return out;
    } catch (_) {
      return {};
    }
  }

  function loadVillageArtConfig() {
    try {
      var raw = localStorage.getItem(EDITOR_VILLAGE_ART_KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (!o || typeof o !== "object") return {};
      var out = {};
      Object.keys(o).forEach(function (k) {
        if (isDataUrlIcon(o[k])) out[k] = o[k];
      });
      return out;
    } catch (_) {
      return {};
    }
  }

  function styleAttrCursor(slotKey) {
    var c = loadEditorCursors();
    var url = c && c[slotKey];
    if (!url) return "";
    return ' style="cursor:url(' + url + ') 8 8, pointer;"';
  }

  function applyDefaultCursor() {
    var c = loadEditorCursors();
    if (c.default) {
      document.body.style.cursor = 'url("' + c.default + '") 8 8, auto';
    } else {
      document.body.style.cursor = "";
    }
  }

  function getVillageArtUrl(villageName) {
    var cfg = loadVillageArtConfig();
    return cfg[villageName] || "";
  }

  var zoneTransitionTimer = null;

  function runZoneTransition(label, done) {
    var root = document.getElementById("zone-transition");
    if (!root) {
      root = document.createElement("div");
      root.id = "zone-transition";
      root.className = "zone-transition";
      root.hidden = true;
      root.innerHTML =
        '<div class="zone-transition__card">' +
        '<p class="zone-transition__title" id="zone-transition-title">Deplacement...</p>' +
        '<div class="zone-transition__track"><span id="zone-transition-fill"></span></div>' +
        "</div>";
      document.body.appendChild(root);
    }
    var title = document.getElementById("zone-transition-title");
    var fill = document.getElementById("zone-transition-fill");
    if (title) title.textContent = label || "Deplacement...";
    if (fill) fill.style.width = "0%";
    if (zoneTransitionTimer) {
      clearTimeout(zoneTransitionTimer);
      zoneTransitionTimer = null;
    }
    root.hidden = false;
    root.style.display = "grid";
    root.classList.add("zone-transition--show");
    requestAnimationFrame(function () {
      if (fill) fill.style.width = "100%";
    });
    zoneTransitionTimer = setTimeout(function () {
      root.classList.remove("zone-transition--show");
      root.hidden = true;
      root.style.display = "none";
      zoneTransitionTimer = null;
      if (typeof done === "function") done();
    }, 900);
  }

  function villageNavEmblemHtml(slotKey) {
    var url = loadEditorNavIcons()[slotKey];
    if (url) {
      return (
        '<span class="village-actions__emblem">' +
        '<img class="village-actions__emblem-img" src="' +
        url +
        '" alt="" />' +
        "</span>"
      );
    }
    return (
      '<span class="village-actions__emblem village-actions__emblem--fallback">' +
      '<span class="village-actions__glyph village-actions__glyph--' +
      slotKey +
      '" aria-hidden="true"></span>' +
      "</span>"
    );
  }

  function goldIconInlineHtml() {
    var url = loadEditorNavIcons().gold;
    if (!url) return "";
    return (
      '<span class="gold-icon" aria-hidden="true">' +
      '<img class="gold-icon__img" src="' +
      url +
      '" alt="" />' +
      "</span>"
    );
  }

  function loadSkillsThemeSettings() {
    var defaults = {
      rowBg: "#1f1b16",
      rowBorder: "#4b4337",
      barStart: "#5a6e4a",
      barEnd: "#8a9e6a",
      text: "#e8e0d4",
      lvl: "#c9a66b",
      tooltipBg: "#221f1a",
      tooltipBorder: "#433c31"
    };
    try {
      var raw = localStorage.getItem("nordhaven-editor-skills-theme-v1");
      var o = raw ? JSON.parse(raw) : null;
      if (!o || typeof o !== "object") return defaults;
      return {
        rowBg: String(o.rowBg || defaults.rowBg),
        rowBorder: String(o.rowBorder || defaults.rowBorder),
        barStart: String(o.barStart || defaults.barStart),
        barEnd: String(o.barEnd || defaults.barEnd),
        text: String(o.text || defaults.text),
        lvl: String(o.lvl || defaults.lvl),
        tooltipBg: String(o.tooltipBg || defaults.tooltipBg),
        tooltipBorder: String(o.tooltipBorder || defaults.tooltipBorder)
      };
    } catch (_) {
      return defaults;
    }
  }

  function escapeHtmlAllowBasic(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeSkillTooltipHtml(raw) {
    var s = String(raw || "");
    s = s.replace(/<\s*\/?\s*(script|style|iframe|object|embed)[^>]*>/gi, "");
    s = s.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "");
    s = s.replace(/\sstyle\s*=\s*(['"]).*?\1/gi, "");
    var safe = s
      .replace(/<strong>/gi, "[[STRONG_OPEN]]")
      .replace(/<\/strong>/gi, "[[STRONG_CLOSE]]")
      .replace(/<em>/gi, "[[EM_OPEN]]")
      .replace(/<\/em>/gi, "[[EM_CLOSE]]")
      .replace(/<mark>/gi, "[[MARK_OPEN]]")
      .replace(/<\/mark>/gi, "[[MARK_CLOSE]]")
      .replace(/<br\s*\/?>/gi, "[[BR]]");
    safe = escapeHtmlAllowBasic(safe);
    return safe
      .replace(/\[\[STRONG_OPEN\]\]/g, "<strong>")
      .replace(/\[\[STRONG_CLOSE\]\]/g, "</strong>")
      .replace(/\[\[EM_OPEN\]\]/g, "<em>")
      .replace(/\[\[EM_CLOSE\]\]/g, "</em>")
      .replace(/\[\[MARK_OPEN\]\]/g, "<mark>")
      .replace(/\[\[MARK_CLOSE\]\]/g, "</mark>")
      .replace(/\[\[BR\]\]/g, "<br>");
  }

  function loadSkillsEditorConfig() {
    try {
      var raw = localStorage.getItem("nordhaven-editor-skills-v1");
      var o = raw ? JSON.parse(raw) : null;
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function villageNavButton(opts) {
    var wide = opts.wide ? " village-actions__btn--wide" : "";
    var primary = opts.primary ? " village-actions__btn--primary-rpg" : "";
    var quest = opts.questBtn ? " quest-btn" : "";
    return (
      '<button type="button" class="village-actions__btn village-actions__btn--rpg' +
      wide +
      primary +
      quest +
      '" id="' +
      opts.id +
      '" data-cursor-key="' +
      escapeHtml(opts.slotKey || "") +
      '"' +
      styleAttrCursor(opts.slotKey) +
      ' data-slot-key="' +
      escapeHtml(opts.slotKey || "") +
      '">' +
      villageNavEmblemHtml(opts.slotKey) +
      '<span class="village-actions__label">' +
      escapeHtml(opts.label) +
      "</span>" +
      (opts.notifHtml || "") +
      "</button>"
    );
  }

  function loadEditorWeapons() {
    try {
      var raw = localStorage.getItem(EDITOR_WEAPONS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr)
        ? arr.filter(function (w) {
            return w && w.kind === "weapon" && w.id;
          })
        : [];
    } catch (_) {
      return [];
    }
  }

  function isDataUrlIcon(s) {
    return (
      typeof s === "string" &&
      s.length < 450000 &&
      /^data:image\/(png|jpe?g|webp|gif);base64,/.test(s)
    );
  }

  function loadEditorItems() {
    try {
      var raw = localStorage.getItem(EDITOR_ITEMS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (it) { return it && it.id; }) : [];
    } catch (_) {
      return [];
    }
  }

  function loadEditorArmors() {
    try {
      var raw = localStorage.getItem(EDITOR_ARMORS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr)
        ? arr.filter(function (it) {
            return it && it.kind === "armor" && it.id;
          })
        : [];
    } catch (_) {
      return [];
    }
  }

  function loadEditorSoundsMap() {
    try {
      var raw = localStorage.getItem(EDITOR_SOUNDS_KEY);
      var o = raw ? JSON.parse(raw) : null;
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function isEditorSoundDataUrl(s) {
    return (
      typeof s === "string" &&
      s.length < 700000 &&
      /^data:audio\/[a-z0-9.+-]+;base64,/i.test(s)
    );
  }

  function playEditorSound(key, fallbackKey) {
    var o = loadEditorSoundsMap();
    var url = o[key];
    if (!isEditorSoundDataUrl(url) && fallbackKey) url = o[fallbackKey];
    if (!isEditorSoundDataUrl(url)) return;
    try {
      var a = new Audio(url);
      a.volume = 0.88;
      var p = a.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (_) {}
  }

  function bindEditorUiSounds() {
    document.addEventListener(
      "click",
      function (e) {
        var t = e.target && e.target.closest ? e.target.closest("button") : null;
        if (!t || t.disabled) return;
        if (t.closest && t.closest(".inv-equip")) return;
        if (
          t.closest &&
          (t.closest(".village-actions__btn") || t.closest(".village-narrator"))
        ) {
          playEditorSound("villageButton", "buttonClick");
          return;
        }
        playEditorSound("buttonClick");
      },
      false
    );
  }

  function loadEditorRaceIcons() {
    try {
      var raw = localStorage.getItem(EDITOR_RACE_ICONS_KEY);
      var o = raw ? JSON.parse(raw) : null;
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function loadEditorRacesExtra() {
    try {
      var raw = localStorage.getItem(EDITOR_RACES_EXTRA_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function loadEditorMonstersList() {
    try {
      var raw = localStorage.getItem(EDITOR_MONSTERS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function loadEditorMonsterTextureByNameMap() {
    var m = {};
    loadEditorMonstersList().forEach(function (row) {
      if (!row || !row.name) return;
      var name = String(row.name).trim();
      if (!name || !isDataUrlIcon(row.textureDataUrl)) return;
      m[name] = row.textureDataUrl;
    });
    return m;
  }

  function loadEditorMonsterByNameMap() {
    var m = {};
    loadEditorMonstersList().forEach(function (row) {
      if (!row || !row.name) return;
      var name = String(row.name).trim();
      if (!name) return;
      m[name] = row;
    });
    return m;
  }

  function loadEditorQuests() {
    try {
      var raw = localStorage.getItem(EDITOR_QUESTS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function resolveCombatEnemyTextureUrl(c) {
    if (!c) return "";
    if (c.enemyName) {
      var byName = loadEditorMonsterTextureByNameMap()[c.enemyName];
      if (isDataUrlIcon(byName)) return byName;
    }
    return "";
  }

  function combatEnemyPortraitBlockHtml(c) {
    var url = resolveCombatEnemyTextureUrl(c);
    if (url) {
      return (
        '<div class="combat-enemy-block">' +
        '<p class="combat-enemy-block__temp-badge combat-enemy-block__temp-badge--editor">Texture editeur</p>' +
        '<div class="combat-enemy-portrait combat-enemy-portrait--image" id="combat-enemy-portrait">' +
        '<img class="combat-enemy-portrait__img" src="' +
        url +
        '" alt=""/>' +
        "</div>" +
        '<h2 class="combat-enemy-name" id="combat-enemy-title">' +
        escapeHtml(c.enemyName) +
        "</h2>" +
        '<div class="combat-bar-line combat-bar-line--enemy combat-bar-line--enemy-inline">' +
        '<div class="combat-bar-line__head">' +
        '<span class="combat-bar-line__label">Vie ennemie</span>' +
        '<span class="combat-bar-line__nums" id="combat-hp-enemy">' + c.enemyHp + " / " + c.enemyHpMax + "</span>" +
        "</div>" +
        '<div class="health combat-bar-line__track"><span id="combat-bar-enemy" style="width:' + pct(c.enemyHp, c.enemyHpMax) + '%"></span></div>' +
        "</div>" +
        "</div>"
      );
    }
    return (
      '<div class="combat-enemy-block">' +
      '<p class="combat-enemy-block__temp-badge" title="Ajoute une texture dans l\'editeur (Monstres ou Quetes)">Texture provisoire</p>' +
      '<div class="combat-enemy-portrait combat-enemy-portrait--temp" id="combat-enemy-portrait" role="img" aria-label="' +
      escapeHtml(c.enemyName) +
      '"></div>' +
      '<h2 class="combat-enemy-name" id="combat-enemy-title">' +
      escapeHtml(c.enemyName) +
      "</h2>" +
      '<div class="combat-bar-line combat-bar-line--enemy combat-bar-line--enemy-inline">' +
      '<div class="combat-bar-line__head">' +
      '<span class="combat-bar-line__label">Vie ennemie</span>' +
      '<span class="combat-bar-line__nums" id="combat-hp-enemy">' + c.enemyHp + " / " + c.enemyHpMax + "</span>" +
      "</div>" +
      '<div class="health combat-bar-line__track"><span id="combat-bar-enemy" style="width:' + pct(c.enemyHp, c.enemyHpMax) + '%"></span></div>' +
      "</div>" +
      "</div>"
    );
  }

  function getCatalogRacesBase() {
    if (typeof NORDHAVEN_CATALOG !== "undefined" && Array.isArray(NORDHAVEN_CATALOG.RACES)) {
      return NORDHAVEN_CATALOG.RACES.map(function (r) {
        return {
          id: r.id,
          label: r.label,
          vit: Number(r.vit) || 0,
          int: Number(r.int) || 0,
          end: Number(r.end) || 0,
          def: Number(r.def) || 0
        };
      });
    }
    return [
      { id: "nordique", label: "Nordique", vit: 1, int: 0, end: 1, def: 0 },
      { id: "elfe_sylvestre", label: "Elfe des bois", vit: 0, int: 2, end: 1, def: 0 },
      { id: "orc_collines", label: "Orque des collines", vit: 2, int: 0, end: 0, def: 0 },
      { id: "breton_rivage", label: "Breton du rivage", vit: 0, int: 2, end: 0, def: 0 },
      { id: "felin_argent", label: "Peau d'argent", vit: 0, int: 0, end: 2, def: 0 }
    ];
  }

  function normalizeEditorRaceExtra(r) {
    var id = String(r.id || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 32);
    if (!id) return null;
    var out = {
      id: id,
      label: String(r.label || "Race").slice(0, 48),
      vit: Math.max(-3, Math.min(5, Math.floor(Number(r.vit) || 0))),
      int: Math.max(-3, Math.min(5, Math.floor(Number(r.int) || 0))),
      end: Math.max(-3, Math.min(5, Math.floor(Number(r.end) || 0))),
      def: Math.max(-3, Math.min(5, Math.floor(Number(r.def) || 0)))
    };
    if (isDataUrlIcon(r.iconDataUrl)) out.iconDataUrl = r.iconDataUrl;
    return out;
  }

  function getRacesMerged() {
    var base = getCatalogRacesBase();
    var icons = loadEditorRaceIcons();
    var extras = loadEditorRacesExtra();
    extras.forEach(function (ex) {
      var n = normalizeEditorRaceExtra(ex);
      if (!n) return;
      var idx = base.findIndex(function (x) {
        return x.id === n.id;
      });
      if (idx >= 0) {
        base[idx] = Object.assign({}, base[idx], n);
      } else {
        base.push(Object.assign({}, n));
      }
    });
    base.forEach(function (race) {
      if (icons[race.id] && isDataUrlIcon(icons[race.id])) {
        race.iconDataUrl = icons[race.id];
      }
    });
    return base;
  }

  function getRaceById(id) {
    var list = getRacesMerged();
    return (
      list.find(function (x) {
        return x.id === id;
      }) ||
      list[0] || { id: "nordique", label: "Nordique", vit: 0, int: 0, end: 0, def: 0 }
    );
  }

  function getRaceBonuses(raceId) {
    var r = getRaceById(raceId);
    return {
      vit: r.vit || 0,
      int: r.int || 0,
      end: r.end || 0,
      def: r.def || 0
    };
  }

  function normalizeEditorItem(it) {
    var kind = it.kind;
    if (kind !== "consumable" && kind !== "spellbook") return null;
    var r = it.rarity;
    if (r !== "common" && r !== "rare" && r !== "epic") r = "common";
    var id = String(it.id || "").slice(0, 48) || "edit_item";
    var name = String(it.name || "Objet").slice(0, 48);
    var cost = Math.max(1, Math.floor(Number(it.cost) || 5));
    if (kind === "consumable") {
      var eff = it.effect;
      if (eff !== "heal" && eff !== "mana" && eff !== "stamina") eff = "heal";
      var o = { id: id, name: name, cost: cost, kind: "consumable", effect: eff, rarity: r };
      if (isDataUrlIcon(it.iconDataUrl)) o.iconDataUrl = it.iconDataUrl;
      return o;
    }
    var sp = it.spellId;
    sp = String(sp || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32) || "heal";
    var o2 = { id: id, name: name, cost: cost, kind: "spellbook", spellId: sp, rarity: r };
    if (isDataUrlIcon(it.iconDataUrl)) o2.iconDataUrl = it.iconDataUrl;
    return o2;
  }

  function normalizeEditorArmor(a) {
    var r = a.rarity;
    if (r !== "common" && r !== "rare" && r !== "epic") r = "common";
    var out = {
      id: String(a.id || "").slice(0, 48) || "edit_armor",
      name: String(a.name || "Armure").slice(0, 48),
      cost: Math.max(1, Math.floor(Number(a.cost) || 15)),
      kind: "armor",
      slot: a.slot === "necklace" ? "necklace" : "armor",
      vitalite: Math.max(0, Math.floor(Number(a.vitalite) || 0)),
      magie: Math.max(0, Math.floor(Number(a.magie) || 0)),
      endurance: Math.max(0, Math.floor(Number(a.endurance) || 0)),
      defense: Math.max(0, Math.floor(Number(a.defense) || 0)),
      rarity: r
    };
    if (isDataUrlIcon(a.iconDataUrl)) out.iconDataUrl = a.iconDataUrl;
    return out;
  }

  function normalizeEditorWeapon(w) {
    var mn = Math.max(0, Math.floor(Number(w.atkMin) || 0));
    var mx = Math.max(0, Math.floor(Number(w.atkMax) || 0));
    if (mx < mn) {
      var t = mn;
      mn = mx;
      mx = t;
    }
    var r = w.rarity;
    if (r !== "common" && r !== "rare" && r !== "epic") r = "common";
    var spd = Number(w.attackSpeed);
    if (!isFinite(spd)) spd = 1;
    spd = Math.round(Math.min(3, Math.max(0.3, spd)) * 10) / 10;
    var out = {
      id: String(w.id || "").slice(0, 48) || "edit_unknown",
      name: String(w.name || "Arme").slice(0, 48),
      cost: Math.max(1, Math.floor(Number(w.cost) || 10)),
      kind: "weapon",
      atkMin: mn,
      atkMax: Math.max(mn, mx),
      attackSpeed: spd,
      rarity: r,
      weaponType: inferWeaponType({
        kind: "weapon",
        name: String(w.name || ""),
        atkMin: mn,
        atkMax: Math.max(mn, mx),
        attackSpeed: spd,
        weaponType: w.weaponType || w.weaponStyle
      })
    };
    if (isDataUrlIcon(w.iconDataUrl)) out.iconDataUrl = w.iconDataUrl;
    return out;
  }

  function gearIconFrameHtml(item) {
    if (!item) return "";
    var k = item.kind;
    if (k !== "weapon" && k !== "armor" && k !== "consumable" && k !== "spellbook") {
      return "";
    }
    var url = item.iconDataUrl;
    var cls = "item-icon-frame item-icon-frame--" + k;
    if (isDataUrlIcon(url)) {
      return (
        '<div class="' +
        cls +
        '">' +
        '<img class="item-icon-frame__img" src="' +
        url +
        '" alt="" loading="lazy" decoding="async" />' +
        "</div>"
      );
    }
    return '<div class="' + cls + ' item-icon-frame--placeholder" aria-hidden="true"></div>';
  }

  function getShopItemsMerged() {
    var out = SHOP_ITEMS.slice();
    loadEditorWeapons().forEach(function (w) {
      var n = normalizeEditorWeapon(w);
      if (!out.some(function (x) { return x.id === n.id; })) out.push(n);
    });
    loadEditorItems().forEach(function (it) {
      var n = normalizeEditorItem(it);
      if (n && !out.some(function (x) { return x.id === n.id; })) out.push(n);
    });
    loadEditorArmors().forEach(function (a) {
      var n = normalizeEditorArmor(a);
      if (!out.some(function (x) { return x.id === n.id; })) out.push(n);
    });
    return out;
  }

  function getShopItemById(id) {
    return getShopItemsMerged().find(function (x) {
      return x.id === id;
    });
  }

  var VILLAGES = [
    { id: "Nordhaven", desc: "Palissades, forges et marche principal." },
    { id: "Corberoc", desc: "Village de chasseurs au pied des falaises." },
    { id: "Fort-Aube", desc: "Place forte religieuse sous la neige." }
  ];

  function getVillageDialogueLines(villageId) {
    var lines = {
      Nordhaven: [
        "Les forges chantent depuis l'aube : on dit qu'un convoi de fer arrive par la route nord.",
        "Un garde marmonne que les pillards se sont rapproches des ruines. Les torches restent allumees la nuit.",
        "Le tavernier parie des septims qu'un heros sortira bientot du portail pour la grande quete.",
        "L'odeur du bois mouille et du pain chaud se melange au vent glace qui franchit la palissade.",
        "Les enfants imitent les arcs des chasseurs de Corberoc. Les adultes sourient sans vraiment ecouter.",
        "On raconte qu'un vieux mercenaire attend a l'auberge, pret a suivre quiconque paie en or sonnant."
      ],
      Corberoc: [
        "Les falaises crachent le brouillard : les pistes sont glissantes, mais les peaux se vendent cher.",
        "Ragna a encore vu des traces de meute vers la passe. Les chiens hurlent avant meme la lune.",
        "Ici, on mesure un homme a la patience de son arc et au silence de ses pas.",
        "Les cheminées des tanneurs fument sans relache. L'odeur colle aux capes pour des jours.",
        "Un chasseur rentre bredouille et jure que le vent lui a vole la fleche au dernier moment.",
        "Les corbeaux tournent au-dessus des charognes eloignees : mauvais presage, disent les vieux."
      ],
      "Fort-Aube": [
        "Les cloches rythment la neige : chaque tintement rappelle un voeu, une offrande, une peur.",
        "Frere Halvar preche contre les cultes du brasier. Sa voix porte jusqu'aux remparts geles.",
        "Les fideles allument des cierges pour les voyageurs perdus. La flamme tremble sans raison.",
        "Sous la place, les caveaux gardent des secrets que meme les pretres n'osent plus nommer.",
        "On murmure qu'une sceau sacree a disparu — ou qu'elle n'a jamais existe que dans les legendes.",
        "La nuit, les gargouilles semblent suivre du regard ceux qui traversent la cour en silence."
      ]
    };
    return lines[villageId] || lines.Nordhaven;
  }

  function buildHeroSheetVillageHtml() {
    var player = state.player;
    var classData = CLASSES[player.classId];
    var atkRange = player.atkMin + "-" + player.atkMax;
    var rInfo = getRaceById(player.raceId || "nordique");
    var portraitHtml = isDataUrlIcon(rInfo.iconDataUrl)
      ? '<div class="hero-sheet__portrait" aria-hidden="true"><img class="hero-sheet__portrait-img" src="' +
        rInfo.iconDataUrl +
        '" alt=""/></div>'
      : '<div class="hero-sheet__portrait hero-sheet__portrait--empty" aria-hidden="true"></div>';
    return [
      '<div class="hero-sheet">',
      '<header class="hero-sheet__header">',
      portraitHtml,
      '<div class="hero-sheet__id">',
      '<div class="hero-sheet__id-row">',
      '<div class="hero-sheet__id-text">',
      '<h3 class="hero-sheet__name">' + escapeHtml(player.name) + "</h3>",
      '<p class="hero-sheet__class">' + classData.label + "</p>",
      '<p class="hero-sheet__race">' + escapeHtml(rInfo.label) + "</p>",
      "</div>",
      '<div class="hero-sheet__head-tools">' +
      '<div class="hero-sheet__purse" title="' + state.gold + ' septims">' +
      goldIconInlineHtml() +
      '<span class="hero-sheet__purse-val">' + state.gold + "</span>" +
      "</div>" +
      '<button type="button" class="hero-sheet__skills-btn" id="open-skills-btn">Competences</button>' +
      "</div>" +
      "</div>" +
      '<div class="hero-sheet__badges">',
      '<span class="hero-badge">Niv. ' + player.level + "</span>",
      '<span class="hero-badge hero-badge--muted">Degats ' + atkRange + "</span>",
      "</div>",
      "</div>",
      '<div class="hero-sheet__micro-bars" title="Vie et mana" aria-label="Vie et mana">' +
      '<div class="hero-micro-block">' +
      '<div class="hero-micro-block__head">' +
      '<span class="hero-micro-block__label">PV</span>' +
      '<span class="hero-micro-block__nums">' +
      Math.floor(player.hp) +
      " / " +
      Math.floor(player.hpMax) +
      "</span>" +
      "</div>" +
      '<div class="hero-micro-track hero-micro-track--hp"><span style="width:' +
      pct(player.hp, player.hpMax) +
      '%"></span></div>' +
      "</div>" +
      '<div class="hero-micro-block">' +
      '<div class="hero-micro-block__head">' +
      '<span class="hero-micro-block__label">Mana</span>' +
      '<span class="hero-micro-block__nums">' +
      Math.floor(player.magie) +
      " / " +
      Math.floor(player.magieMax) +
      "</span>" +
      "</div>" +
      '<div class="hero-micro-track hero-micro-track--mp"><span style="width:' +
      pct(player.magie, player.magieMax) +
      '%"></span></div>' +
      "</div>" +
      '<div class="hero-micro-block">' +
      '<div class="hero-micro-block__head">' +
      '<span class="hero-micro-block__label">XP</span>' +
      '<span class="hero-micro-block__nums">' +
      Math.floor(player.xp) +
      " / " +
      Math.floor(player.xpToNext) +
      "</span>" +
      "</div>" +
      '<div class="hero-micro-track hero-micro-track--xp"><span style="width:' +
      pct(player.xp, player.xpToNext) +
      '%"></span></div>' +
      "</div>" +
      "</div>" +
      "</header>",
      '<section class="hero-sheet__section" aria-label="Talents">',
      '<p class="hero-sheet__talents">Points de talent disponibles : <strong>' + player.talentPoints + "</strong></p>",
      "</section>",
      '<section class="hero-sheet__section" aria-label="Attributs">',
      '<h4 class="hero-sheet__section-title">Attributs</h4>',
      '<div class="hero-sheet__stats hero-sheet__stats--tri">',
      statBox("vitalite", "VIT", "Vitalite", player.vitalite),
      statBox("intelligence", "INT", "Intelligence", player.intelligence),
      statBox("endurance", "END", "Endurance", player.endurance),
      "</div>",
      "</section>",
      '<section class="hero-sheet__section hero-sheet__section--compact" aria-label="Compagnon">',
      '<div class="hero-meta-grid hero-meta-grid--solo">',
      '<div class="hero-meta-card hero-meta-card--wide"><span class="hero-meta-card__label">Compagnon</span><span class="hero-meta-card__value hero-meta-card__value--small">' + escapeHtml(companionStatusText()) + "</span></div>",
      "</div>",
      "</section>",
      '<section class="hero-sheet__section" aria-label="Equipement">',
      '<h4 class="hero-sheet__section-title">Equipement</h4>',
      '<div class="hero-equip-banner">' +
      '<span class="hero-equip-banner__label">Protection</span>' +
      '<span class="hero-equip-banner__val">' +
      player.defense +
      "</span>" +
      '<span class="hero-equip-banner__hint">Armure + collier</span>' +
      "</div>" +
      '<div class="hero-equip hero-equip--sheet">' +
      '<div class="hero-equip-panel hero-equip-panel--weapon">' +
      '<span class="hero-equip-panel__eyebrow">Main principale</span>' +
      equipSlotHtml("weapon", state.equipped.weapon, "Arme") +
      heroEquipMetaLine("weapon", state.equipped.weapon, "Aucune arme equipee") +
      "</div>" +
      '<div class="hero-equip-panel hero-equip-panel--armor">' +
      '<span class="hero-equip-panel__eyebrow">Corps</span>' +
      equipSlotHtml("armor", state.equipped.armor, "Armure") +
      heroEquipMetaLine("armor", state.equipped.armor, "Aucune armure equipee") +
      "</div>" +
      '<div class="hero-equip-panel hero-equip-panel--armor">' +
      '<span class="hero-equip-panel__eyebrow">Collier</span>' +
      equipSlotHtml("necklace", state.equipped.necklace, "Collier") +
      heroEquipMetaLine("necklace", state.equipped.necklace, "Aucun collier equipe") +
      "</div>" +
      "</div>" +
      "</section>",
      "</div>"
    ].join("");
  }

  function barRow(id, label, cur, max, barClass) {
    var p = pct(cur, max);
    return (
      '<div class="hero-bar-row">' +
      '<div class="hero-bar-row__top">' +
      '<span class="hero-bar-row__label">' + label + "</span>" +
      '<span class="hero-bar-row__nums" id="hero-bar-nums-' + id + '">' + cur + " / " + max + "</span>" +
      "</div>" +
      '<div class="' + barClass + ' hero-bar-row__track"><span style="width:' + p + '%"></span></div>' +
      "</div>"
    );
  }

  function journalQuestBadgeClass(stageLabel) {
    if (stageLabel === "En cours") return "journal-badge--progress";
    if (stageLabel === "Retour PNJ") return "journal-badge--turnin";
    return "journal-badge--idle";
  }

  function chronicleGlyphForLine(text) {
    var t = String(text || "");
    if (/victoire|Niveau superieur|terminee|remise a|Quete remise/i.test(t)) return "\u2728";
    if (/defaite|perdu|tombe|Insuffisant/i.test(t)) return "\u2620";
    if (/degats|frappe|combat|Embuscade/i.test(t)) return "\u2694";
    if (/magie|Mana|sort|Guerison|Boule|Regeneration/i.test(t)) return "\u2727";
    if (/Achat|vendu|marchand|septims/i.test(t)) return "\uD83E\uDE99";
    if (/Voyage|Portail|village|Nordhaven|zone/i.test(t)) return "\uD83E\uDDED";
    if (/eclat|fer|forge|amelioree/i.test(t)) return "\u2692";
    return "\uD83D\uDCDC";
  }

  function enrichChronicleHtml(escapedPlain) {
    var s = String(escapedPlain || "");
    s = s.replace(/(\d+)\s*PV/gi, '<span class="journal-rich journal-rich--hp">$1 PV</span>');
    s = s.replace(/(\d+)\s*vie\b/gi, '<span class="journal-rich journal-rich--heal">$1 vie</span>');
    s = s.replace(/(\+?\d+)\s*(septims?|or)\b/gi, '<span class="journal-rich journal-rich--gold">$1 $2</span>');
    s = s.replace(/(\d+)\s*degats?/gi, '<span class="journal-rich journal-rich--dmg">$1 degats</span>');
    s = s.replace(/(\d+)\s*coups?/gi, '<span class="journal-rich journal-rich--swing">$1 coups</span>');
    return s;
  }

  function buildJournalVillageHtml() {
    var q = currentQuest();
    var stageLabel = activeQuestStageLabel();
    var badgeClass = journalQuestBadgeClass(stageLabel);

    var questHtml = "";
    if (!q) {
      questHtml =
        '<section class="journal-section journal-section--quest" aria-label="Quete active">' +
        '<h4 class="journal-section__title">Quete en cours</h4>' +
        '<div class="journal-empty">' +
        '<div class="journal-empty__icon" aria-hidden="true"></div>' +
        '<p class="journal-empty__lead">Aucune quete active</p>' +
        '<p class="journal-empty__hint muted">Visite les PNJ du village pour accepter une mission.</p>' +
        "</div>" +
        "</section>";
    } else {
      var showMark = state.questStage === "accepted";
      questHtml =
        '<section class="journal-section journal-section--quest" aria-label="Quete active">' +
        '<h4 class="journal-section__title">Quete en cours</h4>' +
        '<div class="journal-quest-card">' +
        '<div class="journal-quest-card__head">' +
        '<span class="journal-quest-card__title">' + escapeHtml(q.title) + "</span>" +
        '<span class="journal-badge ' + badgeClass + '">' + escapeHtml(stageLabel) + "</span>" +
        "</div>" +
        '<dl class="journal-quest-meta">' +
        "<div><dt>Donneur</dt><dd>" +
        escapeHtml(q.giver) +
        ' <span class="journal-quest-meta__village">(' +
        escapeHtml(q.giverVillage) +
        ")</span></dd></div>" +
        "<div><dt>Zone cible</dt><dd>" + escapeHtml(q.targetZone) + "</dd></div>" +
        (showMark ? "<div><dt>Marque</dt><dd>" + escapeHtml(q.monster) + "</dd></div>" : "") +
        "</dl>" +
        "</div>" +
        "</section>";
    }

    var logRows = state.log.slice(0, 10).map(function (entry) {
      var text = typeof entry === "string" ? entry : entry.text;
      var at = typeof entry === "string" ? "--:--" : entry.at;
      var mood = /victoire|niveau superieur|terminee/i.test(text) ? "journal-log__entry--good"
        : /defaite|pas assez|insuffisante/i.test(text) ? "journal-log__entry--bad"
        : "journal-log__entry--neutral";
      var glyph = chronicleGlyphForLine(text);
      var bodyHtml = enrichChronicleHtml(escapeHtml(text));
      return (
        '<div class="journal-log__entry ' + mood + '">' +
        '<span class="journal-log__glyph" aria-hidden="true">' +
        glyph +
        "</span>" +
        '<span class="journal-log__time">' +
        escapeHtml(at) +
        "</span>" +
        '<span class="journal-log__text">' +
        bodyHtml +
        "</span>" +
        "</div>"
      );
    }).join("");

    var logBody = logRows
      ? '<div class="journal-log" role="log">' + logRows + "</div>"
      : '<div class="journal-empty journal-empty--tiny"><p class="muted journal-empty__solo">Le journal est vide pour l\'instant.</p></div>';

    return (
      '<div class="journal-panel">' +
      questHtml +
      '<section class="journal-section journal-section--chronicles" aria-label="Chroniques">' +
      '<div class="journal-section__head">' +
      '<h4 class="journal-section__title">Chroniques</h4>' +
      '<span class="journal-section__subtitle">Derniers evenements · ' + String(Math.min(10, state.log.length)) + " entrees</span>" +
      "</div>" +
      '<p class="journal-chronicles__lead muted">Lis les evenements recents de la plus recente a la plus ancienne, avec surbrillance des informations utiles.</p>' +
      logBody +
      "</section>" +
      "</div>"
    );
  }

  resetLegacyQuestsMonstersOnce();
  var state = loadState() || makeInitialState();
  normalizeSaveState();
  state.mode = "menu";

  var els = {
    leftTitle: document.getElementById("left-title"),
    centerTitle: document.getElementById("center-title"),
    rightTitle: document.getElementById("right-title"),
    location: document.getElementById("location-label"),
    left: document.getElementById("left-content"),
    center: document.getElementById("center-content"),
    right: document.getElementById("right-content"),
    toast: document.getElementById("toast"),
    skyuiRoot: document.getElementById("skyui-root")
  };

  function makeInitialState() {
    return {
      mode: "menu",
      currentVillage: "Nordhaven",
      player: null,
      gold: 25,
      inventory: [],
      equipped: { weapon: null, armor: null, necklace: null },
      learnedSpells: [],
      weaponUpgrades: {},
      resources: { ironShard: 0 },
      companion: { hired: false, hp: 0, hpMax: 0, name: "Mercenaire", hireCost: 45 },
      shopStockIds: [],
      shopStockRefreshAt: 0,
      questsTier2Unlocked: false,
      wildCooldownUntil: 0,
      activeQuestId: null,
      questStage: "none",
      completedQuestIds: [],
      combat: null,
      log: ["Le vent froid traverse les palissades de Nordhaven..."]
    };
  }

  function loadState() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return data && typeof data === "object" ? data : null;
    } catch (_) {
      return null;
    }
  }

  function normalizeSaveState() {
    if (!state.player) return;
    if (typeof state.player.level !== "number") state.player.level = 1;
    if (typeof state.player.xp !== "number") state.player.xp = 0;
    if (typeof state.player.xpToNext !== "number") state.player.xpToNext = 45;
    if (typeof state.player.talentPoints !== "number") state.player.talentPoints = 0;
    if (!state.player.talents) state.player.talents = { vitalite: 0, intelligence: 0, endurance: 0 };
    if (typeof state.player.talents.vitalite !== "number") state.player.talents.vitalite = 0;
    if (typeof state.player.talents.intelligence !== "number") state.player.talents.intelligence = 0;
    if (typeof state.player.talents.endurance !== "number") state.player.talents.endurance = 0;
    if (typeof state.player.talents.defense === "number" && state.player.talents.defense > 0) {
      state.player.talentPoints += state.player.talents.defense;
      state.player.talents.defense = 0;
    }
    delete state.player.talents.defense;
    ensurePlayerSkills();
    if (!state.player.raceId) state.player.raceId = "nordique";
    if (!Array.isArray(state.learnedSpells)) state.learnedSpells = [];
    if (!state.equipped || typeof state.equipped !== "object") state.equipped = { weapon: null, armor: null, necklace: null };
    if (typeof state.equipped.weapon !== "string") state.equipped.weapon = null;
    if (typeof state.equipped.armor !== "string") state.equipped.armor = null;
    if (typeof state.equipped.necklace !== "string") state.equipped.necklace = null;
    if (!state.weaponUpgrades || typeof state.weaponUpgrades !== "object") state.weaponUpgrades = {};
    if (!state.resources || typeof state.resources !== "object") state.resources = { ironShard: 0 };
    if (typeof state.resources.ironShard !== "number") state.resources.ironShard = 0;
    if (!state.companion || typeof state.companion !== "object") state.companion = { hired: false, hp: 0, hpMax: 0, name: "Mercenaire", hireCost: 45 };
    if (typeof state.companion.hired !== "boolean") state.companion.hired = false;
    if (typeof state.companion.hp !== "number") state.companion.hp = 0;
    if (typeof state.companion.hpMax !== "number") state.companion.hpMax = 0;
    if (!state.companion.name) state.companion.name = "Mercenaire";
    if (typeof state.companion.hireCost !== "number") state.companion.hireCost = 45;
    if (!Array.isArray(state.shopStockIds)) state.shopStockIds = [];
    if (typeof state.shopStockRefreshAt !== "number") state.shopStockRefreshAt = 0;
    if (typeof state.questsTier2Unlocked !== "boolean") state.questsTier2Unlocked = false;
    if (typeof state.wildCooldownUntil !== "number") state.wildCooldownUntil = 0;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function log(msg) {
    var stamp = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    state.log.unshift({ at: stamp, text: msg });
    state.log = state.log.slice(0, 12);
  }

  function showToast(message, isError) {
    els.toast.textContent = message;
    els.toast.classList.toggle("toast--error", !!isError);
    els.toast.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
      els.toast.hidden = true;
    }, 2500);
  }

  function setMode(mode) {
    state.mode = mode;
    saveState();
    render();
  }

  function currentQuest() {
    return getActiveQuests().find(function (q) {
      return q.id === state.activeQuestId;
    }) || null;
  }

  function getActiveQuests() {
    var base = state.questsTier2Unlocked ? QUESTS.concat(QUESTS_TIER2) : QUESTS;
    var monstersByName = loadEditorMonsterByNameMap();
    var extra = loadEditorQuests().map(function (q) {
      var m = monstersByName[q.monster] || {};
      var count = Math.max(1, Math.floor(Number(q.enemyCount) || 1));
      var hpEach = Math.max(1, Math.floor(Number(m.hp) || 24));
      return {
        id: q.id,
        title: q.title,
        giver: q.giver,
        giverVillage: q.giverVillage || "Nordhaven",
        targetZone: q.targetZone,
        monster: q.monster,
        monsterHp: hpEach,
        rewardGold: Math.max(0, Math.floor(Number(q.rewardGold) || 0)),
        rewardItem: q.rewardItem || "Preuve de traque",
        repeatable: !!q.repeatable,
        enemyCount: count,
        description: q.description || ""
      };
    });
    return base.concat(extra);
  }

  function activeQuestStageLabel() {
    if (!state.activeQuestId) return "Aucune";
    if (state.questStage === "accepted") return "En cours";
    if (state.questStage === "readyToTurnIn") return "Retour PNJ";
    return "Aucune";
  }

  function questDone(id) {
    var q = getActiveQuests().find(function (qq) { return qq.id === id; });
    if (q && q.repeatable) return false;
    return state.completedQuestIds.indexOf(id) !== -1;
  }

  function render() {
    if (state.mode !== "combat") stopCombatAutoLoop();
    document.body.classList.toggle("body--combat", state.mode === "combat");
    applyDefaultCursor();
    if (state.mode === "menu") return renderMainMenu();
    if (state.mode === "creation") return renderCreation();
    if (state.mode === "village") return renderVillage();
    if (state.mode === "map") return renderWorldMap();
    if (state.mode === "combat") return renderCombat();
    if (state.mode === "wild") return renderWildZone();
  }

  function startFreshCharacterFlow() {
    state.mode = "creation";
    state.player = null;
    state.currentVillage = "Nordhaven";
    state.gold = 25;
    state.inventory = [];
    state.equipped = { weapon: null, armor: null, necklace: null };
    state.learnedSpells = [];
    state.weaponUpgrades = {};
    state.resources = { ironShard: 0 };
    state.companion = { hired: false, hp: 0, hpMax: 0, name: "Mercenaire", hireCost: 45 };
    state.shopStockIds = [];
    state.shopStockRefreshAt = 0;
    state.questsTier2Unlocked = false;
    state.wildCooldownUntil = 0;
    state.activeQuestId = null;
    state.questStage = "none";
    state.completedQuestIds = [];
    state.combat = null;
    state.log = ["Le vent froid traverse les palissades de Nordhaven..."];
    saveState();
    render();
  }

  function renderOnboarding() {
    els.location.textContent = "Bienvenue";
    els.leftTitle.textContent = "Univers";
    els.centerTitle.textContent = "Nouveau joueur";
    els.rightTitle.textContent = "Comment jouer";

    els.left.innerHTML = [
      '<div class="onboarding-card card">',
      '<p class="onboarding-card__eyebrow">Nordhaven Chronicles</p>',
      '<h3 class="onboarding-card__title">Un RPG narratif en navigateur</h3>',
      '<p class="onboarding-card__text">Explore les villages du Nord, accepte des quetes, combat des creatures et fais progresser ton heros.</p>',
      '<div class="onboarding-badges" aria-hidden="true">',
      '<span class="onboarding-badge">Exploration</span>',
      '<span class="onboarding-badge">Combat</span>',
      '<span class="onboarding-badge">Loot</span>',
      '<span class="onboarding-badge">Progression</span>',
      "</div>",
      "</div>"
    ].join("");

    els.center.innerHTML = [
      '<div class="onboarding-hero card">',
      '<p class="onboarding-hero__kicker">Premiere partie</p>',
      '<h2 class="onboarding-hero__title">Pret a forger ton personnage ?</h2>',
      '<p class="onboarding-hero__lead">Choisis un nom, une race et une classe. En moins de 2 minutes, tu peux commencer l\'aventure.</p>',
      '<button type="button" class="btn btn--primary onboarding-hero__start" id="onboarding-start">Commencer</button>',
      '<button type="button" class="btn onboarding-hero__secondary" id="onboarding-existing">J\'ai deja une sauvegarde</button>',
      "</div>"
    ].join("");

    els.right.innerHTML = [
      '<div class="onboarding-help card">',
      '<h4 class="onboarding-help__title">Deroulement rapide</h4>',
      '<ol class="onboarding-help__list">',
      "<li>Creation du personnage</li>",
      "<li>Arrivee au village de Nordhaven</li>",
      "<li>Premiers achats et quetes</li>",
      "<li>Combat et progression du niveau</li>",
      "</ol>",
      '<p class="onboarding-help__foot muted">Tu pourras reprendre ta partie plus tard automatiquement.</p>',
      "</div>"
    ].join("");

    var startBtn = els.center.querySelector("#onboarding-start");
    if (startBtn) {
      startBtn.addEventListener("click", function () {
        startFreshCharacterFlow();
      });
    }

    var existingBtn = els.center.querySelector("#onboarding-existing");
    if (existingBtn) {
      existingBtn.addEventListener("click", function () {
        state.mode = "menu";
        saveState();
        renderMainMenu();
      });
    }
  }

  function renderMainMenu() {
    var hasSave = !!state.player;
    els.location.textContent = "Accueil";
    els.leftTitle.textContent = "Chroniques";
    els.centerTitle.textContent = "Menu principal";
    els.rightTitle.textContent = "Session";

    els.left.innerHTML = [
      '<div class="mainmenu-lore card mainmenu-lore--v2">',
      '<p class="mainmenu-lore__eyebrow">Nordhaven Chronicles</p>',
      '<h3 class="mainmenu-lore__title">Le Nord attend un nom</h3>',
      '<p class="mainmenu-lore__text">Les routes sont froides, les contrats sanglants, et les bourses legeres. Chaque depart ecrit une chronique.</p>',
      '<div class="mainmenu-lore__tags" aria-hidden="true">' +
      '<span class="mainmenu-tag">RPG narratif</span>' +
      '<span class="mainmenu-tag">Exploration</span>' +
      '<span class="mainmenu-tag">Progression</span>' +
      "</div>" +
      "</div>"
    ].join("");

    els.center.innerHTML = [
      '<div class="mainmenu-panel">',
      '<p class="mainmenu-panel__kicker">Sanctuaire du joueur</p>',
      '<h2 class="mainmenu-panel__title">Menu principal</h2>',
      '<p class="mainmenu-panel__lead">Choisis ton entree dans le monde.</p>',
      '<div class="mainmenu-actions">',
      '<button type="button" class="btn btn--primary mainmenu-btn" id="menu-new">Creation de personnage</button>',
      '<button type="button" class="btn mainmenu-btn" id="menu-login"' + (hasSave ? "" : " disabled") + '>Connexion / charger la partie</button>',
      (hasSave ? '<button type="button" class="btn mainmenu-btn" id="menu-continue">Continuer l\'aventure</button>' : ""),
      "</div>",
      "</div>"
    ].join("");

    els.right.innerHTML = [
      '<div class="mainmenu-side card mainmenu-side--v2">',
      '<h4 class="mainmenu-side__title">Etat de session</h4>',
      (hasSave
        ? '<p class="mainmenu-side__line"><strong>Personnage :</strong> ' + escapeHtml(state.player.name) + '</p>' +
          '<p class="mainmenu-side__line"><strong>Niveau :</strong> ' + escapeHtml(String(state.player.level || 1)) + '</p>' +
          '<p class="mainmenu-side__line"><strong>Lieu :</strong> ' + escapeHtml(state.currentVillage || "Nordhaven") + "</p>"
        : '<p class="mainmenu-side__line muted">Aucune partie en cours. Cree un personnage pour commencer.</p>') +
      '<p class="mainmenu-side__line muted">Astuce : tu peux revenir ici a tout moment pour lancer une nouvelle campagne.</p>' +
      "</div>"
    ].join("");

    els.center.querySelector("#menu-new").addEventListener("click", function () {
      startFreshCharacterFlow();
    });

    var loginBtn = els.center.querySelector("#menu-login");
    if (loginBtn) {
      loginBtn.addEventListener("click", function () {
        if (!state.player) return;
        showToast("Session chargee : " + state.player.name + ".");
        setMode("village");
      });
    }

    var continueBtn = els.center.querySelector("#menu-continue");
    if (continueBtn) {
      continueBtn.addEventListener("click", function () {
        setMode("village");
      });
    }
  }

  function formatRaceBonusLine(r) {
    if (!r) return "";
    var p = [];
    if (r.vit) p.push("VIT " + (r.vit > 0 ? "+" : "") + r.vit);
    if (r.int) p.push("INT " + (r.int > 0 ? "+" : "") + r.int);
    if (r.end) p.push("END " + (r.end > 0 ? "+" : "") + r.end);
    return p.length ? p.join(" · ") : "Bonus mineurs";
  }

  function buildCreationStatPreview(raceId, classId) {
    var cl = CLASSES[classId || "guerrier"];
    var rb = getRaceBonuses(raceId || "nordique");
    var vit = cl.vitalite + (rb.vit || 0);
    var intel = Math.max(1, cl.intelligence + (rb.int || 0));
    var end = cl.endurance + (rb.end || 0);
    var hp = vit * 2;
    var mana = intel;
    var atkMin = Math.max(1, cl.atkMin);
    var atkMax = Math.max(atkMin, cl.atkMax);
    return (
      '<div class="creation-stats">' +
      '<p class="creation-stats__title">Stats de depart</p>' +
      '<div class="creation-stats__grid">' +
      '<div class="creation-stats__item"><span class="creation-stats__k">Vitalite</span><strong class="creation-stats__v">' + vit + "</strong></div>" +
      '<div class="creation-stats__item"><span class="creation-stats__k">Intelligence</span><strong class="creation-stats__v">' + intel + "</strong></div>" +
      '<div class="creation-stats__item"><span class="creation-stats__k">Endurance</span><strong class="creation-stats__v">' + end + "</strong></div>" +
      '<div class="creation-stats__item"><span class="creation-stats__k">PV max</span><strong class="creation-stats__v">' + hp + "</strong></div>" +
      '<div class="creation-stats__item"><span class="creation-stats__k">Mana max</span><strong class="creation-stats__v">' + mana + "</strong></div>" +
      '<div class="creation-stats__item"><span class="creation-stats__k">Degats</span><strong class="creation-stats__v">' + atkMin + " - " + atkMax + "</strong></div>" +
      "</div>" +
      '<p class="creation-stats__hint muted">Projection sans equipement ni talents.</p>' +
      "</div>"
    );
  }

  function buildCreationPreviewInner(raceId, classId) {
    var r = getRaceById(raceId || "nordique");
    var cl = CLASSES[classId || "guerrier"];
    var portrait = isDataUrlIcon(r.iconDataUrl)
      ? '<div class="creation-preview__portrait"><img class="creation-preview__img" src="' +
        r.iconDataUrl +
        '" alt=""/></div>'
      : '<div class="creation-preview__portrait creation-preview__portrait--empty"></div>';
    return (
      '<div class="creation-preview">' +
      portrait +
      '<p class="creation-preview__race">' +
      escapeHtml(r.label) +
      "</p>" +
      '<p class="creation-preview__class muted">' +
      escapeHtml(cl.label) +
      "</p>" +
      '<p class="creation-preview__bonus muted">' +
      escapeHtml(formatRaceBonusLine(r)) +
      "</p>" +
      buildCreationStatPreview(raceId, classId) +
      "</div>"
    );
  }

  function renderCreation() {
    els.location.textContent = "Creation du personnage";
    els.leftTitle.textContent = "Identite";
    els.centerTitle.textContent = "Lignee et doctrine";
    els.rightTitle.textContent = "Apercu du heros";

    els.left.innerHTML = [
      '<div class="creation-shell card">',
      '<p class="creation-shell__eyebrow">Nouvelle campagne</p>',
      '<h3 class="creation-shell__title">Forger un heros</h3>',
      '<label class="label" for="hero-name">Nom du personnage</label>',
      '<input class="input" id="hero-name" maxlength="24" placeholder="ex: Alrik Corbeaugris" />',
      '<p class="creation-shell__hint muted">2 a 24 caracteres, lettres, espaces, apostrophes et tirets.</p>',
      '<div class="row row--tight">',
      '<button class="btn btn--primary" id="create-btn">Entrer dans Nordhaven</button>',
      '<button class="btn" id="back-menu-btn">Retour menu</button>',
      "</div>",
      "</div>"
    ].join("");

    var raceRadios = getRacesMerged()
      .map(function (r) {
        return (
          '<label><input type="radio" name="race" value="' +
          escapeHtml(r.id) +
          '" ' +
          (r.id === "nordique" ? "checked " : "") +
          "/> " +
          escapeHtml(r.label) +
          "</label>"
        );
      })
      .join("");

    els.center.innerHTML = [
      '<div class="creation-choice-group">',
      '<p class="creation-choice-group__title">Race</p>',
      '<div class="race-choice">',
      raceRadios,
      "</div>",
      "</div>",
      '<div class="creation-choice-group">',
      '<p class="creation-choice-group__title">Classe</p>',
      '<div class="class-choice">',
      '<label><input type="radio" name="class" value="guerrier" checked /> Guerrier du Nord - solide en vitalite</label>',
      '<label><input type="radio" name="class" value="mage" /> Arcaniste - expert en magie</label>',
      '<label><input type="radio" name="class" value="rodeur" /> Rodeur des plaines - endurance elevee</label>',
      "</div>",
      "</div>",
      '<div class="muted">La race ajoute des bonus permanents. La classe fixe tes stats de depart.</div>'
    ].join("");

    var previewEl = document.createElement("div");
    previewEl.id = "creation-preview-root";
    els.right.innerHTML = "";
    els.right.appendChild(previewEl);

    function refreshPreview() {
      var rc = document.querySelector('input[name="race"]:checked');
      var cc = document.querySelector('input[name="class"]:checked');
      previewEl.innerHTML = buildCreationPreviewInner(rc ? rc.value : "nordique", cc ? cc.value : "guerrier");
    }

    refreshPreview();
    document.querySelectorAll('input[name="race"], input[name="class"]').forEach(function (inp) {
      inp.addEventListener("change", refreshPreview);
    });

    var backMenuBtn = els.left.querySelector("#back-menu-btn");
    if (backMenuBtn) {
      backMenuBtn.addEventListener("click", function () {
        setMode("menu");
      });
    }

    els.left.querySelector("#create-btn").addEventListener("click", function () {
      var nameInput = els.left.querySelector("#hero-name");
      var name = (nameInput.value || "").replace(/\s+/g, " ").trim();
      var pickedClass = document.querySelector('input[name="class"]:checked');
      var pickedRace = document.querySelector('input[name="race"]:checked');
      var classId = pickedClass ? pickedClass.value : "guerrier";
      var raceId = pickedRace ? pickedRace.value : "nordique";

      if (!NAME_RE.test(name)) {
        showToast("Nom invalide: 2-24 lettres/espace/tiret.", true);
        return;
      }

      var model = CLASSES[classId];
      state.player = {
        name: name,
        raceId: raceId,
        classId: classId,
        level: 1,
        xp: 0,
        xpToNext: 45,
        talentPoints: 0,
        talents: { vitalite: 0, intelligence: 0, endurance: 0 },
        skills: makeDefaultSkills(),
        vitalite: model.vitalite,
        intelligence: model.intelligence,
        magie: model.intelligence,
        endurance: model.endurance,
        defense: 0,
        atkMin: model.atkMin,
        atkMax: model.atkMax,
        magieMax: model.intelligence
      };
      recalcDerivedStats();
      state.mode = "village";
      log(name + " rejoint Nordhaven en tant que " + model.label + ".");
      saveState();
      render();
    });
  }

  function renderVillage() {
    els.right.classList.remove("panel__body--merchant", "panel__body--shop");
    els.location.textContent = "Village de " + state.currentVillage;
    els.leftTitle.textContent = "Personnage";
    els.centerTitle.textContent = "Village";
    els.rightTitle.textContent = "Journal et quetes";

    var q = currentQuest();
    els.left.innerHTML = buildHeroSheetVillageHtml();

    var needsQuestTravel = !!(q && state.questStage === "accepted");
    var needsQuestTurnIn = !!(q && state.questStage === "readyToTurnIn" && state.currentVillage === q.giverVillage);
    var canTakeNewQuest = !(state.activeQuestId && state.questStage === "accepted");
    var hasLocalQuestOffers =
      canTakeNewQuest &&
      getActiveQuests().some(function (qq) {
        return !questDone(qq.id) && qq.giverVillage === state.currentVillage;
      });
    var showInnNotif = needsQuestTurnIn || hasLocalQuestOffers;

    var villageLines = getVillageDialogueLines(state.currentVillage);
    var villageBlurb = VILLAGES.filter(function (v) { return v.id === state.currentVillage; })[0];
    var blurbText = villageBlurb ? villageBlurb.desc : "";
    var villageArtUrl = getVillageArtUrl(state.currentVillage);

    els.center.innerHTML = [
      '<div class="village-scene">',
      '<button type="button" class="village-narrator" id="village-narrator-btn" aria-label="Ecouter une autre rumeur du village">',
      '<span class="village-narrator__portrait" aria-hidden="true"></span>',
      '<div class="village-narrator__body">',
      '<span class="village-narrator__place">' + escapeHtml(state.currentVillage) + " — rumeurs du jour</span>",
      '<p class="village-narrator__text" id="village-narrator-text">' + escapeHtml(villageLines[0]) + "</p>",
      '<span class="village-narrator__hint">Cliquer pour faire defiler</span>',
      "</div>",
      "</button>",
      (villageArtUrl
        ? '<div class="village-scene__art-wrap"><img class="village-scene__art" src="' + villageArtUrl + '" alt="Illustration de ' + escapeHtml(state.currentVillage) + '" /></div>'
        : ""),
      '<p class="village-scene__flavor">' + escapeHtml(blurbText) + "</p>",
      '<div class="village-actions">',
      villageNavButton({
        id: "open-inventory-btn",
        label: "Inventaire",
        slotKey: "inventory"
      }),
      villageNavButton({
        id: "open-shop",
        label: "Marchand",
        slotKey: "shop"
      }),
      villageNavButton({
        id: "open-forge",
        label: "Forge",
        slotKey: "forge"
      }),
      villageNavButton({
        id: "open-inn",
        label: "Auberge",
        slotKey: "inn",
        questBtn: true,
        notifHtml: showInnNotif ? '<span class="notif-dot" aria-hidden="true">!</span>' : ""
      }),
      villageNavButton({
        id: "open-map",
        label: "Portail de la ville",
        slotKey: "map",
        wide: true,
        primary: true,
        questBtn: true,
        notifHtml: needsQuestTravel ? '<span class="notif-dot" aria-hidden="true">!</span>' : ""
      }),
      "</div>",
      '<p class="village-scene__hint muted">Inventaire, marchand, forge. Auberge : repos, mercenaire et quetes au comptoir. Le portail ouvre la carte du monde.</p>',
      "</div>"
    ].join("");

    (function bindVillageNarrator() {
      var idx = 0;
      var btn = els.center.querySelector("#village-narrator-btn");
      var textEl = els.center.querySelector("#village-narrator-text");
      if (!btn || !textEl) return;
      btn.addEventListener("click", function () {
        idx = (idx + 1) % villageLines.length;
        textEl.textContent = villageLines[idx];
      });
    })();

    els.right.innerHTML = buildJournalVillageHtml();

    bindTalentButtons();

    var skillsBtn = els.left.querySelector("#open-skills-btn");
    if (skillsBtn) skillsBtn.addEventListener("click", openCompetencesSkyui);

    els.center.querySelector("#open-inventory-btn").addEventListener("click", openInventorySkyui);
    els.center.querySelector("#open-shop").addEventListener("click", function () {
      openShopDialog("menu");
    });
    els.center.querySelector("#open-forge").addEventListener("click", openForgeDialog);
    els.center.querySelector("#open-inn").addEventListener("click", openInnDialog);
    els.center.querySelector("#open-map").addEventListener("click", function () {
      runZoneTransition("Ouverture du portail...", function () {
        setMode("map");
      });
    });
  }

  function inventoryEquippedStripHtml() {
    return (
      '<div class="inv-equipped__slots">' +
      equipSlotHtml("weapon", state.equipped.weapon, "Main") +
      equipSlotHtml("armor", state.equipped.armor, "Corps") +
      equipSlotHtml("necklace", state.equipped.necklace, "Collier") +
      "</div>"
    );
  }

  function resourcesSectionHtml() {
    var r = state.resources || {};
    var iron = typeof r.ironShard === "number" ? r.ironShard : 0;
    return (
      '<div class="inv-stats-row">' +
      '<div class="inv-stat inv-stat--gold">' +
      '<span class="inv-stat__label">Septims</span>' +
      '<span class="inv-stat__val">' +
      state.gold +
      "</span></div>" +
      '<div class="inv-stat inv-stat--iron">' +
      '<span class="inv-stat__label">Eclats de fer</span>' +
      '<span class="inv-stat__val">' +
      iron +
      "</span></div>" +
      "</div>"
    );
  }

  function buildUsableConsumablesListHtml() {
    var rows = state.inventory.filter(function (it) {
      return it && (it.kind === "consumable" || it.effect === "heal" || it.effect === "mana" || it.effect === "stamina");
    });
    if (!rows.length) {
      return '<p class="inv-consumables__empty muted">Aucun consommable utilisable.</p>';
    }
    return rows
      .map(function (it, idx) {
        var effectLabel = it.effect === "mana"
          ? "Mana +6"
          : it.effect === "stamina"
            ? "Endurance +1"
            : "Vie +12";
        return (
          '<button type="button" class="inv-consumables__chip inv-use" data-idx="' +
          idx +
          '">' +
          '<span class="inv-consumables__chip-name">' + escapeHtml(it.name || "Consommable") + "</span>" +
          '<span class="inv-consumables__chip-eff">' + effectLabel + "</span>" +
          "</button>"
        );
      })
      .join("");
  }

  function renderInventory(gridEl) {
    var holder = gridEl || document.getElementById("inventory-list-modal");
    if (!holder) return;
    var resEl = document.getElementById("inventory-resources");
    if (resEl) resEl.innerHTML = resourcesSectionHtml();
    var eqStrip = document.getElementById("inv-equipped-strip");
    if (eqStrip) eqStrip.innerHTML = inventoryEquippedStripHtml();
    var consEl = document.getElementById("inv-usable-list");
    if (consEl) consEl.innerHTML = buildUsableConsumablesListHtml();
    var countEl = document.getElementById("inv-item-count");
    if (countEl) countEl.textContent = String(state.inventory.length);

    function invGroupMeta(i) {
      if (i.kind === "weapon") return { key: "weapon", label: "Armes", order: 1 };
      if (isNecklaceGear(i)) return { key: "necklace", label: "Colliers", order: 3 };
      if (i.kind === "armor") return { key: "armor", label: "Armures", order: 2 };
      if (i.kind === "consumable") return { key: "consumable", label: "Consommables", order: 4 };
      if (i.kind === "spellbook") return { key: "spellbook", label: "Grimoires", order: 5 };
      return { key: "loot", label: "Butin", order: 6 };
    }

    function sortInGroup(a, b) {
      var ai = a.item || a;
      var bi = b.item || b;
      var ar = String(ai.rarity || "common");
      var br = String(bi.rarity || "common");
      var rank = { epic: 3, rare: 2, common: 1 };
      var rr = (rank[br] || 0) - (rank[ar] || 0);
      if (rr !== 0) return rr;
      return String(ai.name || "").localeCompare(String(bi.name || ""), "fr");
    }

    function renderInvCard(entry) {
          var i = entry.item;
          var invIdx = entry.idx;
          var isWeaponEq = i.kind === "weapon" && state.equipped.weapon === i.name;
          var isArmorEq = i.kind === "armor" && !isNecklaceGear(i) && state.equipped.armor === i.name;
          var isNecklaceEq = i.kind === "armor" && isNecklaceGear(i) && state.equipped.necklace === i.name;
          var equipped = isWeaponEq || isArmorEq || isNecklaceEq;
          var equipBtn = (i.kind === "weapon" || i.kind === "armor")
            ? '<button type="button" class="btn inv-card__btn inv-equip" data-idx="' + invIdx + '">' + (equipped ? "Retirer" : "Equiper") + "</button>"
            : "";
          var useBtn = (i.kind === "consumable" || i.effect === "heal" || i.effect === "mana" || i.effect === "stamina")
            ? '<button type="button" class="btn btn--primary inv-card__btn inv-use" data-idx="' + invIdx + '">Utiliser</button>'
            : "";
          var learnBtn = i.kind === "spellbook"
            ? '<button type="button" class="btn btn--primary inv-card__btn inv-learn" data-idx="' + invIdx + '">Etudier le grimoire</button>'
            : "";
          var slot = i.kind === "weapon" ? "Arme" : (i.kind === "armor" ? (isNecklaceGear(i) ? "Collier" : "Armure") : (i.kind === "spellbook" ? "Grimoire" : "Objet"));
          var learnable = i.kind === "spellbook" ? ' data-learn-idx="' + invIdx + '"' : "";
          var rarity = i.rarity || "";
          var rarityEl = rarity
            ? '<span class="inv-card__rarity rarity rarity--' + rarity + '">' + rarityLabel(rarity) + "</span>"
            : "";
          var kindClass = i.kind || "loot";
          var iconHtml = gearIconFrameHtml(i);
          if (i.kind === "consumable" || i.effect === "heal" || i.effect === "mana" || i.effect === "stamina") {
            iconHtml = '<div class="item--tooltip" data-tip="' + escapeHtml(itemDescription(i)) + '">' + iconHtml + "</div>";
          }
          return (
            '<article class="inv-card inv-card--' +
            kindClass +
            (equipped ? " inv-card--equipped" : "") +
            (rarity ? " inv-card--has-rarity rarity-border--" + rarity : "") +
            '"' +
            learnable +
            ">" +
            '<div class="inv-card__chrome"></div>' +
            '<div class="inv-card__content">' +
            iconHtml +
            '<div class="inv-card__stack">' +
            '<header class="inv-card__head">' +
            '<span class="inv-card__kind">' +
            slot +
            "</span>" +
            '<div class="inv-card__tags">' +
            rarityEl +
            (equipped ? '<span class="inv-card__equipped-badge">Equipe</span>' : "") +
            "</div>" +
            "</header>" +
            '<div class="inv-card__body">' +
            '<h3 class="inv-card__name">' +
            escapeHtml(i.name) +
            "</h3>" +
            '<div class="inv-card__stats">' +
            itemStatsHtml(i) +
            "</div>" +
            "</div>" +
            "</div>" +
            "</div>" +
            '<div class="inv-card__actions">' +
            equipBtn +
            useBtn +
            learnBtn +
            "</div>" +
            "</article>"
          );
    }

    if (state.inventory.length) {
      var groups = {};
      state.inventory.forEach(function (it, idx) {
        var meta = invGroupMeta(it);
        if (!groups[meta.key]) groups[meta.key] = { label: meta.label, order: meta.order, items: [] };
        groups[meta.key].items.push({ item: it, idx: idx });
      });
      var groupHtml = Object.keys(groups)
        .map(function (k) { return groups[k]; })
        .sort(function (a, b) { return a.order - b.order; })
        .map(function (g) {
          g.items.sort(sortInGroup);
          return (
            '<section class="inv-group">' +
            '<header class="inv-group__head">' +
            '<h4 class="inv-group__title">' + escapeHtml(g.label) + "</h4>" +
            '<span class="inv-group__count">' + g.items.length + "</span>" +
            "</header>" +
            '<div class="inv-group__grid">' +
            g.items.map(renderInvCard).join("") +
            "</div>" +
            "</section>"
          );
        })
        .join("");
      holder.innerHTML = groupHtml;
    } else {
      holder.innerHTML = '<div class="inv-empty">' +
        '<div class="inv-empty__glow" aria-hidden="true"></div>' +
        '<p class="inv-empty__title">Sac presque vide</p>' +
        '<p class="inv-empty__hint muted">Butin, achats et recompenses de quete s\'affichent ici.</p>' +
        "</div>";
    }

    var equipButtons = holder.querySelectorAll(".inv-equip");
    equipButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-idx"));
        var item = state.inventory[idx];
        if (!item) return;
        var wasEquipped = false;
        if (item.kind === "weapon") wasEquipped = state.equipped.weapon === item.name;
        else if (item.kind === "armor" && isNecklaceGear(item)) wasEquipped = state.equipped.necklace === item.name;
        else if (item.kind === "armor") wasEquipped = state.equipped.armor === item.name;
        if (item.kind === "weapon") state.equipped.weapon = state.equipped.weapon === item.name ? null : item.name;
        if (item.kind === "armor" && isNecklaceGear(item)) {
          state.equipped.necklace = state.equipped.necklace === item.name ? null : item.name;
        } else if (item.kind === "armor") {
          state.equipped.armor = state.equipped.armor === item.name ? null : item.name;
        }
        playEditorSound(wasEquipped ? "unequip" : "equip");
        recalcDerivedStats();
        log("Equipement modifie: " + item.name + ".");
        saveState();
        render();
        renderInventory(document.getElementById("inventory-list-modal"));
      });
    });

    var useButtons = holder.querySelectorAll(".inv-use");
    useButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-idx"));
        useConsumableAtIndex(idx, false);
      });
    });

    var learnButtons = holder.querySelectorAll(".inv-learn");
    learnButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-idx"));
        var cand = state.inventory[idx];
        if (!cand || cand.kind !== "spellbook") return;
        var book = cand;
        if (!book.spellId) return;
        if (state.learnedSpells.indexOf(book.spellId) !== -1) {
          showToast("Sort deja appris.");
          return;
        }
        state.learnedSpells.push(book.spellId);
        state.inventory.splice(idx, 1);
        log("Nouveau sort appris: " + spellName(book.spellId) + ".");
        saveState();
        render();
        renderInventory(document.getElementById("inventory-list-modal"));
      });
    });

    var learnCards = holder.querySelectorAll("[data-learn-idx]");
    learnCards.forEach(function (card) {
      card.addEventListener("click", function (e) {
        if (e.target && e.target.closest("button")) return;
        var idx = Number(card.getAttribute("data-learn-idx"));
        var book = state.inventory[idx];
        if (!book || book.kind !== "spellbook") return;
        if (state.learnedSpells.indexOf(book.spellId) !== -1) return showToast("Sort deja appris.");
        state.learnedSpells.push(book.spellId);
        state.inventory.splice(idx, 1);
        log("Nouveau sort appris: " + spellName(book.spellId) + ".");
        saveState();
        render();
        renderInventory(document.getElementById("inventory-list-modal"));
      });
    });
  }

  function merchantVoiceLine(mode) {
    var lines = {
      menu: "Bienvenue. Fer, herbes, grimoires : tout a un prix net.",
      buy: "Compte tes septims avant de tendre la main.",
      sell: "Montre ton butin : je paie en septims, pas en promesses."
    };
    return lines[mode] || lines.menu;
  }

  function shopItemTypeKey(it) {
    if (!it) return "other";
    if (it.kind === "weapon") return "weapon";
    if (it.kind === "armor" && it.slot === "necklace") return "necklace";
    if (it.kind === "armor") return "armor";
    if (it.kind === "consumable") return "consumable";
    if (it.kind === "spellbook") return "spellbook";
    return "other";
  }

  function buildShopBuyGridHtml(filterKey) {
    filterKey = filterKey || "all";
    ensureShopStock();
    var rows;
    if (filterKey === "all") {
      rows = state.shopStockIds.map(function (id) {
        return getShopItemById(id);
      }).filter(Boolean);
    } else {
      rows = getShopItemsMerged().filter(function (it) {
        return shopItemTypeKey(it) === filterKey;
      });
    }
    if (!rows.length) return '<p class="shop-empty muted">Etagere vide pour l\'instant.</p>';
    return rows
      .map(function (it) {
        var slot = it.kind === "weapon" ? "Arme" : it.kind === "armor" ? (it.slot === "necklace" ? "Collier" : "Armure") : it.kind === "spellbook" ? "Grimoire" : "Objet";
        var rarity = it.rarity
          ? '<span class="shop-card__rarity rarity rarity--' + (it.rarity || "common") + '">' + rarityLabel(it.rarity) + "</span>"
          : "";
        var pay = shopBuyPrice(it);
        var priceBlock =
          pay < it.cost
            ? '<span class="shop-card__price"><span class="shop-card__price--was">' +
              it.cost +
              '</span> <span class="shop-card__price-val">' +
              pay +
              '</span> <span class="shop-card__price-unit">or</span></span>'
            : '<span class="shop-card__price"><span class="shop-card__price-val">' +
              pay +
              '</span> <span class="shop-card__price-unit">or</span></span>';
        return (
          '<article class="shop-card shop-card--buy">' +
          '<div class="shop-card__hero">' +
          gearIconFrameHtml(it) +
          '<div class="shop-card__hero-main">' +
          '<div class="shop-card__top">' +
          '<span class="shop-card__slot">' +
          slot +
          "</span>" +
          rarity +
          priceBlock +
          "</div>" +
          '<h3 class="shop-card__name">' +
          escapeHtml(it.name) +
          "</h3>" +
          '<div class="shop-card__stats">' +
          itemStatsHtml(it) +
          "</div>" +
          "</div>" +
          "</div>" +
          '<button type="button" class="btn btn--primary shop-card__action buy-btn" data-id="' +
          escapeHtml(it.id) +
          '">Acheter</button>' +
          "</article>"
        );
      })
      .join("");
  }

  function buildShopSellGridHtml() {
    if (!state.inventory.length) return '<p class="shop-empty muted">Rien a vendre.</p>';
    return state.inventory
      .map(function (it, idx) {
        var sell = Math.max(2, Math.floor((it.sell || 8) * 0.7));
        var slot = it.kind === "weapon" ? "Arme" : it.kind === "armor" ? (it.slot === "necklace" ? "Collier" : "Armure") : it.kind === "spellbook" ? "Grimoire" : "Objet";
        var rarity = it.rarity
          ? '<span class="shop-card__rarity rarity rarity--' + (it.rarity || "common") + '">' + rarityLabel(it.rarity) + "</span>"
          : "";
        return (
          '<article class="shop-card shop-card--sell">' +
          '<div class="shop-card__hero">' +
          gearIconFrameHtml(it) +
          '<div class="shop-card__hero-main">' +
          '<div class="shop-card__top">' +
          '<span class="shop-card__slot">' +
          slot +
          "</span>" +
          rarity +
          '<span class="shop-card__price shop-card__price--sell">+' +
          sell +
          ' <span class="shop-card__price-unit">or</span></span>' +
          "</div>" +
          '<h3 class="shop-card__name">' +
          escapeHtml(it.name) +
          "</h3>" +
          '<div class="shop-card__stats">' +
          itemStatsHtml(it) +
          "</div>" +
          "</div>" +
          "</div>" +
          '<button type="button" class="btn shop-card__action sell-btn" data-idx="' +
          idx +
          '">Vendre</button>' +
          "</article>"
        );
      })
      .join("");
  }

  function openInventorySkyui() {
    if (!els.skyuiRoot) return;
    var p = state.player;
    var heroLine = p
      ? escapeHtml(p.name) +
        " — " +
        escapeHtml(getRaceById(p.raceId || "nordique").label) +
        " · " +
        escapeHtml(CLASSES[p.classId].label)
      : "";
    els.skyuiRoot.innerHTML = [
      '<div class="skyui-overlay inv-overlay" role="dialog" aria-modal="true" aria-labelledby="skyui-title">',
      '<div class="skyui-window inv-window">',
      '<div class="skyui-window__chrome">',
      '<div class="skyui-window__corner skyui-window__corner--tl"></div>',
      '<div class="skyui-window__corner skyui-window__corner--tr"></div>',
      '<div class="skyui-window__corner skyui-window__corner--bl"></div>',
      '<div class="skyui-window__corner skyui-window__corner--br"></div>',
      "</div>",
      '<header class="skyui-header inv-window__header">',
      '<div class="inv-window__brand">',
      '<h2 class="inv-window__title" id="skyui-title">Sac du voyageur</h2>',
      '<p class="inv-window__subtitle">' + heroLine + "</p>",
      "</div>",
      '<span class="skyui-header__hint">Echap pour fermer</span>',
      "</header>",
      '<div class="skyui-body inv-window__body">',
      '<div class="inv-panel-top">',
      '<div class="inv-resources-wrap" id="inventory-resources"></div>',
      '<div class="inv-equipped" id="inv-equipped-strip"></div>',
      "</div>",
      '<div class="inv-section-head">',
      '<span class="inv-section-head__label">Objets</span>',
      '<span class="inv-section-head__count" id="inv-item-count">0</span>',
      "</div>",
      '<section class="inv-consumables" aria-label="Consommables utilisables">' +
      '<h4 class="inv-consumables__title">Consommables utilisables</h4>' +
      '<div class="inv-consumables__list" id="inv-usable-list"></div>' +
      "</section>",
      '<div class="inv-grid inv-grid--modal" id="inventory-list-modal"></div>',
      "</div>",
      '<footer class="skyui-footer inv-window__footer"><button type="button" class="btn skyui-close inv-window__close" id="skyui-close-btn">Fermer</button></footer>',
      "</div>",
      "</div>"
    ].join("");
    els.skyuiRoot.setAttribute("aria-hidden", "false");
    document.body.classList.add("skyui-open");

    function close() {
      els.skyuiRoot.innerHTML = "";
      els.skyuiRoot.setAttribute("aria-hidden", "true");
      document.body.classList.remove("skyui-open");
      document.removeEventListener("keydown", onKey);
    }

    function onKey(e) {
      if (e.key === "Escape") close();
    }

    document.addEventListener("keydown", onKey);
    els.skyuiRoot.querySelector(".skyui-overlay").addEventListener("click", function (e) {
      if (e.target.classList.contains("skyui-overlay")) close();
    });
    document.getElementById("skyui-close-btn").addEventListener("click", close);

    renderInventory(document.getElementById("inventory-list-modal"));
  }

  function buildSkillsPanelHtml() {
    ensurePlayerSkills();
    var theme = loadSkillsThemeSettings();
    var cfg = loadSkillsEditorConfig();
    var rows = SKILL_DEFS.map(function (def) {
      var over = cfg[def.id] && typeof cfg[def.id] === "object" ? cfg[def.id] : {};
      var skillName = String(over.label || def.label || "").trim() || def.label;
      var tipHtml = sanitizeSkillTooltipHtml(over.tooltipHtml || def.hint);
      var iconHtml = isDataUrlIcon(over.iconDataUrl)
        ? '<img class="skills-row__icon-img" src="' + over.iconDataUrl + '" alt="" />'
        : '<span class="skills-row__icon-fallback" aria-hidden="true"></span>';
      var s = state.player.skills[def.id];
      var lv = Math.min(SKILL_MAX_LEVEL, Math.max(0, Math.floor(s.level)));
      var need = skillXpNeededForNext(lv);
      var frac =
        lv >= SKILL_MAX_LEVEL
          ? SKILL_MAX_LEVEL
          : lv + (need > 0 ? Math.min(0.995, (s.xp || 0) / need) : 0);
      var barPct = Math.min(100, (frac / SKILL_MAX_LEVEL) * 100);
      var rowStyle =
        "--skills-row-bg:" + theme.rowBg +
        ";--skills-row-border:" + theme.rowBorder +
        ";--skills-bar-start:" + theme.barStart +
        ";--skills-bar-end:" + theme.barEnd +
        ";--skills-text:" + theme.text +
        ";--skills-lvl:" + theme.lvl +
        ";--skills-tip-bg:" + theme.tooltipBg +
        ";--skills-tip-border:" + theme.tooltipBorder;
      return (
        '<div class="skills-row" style="' +
        escapeHtml(rowStyle) +
        '">' +
        '<div class="skills-row__icon">' + iconHtml + "</div>" +
        '<div class="skills-row__content">' +
        '<div class="skills-row__head">' +
        '<span class="skills-row__name">' +
        escapeHtml(skillName) +
        "</span>" +
        '<span class="skills-row__lvl">' +
        lv +
        " / " +
        SKILL_MAX_LEVEL +
        "</span>" +
        "</div>" +
        '<div class="skills-row__bar" role="progressbar" aria-valuenow="' +
        lv +
        '" aria-valuemin="0" aria-valuemax="' +
        SKILL_MAX_LEVEL +
        '">' +
        '<span style="width:' +
        barPct +
        '%"></span>' +
        "</div>" +
        '<div class="skills-row__tooltip">' + tipHtml + "</div>" +
        "</div>" +
        "</div>"
      );
    }).join("");
    return (
      '<div class="skills-panel">' +
      '<p class="skills-panel__lead muted">Les competences montent a l\'usage (style Skyrim). Survole un nom pour le detail.</p>' +
      '<div class="skills-panel__list">' +
      rows +
      "</div>" +
      "</div>"
    );
  }

  function openCompetencesSkyui() {
    if (!els.skyuiRoot || !state.player) return;
    ensurePlayerSkills();
    var heroLine = state.player.name + " — progression";
    els.skyuiRoot.innerHTML = [
      '<div class="skyui-overlay inv-overlay" role="dialog" aria-modal="true" aria-labelledby="skills-ui-title">',
      '<div class="skyui-window inv-window">',
      '<div class="skyui-window__chrome">',
      '<div class="skyui-window__corner skyui-window__corner--tl"></div>',
      '<div class="skyui-window__corner skyui-window__corner--tr"></div>',
      '<div class="skyui-window__corner skyui-window__corner--bl"></div>',
      '<div class="skyui-window__corner skyui-window__corner--br"></div>',
      "</div>",
      '<header class="skyui-header inv-window__header">',
      '<div class="inv-window__brand">',
      '<h2 class="inv-window__title" id="skills-ui-title">Competences</h2>',
      '<p class="inv-window__subtitle">' + escapeHtml(heroLine) + "</p>",
      "</div>",
      '<span class="skyui-header__hint">Echap pour fermer</span>',
      "</header>",
      '<div class="skyui-body inv-window__body skills-window__body">',
      buildSkillsPanelHtml(),
      "</div>",
      '<footer class="skyui-footer inv-window__footer"><button type="button" class="btn skyui-close inv-window__close" id="skills-close-btn">Fermer</button></footer>',
      "</div>",
      "</div>"
    ].join("");
    els.skyuiRoot.setAttribute("aria-hidden", "false");
    document.body.classList.add("skyui-open");

    function close() {
      els.skyuiRoot.innerHTML = "";
      els.skyuiRoot.setAttribute("aria-hidden", "true");
      document.body.classList.remove("skyui-open");
      document.removeEventListener("keydown", onKey);
    }

    function onKey(e) {
      if (e.key === "Escape") close();
    }

    document.addEventListener("keydown", onKey);
    els.skyuiRoot.querySelector(".skyui-overlay").addEventListener("click", function (e) {
      if (e.target.classList.contains("skyui-overlay")) close();
    });
    document.getElementById("skills-close-btn").addEventListener("click", close);
  }

  function bindShopBuySell() {
    var buyButtons = els.right.querySelectorAll(".buy-btn");
    buyButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var itemId = btn.getAttribute("data-id");
        var it = getShopItemById(itemId);
        if (!it) return;
        var price = shopBuyPrice(it);
        if (state.gold < price) {
          showToast("Pas assez de septims.", true);
          return;
        }
        state.gold -= price;
        addSkillXp("speech", 3 + Math.min(10, Math.floor((Number(it.cost) || 5) / 8)));
        var invPush = {
          name: it.name,
          kind: it.kind,
          atkMin: it.atkMin || 0,
          atkMax: it.atkMax || 0,
          vitalite: it.vitalite || 0,
          magie: it.magie || 0,
          endurance: it.endurance || 0,
          defense: it.defense || 0,
          rarity: it.rarity || "common",
          effect: it.effect || "",
          spellId: it.spellId || "",
          sell: Math.max(4, Math.floor(it.cost * 0.55))
        };
        if (it.kind === "weapon") {
          var aspd = Number(it.attackSpeed);
          invPush.attackSpeed = isFinite(aspd) && aspd > 0 ? Math.min(3, Math.max(0.3, Math.round(aspd * 10) / 10)) : 1;
          invPush.weaponType = it.weaponType || inferWeaponType(it);
        }
        if (isDataUrlIcon(it.iconDataUrl)) {
          invPush.iconDataUrl = it.iconDataUrl;
        }
        state.inventory.push(invPush);
        playMerchantBuyAnimation(btn);
        log("Achat : " + it.name + " (" + price + " septims).");
        recalcDerivedStats();
        saveState();
        setTimeout(function () {
          render();
          openShopDialog("buy");
        }, 300);
      });
    });

    var sellButtons = els.right.querySelectorAll(".sell-btn");
    sellButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-idx"));
        var item = state.inventory[idx];
        if (!item) return;
        var sell = Math.max(2, Math.floor((item.sell || 8) * 0.7));
        state.gold += sell;
        if (state.equipped.weapon === item.name) state.equipped.weapon = null;
        if (state.equipped.armor === item.name) state.equipped.armor = null;
        if (state.equipped.necklace === item.name) state.equipped.necklace = null;
        state.inventory.splice(idx, 1);
        recalcDerivedStats();
        log("Objet vendu: " + item.name + " (+" + sell + " or).");
        saveState();
        render();
        openShopDialog("sell");
      });
    });
  }

  function playMerchantBuyAnimation(sourceBtn) {
    var host = els && els.right ? els.right : null;
    if (!host) return;
    if (sourceBtn && sourceBtn.closest) {
      var card = sourceBtn.closest(".shop-card");
      if (card) {
        card.classList.remove("shop-card--bought");
        void card.offsetWidth;
        card.classList.add("shop-card--bought");
        setTimeout(function () {
          card.classList.remove("shop-card--bought");
        }, 360);
      }
    }
    var fx = document.createElement("div");
    fx.className = "merchant-buy-fx";
    fx.innerHTML = '<span class="merchant-buy-fx__coin">✦</span><span class="merchant-buy-fx__text">Achat valide</span>';
    host.appendChild(fx);
    setTimeout(function () {
      if (fx && fx.parentNode) fx.parentNode.removeChild(fx);
    }, 720);
  }

  function openShopDialog(mode) {
    mode = mode || "menu";
    els.right.classList.remove("panel__body--merchant", "panel__body--shop");
    els.right.classList.add("panel__body--shop");

    var v = state.currentVillage;
    var goldStrip =
      '<div class="merchant-strip">' +
      '<span class="merchant-strip__label">' + goldIconInlineHtml() + "Porte-monnaie</span>" +
      '<span class="merchant-strip__gold">' +
      state.gold +
      " <small>septims</small></span>" +
      "</div>";

    if (mode === "menu") {
      els.right.innerHTML =
        '<div class="merchant-panel merchant-panel--menu">' +
        '<header class="merchant-panel__head">' +
        "<h3>Comptoir — " +
        escapeHtml(v) +
        "</h3>" +
        '<p class="merchant-panel__voice">' +
        escapeHtml(merchantVoiceLine("menu")) +
        "</p>" +
        "</header>" +
        goldStrip +
        '<nav class="merchant-nav" aria-label="Commerce">' +
        '<button type="button" class="merchant-nav__btn merchant-nav__btn--buy" id="shop-go-buy">' +
        '<span class="merchant-nav__btn-title">Acheter</span>' +
        '<span class="merchant-nav__btn-hint muted">Armes, armures, consommables, grimoires</span>' +
        "</button>" +
        '<button type="button" class="merchant-nav__btn merchant-nav__btn--sell" id="shop-go-sell">' +
        '<span class="merchant-nav__btn-title">Vendre</span>' +
        '<span class="merchant-nav__btn-hint muted">Depouille ton sac contre de l\'or</span>' +
        "</button>" +
        "</nav>" +
        "</div>";
      els.right.querySelector("#shop-go-buy").addEventListener("click", function () {
        openShopDialog("buy");
      });
      els.right.querySelector("#shop-go-sell").addEventListener("click", function () {
        openShopDialog("sell");
      });
      return;
    }

    var list = buildShopBuyGridHtml(shopBuyFilter);
    var inv = buildShopSellGridHtml();
    var back = '<button type="button" class="btn merchant-back" id="shop-back-menu">← Comptoir</button>';

    if (mode === "buy") {
      var filters = [
        { id: "all", label: "Tous" },
        { id: "weapon", label: "Armes" },
        { id: "armor", label: "Armures" },
        { id: "necklace", label: "Colliers" },
        { id: "consumable", label: "Consommables" },
        { id: "spellbook", label: "Grimoires" }
      ];
      var filterHtml =
        '<div class="shop-filter" role="tablist" aria-label="Filtrer les achats">' +
        filters.map(function (f) {
          return (
            '<button type="button" class="shop-filter__btn' +
            (shopBuyFilter === f.id ? " shop-filter__btn--active" : "") +
            '" data-shop-filter="' +
            f.id +
            '">' +
            f.label +
            "</button>"
          );
        }).join("") +
        "</div>";
      els.right.innerHTML =
        '<div class="merchant-panel merchant-panel--buy">' +
        '<header class="merchant-panel__head">' +
        "<h3>Vitrine — " +
        escapeHtml(v) +
        "</h3>" +
        '<p class="merchant-panel__voice">' +
        escapeHtml(merchantVoiceLine("buy")) +
        "</p>" +
        "</header>" +
        goldStrip +
        filterHtml +
        '<section class="merchant-section" aria-label="Stock">' +
        '<h4 class="merchant-section__title">Arrivages</h4>' +
        '<div class="shop-grid">' +
        list +
        "</div>" +
        "</section>" +
        back +
        "</div>";
      bindShopBuySell();
      els.right.querySelectorAll("[data-shop-filter]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          shopBuyFilter = btn.getAttribute("data-shop-filter") || "all";
          openShopDialog("buy");
        });
      });
      els.right.querySelector("#shop-back-menu").addEventListener("click", function () {
        openShopDialog("menu");
      });
      return;
    }

    if (mode === "sell") {
      els.right.innerHTML =
        '<div class="merchant-panel merchant-panel--sell">' +
        '<header class="merchant-panel__head">' +
        "<h3>Rachat — " +
        escapeHtml(v) +
        "</h3>" +
        '<p class="merchant-panel__voice">' +
        escapeHtml(merchantVoiceLine("sell")) +
        "</p>" +
        "</header>" +
        goldStrip +
        '<section class="merchant-section" aria-label="Vente">' +
        '<h4 class="merchant-section__title">Ton inventaire</h4>' +
        '<div class="shop-grid shop-grid--sell">' +
        inv +
        "</div>" +
        "</section>" +
        back +
        "</div>";
      bindShopBuySell();
      els.right.querySelector("#shop-back-menu").addEventListener("click", function () {
        openShopDialog("menu");
      });
    }
  }

  function getInnkeeperTitle(villageId) {
    if (villageId === "Corberoc") return "Sten le Long, aux tonneaux";
    if (villageId === "Fort-Aube") return "Soeur Celise, qui veille sur la salle";
    return "Hilda, maitresse de l'auberge";
  }

  function getInnWelcomeLine(villageId) {
    if (villageId === "Corberoc") {
      return "La fumee des braises masque l'odeur du cuir et du sang seché. Les chasseurs parlent bas, une choppe a la main.";
    }
    if (villageId === "Fort-Aube") {
      return "Les bancs de pierre resonnent des prieres du jour. Meme le vin a le gout de l'encens, ici.";
    }
    return "Les voyageurs essorent leurs capes pres du feu. Les nouvelles vont et viennent avec les bouteilles.";
  }

  function innQuestHookLine(quest) {
    if (quest && quest.description) return String(quest.description);
    return QUEST_INN_HOOKS[quest.id] || (
      "« " + quest.giver + " cherche une lame pour " + quest.targetZone + ". La cible : " + quest.monster + ". »"
    );
  }

  function buildInnQuestSectionHtml() {
    var q = currentQuest();

    if (q && state.questStage === "readyToTurnIn") {
      if (state.currentVillage !== q.giverVillage) {
        return (
          '<div class="inn-quest-block inn-quest-block--muted">' +
          "<p><strong>Contrat en attente ailleurs</strong></p>" +
          "<p>Ton contact pour <em>" + escapeHtml(q.title) + "</em> t'attend a <strong>" + escapeHtml(q.giverVillage) + "</strong>, pas dans cette salle.</p>" +
          "</div>"
        );
      }
      var turnInRp =
        "« Alors, c'est fait ? Montre-moi ce que tu ramenes. Les histoires au comptoir, ca ne paie pas les murs. » — " +
        escapeHtml(q.giver);
      return (
        '<div class="inn-quest-block inn-quest-block--turnin">' +
        '<div class="inn-rp-bubble">' +
        '<span class="inn-rp-speaker">Remise du contrat</span>' +
        '<p class="inn-rp-line">' + turnInRp + "</p>" +
        '<p class="inn-rp-meta muted">Objectif rempli : ' + escapeHtml(q.monster) + " — " + escapeHtml(q.targetZone) + "</p>" +
        "</div>" +
        '<button type="button" class="btn btn--primary inn-action-btn inn-action-btn--turnin" id="inn-turn-in-btn">Poser la preuve sur la table et toucher la prime</button>' +
        "</div>"
      );
    }

    if (state.activeQuestId && state.questStage === "accepted" && q) {
      return (
        '<div class="inn-quest-block inn-quest-block--active">' +
        '<div class="inn-rp-bubble inn-rp-bubble--neutral">' +
        '<span class="inn-rp-speaker">Contrat en cours</span>' +
        "<p class=\"inn-rp-line\">Les habitues savent que tu traques <strong>" +
        escapeHtml(q.monster) +
        "</strong> pres de <em>" +
        escapeHtml(q.targetZone) +
        "</em>. On ne conclut pas deux affaires a la fois dans cette salle.</p>" +
        '<p class="inn-rp-meta muted">Quete : ' + escapeHtml(q.title) + " — donneur : " + escapeHtml(q.giver) + " (" + escapeHtml(q.giverVillage) + ")</p>" +
        "</div>" +
        "</div>"
      );
    }

    var pool = getActiveQuests().filter(function (qq) {
      return !questDone(qq.id) && qq.giverVillage === state.currentVillage;
    });
    if (!pool.length) {
      return (
        '<div class="inn-quest-block inn-quest-block--muted">' +
        "<p>Les habitues ne declinent aucun contrat digne de ce nom, ce soir — du moins, pas pour ce village.</p>" +
        "<p class=\"muted\">Si une affaire t'attend ailleurs, il faudra boire une autre choppe la-bas.</p>" +
        "</div>"
      );
    }

    return pool.map(function (quest) {
      return (
        '<div class="inn-quest-offer">' +
        '<div class="inn-rp-bubble">' +
        '<span class="inn-rp-speaker">' + escapeHtml(quest.giver) + "</span>" +
        '<p class="inn-rp-line">' + escapeHtml(innQuestHookLine(quest)) + "</p>" +
        '<p class="inn-rp-meta muted">' + escapeHtml(quest.title) + " — zone : " + escapeHtml(quest.targetZone) + "</p>" +
        "</div>" +
        '<button type="button" class="btn btn--primary inn-action-btn inn-action-btn--quest inn-accept-quest" data-id="' +
        quest.id +
        '">Serrer la main — accepter ce contrat</button>' +
        "</div>"
      );
    }).join("");
  }

  function buildPortalCenterHtml() {
    var q = currentQuest();
    var activeQuestLabel = q ? escapeHtml(q.title) : "Aucune mission";
    var villagesHtml = VILLAGES.map(function (v) {
      var here = state.currentVillage === v.id;
      return (
        '<button type="button" class="portal-card portal-card--town' +
        (here ? " portal-card--here" : "") +
        '" data-zone="village:' +
        escapeHtml(v.id) +
        '">' +
        '<span class="portal-card__eyebrow">' +
        (here ? "Position" : "Route") +
        "</span>" +
        '<span class="portal-card__title">' +
        escapeHtml(v.id) +
        "</span>" +
        '<span class="portal-card__desc">' +
        escapeHtml(v.desc) +
        "</span>" +
        "</button>"
      );
    }).join("");

    var canDepartQuest = !!(q && state.questStage === "accepted");
    var questDisabled = canDepartQuest ? "" : " disabled";
    var questNotif = canDepartQuest ? '<span class="notif-dot portal-card__notif" aria-hidden="true">!</span>' : "";
    var questDesc = !q
      ? "Aucune quete en cours. L'auberge distribue les contrats."
      : state.questStage === "accepted"
        ? "Affronter : " + escapeHtml(q.monster)
        : state.questStage === "readyToTurnIn"
          ? "Remets d'abord la preuve au PNJ — le combat est clos."
          : "Accepte un contrat a l'auberge pour partir.";
    var questHtml =
      '<button type="button" class="portal-card portal-card--quest' +
      questDisabled +
      '" data-zone="quest">' +
      questNotif +
      '<span class="portal-card__eyebrow">Zone de quete</span>' +
      '<span class="portal-card__title">' +
      (q ? escapeHtml(q.targetZone) : "Aucune mission") +
      "</span>" +
      '<span class="portal-card__desc">' +
      questDesc +
      "</span>" +
      "</button>";

    var wildHtml =
      '<button type="button" class="portal-card portal-card--wild" data-zone="wild">' +
      '<span class="portal-card__eyebrow">Hors les murs</span>' +
      '<span class="portal-card__title">Terres sauvages</span>' +
      '<span class="portal-card__desc">Fouille, eclats de fer, embuscades possibles.</span>' +
      "</button>";

    return (
      '<div class="portal-scene">' +
      '<header class="portal-scene__head">' +
      '<div class="portal-scene__head-top">' +
      '<span class="portal-badge">Carte du Nord</span>' +
      '<span class="portal-badge portal-badge--muted">Position : ' +
      escapeHtml(state.currentVillage) +
      "</span>" +
      "</div>" +
      '<h2 class="portal-scene__title">Table de route</h2>' +
      '<p class="portal-scene__lead">Trace ta voie entre les villages, surveille ton contrat, et evite les detours qui finissent dans la neige.</p>' +
      '<div class="portal-scene__status">' +
      '<span class="portal-scene__status-label">Contrat actif</span>' +
      '<strong class="portal-scene__status-value">' +
      activeQuestLabel +
      "</strong>" +
      "</div>" +
      '<div class="portal-legend" aria-hidden="true">' +
      '<span class="portal-legend__item"><span class="portal-legend__dot portal-legend__dot--here"></span>Position actuelle</span>' +
      '<span class="portal-legend__item"><span class="portal-legend__dot portal-legend__dot--route"></span>Route de village</span>' +
      '<span class="portal-legend__item"><span class="portal-legend__dot portal-legend__dot--danger"></span>Zone risquee</span>' +
      "</div>" +
      "</header>" +
      '<section class="portal-section">' +
      '<h3 class="portal-section__title">Villages</h3>' +
      '<div class="portal-grid portal-grid--3">' +
      villagesHtml +
      "</div>" +
      "</section>" +
      '<section class="portal-section">' +
      '<h3 class="portal-section__title">Missions & danger</h3>' +
      '<div class="portal-grid portal-grid--2">' +
      questHtml +
      wildHtml +
      "</div>" +
      "</section>" +
      '<button type="button" class="btn btn--primary portal-return" data-zone="village:' +
      escapeHtml(state.currentVillage) +
      '">Rentrer au village (' +
      escapeHtml(state.currentVillage) +
      ")</button>" +
      "</div>"
    );
  }

  function buildPortalRightHtml() {
    var q = currentQuest();
    if (!q) {
      return (
        '<div class="portal-aside">' +
        '<h4 class="portal-aside__title">Carnet de route</h4>' +
        '<p class="portal-aside__text muted">Sans quete acceptee, la voie « contrat » reste close. Les auberges distribuent les contrats.</p>' +
        "</div>"
      );
    }
    return (
      '<div class="portal-aside">' +
      '<h4 class="portal-aside__title">Contrat en cours</h4>' +
      '<p class="portal-aside__quest-title">' +
      escapeHtml(q.title) +
      "</p>" +
      '<dl class="portal-aside__meta">' +
      "<div><dt>Zone</dt><dd>" +
      escapeHtml(q.targetZone) +
      "</dd></div>" +
      "<div><dt>Cible</dt><dd>" +
      escapeHtml(q.monster) +
      "</dd></div>" +
      "<div><dt>Etat</dt><dd>" +
      escapeHtml(activeQuestStageLabel()) +
      "</dd></div>" +
      "</dl>" +
      "</div>"
    );
  }

  function renderWorldMap() {
    els.right.classList.remove("panel__body--merchant", "panel__body--shop");
    els.location.textContent = "Portail — " + state.currentVillage;
    els.leftTitle.textContent = "Personnage";
    els.centerTitle.textContent = "Carte";
    els.rightTitle.textContent = "Carnet";

    els.left.innerHTML = buildHeroSheetVillageHtml();

    els.center.innerHTML = buildPortalCenterHtml();
    els.right.innerHTML = buildPortalRightHtml();

    bindTalentButtons();
    var skillsBtnMap = els.left.querySelector("#open-skills-btn");
    if (skillsBtnMap) skillsBtnMap.addEventListener("click", openCompetencesSkyui);
    els.center.querySelectorAll("[data-zone]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var z = btn.getAttribute("data-zone");
        if (!z) return;
        var q = currentQuest();
        if (z.indexOf("village:") === 0) {
          var targetVillage = z.split(":")[1];
          return runZoneTransition("Voyage vers " + targetVillage + "...", function () {
            state.currentVillage = targetVillage;
            log("Voyage vers " + state.currentVillage + ".");
            setMode("village");
          });
        }
        if (z === "wild") {
          return runZoneTransition("Cap vers les terres sauvages...", function () {
            state.mode = "wild";
            saveState();
            render();
          });
        }
        if (z === "quest") {
          if (!q || state.questStage !== "accepted") {
            showToast(q ? "Tu ne peux pas relancer ce lieu pour l'instant." : "Aucune quete active.");
            return;
          }
          runZoneTransition("Pistage de la cible...", function () {
            startCombat(q);
          });
        }
      });
    });
  }

  function startCombat(quest) {
    var m = loadEditorMonsterByNameMap()[quest.monster] || {};
    var hp = Math.max(1, Math.floor(Number(quest.monsterHp) || Number(m.hp) || 20));
    var atkSpd = Number(m.attackSpeed);
    if (!isFinite(atkSpd)) atkSpd = 1;
    atkSpd = Math.min(ENEMY_ATTACK_SPEED_MAX, Math.max(ENEMY_ATTACK_SPEED_MIN, atkSpd));
    var eAtkMin = Math.max(1, Math.floor(Number(m.atkMin) || 3));
    var eAtkMax = Math.max(eAtkMin, Math.floor(Number(m.atkMax) || 8));
    state.combat = {
      kind: "quest",
      questId: quest.id,
      enemyName: quest.monster,
      enemyHpMax: hp,
      enemyHp: hp,
      currentWave: 1,
      totalWaves: Math.max(1, Math.floor(Number(quest.enemyCount) || 1)),
      enemyDefense: Math.max(0, Math.floor(Number(m.defense) || 0)),
      enemyAttackSpeed: atkSpd,
      enemyAtkMin: eAtkMin,
      enemyAtkMax: eAtkMax,
      rewardXp: Math.max(1, Math.floor(Number(m.xp) || 20)),
      rewardGoldCombat: Math.max(0, Math.floor(Number(m.combatGold) || 0)),
      rewardLootName: String(m.loot || "").trim().slice(0, 64),
      rewardLootTable: Array.isArray(m.lootTable) ? m.lootTable : [],
      auto: { pAcc: 0, eAcc: 0, lastFrameTs: 0, manaAcc: 0, lastSaveAt: Date.now() }
    };
    state.mode = "combat";
    log("Depart vers " + quest.targetZone + ".");
    log("Charge ennemie appliquee: " + String(Math.round(atkSpd * 10) / 10) + "s (attaque toutes ~" + Math.round(combatEnemyAttackIntervalMs()) + " ms).");
    saveState();
    render();
  }

  function stopCombatAutoLoop() {
    if (combatAutoRafId !== null) {
      cancelAnimationFrame(combatAutoRafId);
      combatAutoRafId = null;
    }
  }

  function combatPlayerAttackIntervalMs() {
    var spd = getWeaponAttackSpeedMultiplier();
    return Math.min(2800, Math.max(320, 1000 / spd));
  }

  function combatEnemyAttackIntervalMs() {
    var c = state.combat;
    var spd = c ? Number(c.enemyAttackSpeed) : 1;
    if (!isFinite(spd)) spd = 1;
    var clamped = Math.min(ENEMY_ATTACK_SPEED_MAX, Math.max(ENEMY_ATTACK_SPEED_MIN, spd));
    return Math.round(clamped * 1000);
  }

  function updateCombatHud() {
    var c = state.combat;
    if (!c || state.mode !== "combat") return;
    var el;
    el = document.getElementById("combat-hp-player");
    if (el) el.textContent = state.player.hp + " / " + state.player.hpMax;
    el = document.getElementById("combat-bar-player");
    if (el) el.style.width = pct(state.player.hp, state.player.hpMax) + "%";
    el = document.getElementById("combat-mana");
    if (el) el.textContent = state.player.magie + " / " + state.player.magieMax;
    el = document.getElementById("combat-bar-mana");
    if (el) el.style.width = pct(state.player.magie, state.player.magieMax) + "%";
    el = document.getElementById("combat-hp-enemy");
    if (el) el.textContent = c.enemyHp + " / " + c.enemyHpMax;
    el = document.getElementById("combat-bar-enemy");
    if (el) el.style.width = pct(c.enemyHp, c.enemyHpMax) + "%";

    var auto = c.auto || { pAcc: 0, eAcc: 0 };
    var pInt = combatPlayerAttackIntervalMs();
    var eInt = combatEnemyAttackIntervalMs();
    el = document.getElementById("combat-atb-player");
    if (el) el.style.width = pct(auto.pAcc, pInt) + "%";
    el = document.getElementById("combat-atb-enemy");
    if (el) el.style.width = pct(auto.eAcc, eInt) + "%";
  }

  function combatAutoTick(ts) {
    combatAutoRafId = null;
    var c = state.combat;
    if (!c || state.mode !== "combat") return;

    if (!c.auto) {
      c.auto = { pAcc: 0, eAcc: 0, lastFrameTs: 0, manaAcc: 0, lastSaveAt: Date.now() };
    }
    var a = c.auto;
    if (!a.lastFrameTs) {
      a.lastFrameTs = ts;
      combatAutoRafId = requestAnimationFrame(combatAutoTick);
      updateCombatHud();
      return;
    }
    var dt = Math.min(180, Math.max(0, ts - a.lastFrameTs));
    a.lastFrameTs = ts;

    a.pAcc += dt;
    a.eAcc += dt;
    a.manaAcc += dt;

    var pInt = combatPlayerAttackIntervalMs();
    var eInt = combatEnemyAttackIntervalMs();

    var burst = 0;
    while (burst < 12 && c.enemyHp > 0 && a.pAcc >= pInt) {
      burst++;
      a.pAcc -= pInt;
      var phys = rollPhysicalAttackDamage();
      var dealt = applyEnemyDefense(phys.dmg);
      c.enemyHp -= dealt;
      triggerCombatAnimation("enemyHit");
      var witem = getEquippedInventoryItem("weapon", state.equipped.weapon);
      if (witem && witem.kind === "weapon") {
        var st = getWeaponCombatStyle(witem);
        var xpGain = 2.2 + Math.min(7, phys.dmg / 10);
        if (st === "twoHanded") addSkillXp("twoHanded", xpGain);
        else if (st === "archery") addSkillXp("archery", xpGain);
        else addSkillXp("oneHanded", xpGain);
      }
      log(">> " + dealt + " degats (" + phys.strikes + " coups) sur " + c.enemyName);
      if (companionTurn()) {
        return;
      }
      if (c.enemyHp <= 0) {
        if (advanceCombatWaveOrWin()) return;
        return;
      }
    }

    if (a.eAcc >= eInt) {
      a.eAcc -= eInt;
      if (enemyStrikeOnce()) {
        return;
      }
    }

    if (a.manaAcc >= 2800) {
      a.manaAcc = 0;
      applyPassiveManaRegen();
    }

    if (Date.now() - a.lastSaveAt > 2200) {
      a.lastSaveAt = Date.now();
      saveState();
    }

    updateCombatHud();
    combatAutoRafId = requestAnimationFrame(combatAutoTick);
  }

  function startCombatAutoLoop() {
    if (combatAutoRafId !== null) return;
    combatAutoRafId = requestAnimationFrame(combatAutoTick);
  }

  function renderCombat() {
    stopCombatAutoLoop();
    els.right.classList.remove("panel__body--merchant", "panel__body--shop");
    var c = state.combat;
    var q = currentQuest();
    if (!c) {
      setMode("village");
      return;
    }

    if (!c.auto) {
      c.auto = { pAcc: 0, eAcc: 0, lastFrameTs: 0, manaAcc: 0, lastSaveAt: Date.now() };
    }

    var zoneLabel = c.kind === "wild" ? "Zone libre" : q && q.targetZone ? q.targetZone : "Combat";
    els.location.textContent = zoneLabel;
    els.leftTitle.textContent = "";
    els.centerTitle.textContent = "Combat";
    els.rightTitle.textContent = "";

    els.left.innerHTML = "";
    els.right.innerHTML = "";

    var waveBit =
      c.kind === "quest" && c.totalWaves > 1
        ? "Vague " + c.currentWave + "/" + c.totalWaves
        : "";
    var cadence = String(Math.round((Number(c.enemyAttackSpeed) || 1) * 10) / 10);
    var metaParts = [escapeHtml(zoneLabel)];
    if (waveBit) metaParts.push(waveBit);
    metaParts.push("Ennemi: " + cadence + " s/coup");

    els.center.innerHTML = [
      '<div class="combat-stage combat-stage--simple">',
      '<p class="combat-context" aria-label="Contexte du combat">' + metaParts.join(" · ") + "</p>",
      combatEnemyPortraitBlockHtml(c),
      '<div class="combat-hud" role="group" aria-label="Etat du combat">',
      '<div class="combat-bar-line combat-bar-line--player">',
      '<div class="combat-bar-line__head">',
      '<span class="combat-bar-line__label">' + escapeHtml(state.player.name) + "</span>",
      '<span class="combat-bar-line__nums" id="combat-hp-player">' +
        state.player.hp +
        " / " +
        state.player.hpMax +
        "</span>",
      "</div>",
      '<div class="health combat-bar-line__track"><span id="combat-bar-player" style="width:' +
        pct(state.player.hp, state.player.hpMax) +
        '%"></span></div>',
      "</div>",
      '<div class="combat-bar-line combat-bar-line--mana">',
      '<div class="combat-bar-line__head">',
      '<span class="combat-bar-line__label">Mana</span>',
      '<span class="combat-bar-line__nums" id="combat-mana">' +
        state.player.magie +
        " / " +
        state.player.magieMax +
        "</span>",
      "</div>",
      '<div class="mana combat-bar-line__track"><span id="combat-bar-mana" style="width:' +
        pct(state.player.magie, state.player.magieMax) +
        '%"></span></div>',
      "</div>",
      state.companion.hired
        ? '<div class="combat-companion-mini">' +
          '<span class="combat-companion-mini__name">' +
          escapeHtml(state.companion.name) +
          "</span>" +
          '<span class="combat-companion-mini__hp">' +
          state.companion.hp +
          "/" +
          state.companion.hpMax +
          "</span>" +
          '<div class="health combat-bar-line__track combat-bar-line__track--thin"><span style="width:' +
          pct(state.companion.hp, state.companion.hpMax) +
          '%"></span></div></div>'
        : "",
      '<div class="combat-atb-row" role="group" aria-label="Rythme des tours">',
      '<div class="combat-atb-cell">',
      '<span class="combat-atb-cell__cap">Ta salve</span>',
      '<div class="combat-atb combat-atb--player" aria-hidden="true"><span class="combat-atb__fill" id="combat-atb-player"></span></div>',
      "</div>",
      '<div class="combat-atb-cell">',
      '<span class="combat-atb-cell__cap">Coup ennemi</span>',
      '<div class="combat-atb combat-atb--enemy" aria-hidden="true"><span class="combat-atb__fill" id="combat-atb-enemy"></span></div>',
      "</div>",
      "</div>",
      "</div>",
      '<div class="combat-stage__actions combat-actions">',
      '<button class="btn btn--combat" type="button" id="spellbook-btn">Sorts</button>',
      '<button class="btn btn--combat" type="button" id="item-btn">Objet</button>',
      '<button class="btn btn--danger btn--combat" type="button" id="flee-btn">Fuir</button>',
      "</div>",
      '<div class="card spellbook combat-spellbook" id="spellbook-menu" hidden>' +
        "<strong>Livre de sorts</strong>" +
        '<div class="list" id="spell-list">' +
        renderSpellButtons() +
        "</div></div>",
      '<div class="card spellbook combat-spellbook" id="consumable-menu" hidden>' +
        "<strong>Sac de consommables</strong>" +
        '<div class="list" id="consumable-list">' +
        renderCombatConsumableButtons() +
        "</div></div>",
      "</div>"
    ].join("");

    var centerRoot = els.center;
    centerRoot.querySelector("#spellbook-btn").addEventListener("click", function () {
      var menu = centerRoot.querySelector("#spellbook-menu");
      menu.hidden = !menu.hidden;
      var bag = centerRoot.querySelector("#consumable-menu");
      if (!menu.hidden && bag) bag.hidden = true;
    });
    centerRoot.querySelectorAll(".spell-cast").forEach(function (btn) {
      btn.addEventListener("click", function () {
        castSpell(btn.getAttribute("data-spell"));
      });
    });
    centerRoot.querySelector("#item-btn").addEventListener("click", function () {
      var bag = centerRoot.querySelector("#consumable-menu");
      if (!bag) return;
      bag.hidden = !bag.hidden;
      var menu = centerRoot.querySelector("#spellbook-menu");
      if (!bag.hidden && menu) menu.hidden = true;
    });
    centerRoot.querySelectorAll(".consumable-use").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-idx"));
        useConsumableAtIndex(idx, true);
      });
    });
    centerRoot.querySelector("#flee-btn").addEventListener("click", function () {
      stopCombatAutoLoop();
      log("Retraite tactique vers Nordhaven.");
      state.mode = "village";
      state.combat = null;
      saveState();
      render();
    });

    updateCombatHud();
    startCombatAutoLoop();
  }

  function getWeaponAttackSpeedMultiplier() {
    var w = getEquippedInventoryItem("weapon", state.equipped.weapon);
    if (!w || w.kind !== "weapon") return 1;
    var s = Number(w.attackSpeed);
    if (!isFinite(s) || s <= 0) return 1;
    return Math.min(3, Math.max(0.3, Math.round(s * 10) / 10));
  }

  function countPhysicalLightStrikes() {
    return Math.max(1, Math.min(12, Math.round(getWeaponAttackSpeedMultiplier() * 3)));
  }

  function rollPhysicalAttackDamage() {
    var endBonus = Math.floor(state.player.endurance / 6);
    var W = randomInt(state.player.atkMin, state.player.atkMax) + endBonus;
    var strikes = countPhysicalLightStrikes();
    if (strikes <= 1) {
      return { dmg: W, strikes: 1 };
    }
    var base = Math.floor(W / strikes);
    var rem = W % strikes;
    var dmg = 0;
    for (var i = 0; i < strikes; i++) {
      dmg += base + (i < rem ? 1 : 0);
    }
    return { dmg: dmg, strikes: strikes };
  }

  function applyEnemyDefense(rawDamage) {
    var c = state.combat;
    var def = c ? Math.max(0, Math.floor(Number(c.enemyDefense) || 0)) : 0;
    return Math.max(1, Math.floor(Number(rawDamage) || 0) - def);
  }

  function applyEnemyLootTable() {
    var c = state.combat;
    if (!c || !Array.isArray(c.rewardLootTable) || !c.rewardLootTable.length) return;
    c.rewardLootTable.forEach(function (row) {
      var chance = Math.max(1, Math.min(100, Math.floor(Number(row.chance) || 0)));
      var name = String(row.name || "").trim();
      if (!name || !chance) return;
      if (Math.random() * 100 <= chance) {
        state.inventory.push({ name: name, kind: "loot", sell: Math.max(2, Math.floor((state.player.level || 1) * 2)) });
      }
    });
  }

  function advanceCombatWaveOrWin() {
    var c = state.combat;
    if (!c) return true;
    if (c.kind === "quest" && c.totalWaves > 1 && c.currentWave < c.totalWaves) {
      c.currentWave += 1;
      c.enemyHp = c.enemyHpMax;
      c.auto = { pAcc: 0, eAcc: 0, lastFrameTs: 0, manaAcc: 0, lastSaveAt: Date.now() };
      log("Nouvelle vague: " + c.currentWave + "/" + c.totalWaves + ".");
      render();
      return true;
    }
    winCombat();
    return true;
  }

  function castSpell(spellId) {
    var c = state.combat;
    if (!c) return;
    var sp = getSpellDef(spellId);
    if (!sp) {
      showToast("Sort inconnu.", true);
      return;
    }
    if (state.player.magie < sp.manaCost) {
      showToast("Mana insuffisant (" + sp.manaCost + " requis).", true);
      return;
    }

    state.player.magie -= sp.manaCost;
    if (sp.effect === "heal") {
      if (state.player.hp >= state.player.hpMax) {
        showToast("Tu es deja a pleine vie.", true);
        state.player.magie = Math.min(state.player.magieMax, state.player.magie + sp.manaCost);
        return;
      }
      var rest = sp.skillId === "restoration" ? getSkillLevel("restoration") : 0;
      var base = randomInt(sp.powerMin, sp.powerMax);
      var scale = sp.scaleAttr === "intelligence"
        ? Math.floor(state.player.intelligence / 5)
        : sp.scaleAttr === "vitalite"
          ? Math.floor(state.player.vitalite / 5)
          : sp.scaleAttr === "endurance"
            ? Math.floor(state.player.endurance / 5)
            : 0;
      var healMul = 1 + 0.2 * (rest / SKILL_MAX_LEVEL);
      var heal = Math.max(1, Math.floor((base + scale) * healMul));
      var before = state.player.hp;
      state.player.hp = Math.min(state.player.hpMax, state.player.hp + heal);
      if (sp.skillId !== "none" && sp.xpGain > 0) addSkillXp(sp.skillId, sp.xpGain);
      log(spellName(spellId) + " : +" + (state.player.hp - before) + " PV.");
      triggerCombatAnimation("heal");
      if (companionTurn()) return;
      if (runEnemyTurn()) return;
      applyPassiveManaRegen();
      saveState();
      render();
      return;
    }

    var dest = sp.skillId === "destruction" ? getSkillLevel("destruction") : 0;
    var dmg = randomInt(sp.powerMin, sp.powerMax);
    if (sp.scaleAttr === "intelligence") dmg += Math.floor(state.player.intelligence / 4);
    else if (sp.scaleAttr === "vitalite") dmg += Math.floor(state.player.vitalite / 4);
    else if (sp.scaleAttr === "endurance") dmg += Math.floor(state.player.endurance / 4);
    dmg += Math.floor((12 * dest) / SKILL_MAX_LEVEL);
    var dealt = applyEnemyDefense(dmg);
    c.enemyHp -= dealt;
    if (sp.skillId !== "none" && sp.xpGain > 0) addSkillXp(sp.skillId, sp.xpGain);
    log(spellName(spellId) + " : " + dealt + " degats.");
    triggerCombatAnimation("spellHit");
    if (companionTurn()) return;
    if (c.enemyHp <= 0) {
      if (advanceCombatWaveOrWin()) return;
      return;
    }

    if (runEnemyTurn()) return;
    applyPassiveManaRegen();
    saveState();
    render();
  }

  function defeatPlayerInCombat() {
    stopCombatAutoLoop();
    state.player.hp = Math.floor(state.player.hpMax * 0.55);
    state.mode = "village";
    state.combat = null;
    state.gold = Math.max(0, state.gold - 10);
    log("Defaite au combat. Tu te reveilles au village (10 septims perdus).");
    showToast("Defaite : tu reprends tes esprits au village.", true);
    saveState();
    render();
  }

  function enemyStrikeOnce() {
    var c = state.combat;
    if (!c) return false;
    if (state.companion.hired && state.companion.hp > 0 && Math.random() < 0.3) {
      var compDmg = 2 + Math.floor(Math.random() * 5);
      state.companion.hp -= compDmg;
      log(c.enemyName + " frappe ton compagnon (" + compDmg + ").");
      if (state.companion.hp <= 0) {
        state.companion.hired = false;
        state.companion.hp = 0;
        log("Ton compagnon est tombe au combat. Il faudra le reembaucher.");
      }
      return false;
    }
    var mn = Math.max(1, Math.floor(Number(c.enemyAtkMin) || 3));
    var mx = Math.max(mn, Math.floor(Number(c.enemyAtkMax) || 8));
    var enemyRaw = randomInt(mn, mx);
    var enemyDmg = Math.max(1, enemyRaw - state.player.defense);
    state.player.hp -= enemyDmg;
    triggerCombatAnimation("playerHit");
    log(c.enemyName + " : " + enemyDmg + " degats subis (brut " + enemyRaw + ", armure " + state.player.defense + ").");

    if (state.player.hp <= 0) {
      defeatPlayerInCombat();
      return true;
    }
    return false;
  }

  function runEnemyTurn() {
    return enemyStrikeOnce();
  }

  function pulseClass(selector, cls, ms) {
    var el = document.querySelector(selector);
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms || 240);
  }

  function triggerCombatAnimation(kind) {
    if (state.mode !== "combat") return;
    if (kind === "enemyHit") {
      pulseClass("#combat-enemy-portrait", "is-hit", 280);
    } else if (kind === "playerHit") {
      pulseClass(".combat-hud", "is-hit", 280);
    } else if (kind === "spellHit") {
      pulseClass("#combat-enemy-portrait", "is-spell-hit", 300);
    } else if (kind === "heal") {
      pulseClass(".combat-hud", "is-heal", 280);
    }
  }

  function winCombat() {
    stopCombatAutoLoop();
    var c = state.combat;
    var q = currentQuest();
    if (!c) return;
    if (c.kind === "wild") {
      grantXp(14);
      var ore = randomInt(1, 2);
      state.resources.ironShard += ore;
      state.mode = "wild";
      state.combat = null;
      log("Victoire en zone libre: +" + ore + " eclat(s) de fer.");
      saveState();
      render();
      return;
    }
    if (!q) return;

    var combatGold = Math.floor(q.rewardGold * 0.35) + Math.max(0, Math.floor(Number(c.rewardGoldCombat) || 0));
    state.gold += applyQuestGoldBonus(combatGold);
    grantXp(Math.max(1, Math.floor(Number(c.rewardXp) || 20)));
    if (q.rewardItem) {
      state.inventory.push({ name: q.rewardItem, kind: "loot", sell: Math.floor(q.rewardGold * 0.4) });
    }
    if (c.rewardLootName) {
      state.inventory.push({ name: c.rewardLootName, kind: "loot", sell: Math.max(2, Math.floor((q.rewardGold || 0) * 0.2)) });
    }
    applyEnemyLootTable();
    state.questStage = "readyToTurnIn";
    state.player.endurance += 1;
    recalcDerivedStats();
    state.player.hp = Math.min(state.player.hpMax, state.player.hp + 5);
    state.mode = "village";
    state.combat = null;

    log("Victoire contre " + c.enemyName + "!");
    log("Preuve rapportee. Retourne voir " + q.giver + " a " + q.giverVillage + ".");
    showToast("Mission accomplie. Remets la quete au PNJ.");
    saveState();
    render();
  }

  function finishQuestTurnIn(opts) {
    var q = currentQuest();
    if (!q || state.questStage !== "readyToTurnIn") return;
    var gainedGold = applyQuestGoldBonus(q.rewardGold);
    state.gold += gainedGold;
    grantXp(30);
    if (!q.repeatable) state.completedQuestIds.push(q.id);
    state.activeQuestId = null;
    state.questStage = "none";
    log("Quete remise a " + q.giver + ". +" + gainedGold + " septims.");
    maybeUnlockTier2Quests();
    showToast("Quete terminee: " + q.title + " !");
    saveState();
    render();
    if (opts && opts.reopenInn && state.mode === "village") openInnDialog();
  }

  function useConsumableAtIndex(idx, inCombat) {
    idx = Number(idx);
    if (idx < 0) {
      showToast("Aucun consommable dans l'inventaire.", true);
      return;
    }
    var item = state.inventory[idx];
    if (!item || !(item.kind === "consumable" || item.effect === "heal" || item.effect === "mana" || item.effect === "stamina")) {
      showToast("Consommable introuvable.", true);
      return;
    }
    if (item.effect === "heal") {
      state.player.hp = Math.min(state.player.hpMax, state.player.hp + 12);
      log("Tu bois une potion de vitalite (+12 vie).");
    } else if (item.effect === "mana") {
      state.player.magie = Math.min(state.player.magieMax, state.player.magie + 6);
      log("Tu bois une potion de magie (+6 magie).");
    } else if (item.effect === "stamina") {
      state.player.endurance += 1;
      log("Tu manges des rations (+1 endurance pour ce combat).");
    }
    state.inventory.splice(idx, 1);
    applyPassiveManaRegen();
    saveState();
    if (inCombat) render();
    else {
      render();
      renderInventory(document.getElementById("inventory-list-modal"));
      showToast("Consommable utilise: " + item.name + ".");
    }
  }

  function useConsumableInCombat() {
    var idx = state.inventory.findIndex(function (it) {
      return it && (it.kind === "consumable" || it.effect === "heal" || it.effect === "mana" || it.effect === "stamina");
    });
    if (idx < 0) {
      showToast("Aucun consommable dans l'inventaire.", true);
      return;
    }
    useConsumableAtIndex(idx, true);
  }

  function companionTurn() {
    var c = state.combat;
    if (!c) return false;
    if (!state.companion.hired || state.companion.hp <= 0) return false;
    var dmg = 2 + Math.floor(Math.random() * 4);
    var dealt = applyEnemyDefense(dmg);
    c.enemyHp -= dealt;
    log(state.companion.name + " frappe pour " + dealt + " degats.");
    if (c.enemyHp <= 0) {
      if (advanceCombatWaveOrWin()) return true;
      return true;
    }
    return false;
  }

  function applyPassiveManaRegen() {
    var regen = Math.max(1, Math.floor((state.player.intelligence || 1) / 6));
    var before = state.player.magie;
    state.player.magie = Math.min(state.player.magieMax, state.player.magie + regen);
    if (state.player.magie > before) {
      log("Regeneration passive: +" + (state.player.magie - before) + " mana.");
    }
  }

  function recalcDerivedStats() {
    var base = CLASSES[state.player.classId];
    var rb = getRaceBonuses(state.player.raceId || "nordique");
    var atkMinBonus = 0;
    var atkMaxBonus = 0;
    var vitBonus = 0;
    var intBonus = 0;
    var endBonus = 0;
    var defBonus = 0;
    state.inventory.forEach(function (it) {
      var isEquipped =
        (it.kind === "weapon" && state.equipped.weapon === it.name) ||
        (it.kind === "armor" && isNecklaceGear(it) && state.equipped.necklace === it.name) ||
        (it.kind === "armor" && !isNecklaceGear(it) && state.equipped.armor === it.name);
      if (!isEquipped) return;
      var up = it.kind === "weapon" ? (state.weaponUpgrades[it.name] || 0) : 0;
      atkMinBonus += (it.atkMin || 0) + up;
      atkMaxBonus += (it.atkMax || 0) + (up * 2);
      vitBonus += it.vitalite || 0;
      intBonus += it.magie || 0;
      endBonus += it.endurance || 0;
      defBonus += it.defense || 0;
    });
    var t = state.player.talents || { vitalite: 0, intelligence: 0, endurance: 0 };
    state.player.vitalite = base.vitalite + vitBonus + rb.vit + t.vitalite;
    state.player.intelligence = Math.max(1, base.intelligence + intBonus + rb.int + t.intelligence);
    state.player.magieMax = Math.max(1, state.player.intelligence);
    state.player.magie = Math.min(state.player.magie || state.player.magieMax, state.player.magieMax);
    state.player.endurance = base.endurance + endBonus + rb.end + t.endurance;
    state.player.defense = defBonus;
    state.player.atkMin = Math.max(1, base.atkMin + atkMinBonus);
    state.player.atkMax = Math.max(state.player.atkMin, base.atkMax + atkMaxBonus);

    var oldHpRatio = state.player.hpMax ? state.player.hp / state.player.hpMax : 1;
    state.player.hpMax = state.player.vitalite * 2;
    state.player.hp = Math.max(1, Math.min(state.player.hpMax, Math.round(state.player.hpMax * oldHpRatio)));
  }

  function statBox(key, shortLabel, name, value) {
    var plus = state.player.talentPoints > 0
      ? '<button class="btn stat-add stat-add--plus" data-talent="' + key + '" title="Ajouter 1 point en ' + name + '" aria-label="Ajouter 1 point en ' + name + '"><span class="stat-add__plus" aria-hidden="true">+</span></button>'
      : "";
    var tip = statTooltip(key);
    return (
      '<div class="stat-box stat-box--' +
      key +
      ' item--tooltip" data-tip="' +
      escapeHtml(tip) +
      '">' +
      '<span class="stat-abbr" aria-hidden="true">' +
      escapeHtml(shortLabel) +
      "</span>" +
      '<span class="stat-name">' +
      name +
      '</span><span class="stat-value">' +
      value +
      "</span>" +
      plus +
      "</div>"
    );
  }

  function heroEquipMetaLine(slotId, equippedName, emptyPhrase) {
    var item = getEquippedInventoryItem(slotId, equippedName);
    if (!equippedName) {
      return '<p class="hero-equip-panel__empty">' + emptyPhrase + "</p>";
    }
    if (!item) {
      return (
        '<p class="hero-equip-panel__missing">' +
        escapeHtml(equippedName) +
        " — <em>absent du sac</em></p>"
      );
    }
    var rHtml = item.rarity
      ? '<span class="rarity rarity--' +
        item.rarity +
        ' hero-equip-panel__rarity-tag">' +
        rarityLabel(item.rarity) +
        "</span>"
      : "";
    return (
      '<p class="hero-equip-panel__title">' +
      escapeHtml(item.name) +
      "</p>" +
      (rHtml ? '<div class="hero-equip-panel__tags">' + rHtml + "</div>" : "")
    );
  }

  function weaponEffectiveAtkRange(it, upgradeLevel) {
    var up = typeof upgradeLevel === "number" ? upgradeLevel : state.weaponUpgrades[it.name] || 0;
    var mn = (it.atkMin || 0) + up;
    var mx = (it.atkMax || 0) + up * 2;
    return { min: mn, max: mx, level: up };
  }

  function getItemStatRows(it) {
    var rows = [];
    if (!it || !it.kind) {
      rows.push({ label: "Type", value: "Butin" });
      return rows;
    }
    if (it.kind === "weapon") {
      var eff = weaponEffectiveAtkRange(it);
      rows.push({ label: "Degats", value: eff.min + " – " + eff.max });
      var asp = typeof it.attackSpeed === "number" && isFinite(it.attackSpeed) ? it.attackSpeed : 1;
      rows.push({ label: "Vitesse d'attaque", value: String(Math.round(asp * 10) / 10) });
      rows.push({ label: "Style", value: weaponStyleLabel(getWeaponCombatStyle(it)) });
      if (eff.level > 0) rows.push({ label: "Rang de forge", value: "+" + eff.level });
    } else if (it.kind === "armor") {
      if (it.slot === "necklace") rows.push({ label: "Emplacement", value: "Collier" });
      if (it.defense) rows.push({ label: "Defense", value: "+" + it.defense });
      if (it.vitalite) rows.push({ label: "Vitalite", value: "+" + it.vitalite });
      if (it.magie) rows.push({ label: "Intelligence", value: "+" + it.magie });
      if (!rows.length) rows.push({ label: "Bonus", value: "Aucun" });
    } else if (it.kind === "consumable") {
      if (it.effect === "heal") rows.push({ label: "Effet", value: "Soin +12 PV" });
      else if (it.effect === "mana") rows.push({ label: "Effet", value: "Magie +6" });
      else if (it.effect === "stamina") rows.push({ label: "Effet", value: "Endurance +1" });
      else rows.push({ label: "Effet", value: "Consommable" });
    } else if (it.kind === "spellbook") {
      rows.push({ label: "Enseigne", value: spellName(it.spellId || "") });
    } else {
      rows.push({ label: "Type", value: "Butin" });
    }
    return rows;
  }

  function itemStatsHtml(it) {
    var rows = getItemStatRows(it);
    if (!rows.length) return '<p class="item-stats item-stats--empty muted">—</p>';
    return (
      '<dl class="item-stats">' +
      rows
        .map(function (r) {
          return (
            '<div class="item-stats__row">' +
            "<dt>" +
            escapeHtml(r.label) +
            "</dt><dd>" +
            escapeHtml(r.value) +
            "</dd></div>"
          );
        })
        .join("") +
      "</dl>"
    );
  }

  function itemDescription(it) {
    var rows = getItemStatRows(it);
    return rows.length ? rows.map(function (r) { return r.label + " " + r.value; }).join(" · ") : "Butin";
  }

  function rarityLabel(r) {
    if (r === "epic") return "Epique";
    if (r === "rare") return "Rare";
    return "Commun";
  }

  function ensureShopStock() {
    var now = Date.now();
    if (state.shopStockIds.length && now < state.shopStockRefreshAt) return;
    var merged = getShopItemsMerged();
    var always = merged.filter(function (it) { return it.kind === "consumable"; }).map(function (it) { return it.id; });
    var pool = merged.filter(function (it) { return it.kind !== "consumable"; });
    var picks = [];
    while (picks.length < 4 && pool.length) {
      var idx = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(idx, 1)[0].id);
    }
    state.shopStockIds = always.concat(picks);
    state.shopStockRefreshAt = now + 4 * 60 * 1000;
  }

  function renderSpellButtons() {
    if (!state.learnedSpells.length) {
      return '<div class="muted">Aucun sort appris. Des grimoires sont en vente chez le marchand.</div>';
    }
    var spellMap = getSpellCatalog();
    return state.learnedSpells.map(function (id) {
      var sp = spellMap[id];
      if (!sp) return "";
      var iconHtml = sp.iconDataUrl
        ? '<img class="combat-spell-item__icon-img" src="' + sp.iconDataUrl + '" alt="" />'
        : '<span class="combat-spell-item__icon-fallback" aria-hidden="true">' + escapeHtml(sp.glyph || "✦") + "</span>";
      return (
        '<button type="button" class="combat-spell-item spell-cast" data-spell="' + escapeHtml(sp.id) + '">' +
        '<span class="combat-spell-item__icon">' + iconHtml + "</span>" +
        '<span class="combat-spell-item__body">' +
        '<span class="combat-spell-item__name">' + escapeHtml(sp.name) + "</span>" +
        '<span class="combat-spell-item__meta">' + sp.manaCost + " mana</span>" +
        '<span class="combat-spell-item__desc">' + escapeHtml(sp.description || "") + "</span>" +
        "</span></button>"
      );
    }).join("");
  }

  function renderCombatConsumableButtons() {
    var rows = state.inventory
      .map(function (it, idx) { return { item: it, idx: idx }; })
      .filter(function (row) {
        var it = row.item;
        return it && (it.kind === "consumable" || it.effect === "heal" || it.effect === "mana" || it.effect === "stamina");
      });
    if (!rows.length) {
      return '<div class="muted">Aucun consommable utilisable.</div>';
    }
    return rows.map(function (row) {
      var it = row.item;
      var effectLabel = it.effect === "mana"
        ? "Mana +6"
        : it.effect === "stamina"
          ? "Endurance +1"
          : "Vie +12";
      var iconHtml = isDataUrlIcon(it.iconDataUrl)
        ? '<img class="combat-spell-item__icon-img" src="' + it.iconDataUrl + '" alt="" />'
        : '<span class="combat-spell-item__icon-fallback" aria-hidden="true">⛨</span>';
      return (
        '<button type="button" class="combat-spell-item consumable-use" data-idx="' + row.idx + '">' +
        '<span class="combat-spell-item__icon">' + iconHtml + "</span>" +
        '<span class="combat-spell-item__body">' +
        '<span class="combat-spell-item__name">' + escapeHtml(it.name || "Consommable") + "</span>" +
        '<span class="combat-spell-item__meta">' + effectLabel + "</span>" +
        '<span class="combat-spell-item__desc">Utiliser pendant le combat</span>' +
        "</span></button>"
      );
    }).join("");
  }

  function spellName(id) {
    var sp = getSpellDef(id);
    if (sp) return sp.name;
    return "Inconnu";
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function bindTalentButtons() {
    var buttons = els.left.querySelectorAll(".stat-add");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-talent");
        if (key !== "vitalite" && key !== "intelligence" && key !== "endurance") return;
        if (!state.player || state.player.talentPoints <= 0) return;
        state.player.talents[key] = (state.player.talents[key] || 0) + 1;
        state.player.talentPoints -= 1;
        recalcDerivedStats();
        saveState();
        render();
      });
    });
  }

  function statTooltip(key) {
    var base = CLASSES[state.player.classId];
    var t = state.player.talents || { vitalite: 0, intelligence: 0, endurance: 0 };
    if (key === "vitalite") return "Base : " + base.vitalite + " | Talents : +" + t.vitalite + " | Augmente les PV max (x2).";
    if (key === "intelligence") return "Base : " + base.intelligence + " | Talents : +" + t.intelligence + " | Mana max, regen et sorts.";
    if (key === "endurance") return "Base : " + base.endurance + " | Talents : +" + t.endurance + " | Degats physiques.";
    return "";
  }

  function getEquippedInventoryItem(slotId, name) {
    if (!name || !state.inventory) return null;
    var k = slotId === "weapon" ? "weapon" : "armor";
    return (
      state.inventory.find(function (it) {
        if (!(it.name === name && it.kind === k)) return false;
        if (slotId === "necklace") return isNecklaceGear(it);
        if (slotId === "armor") return !isNecklaceGear(it);
        return true;
      }) || null
    );
  }

  function equipSlotHtml(slotId, equippedName, caption) {
    var item = getEquippedInventoryItem(slotId, equippedName);
    var tip;
    if (item) {
      tip = itemDescription(item);
      if (slotId === "weapon" && equippedName && state.weaponUpgrades && state.weaponUpgrades[equippedName]) {
        tip += " — Forge +" + state.weaponUpgrades[equippedName];
      }
    } else if (equippedName) {
      tip = equippedName + " — absent du sac";
    } else {
      tip = caption + " — vide";
    }

    var iconBlock = item
      ? gearIconFrameHtml(item)
      : '<div class="equip-slot__empty" aria-hidden="true"></div>';

    return (
      '<div class="equip-slot item--tooltip equip-slot--' +
      slotId +
      (item || equippedName ? "" : " equip-slot--empty") +
      '" data-tip="' +
      escapeHtml(tip) +
      '">' +
      '<div class="equip-slot__case">' +
      iconBlock +
      "</div></div>"
    );
  }

  function openForgeDialog(selectedName) {
    els.right.classList.remove("panel__body--merchant", "panel__body--shop");
    var weapons = state.inventory.filter(function (i) {
      return i.kind === "weapon";
    });
    if (!weapons.length) {
      els.right.innerHTML =
        '<div class="forge-panel">' +
        '<h3 class="forge-panel__title">Forge de ' +
        escapeHtml(state.currentVillage) +
        "</h3>" +
        '<p class="forge-panel__empty muted">Aucune arme dans ton sac. Achete-en une au marchand ou trouve-en une au combat.</p>' +
        "</div>";
      return;
    }

    var selName = selectedName;
    if (!selName || !weapons.some(function (w) { return w.name === selName; })) {
      selName = weapons[0].name;
    }
    var item = weapons.find(function (w) {
      return w.name === selName;
    });
    var currentUp = state.weaponUpgrades[selName] || 0;
    var next = currentUp + 1;
    var maxForge = 3;
    var atMax = currentUp >= maxForge;
    var cost = !atMax && next <= maxForge ? next * 2 : 999;
    var canAfford = state.resources.ironShard >= cost;
    var canUpgrade = !atMax && canAfford;

    var oldR = weaponEffectiveAtkRange(item, currentUp);
    var newR = weaponEffectiveAtkRange(item, next);
    var isEquipped = state.equipped.weapon === selName;

    var picker = weapons
      .map(function (w) {
        var up = state.weaponUpgrades[w.name] || 0;
        var active = w.name === selName ? " forge-pick--active" : "";
        return (
          '<button type="button" class="forge-pick' +
          active +
          '" data-forge-weapon="' +
          escapeHtml(w.name) +
          '">' +
          '<span class="forge-pick__name">' +
          escapeHtml(w.name) +
          "</span>" +
          '<span class="forge-pick__rank">+' +
          up +
          "</span>" +
          "</button>"
        );
      })
      .join("");

    var compareBlock = atMax
      ? '<p class="forge-compare forge-compare--max muted">Cette lame a atteint le rang de forge maximal (+3).</p>'
      : '<div class="forge-compare">' +
        '<div class="forge-compare__col">' +
        '<span class="forge-compare__label">Actuellement (+' +
        currentUp +
        ")</span>" +
        '<dl class="forge-stat">' +
        "<div><dt>Degats</dt><dd>" +
        oldR.min +
        " – " +
        oldR.max +
        "</dd></div>" +
        "</dl>" +
        "</div>" +
        '<span class="forge-compare__arrow" aria-hidden="true">→</span>' +
        '<div class="forge-compare__col forge-compare__col--next">' +
        '<span class="forge-compare__label">Apres forge (+' +
        next +
        ")</span>" +
        '<dl class="forge-stat forge-stat--highlight">' +
        "<div><dt>Degats</dt><dd>" +
        newR.min +
        " – " +
        newR.max +
        "</dd></div>" +
        "</dl>" +
        "</div>" +
        "</div>";

    var disabledAttr = canUpgrade ? "" : " disabled";
    var hint = "";
    if (!atMax && !canAfford) {
      hint = '<p class="forge-hint forge-hint--warn muted">Eclats insuffisants : il en faut ' + cost + " (tu en as " + state.resources.ironShard + ").</p>";
    } else if (!atMax) {
      hint = '<p class="forge-hint muted">Cout : <strong>' + cost + "</strong> eclat(s) de fer — stock : " + state.resources.ironShard + "</p>";
    }

    els.right.innerHTML =
      '<div class="forge-panel">' +
      '<header class="forge-panel__head">' +
      "<h3>Forge — " +
      escapeHtml(state.currentVillage) +
      "</h3>" +
      '<p class="forge-panel__lead muted">Choisis une lame du sac. Chaque rang augmente les degats minimum (+1) et maximum (+2).</p>' +
      "</header>" +
      '<div class="forge-picker">' +
      picker +
      "</div>" +
      '<div class="forge-selected">' +
      '<span class="forge-selected__label">Arme selectionnee</span>' +
      "<strong>" +
      escapeHtml(selName) +
      "</strong>" +
      (isEquipped ? '<span class="forge-equipped-tag">Equipee</span>' : '<span class="forge-equipped-tag forge-equipped-tag--bag">Dans le sac</span>') +
      "</div>" +
      compareBlock +
      hint +
      '<button type="button" class="btn btn--primary forge-up-btn" id="forge-up"' +
      disabledAttr +
      ">" +
      (atMax
        ? "Rang max atteint"
        : "Forger : +" + next + " (" + cost + " eclats)") +
      "</button>" +
      "</div>";

    els.right.querySelectorAll("[data-forge-weapon]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = btn.getAttribute("data-forge-weapon");
        openForgeDialog(name);
      });
    });

    var upBtn = document.getElementById("forge-up");
    if (upBtn && !atMax) {
      upBtn.addEventListener("click", function () {
        if (currentUp >= maxForge) return;
        if (state.resources.ironShard < cost) return;
        state.resources.ironShard -= cost;
        state.weaponUpgrades[selName] = next;
        recalcDerivedStats();
        log("Arme amelioree: " + selName + " +" + next + ".");
        saveState();
        render();
        openForgeDialog(selName);
      });
    }
  }

  function openInnDialog() {
    els.right.classList.remove("panel__body--merchant", "panel__body--shop");
    var nightCost = 18;
    var hireCost = state.companion.hireCost || 45;
    var canRest = state.gold >= nightCost;
    var canHire = !state.companion.hired && state.gold >= hireCost;
    var v = state.currentVillage;

    els.right.innerHTML =
      '<div class="inn-panel">' +
      '<header class="inn-panel__head">' +
      '<h3 class="inn-panel__title">Auberge — ' +
      escapeHtml(v) +
      "</h3>" +
      '<p class="inn-panel__keeper">' +
      escapeHtml(getInnkeeperTitle(v)) +
      "</p>" +
      '<p class="inn-panel__meta">Feu de salle | Contrats | Lit chaud</p>' +
      "</header>" +
      '<p class="inn-panel__atmo">' +
      escapeHtml(getInnWelcomeLine(v)) +
      "</p>" +
      '<section class="inn-section" aria-label="Contrats et rumeurs">' +
      '<h4 class="inn-section__title">Salle commune — rumeurs et contrats</h4>' +
      buildInnQuestSectionHtml() +
      "</section>" +
      '<section class="inn-section inn-section--rest" aria-label="Repos">' +
      '<h4 class="inn-section__title">Chambre et compagnon</h4>' +
      '<p class="inn-rest-note muted">Le sommeil restaure toute ta vie et ta mana.</p>' +
      '<button type="button" class="btn inn-action-btn inn-action-btn--rest" id="rest-btn"' +
      (canRest ? "" : " disabled") +
      ">Dormir (" +
      nightCost +
      " septims)</button>" +
      '<p class="inn-companion inn-companion--status muted">Compagnon : ' +
      escapeHtml(companionStatusText()) +
      "</p>" +
      '<button type="button" class="btn btn--primary inn-action-btn inn-action-btn--hire" id="hire-btn"' +
      (canHire ? "" : " disabled") +
      ">Embaucher le mercenaire (" +
      hireCost +
      " or)</button>" +
      "</section>" +
      "</div>";

    var turnInBtn = document.getElementById("inn-turn-in-btn");
    if (turnInBtn) {
      turnInBtn.addEventListener("click", function () {
        finishQuestTurnIn({ reopenInn: true });
      });
    }

    var acceptBtns = els.right.querySelectorAll(".inn-accept-quest");
    acceptBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var questId = btn.getAttribute("data-id");
        if (!questId) return;
        state.activeQuestId = questId;
        state.questStage = "accepted";
        var qq = currentQuest();
        if (qq) {
          log("Quete acceptee: " + qq.title + ".");
          showToast("Contrat accepte : " + qq.title);
        }
        saveState();
        render();
        openInnDialog();
      });
    });

    var restBtn = document.getElementById("rest-btn");
    if (restBtn) {
      restBtn.addEventListener("click", function () {
        if (state.gold < nightCost) return;
        state.gold -= nightCost;
        state.player.hp = state.player.hpMax;
        state.player.magie = state.player.magieMax;
        if (state.companion.hired) state.companion.hp = state.companion.hpMax;
        log("Nuit a l'auberge: forces restaurees.");
        saveState();
        render();
        openInnDialog();
      });
    }

    var hireBtn = document.getElementById("hire-btn");
    if (hireBtn) {
      hireBtn.addEventListener("click", function () {
        if (state.gold < hireCost) return;
        if (state.companion.hired) return;
        state.gold -= hireCost;
        state.companion.hired = true;
        state.companion.hpMax = 18 + Math.floor(state.player.level * 1.5);
        state.companion.hp = state.companion.hpMax;
        log("Compagnon embauche pour t'accompagner.");
        saveState();
        render();
        openInnDialog();
      });
    }
  }

  function companionStatusText() {
    if (!state.companion.hired) return "Aucun compagnon actif.";
    return state.companion.name + " - Vie: " + state.companion.hp + "/" + state.companion.hpMax;
  }

  function renderCompanionCombatCard() {
    if (!state.companion.hired) {
      return '<div class="card"><div class="muted">Compagnon: aucun</div></div>';
    }
    return '<div class="card">Compagnon: ' + state.companion.name + '<br/>Vie: ' + state.companion.hp + "/" + state.companion.hpMax + '<div class="health"><span style="width:' + pct(state.companion.hp, state.companion.hpMax) + '%"></span></div></div>';
  }

  function renderWildZone() {
    els.location.textContent = "Zone libre - Terres sauvages";
    els.leftTitle.textContent = "Personnage";
    els.centerTitle.textContent = "Exploration";
    els.rightTitle.textContent = "Butin";
    var cls = CLASSES[state.player.classId];
    els.left.innerHTML = [
      '<div class="card"><strong>' + escapeHtml(state.player.name) + "</strong><div class=\"muted\">" + cls.label + "</div></div>",
      '<div class="card"><div>Vie: ' + state.player.hp + "/" + state.player.hpMax + '</div><div class="health"><span style="width:' + pct(state.player.hp, state.player.hpMax) + '%"></span></div></div>',
      '<div class="card"><div>Mana: ' + state.player.magie + "/" + state.player.magieMax + '</div><div class="mana"><span style="width:' + pct(state.player.magie, state.player.magieMax) + '%"></span></div></div>',
      '<div class="card"><strong>Ressources</strong><div class="muted">Eclats de fer: ' + state.resources.ironShard + "</div></div>"
    ].join("");
    var now = Date.now();
    var waitMs = Math.max(0, state.wildCooldownUntil - now);
    var waitTxt = waitMs > 0 ? Math.ceil(waitMs / 1000) + "s" : "pret";
    var disabled = waitMs > 0 ? " disabled" : "";
    els.center.innerHTML = '<div class="card scene-text">Forets froides, ruines brisees, minerais exposes.\nTu peux fouiller la zone pour trouver des ressources de forge.</div>' +
      '<div class="row"><button class="btn btn--primary" id="farm-btn"' + disabled + '>Fouiller la zone (' + waitTxt + ')</button><button class="btn" id="back-map-btn">Retour carte</button></div>';
    els.right.innerHTML = '<div class="card"><strong>Recolte</strong><div class="muted">Chance de trouver 1 a 3 eclats de fer.\nFaible chance de declencher un combat.</div></div>';
    document.getElementById("farm-btn").addEventListener("click", function () {
      if (Date.now() < state.wildCooldownUntil) return;
      state.wildCooldownUntil = Date.now() + 8000;
      if (Math.random() < 0.16) {
        startWildCombat();
        return;
      }
      var gain = randomInt(1, 3);
      state.resources.ironShard += gain;
      grantXp(6);
      log("Exploration: +" + gain + " eclat(s) de fer.");
      saveState();
      render();
    });
    document.getElementById("back-map-btn").addEventListener("click", function () {
      setMode("map");
    });
  }

  function grantXp(amount) {
    if (!state.player) return;
    state.player.xp += amount;
    while (state.player.xp >= state.player.xpToNext) {
      state.player.xp -= state.player.xpToNext;
      state.player.level += 1;
      state.player.talentPoints += 2;
      state.player.xpToNext = Math.floor(state.player.xpToNext * 1.25);
      log("Niveau superieur : " + state.player.level + ". +2 points de talent.");
    }
  }

  function startWildCombat() {
    var pool = loadEditorMonstersList()
      .map(function (m) {
        return {
          name: String(m.name || "").trim(),
          hp: Math.max(10, Math.floor(Number(m.hp) || 18)),
          defense: Math.max(0, Math.floor(Number(m.defense) || 0)),
          attackSpeed: Math.min(ENEMY_ATTACK_SPEED_MAX, Math.max(ENEMY_ATTACK_SPEED_MIN, Number(m.attackSpeed) || 1)),
          atkMin: Math.max(1, Math.floor(Number(m.atkMin) || 3)),
          atkMax: Math.max(1, Math.floor(Number(m.atkMax) || 8))
        };
      })
      .filter(function (m) {
        return !!m.name;
      });
    if (!pool.length) {
      pool = [
        { name: "Creature errante", hp: 18, defense: 0, attackSpeed: 1, atkMin: 3, atkMax: 8 },
        { name: "Ombre vagabonde", hp: 20, defense: 1, attackSpeed: 1.1, atkMin: 3, atkMax: 9 },
        { name: "Errant des glaces", hp: 22, defense: 1, attackSpeed: 1.2, atkMin: 4, atkMax: 9 }
      ];
    }
    var pick = pool[Math.floor(Math.random() * pool.length)];
    state.combat = {
      kind: "wild",
      enemyName: pick.name,
      enemyHpMax: pick.hp,
      enemyHp: pick.hp,
      enemyDefense: pick.defense,
      enemyAttackSpeed: pick.attackSpeed,
      enemyAtkMin: pick.atkMin,
      enemyAtkMax: Math.max(pick.atkMin, pick.atkMax),
      auto: { pAcc: 0, eAcc: 0, lastFrameTs: 0, manaAcc: 0, lastSaveAt: Date.now() }
    };
    state.mode = "combat";
    log("Embuscade en zone libre: " + pick.name + "!");
    saveState();
    render();
  }

  function maybeUnlockTier2Quests() {
    if (state.questsTier2Unlocked) return;
    if (!QUESTS.every(function (q) { return questDone(q.id); })) return;
    state.questsTier2Unlocked = true;
    log("Trois nouvelles quetes sont apparues.");
    showToast("Nouvelles quetes disponibles.");
  }

  function pct(current, max) {
    if (max <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  hydrateEditorDataFromServer().then(function () {
    bindEditorUiSounds();
    render();
  });
})();
