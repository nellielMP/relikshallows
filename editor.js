(function () {
  "use strict";

  var STORAGE_WEAPONS = "nordhaven-editor-weapons-v1";
  var STORAGE_ITEMS = "nordhaven-editor-items-v1";
  var STORAGE_SPELLS = "nordhaven-editor-spells-v1";
  var STORAGE_ARMORS = "nordhaven-editor-armors-v1";
  var STORAGE_RACE_ICONS = "nordhaven-editor-race-icons-v1";
  var STORAGE_RACES_EXTRA = "nordhaven-editor-races-extra-v1";
  var STORAGE_NAV_ICONS = "nordhaven-editor-nav-icons-v1";
  var STORAGE_SKILLS_THEME = "nordhaven-editor-skills-theme-v1";
  var STORAGE_SKILLS = "nordhaven-editor-skills-v1";
  var STORAGE_CURSORS = "nordhaven-editor-cursors-v1";
  var STORAGE_SOUNDS = "nordhaven-editor-sounds-v1";
  var STORAGE_VILLAGE_ART = "nordhaven-editor-village-art-v1";
  var STORAGE_MONSTERS = "nordhaven-editor-monsters-v1";
  var STORAGE_QUESTS = "nordhaven-editor-quests-v1";
  var LEGACY_RESET_MARKER = "nordhaven-editor-legacy-reset-v1";
  /** Cle identique a game.js (sauvegarde partie). */
  var GAME_SAVE_KEY = "nordhaven-save-v3";
  var ENEMY_ATTACK_SPEED_MIN = 0.2;
  var ENEMY_ATTACK_SPEED_MAX = 8;

  var MAX_ICON_BYTES = 400 * 1024;
  var MAX_SOUND_BYTES = 500 * 1024;
  var SOUND_KEYS = ["buttonClick", "villageButton", "equip", "unequip"];
  var NAV_ICON_KEYS = ["inventory", "shop", "forge", "inn", "map", "gold"];
  var CURSOR_KEYS = ["default", "inventory", "shop", "forge", "inn", "map"];
  var VILLAGE_ART_KEYS = ["Nordhaven", "Corberoc", "Fort-Aube"];
  var SKILL_EDITOR_DEFS = [
    { id: "oneHanded", label: "Arme a une main", hint: "Monte quand tu frappes en combat avec une arme de poing ou de main." },
    { id: "twoHanded", label: "Arme a deux mains", hint: "Monte avec les armes lourdes et lentes." },
    { id: "archery", label: "Tir a l'arc", hint: "Monte avec arcs et armes de trait." },
    { id: "destruction", label: "Destruction", hint: "Monte en lançant des sorts offensifs (ex. boule de feu)." },
    { id: "restoration", label: "Soins", hint: "Monte en lançant des soins ; augmente legerement leur efficacite." },
    { id: "speech", label: "Charisme", hint: "Monte en achetant au marchand ; reduit les prix et augmente l'or des quetes." }
  ];

  var cat =
    typeof NORDHAVEN_CATALOG !== "undefined"
      ? NORDHAVEN_CATALOG
      : { SHOP_ITEMS: [], RACES: [], QUESTS_REF: [] };

  var els = {};
  var weaponIconDataUrl = "";
  var itemIconDataUrl = "";
  var spellIconDataUrl = "";
  var armorIconDataUrl = "";
  var monsterIconDataUrl = "";
  var raceExtraIconBuffer = "";
  var SERVER_EDITOR_KEYS = [
    STORAGE_WEAPONS,
    STORAGE_ITEMS,
    STORAGE_SPELLS,
    STORAGE_ARMORS,
    STORAGE_RACE_ICONS,
    STORAGE_RACES_EXTRA,
    STORAGE_NAV_ICONS,
    STORAGE_SKILLS_THEME,
    STORAGE_SKILLS,
    STORAGE_CURSORS,
    STORAGE_SOUNDS,
    STORAGE_VILLAGE_ART,
    STORAGE_MONSTERS,
    STORAGE_QUESTS
  ];
  var syncTimer = 0;

  function readStorageJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStorageJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      scheduleServerSync();
    } catch (_) {}
  }

  function collectEditorSnapshot() {
    var out = {};
    SERVER_EDITOR_KEYS.forEach(function (key) {
      var parsed = readStorageJson(key, null);
      if (parsed !== null && parsed !== undefined) out[key] = parsed;
    });
    return out;
  }

  function scheduleServerSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      pushEditorSnapshotToServer();
    }, 300);
  }

  function pushEditorSnapshotToServer() {
    var payload = collectEditorSnapshot();
    return fetch("/api/editor-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: payload })
    }).catch(function () {});
  }

  function hydrateFromServer() {
    return fetch("/api/editor-config", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("http_" + res.status);
        return res.json();
      })
      .then(function (body) {
        var data = body && body.data && typeof body.data === "object" ? body.data : {};
        SERVER_EDITOR_KEYS.forEach(function (key) {
          if (!Object.prototype.hasOwnProperty.call(data, key)) return;
          localStorage.setItem(key, JSON.stringify(data[key]));
        });
      })
      .catch(function () {});
  }

  function isAllowedIconDataUrl(s) {
    return (
      typeof s === "string" &&
      s.length < 450000 &&
      /^data:image\/(png|jpe?g|webp|gif);base64,/.test(s)
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg, isError) {
    els.toast.textContent = msg;
    els.toast.classList.toggle("editor-toast--error", !!isError);
    els.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      els.toast.hidden = true;
    }, 2600);
  }

  function resetLegacyQuestsMonstersOnce() {
    try {
      if (localStorage.getItem(LEGACY_RESET_MARKER) === "1") return;
      writeStorageJson(STORAGE_MONSTERS, []);
      writeStorageJson(STORAGE_QUESTS, []);
      localStorage.setItem(LEGACY_RESET_MARKER, "1");
    } catch (_) {}
  }

  function loadWeapons() {
    try {
      var raw = localStorage.getItem(STORAGE_WEAPONS);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveWeapons(list) {
    writeStorageJson(STORAGE_WEAPONS, list);
  }

  function loadItems() {
    try {
      var raw = localStorage.getItem(STORAGE_ITEMS);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function loadSpells() {
    try {
      var raw = localStorage.getItem(STORAGE_SPELLS);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (x) { return x && x.id; }) : [];
    } catch (_) {
      return [];
    }
  }

  function saveSpells(list) {
    writeStorageJson(STORAGE_SPELLS, list);
  }

  function saveItems(list) {
    writeStorageJson(STORAGE_ITEMS, list);
  }

  function loadArmors() {
    try {
      var raw = localStorage.getItem(STORAGE_ARMORS);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveArmors(list) {
    writeStorageJson(STORAGE_ARMORS, list);
  }

  function loadRaceIcons() {
    try {
      var raw = localStorage.getItem(STORAGE_RACE_ICONS);
      var o = raw ? JSON.parse(raw) : null;
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function saveRaceIcons(obj) {
    writeStorageJson(STORAGE_RACE_ICONS, obj);
  }

  function loadRacesExtra() {
    try {
      var raw = localStorage.getItem(STORAGE_RACES_EXTRA);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveRacesExtra(list) {
    writeStorageJson(STORAGE_RACES_EXTRA, list);
  }

  function loadNavIcons() {
    try {
      var raw = localStorage.getItem(STORAGE_NAV_ICONS);
      var o = raw ? JSON.parse(raw) : null;
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function saveNavIcons(obj) {
    writeStorageJson(STORAGE_NAV_ICONS, obj);
  }

  function loadSkillsTheme() {
    try {
      var raw = localStorage.getItem(STORAGE_SKILLS_THEME);
      var o = raw ? JSON.parse(raw) : null;
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function saveSkillsTheme(obj) {
    writeStorageJson(STORAGE_SKILLS_THEME, obj);
  }

  function loadSkillsEditorConfig() {
    try {
      var raw = localStorage.getItem(STORAGE_SKILLS);
      var o = raw ? JSON.parse(raw) : null;
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function saveSkillsEditorConfig(obj) {
    writeStorageJson(STORAGE_SKILLS, obj);
  }

  function loadCursors() {
    try {
      var raw = localStorage.getItem(STORAGE_CURSORS);
      var o = raw ? JSON.parse(raw) : null;
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function saveCursors(obj) {
    writeStorageJson(STORAGE_CURSORS, obj);
  }

  function loadSounds() {
    try {
      var raw = localStorage.getItem(STORAGE_SOUNDS);
      var o = raw ? JSON.parse(raw) : null;
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function saveSounds(obj) {
    writeStorageJson(STORAGE_SOUNDS, obj);
  }

  function isAllowedAudioDataUrl(s) {
    return (
      typeof s === "string" &&
      s.length < 700000 &&
      /^data:audio\/[a-z0-9.+-]+;base64,/i.test(s)
    );
  }

  function loadVillageArt() {
    try {
      var raw = localStorage.getItem(STORAGE_VILLAGE_ART);
      var o = raw ? JSON.parse(raw) : null;
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function saveVillageArt(obj) {
    writeStorageJson(STORAGE_VILLAGE_ART, obj);
  }

  function normalizeWeapon(raw, iconDataUrl) {
    var mn = Math.max(0, Math.floor(Number(raw.atkMin) || 0));
    var mx = Math.max(0, Math.floor(Number(raw.atkMax) || 0));
    if (mx < mn) {
      var t = mn;
      mn = mx;
      mx = t;
    }
    var r = raw.rarity;
    if (r !== "common" && r !== "rare" && r !== "epic") r = "common";
    var spd = Number(raw.attackSpeed);
    if (!isFinite(spd)) spd = 1;
    spd = Math.round(Math.min(3, Math.max(0.3, spd)) * 10) / 10;
    var out = {
      id: String(raw.id || "").trim().slice(0, 48),
      name: String(raw.name || "Arme").trim().slice(0, 48),
      cost: Math.max(1, Math.floor(Number(raw.cost) || 10)),
      kind: "weapon",
      atkMin: mn,
      atkMax: Math.max(mn, mx),
      attackSpeed: spd,
      rarity: r
    };
    var ic = typeof iconDataUrl === "string" && isAllowedIconDataUrl(iconDataUrl) ? iconDataUrl : "";
    if (ic) out.iconDataUrl = ic;
    return out;
  }

  function normalizeItem(raw, iconDataUrl) {
    var kind = raw.kind;
    if (kind !== "consumable" && kind !== "spellbook") return null;
    var r = raw.rarity;
    if (r !== "common" && r !== "rare" && r !== "epic") r = "common";
    var id = String(raw.id || "").trim().slice(0, 48) || "edit_item";
    var name = String(raw.name || "Objet").trim().slice(0, 48);
    var cost = Math.max(1, Math.floor(Number(raw.cost) || 5));
    var ic = typeof iconDataUrl === "string" && isAllowedIconDataUrl(iconDataUrl) ? iconDataUrl : "";
    if (kind === "consumable") {
      var eff = raw.effect;
      if (eff !== "heal" && eff !== "mana" && eff !== "stamina") eff = "heal";
      var o = { id: id, name: name, cost: cost, kind: "consumable", effect: eff, rarity: r };
      if (ic) o.iconDataUrl = ic;
      return o;
    }
    var sp = String(raw.spellId || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32) || "heal";
    var o2 = { id: id, name: name, cost: cost, kind: "spellbook", spellId: sp, rarity: r };
    if (ic) o2.iconDataUrl = ic;
    return o2;
  }

  function normalizeSpell(raw, iconDataUrl) {
    var id = String(raw.id || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32);
    if (!id) return null;
    var effect = raw.effect === "heal" ? "heal" : "damage";
    var scale = String(raw.scaleAttr || "intelligence");
    if (scale !== "intelligence" && scale !== "vitalite" && scale !== "endurance" && scale !== "none") scale = "intelligence";
    var skillId = String(raw.skillId || "none");
    if (skillId !== "destruction" && skillId !== "restoration" && skillId !== "none") skillId = "none";
    var mn = Math.max(1, Math.floor(Number(raw.powerMin) || 1));
    var mx = Math.max(mn, Math.floor(Number(raw.powerMax) || mn));
    var out = {
      id: id,
      name: String(raw.name || id).trim().slice(0, 48),
      description: String(raw.description || "").trim().slice(0, 220),
      manaCost: Math.max(0, Math.floor(Number(raw.manaCost) || 0)),
      effect: effect,
      powerMin: mn,
      powerMax: mx,
      scaleAttr: scale,
      skillId: skillId,
      xpGain: Math.max(0, Math.floor(Number(raw.xpGain) || 0)),
      glyph: String(raw.glyph || "✦").trim().slice(0, 2)
    };
    var ic = typeof iconDataUrl === "string" && isAllowedIconDataUrl(iconDataUrl) ? iconDataUrl : "";
    if (ic) out.iconDataUrl = ic;
    return out;
  }

  function normalizeArmor(raw, iconDataUrl) {
    var r = raw.rarity;
    if (r !== "common" && r !== "rare" && r !== "epic") r = "common";
    var out = {
      id: String(raw.id || "").trim().slice(0, 48) || "edit_armor",
      name: String(raw.name || "Armure").trim().slice(0, 48),
      cost: Math.max(1, Math.floor(Number(raw.cost) || 15)),
      kind: "armor",
      slot: raw.slot === "necklace" ? "necklace" : "armor",
      vitalite: Math.max(0, Math.floor(Number(raw.vitalite) || 0)),
      magie: Math.max(0, Math.floor(Number(raw.magie) || 0)),
      endurance: Math.max(0, Math.floor(Number(raw.endurance) || 0)),
      defense: Math.max(0, Math.floor(Number(raw.defense) || 0)),
      rarity: r
    };
    var ic = typeof iconDataUrl === "string" && isAllowedIconDataUrl(iconDataUrl) ? iconDataUrl : "";
    if (ic) out.iconDataUrl = ic;
    return out;
  }

  function normalizeRaceExtra(raw, iconDataUrl) {
    var id = String(raw.id || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 32);
    if (!id) return null;
    var out = {
      id: id,
      label: String(raw.label || "Race").slice(0, 48),
      vit: Math.max(-3, Math.min(5, Math.floor(Number(raw.vit) || 0))),
      int: Math.max(-3, Math.min(5, Math.floor(Number(raw.int) || 0))),
      end: Math.max(-3, Math.min(5, Math.floor(Number(raw.end) || 0))),
      def: Math.max(-3, Math.min(5, Math.floor(Number(raw.def) || 0)))
    };
    var ic = typeof iconDataUrl === "string" && isAllowedIconDataUrl(iconDataUrl) ? iconDataUrl : "";
    if (ic) out.iconDataUrl = ic;
    return out;
  }

  function readFileAsIcon(inputEl, cb) {
    var f = inputEl.files && inputEl.files[0];
    if (!f) return;
    if (f.size > MAX_ICON_BYTES) {
      showToast("Image trop lourde (max. ~400 Ko).", true);
      inputEl.value = "";
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var result = reader.result;
      if (typeof result === "string" && isAllowedIconDataUrl(result)) cb(result);
      else {
        showToast("Format non pris en charge (PNG, JPEG, WebP, GIF).", true);
        cb("");
      }
      inputEl.value = "";
    };
    reader.onerror = function () {
      showToast("Lecture du fichier impossible.", true);
    };
    reader.readAsDataURL(f);
  }

  function readFileAsSound(inputEl, cb) {
    var f = inputEl.files && inputEl.files[0];
    if (!f) return;
    if (f.size > MAX_SOUND_BYTES) {
      showToast("Fichier audio trop lourd (max. ~500 Ko).", true);
      inputEl.value = "";
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var result = reader.result;
      if (typeof result === "string" && isAllowedAudioDataUrl(result)) cb(result);
      else {
        showToast("Format audio non pris en charge (MP3, OGG, WAV, WebM...).", true);
        cb("");
      }
      inputEl.value = "";
    };
    reader.onerror = function () {
      showToast("Lecture du fichier impossible.", true);
    };
    reader.readAsDataURL(f);
  }

  function bindTabs() {
    document.querySelectorAll("[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tab = btn.getAttribute("data-tab");
        document.querySelectorAll(".editor-panels").forEach(function (p) {
          p.hidden = p.id !== "panel-" + tab;
        });
        document.querySelectorAll("[data-tab]").forEach(function (b) {
          b.classList.toggle("editor-nav__pill--active", b === btn);
        });
      });
    });
  }

  function renderBaseWeapons() {
    var list = (cat.SHOP_ITEMS || []).filter(function (x) {
      return x.kind === "weapon";
    });
    els.baseWeaponList.innerHTML = list.length
      ? list
          .map(function (w) {
            return (
              '<li class="ref-list__item">' +
              '<span class="ref-list__name">' +
              escapeHtml(w.name) +
              "</span>" +
              '<span class="ref-list__meta muted">' +
              escapeHtml(w.id) +
              " · " +
              w.atkMin +
              "–" +
              w.atkMax +
              " · " +
              w.cost +
              " or</span>" +
              "</li>"
            );
          })
          .join("")
      : '<li class="ref-list__empty muted">Aucune entrée dans le catalogue.</li>';
  }

  function renderBaseItems() {
    var list = (cat.SHOP_ITEMS || []).filter(function (x) {
      return x.kind === "consumable" || x.kind === "spellbook";
    });
    els.baseItemList.innerHTML = list.length
      ? list
          .map(function (it) {
            var extra =
              it.kind === "spellbook"
                ? "grimoire · " + (it.spellId || "")
                : "effet · " + (it.effect || "");
            return (
              '<li class="ref-list__item">' +
              '<span class="ref-list__name">' +
              escapeHtml(it.name) +
              "</span>" +
              '<span class="ref-list__meta muted">' +
              escapeHtml(it.id) +
              " · " +
              extra +
              " · " +
              it.cost +
              " or</span>" +
              "</li>"
            );
          })
          .join("")
      : '<li class="ref-list__empty muted">—</li>';
  }

  function renderBaseArmors() {
    var list = (cat.SHOP_ITEMS || []).filter(function (x) {
      return x.kind === "armor";
    });
    els.baseArmorList.innerHTML = list.length
      ? list
          .map(function (a) {
            return (
              '<li class="ref-list__item">' +
              '<span class="ref-list__name">' +
              escapeHtml(a.name) +
              "</span>" +
              '<span class="ref-list__meta muted">' +
              escapeHtml(a.id) +
              " · DEF " +
              (a.defense || 0) +
              " · " +
              a.cost +
              " or</span>" +
              "</li>"
            );
          })
          .join("")
      : '<li class="ref-list__empty muted">—</li>';
  }

  function renderWeaponList() {
    var items = loadWeapons().filter(function (w) {
      return w && w.kind === "weapon";
    });
    if (!items.length) {
      els.weaponList.innerHTML = '<li class="weapon-list__empty">Aucune arme personnalisée.</li>';
      return;
    }
    els.weaponList.innerHTML = items
      .map(function (w) {
        var thumb =
          w.iconDataUrl && isAllowedIconDataUrl(w.iconDataUrl)
            ? '<div class="weapon-item__thumb"><img src="' + w.iconDataUrl + '" alt="" /></div>'
            : '<div class="weapon-item__thumb weapon-item__thumb--empty" aria-hidden="true"></div>';
        return (
          '<li class="weapon-item">' +
          thumb +
          '<div class="weapon-item__col">' +
          '<div class="weapon-item__main">' +
          '<span class="weapon-item__name">' +
          escapeHtml(w.name) +
          "</span>" +
          '<span class="weapon-item__id muted">' +
          escapeHtml(w.id) +
          "</span>" +
          "</div>" +
          '<div class="weapon-item__stats muted">' +
          "Dégâts " +
          w.atkMin +
          " – " +
          w.atkMax +
          " · vit. " +
          (typeof w.attackSpeed === "number" ? w.attackSpeed : 1) +
          " · " +
          w.cost +
          " or · " +
          w.rarity +
          "</div>" +
          '<div class="weapon-item__actions">' +
          '<button type="button" class="btn btn-sm weapon-edit" data-id="' +
          escapeHtml(w.id) +
          '">Modifier</button>' +
          '<button type="button" class="btn btn-sm weapon-del" data-id="' +
          escapeHtml(w.id) +
          '">Supprimer</button>' +
          "</div>" +
          "</div>" +
          "</li>"
        );
      })
      .join("");

    els.weaponList.querySelectorAll(".weapon-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openWeaponForm(btn.getAttribute("data-id"));
      });
    });
    els.weaponList.querySelectorAll(".weapon-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        if (!confirm("Supprimer cette arme ?")) return;
        saveWeapons(loadWeapons().filter(function (w) {
          return w.id !== id;
        }));
        showToast("Arme supprimée.");
        renderWeaponList();
        if (els.wId.value === id) resetWeaponForm(true);
      });
    });
  }

  function updateWeaponIconPreview() {
    els.wIconPreviewFrame.innerHTML = "";
    if (weaponIconDataUrl && isAllowedIconDataUrl(weaponIconDataUrl)) {
      var img = document.createElement("img");
      img.className = "weapon-icon-preview__img";
      img.src = weaponIconDataUrl;
      img.alt = "";
      els.wIconPreviewFrame.appendChild(img);
      els.wIconPreviewWrap.hidden = false;
    } else {
      els.wIconPreviewWrap.hidden = true;
    }
  }

  function resetWeaponForm(hidePanel) {
    els.weaponForm.reset();
    els.wId.value = "";
    els.wCost.value = "20";
    els.wAtkMin.value = "1";
    els.wAtkMax.value = "3";
    if (els.wAtkSpeed) els.wAtkSpeed.value = "1";
    els.wRarity.value = "common";
    weaponIconDataUrl = "";
    if (els.wIconFile) els.wIconFile.value = "";
    updateWeaponIconPreview();
    els.formHeading.textContent = "Nouvelle arme";
    els.btnCancel.hidden = true;
    if (hidePanel) els.weaponFormSection.hidden = true;
  }

  function openWeaponForm(id) {
    els.weaponFormSection.hidden = false;
    els.btnCancel.hidden = false;
    if (!id) {
      resetWeaponForm(false);
      els.wName.value = "";
      els.wName.focus();
      els.formHeading.textContent = "Nouvelle arme";
      return;
    }
    var w = loadWeapons().find(function (x) {
      return x.id === id;
    });
    if (!w) return showToast("Arme introuvable.", true);
    els.formHeading.textContent = "Modifier — " + w.name;
    els.wId.value = w.id;
    els.wName.value = w.name;
    els.wCost.value = String(w.cost);
    els.wAtkMin.value = String(w.atkMin);
    els.wAtkMax.value = String(w.atkMax);
    if (els.wAtkSpeed) els.wAtkSpeed.value = String(typeof w.attackSpeed === "number" ? w.attackSpeed : 1);
    els.wRarity.value = w.rarity || "common";
    weaponIconDataUrl = w.iconDataUrl && isAllowedIconDataUrl(w.iconDataUrl) ? w.iconDataUrl : "";
    if (els.wIconFile) els.wIconFile.value = "";
    updateWeaponIconPreview();
  }

  function renderItemList() {
    var items = loadItems();
    if (!items.length) {
      els.itemList.innerHTML = '<li class="weapon-list__empty">Aucun objet personnalisé.</li>';
      return;
    }
    els.itemList.innerHTML = items
      .map(function (it) {
        var sub = it.kind === "spellbook" ? it.spellId : it.effect;
        var thumb =
          it.iconDataUrl && isAllowedIconDataUrl(it.iconDataUrl)
            ? '<div class="weapon-item__thumb"><img src="' + it.iconDataUrl + '" alt="" /></div>'
            : '<div class="weapon-item__thumb weapon-item__thumb--empty"></div>';
        return (
          '<li class="weapon-item">' +
          thumb +
          '<div class="weapon-item__col">' +
          '<div class="weapon-item__main">' +
          '<span class="weapon-item__name">' +
          escapeHtml(it.name) +
          "</span>" +
          '<span class="weapon-item__id muted">' +
          escapeHtml(it.id) +
          "</span></div>" +
          '<div class="weapon-item__stats muted">' +
          it.kind +
          " · " +
          sub +
          " · " +
          it.cost +
          " or</div>" +
          '<div class="weapon-item__actions">' +
          '<button type="button" class="btn btn-sm item-edit" data-id="' +
          escapeHtml(it.id) +
          '">Modifier</button>' +
          '<button type="button" class="btn btn-sm item-del" data-id="' +
          escapeHtml(it.id) +
          '">Supprimer</button>' +
          "</div></div></li>"
        );
      })
      .join("");

    els.itemList.querySelectorAll(".item-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openItemForm(btn.getAttribute("data-id"));
      });
    });
    els.itemList.querySelectorAll(".item-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        if (!confirm("Supprimer cet objet ?")) return;
        saveItems(loadItems().filter(function (x) {
          return x.id !== id;
        }));
        showToast("Objet supprimé.");
        renderItemList();
        if (els.itId.value === id) resetItemForm(true);
      });
    });
  }

  function toggleItemKindFields() {
    var isSpell = els.itKind.value === "spellbook";
    els.itEffectWrap.hidden = isSpell;
    els.itSpellWrap.hidden = !isSpell;
    if (isSpell) {
      refreshSpellSelectOptions();
      if (!els.itSpell.value) els.itSpell.value = "heal";
    } else {
      if (!els.itEffect.value) els.itEffect.value = "heal";
    }
  }

  function refreshSpellSelectOptions() {
    if (!els.itSpell) return;
    var defaults = [
      { id: "heal", name: "Guerison" },
      { id: "fireball", name: "Boule de feu" }
    ];
    var map = {};
    defaults.forEach(function (s) { map[s.id] = s.name; });
    loadSpells().forEach(function (s) {
      map[String(s.id)] = String(s.name || s.id);
    });
    var current = els.itSpell.value;
    var keys = Object.keys(map).sort(function (a, b) { return a.localeCompare(b, "fr"); });
    els.itSpell.innerHTML = keys.map(function (id) {
      return '<option value="' + escapeHtml(id) + '">' + escapeHtml(map[id]) + "</option>";
    }).join("");
    els.itSpell.value = map[current] ? current : "heal";
  }

  function updateItemIconPreview() {
    els.itIconPreviewFrame.innerHTML = "";
    if (itemIconDataUrl && isAllowedIconDataUrl(itemIconDataUrl)) {
      var img = document.createElement("img");
      img.className = "weapon-icon-preview__img";
      img.src = itemIconDataUrl;
      els.itIconPreviewFrame.appendChild(img);
      els.itIconPreviewWrap.hidden = false;
    } else {
      els.itIconPreviewWrap.hidden = true;
    }
  }

  function resetItemForm(hide) {
    els.itemForm.reset();
    els.itId.value = "";
    itemIconDataUrl = "";
    if (els.itIconFile) els.itIconFile.value = "";
    updateItemIconFields();
    toggleItemKindFields();
    updateItemIconPreview();
    els.itemFormTitle.textContent = "Objet";
    els.btnCancelItem.hidden = true;
    if (hide) els.itemFormSection.hidden = true;
  }

  function updateItemIconFields() {
    els.itIdInput.readOnly = false;
    els.itIdInput.classList.remove("field__input--locked");
  }

  function openItemForm(id) {
    els.itemFormSection.hidden = false;
    els.btnCancelItem.hidden = false;
    if (!id) {
      resetItemForm(false);
      els.itIdInput.value = "";
      els.itName.value = "";
      els.itCost.value = "12";
      els.itKind.value = "consumable";
      els.itEffect.value = "heal";
      refreshSpellSelectOptions();
      els.itSpell.value = "heal";
      els.itRarity.value = "common";
      toggleItemKindFields();
      els.itemFormTitle.textContent = "Nouvel objet";
      return;
    }
    var it = loadItems().find(function (x) {
      return x.id === id;
    });
    if (!it) return showToast("Objet introuvable.", true);
    els.itemFormTitle.textContent = "Modifier — " + it.name;
    els.itId.value = it.id;
    els.itIdInput.value = it.id;
    els.itIdInput.readOnly = true;
    els.itIdInput.classList.add("field__input--locked");
    els.itName.value = it.name;
    els.itCost.value = String(it.cost);
    els.itKind.value = it.kind;
    refreshSpellSelectOptions();
    if (it.kind === "spellbook") els.itSpell.value = it.spellId || "heal";
    else els.itEffect.value = it.effect || "heal";
    els.itRarity.value = it.rarity || "common";
    itemIconDataUrl = it.iconDataUrl && isAllowedIconDataUrl(it.iconDataUrl) ? it.iconDataUrl : "";
    if (els.itIconFile) els.itIconFile.value = "";
    toggleItemKindFields();
    updateItemIconPreview();
  }

  function updateSpellIconPreview() {
    els.spIconPreviewFrame.innerHTML = "";
    if (spellIconDataUrl && isAllowedIconDataUrl(spellIconDataUrl)) {
      var img = document.createElement("img");
      img.className = "weapon-icon-preview__img";
      img.src = spellIconDataUrl;
      els.spIconPreviewFrame.appendChild(img);
      els.spIconPreviewWrap.hidden = false;
    } else {
      els.spIconPreviewWrap.hidden = true;
    }
  }

  function resetSpellForm(hide) {
    els.spellForm.reset();
    els.spIdHidden.value = "";
    spellIconDataUrl = "";
    if (els.spIconFile) els.spIconFile.value = "";
    updateSpellIconPreview();
    els.spFormTitle.textContent = "Sort";
    els.btnCancelSpell.hidden = true;
    if (hide) els.spellFormSection.hidden = true;
  }

  function openSpellForm(id) {
    els.spellFormSection.hidden = false;
    els.btnCancelSpell.hidden = false;
    if (!id) {
      resetSpellForm(false);
      els.spId.value = "";
      els.spName.value = "";
      els.spDesc.value = "";
      els.spMana.value = "3";
      els.spEffect.value = "damage";
      els.spPMin.value = "10";
      els.spPMax.value = "14";
      els.spScale.value = "intelligence";
      els.spSkill.value = "destruction";
      els.spXp.value = "6";
      els.spGlyph.value = "✦";
      els.spFormTitle.textContent = "Nouveau sort";
      return;
    }
    var s = loadSpells().find(function (x) { return x.id === id; });
    if (!s) return showToast("Sort introuvable.", true);
    els.spFormTitle.textContent = "Modifier — " + s.name;
    els.spIdHidden.value = s.id;
    els.spId.value = s.id;
    els.spName.value = s.name || "";
    els.spDesc.value = s.description || "";
    els.spMana.value = String(s.manaCost || 0);
    els.spEffect.value = s.effect || "damage";
    els.spPMin.value = String(s.powerMin || 1);
    els.spPMax.value = String(s.powerMax || s.powerMin || 1);
    els.spScale.value = s.scaleAttr || "intelligence";
    els.spSkill.value = s.skillId || "none";
    els.spXp.value = String(s.xpGain || 0);
    els.spGlyph.value = s.glyph || "✦";
    spellIconDataUrl = s.iconDataUrl && isAllowedIconDataUrl(s.iconDataUrl) ? s.iconDataUrl : "";
    if (els.spIconFile) els.spIconFile.value = "";
    updateSpellIconPreview();
  }

  function renderSpellList() {
    var spells = loadSpells();
    if (!spells.length) {
      els.spellList.innerHTML = '<li class="weapon-list__empty">Aucun sort personnalisé.</li>';
      return;
    }
    els.spellList.innerHTML = spells.map(function (s) {
      var thumb =
        s.iconDataUrl && isAllowedIconDataUrl(s.iconDataUrl)
          ? '<div class="weapon-item__thumb"><img src="' + s.iconDataUrl + '" alt="" /></div>'
          : '<div class="weapon-item__thumb weapon-item__thumb--empty"></div>';
      return (
        '<li class="weapon-item">' + thumb +
        '<div class="weapon-item__col">' +
        '<div class="weapon-item__main"><span class="weapon-item__name">' + escapeHtml(s.name) + '</span><span class="weapon-item__id muted">' + escapeHtml(s.id) + "</span></div>" +
        '<div class="weapon-item__stats muted">' + escapeHtml(s.effect) + " · " + s.manaCost + " mana · " + s.powerMin + "-" + s.powerMax + "</div>" +
        '<div class="weapon-item__actions">' +
        '<button type="button" class="btn btn-sm spell-edit" data-id="' + escapeHtml(s.id) + '">Modifier</button>' +
        '<button type="button" class="btn btn-sm spell-del" data-id="' + escapeHtml(s.id) + '">Supprimer</button>' +
        "</div></div></li>"
      );
    }).join("");
    els.spellList.querySelectorAll(".spell-edit").forEach(function (btn) {
      btn.addEventListener("click", function () { openSpellForm(btn.getAttribute("data-id")); });
    });
    els.spellList.querySelectorAll(".spell-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        if (!confirm("Supprimer ce sort ?")) return;
        saveSpells(loadSpells().filter(function (s) { return s.id !== id; }));
        renderSpellList();
        refreshSpellSelectOptions();
        showToast("Sort supprime.");
      });
    });
  }

  function renderArmorList() {
    var items = loadArmors();
    if (!items.length) {
      els.armorList.innerHTML = '<li class="weapon-list__empty">Aucune armure personnalisée.</li>';
      return;
    }
    els.armorList.innerHTML = items
      .map(function (a) {
        var thumb =
          a.iconDataUrl && isAllowedIconDataUrl(a.iconDataUrl)
            ? '<div class="weapon-item__thumb"><img src="' + a.iconDataUrl + '" alt="" /></div>'
            : '<div class="weapon-item__thumb weapon-item__thumb--empty"></div>';
        return (
          '<li class="weapon-item">' +
          thumb +
          '<div class="weapon-item__col">' +
          '<div class="weapon-item__main">' +
          '<span class="weapon-item__name">' +
          escapeHtml(a.name) +
          "</span>" +
          '<span class="weapon-item__id muted">' +
          escapeHtml(a.id) +
          "</span></div>" +
          '<div class="weapon-item__stats muted">DEF ' +
          (a.defense || 0) +
          " · " +
          (a.slot === "necklace" ? "Collier" : "Armure") +
          " · " +
          a.cost +
          " or</div>" +
          '<div class="weapon-item__actions">' +
          '<button type="button" class="btn btn-sm armor-edit" data-id="' +
          escapeHtml(a.id) +
          '">Modifier</button>' +
          '<button type="button" class="btn btn-sm armor-del" data-id="' +
          escapeHtml(a.id) +
          '">Supprimer</button>' +
          "</div></div></li>"
        );
      })
      .join("");

    els.armorList.querySelectorAll(".armor-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openArmorForm(btn.getAttribute("data-id"));
      });
    });
    els.armorList.querySelectorAll(".armor-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        if (!confirm("Supprimer cette armure ?")) return;
        saveArmors(loadArmors().filter(function (x) {
          return x.id !== id;
        }));
        showToast("Armure supprimée.");
        renderArmorList();
        if (els.arId.value === id) resetArmorForm(true);
      });
    });
  }

  function updateArmorIconPreview() {
    els.arIconPreviewFrame.innerHTML = "";
    if (armorIconDataUrl && isAllowedIconDataUrl(armorIconDataUrl)) {
      var img = document.createElement("img");
      img.className = "weapon-icon-preview__img";
      img.src = armorIconDataUrl;
      els.arIconPreviewFrame.appendChild(img);
      els.arIconPreviewWrap.hidden = false;
    } else {
      els.arIconPreviewWrap.hidden = true;
    }
  }

  function resetArmorForm(hide) {
    els.armorForm.reset();
    els.arId.value = "";
    armorIconDataUrl = "";
    if (els.arIconFile) els.arIconFile.value = "";
    els.arIdInput.readOnly = false;
    els.arIdInput.classList.remove("field__input--locked");
    updateArmorIconPreview();
    els.armorFormTitle.textContent = "Armure";
    els.btnCancelArmor.hidden = true;
    if (hide) els.armorFormSection.hidden = true;
  }

  function openArmorForm(id) {
    els.armorFormSection.hidden = false;
    els.btnCancelArmor.hidden = false;
    if (!id) {
      resetArmorForm(false);
      els.arIdInput.value = "";
      els.arName.value = "";
      els.arCost.value = "25";
      els.arVit.value = "0";
      els.arMag.value = "0";
      els.arEnd.value = "0";
      els.arDef.value = "0";
      els.arRarity.value = "common";
      if (els.arSlot) els.arSlot.value = "armor";
      els.armorFormTitle.textContent = "Nouvelle armure";
      return;
    }
    var a = loadArmors().find(function (x) {
      return x.id === id;
    });
    if (!a) return showToast("Armure introuvable.", true);
    els.armorFormTitle.textContent = "Modifier — " + a.name;
    els.arId.value = a.id;
    els.arIdInput.value = a.id;
    els.arIdInput.readOnly = true;
    els.arIdInput.classList.add("field__input--locked");
    els.arName.value = a.name;
    els.arCost.value = String(a.cost);
    els.arVit.value = String(a.vitalite || 0);
    els.arMag.value = String(a.magie || 0);
    els.arEnd.value = String(a.endurance || 0);
    els.arDef.value = String(a.defense || 0);
    els.arRarity.value = a.rarity || "common";
    if (els.arSlot) els.arSlot.value = a.slot === "necklace" ? "necklace" : "armor";
    armorIconDataUrl = a.iconDataUrl && isAllowedIconDataUrl(a.iconDataUrl) ? a.iconDataUrl : "";
    if (els.arIconFile) els.arIconFile.value = "";
    updateArmorIconPreview();
  }

  function renderRaceBase() {
    var icons = loadRaceIcons();
    var races = cat.RACES || [];
    els.raceBaseTable.innerHTML = races
      .map(function (r) {
        var ic = icons[r.id] && isAllowedIconDataUrl(icons[r.id]) ? icons[r.id] : "";
        var thumb = ic
          ? '<div class="race-table__thumb"><img src="' + ic + '" alt=""/></div>'
          : '<div class="race-table__thumb race-table__thumb--empty"></div>';
        var bonus =
          "VIT " +
          (r.vit >= 0 ? "+" : "") +
          r.vit +
          " · INT " +
          (r.int >= 0 ? "+" : "") +
          r.int +
          " · END " +
          (r.end >= 0 ? "+" : "") +
          r.end +
          " · DEF " +
          (r.def >= 0 ? "+" : "") +
          r.def;
        return (
          '<div class="race-table__row" data-race-row="' +
          escapeHtml(r.id) +
          '">' +
          thumb +
          '<div class="race-table__info">' +
          "<strong>" +
          escapeHtml(r.label) +
          "</strong>" +
          '<span class="muted race-table__id">' +
          escapeHtml(r.id) +
          "</span>" +
          '<span class="race-table__bonus muted">' +
          escapeHtml(bonus) +
          "</span></div>" +
          '<div class="race-table__actions">' +
          '<input type="file" class="field__input race-icon-file" accept="image/png,image/jpeg,image/webp,image/gif" data-race-id="' +
          escapeHtml(r.id) +
          '" title="Choisir une image portrait" />' +
          (ic
            ? '<button type="button" class="btn btn-sm race-icon-rm" data-race-id="' +
              escapeHtml(r.id) +
              '">Retirer icône</button>'
            : "") +
          "</div></div>"
        );
      })
      .join("");

    els.raceBaseTable.querySelectorAll(".race-icon-file").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var rid = inp.getAttribute("data-race-id");
        readFileAsIcon(inp, function (dataUrl) {
          if (!dataUrl) return;
          var o = loadRaceIcons();
          o[rid] = dataUrl;
          saveRaceIcons(o);
          showToast("Icône enregistrée pour " + rid + ".");
          renderRaceBase();
        });
      });
    });
    els.raceBaseTable.querySelectorAll(".race-icon-rm").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var rid = btn.getAttribute("data-race-id");
        var o = loadRaceIcons();
        delete o[rid];
        saveRaceIcons(o);
        showToast("Icône retirée.");
        renderRaceBase();
      });
    });
  }

  function renderRaceExtraList() {
    var list = loadRacesExtra();
    if (!list.length) {
      els.raceExtraList.innerHTML = '<li class="weapon-list__empty">Aucune race ajoutée.</li>';
      return;
    }
    els.raceExtraList.innerHTML = list
      .map(function (r) {
        return (
          '<li class="weapon-item"><div class="weapon-item__col">' +
          '<div class="weapon-item__main">' +
          '<span class="weapon-item__name">' +
          escapeHtml(r.label) +
          "</span>" +
          '<span class="weapon-item__id muted">' +
          escapeHtml(r.id) +
          "</span></div>" +
          '<div class="weapon-item__stats muted">VIT ' +
          r.vit +
          " INT " +
          r.int +
          " END " +
          r.end +
          " DEF " +
          r.def +
          "</div>" +
          '<div class="weapon-item__actions">' +
          '<button type="button" class="btn btn-sm race-x-del" data-id="' +
          escapeHtml(r.id) +
          '">Supprimer</button>' +
          "</div></div></li>"
        );
      })
      .join("");

    els.raceExtraList.querySelectorAll(".race-x-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        if (!confirm("Supprimer cette race ?")) return;
        saveRacesExtra(
          loadRacesExtra().filter(function (x) {
            return x.id !== id;
          })
        );
        showToast("Race supprimée.");
        renderRaceExtraList();
      });
    });
  }

  function loadMonsters() {
    try {
      var raw = localStorage.getItem(STORAGE_MONSTERS);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveMonsters(list) {
    writeStorageJson(STORAGE_MONSTERS, list);
  }

  function loadQuests() {
    try {
      var raw = localStorage.getItem(STORAGE_QUESTS);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveQuests(list) {
    writeStorageJson(STORAGE_QUESTS, list);
  }

  function parseLootTable(text) {
    var rows = [];
    String(text || "")
      .split(/\r?\n/)
      .forEach(function (line) {
        var s = String(line || "").trim();
        if (!s) return;
        var parts = s.split(":");
        if (parts.length < 2) return;
        var name = String(parts[0] || "").trim().slice(0, 64);
        var weight = Math.max(0, Math.floor(Number(parts.slice(1).join(":")) || 0));
        if (!name || !weight) return;
        rows.push({ name: name, weight: weight });
      });
    rows = rows.slice(0, 12);
    if (!rows.length) return [];
    var total = rows.reduce(function (sum, r) { return sum + r.weight; }, 0);
    if (total <= 0) return [];
    var out = rows.map(function (r) {
      var exact = (r.weight * 100) / total;
      var base = Math.floor(exact);
      return { name: r.name, chance: base, frac: exact - base };
    });
    var used = out.reduce(function (sum, r) { return sum + r.chance; }, 0);
    var remaining = 100 - used;
    out.sort(function (a, b) { return b.frac - a.frac; });
    for (var i = 0; i < out.length && remaining > 0; i++) {
      out[i].chance += 1;
      remaining -= 1;
    }
    out.sort(function (a, b) { return a.name.localeCompare(b.name, "fr"); });
    return out.map(function (r) {
      return { name: r.name, chance: r.chance };
    });
  }

  function getAvailableLootItemNames() {
    var names = {};
    function addName(v) {
      var s = String(v || "").trim();
      if (!s) return;
      names[s] = true;
    }
    (cat.SHOP_ITEMS || []).forEach(function (it) { addName(it.name); });
    loadWeapons().forEach(function (it) { addName(it.name); });
    loadItems().forEach(function (it) { addName(it.name); });
    loadArmors().forEach(function (it) { addName(it.name); });
    return Object.keys(names).sort(function (a, b) { return a.localeCompare(b, "fr"); });
  }

  function renderLootScrollLists() {
    var names = getAvailableLootItemNames();
    function fill(selectEl) {
      if (!selectEl) return;
      if (!names.length) {
        selectEl.innerHTML = '<option value="">Aucun item cree</option>';
        return;
      }
      selectEl.innerHTML = names
        .map(function (n) {
          return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + "</option>";
        })
        .join("");
    }
    fill(els.moLootScroll);
    fill(els.quLootScroll);
  }

  function getAvailableQuestZones() {
    var zones = {
      Nordhaven: true,
      Corberoc: true,
      "Fort-Aube": true
    };
    (cat.QUESTS_REF || []).forEach(function (q) {
      if (q && q.targetZone) zones[String(q.targetZone).trim()] = true;
    });
    loadQuests().forEach(function (q) {
      if (q && q.targetZone) zones[String(q.targetZone).trim()] = true;
    });
    return Object.keys(zones)
      .filter(function (z) { return !!z; })
      .sort(function (a, b) { return a.localeCompare(b, "fr"); });
  }

  function getAvailableQuestMonsters() {
    var monsters = {};
    (cat.QUESTS_REF || []).forEach(function (q) {
      if (q && q.monster) monsters[String(q.monster).trim()] = true;
    });
    loadMonsters().forEach(function (m) {
      if (m && m.name) monsters[String(m.name).trim()] = true;
    });
    loadQuests().forEach(function (q) {
      if (q && q.monster) monsters[String(q.monster).trim()] = true;
    });
    return Object.keys(monsters)
      .filter(function (m) { return !!m; })
      .sort(function (a, b) { return a.localeCompare(b, "fr"); });
  }

  function renderQuestScrollLists() {
    function fill(selectEl, values, emptyLabel) {
      if (!selectEl) return;
      if (!values.length) {
        selectEl.innerHTML = '<option value="">' + escapeHtml(emptyLabel) + "</option>";
        return;
      }
      selectEl.innerHTML = values
        .map(function (v) {
          return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + "</option>";
        })
        .join("");
    }
    fill(els.quZoneScroll, getAvailableQuestZones(), "Aucune zone");
    fill(els.quMonsterScroll, getAvailableQuestMonsters(), "Aucun mob");
  }

  function normalizeMonster(raw, iconDataUrl) {
    var fixedId = String(raw.id || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 48);
    if (!fixedId) return null;
    var name = String(raw.name || "").trim().slice(0, 80);
    if (!name) return null;
    var atkMin = Math.max(1, Math.floor(Number(raw.atkMin) || 1));
    var atkMax = Math.max(1, Math.floor(Number(raw.atkMax) || 1));
    if (atkMax < atkMin) {
      var t = atkMin;
      atkMin = atkMax;
      atkMax = t;
    }
    var out = {
      id: fixedId,
      name: name,
      hp: Math.max(1, Math.floor(Number(raw.hp) || 1)),
      defense: Math.max(0, Math.floor(Number(raw.defense) || 0)),
      attackSpeed: Math.min(ENEMY_ATTACK_SPEED_MAX, Math.max(ENEMY_ATTACK_SPEED_MIN, Math.round((Number(raw.attackSpeed) || 1) * 10) / 10)),
      atkMin: atkMin,
      atkMax: atkMax,
      xp: Math.max(1, Math.floor(Number(raw.xp) || 20)),
      combatGold: Math.max(0, Math.floor(Number(raw.combatGold) || 0)),
      loot: String(raw.loot || "").trim().slice(0, 64),
      lootTable: parseLootTable(raw.lootTable || "")
    };
    var ic = typeof iconDataUrl === "string" && isAllowedIconDataUrl(iconDataUrl) ? iconDataUrl : "";
    if (ic) out.textureDataUrl = ic;
    return out;
  }

  function normalizeQuest(raw) {
    var fixedId = String(raw.id || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 48);
    if (!fixedId) return null;
    var out = {
      id: fixedId,
      title: String(raw.title || "").trim().slice(0, 80),
      giver: String(raw.giver || "").trim().slice(0, 64),
      giverVillage: String(raw.giverVillage || "Nordhaven").trim().slice(0, 40),
      targetZone: String(raw.targetZone || "").trim().slice(0, 64),
      monster: String(raw.monster || "").trim().slice(0, 80),
      enemyCount: Math.max(1, Math.min(20, Math.floor(Number(raw.enemyCount) || 1))),
      repeatable: !!raw.repeatable,
      rewardGold: Math.max(0, Math.floor(Number(raw.rewardGold) || 0)),
      rewardItem: String(raw.rewardItem || "").trim().slice(0, 64),
      description: String(raw.description || "").trim().slice(0, 280)
    };
    if (!out.title || !out.giver || !out.targetZone || !out.monster) return null;
    return out;
  }

  function renderBaseMonsters() {
    if (!els.baseMonsterList) return;
    var allQ = [].concat(cat.QUESTS_REF || []);
    var map = {};
    allQ.forEach(function (q) {
      if (!q || !q.monster) return;
      map[q.monster] = true;
    });
    var names = Object.keys(map).sort();
    els.baseMonsterList.innerHTML = names.length
      ? names
          .map(function (n) {
            return '<li class="ref-list__item"><span class="ref-list__name">' + escapeHtml(n) + "</span></li>";
          })
          .join("")
      : '<li class="ref-list__empty muted">Aucune entrée.</li>';
  }

  function renderMonsterList() {
    if (!els.monsterList) return;
    var list = loadMonsters();
    if (!list.length) {
      els.monsterList.innerHTML = '<li class="weapon-list__empty">Aucun monstre personnalisé.</li>';
      return;
    }
    els.monsterList.innerHTML = list
      .map(function (m) {
        var name = String(m.name || "").trim() || m.id;
        var thumb =
          m.textureDataUrl && isAllowedIconDataUrl(m.textureDataUrl)
            ? '<div class="weapon-item__thumb"><img src="' + m.textureDataUrl + '" alt="" /></div>'
            : '<div class="weapon-item__thumb weapon-item__thumb--empty"></div>';
        return (
          '<li class="weapon-item">' +
          thumb +
          '<div class="weapon-item__col">' +
          '<div class="weapon-item__main"><span class="weapon-item__name">' +
          escapeHtml(name) +
          '</span><span class="weapon-item__id muted">' +
          escapeHtml(m.id || "") +
          "</span></div>" +
          '<div class="weapon-item__stats muted">HP ' +
          (m.hp || 1) +
          " · DEF " +
          (m.defense || 0) +
          " · DGT " +
          (m.atkMin || 3) +
          "-" +
          (m.atkMax || 8) +
          " · Vit. " +
          (m.attackSpeed || 1) +
          " · XP " +
          (m.xp || 20) +
          " · Or " +
          (m.combatGold || 0) +
          "</div>" +
          '<div class="weapon-item__actions"><button type="button" class="btn btn-sm monster-edit" data-id="' +
          escapeHtml(m.id || "") +
          '">Modifier</button><button type="button" class="btn btn-sm weapon-del monster-del" data-id="' +
          escapeHtml(m.id || "") +
          '">Supprimer</button></div></div></li>'
        );
      })
      .join("");

    els.monsterList.querySelectorAll(".monster-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openMonsterForm(btn.getAttribute("data-id"));
      });
    });
    els.monsterList.querySelectorAll(".monster-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        if (!confirm("Supprimer ce monstre ?")) return;
        saveMonsters(loadMonsters().filter(function (m) { return m.id !== id; }));
        showToast("Monstre supprimé.");
        renderMonsterList();
      });
    });
  }

  function updateMonsterIconPreview() {
    els.moIconPreviewFrame.innerHTML = "";
    if (monsterIconDataUrl && isAllowedIconDataUrl(monsterIconDataUrl)) {
      var img = document.createElement("img");
      img.className = "weapon-icon-preview__img";
      img.src = monsterIconDataUrl;
      img.alt = "";
      els.moIconPreviewFrame.appendChild(img);
      els.moIconPreviewWrap.hidden = false;
    } else {
      els.moIconPreviewWrap.hidden = true;
    }
  }

  function resetMonsterForm(hide) {
    els.monsterForm.reset();
    els.moIdHidden.value = "";
    els.moIdInput.readOnly = false;
    els.moIdInput.classList.remove("field__input--locked");
    monsterIconDataUrl = "";
    if (els.moIconFile) els.moIconFile.value = "";
    updateMonsterIconPreview();
    updateMonsterSimulationPreview();
    els.monsterFormTitle.textContent = "Monstre";
    els.btnCancelMonster.hidden = true;
    if (hide) els.monsterFormSection.hidden = true;
  }

  function openMonsterForm(id) {
    els.monsterFormSection.hidden = false;
    els.btnCancelMonster.hidden = false;
    if (!id) {
      resetMonsterForm(false);
      els.moIdInput.value = "";
      els.moName.value = "";
      els.moHp.value = "24";
      els.moDefense.value = "1";
      els.moAtkSpeed.value = "1";
      els.moAtkMin.value = "3";
      els.moAtkMax.value = "8";
      els.moXp.value = "20";
      els.moGold.value = "12";
      els.moLoot.value = "";
      els.moLootTable.value = "";
      els.monsterFormTitle.textContent = "Nouveau monstre";
      updateMonsterSimulationPreview();
      return;
    }
    var m = loadMonsters().find(function (x) { return x.id === id; });
    if (!m) return showToast("Monstre introuvable.", true);
    els.moIdHidden.value = m.id;
    els.moIdInput.value = m.id;
    els.moIdInput.readOnly = true;
    els.moIdInput.classList.add("field__input--locked");
    els.moName.value = m.name || "";
    els.moHp.value = String(m.hp || 24);
    els.moDefense.value = String(m.defense || 0);
    els.moAtkSpeed.value = String(m.attackSpeed || 1);
    els.moAtkMin.value = String(m.atkMin || 3);
    els.moAtkMax.value = String(m.atkMax || 8);
    els.moXp.value = String(m.xp || 20);
    els.moGold.value = String(m.combatGold || 0);
    els.moLoot.value = m.loot || "";
    els.moLootTable.value = Array.isArray(m.lootTable)
      ? m.lootTable
          .map(function (r) {
            return String(r.name || "").trim() + ":" + Math.max(1, Math.min(100, Math.floor(Number(r.chance) || 0)));
          })
          .join("\n")
      : "";
    monsterIconDataUrl = m.textureDataUrl && isAllowedIconDataUrl(m.textureDataUrl) ? m.textureDataUrl : "";
    updateMonsterIconPreview();
    updateMonsterSimulationPreview();
    els.monsterFormTitle.textContent = "Modifier — " + m.name;
  }

  function updateMonsterSimulationPreview() {
    if (!els.monsterSimText) return;
    var hp = Math.max(1, Math.floor(Number(els.moHp.value) || 1));
    var def = Math.max(0, Math.floor(Number(els.moDefense.value) || 0));
    var spd = Math.min(ENEMY_ATTACK_SPEED_MAX, Math.max(ENEMY_ATTACK_SPEED_MIN, Number(els.moAtkSpeed.value) || 1));
    var atkMin = Math.max(1, Math.floor(Number(els.moAtkMin.value) || 1));
    var atkMax = Math.max(atkMin, Math.floor(Number(els.moAtkMax.value) || atkMin));
    var xp = Math.max(1, Math.floor(Number(els.moXp.value) || 1));
    var gold = Math.max(0, Math.floor(Number(els.moGold.value) || 0));
    var estThreat = Math.max(1, Math.round((hp * (1 + def * 0.08) * spd) / 10));
    var lootRows = parseLootTable(els.moLootTable ? els.moLootTable.value : "");
    var lootText = lootRows.length
      ? lootRows
          .map(function (r) {
            return r.name + " (" + r.chance + "%)";
          })
          .join(", ")
      : (els.moLoot.value.trim() ? els.moLoot.value.trim() + " (loot fixe)" : "aucun");
    els.monsterSimText.textContent =
      "Menace estimee " +
      estThreat +
      " | HP " +
      hp +
      " | DEF " +
      def +
      " | Vit. " +
      spd.toFixed(1) +
      " | DGT " +
      atkMin +
      "-" +
      atkMax +
      " | XP " +
      xp +
      " | Or " +
      gold +
      " | Loot: " +
      lootText;
  }

  function renderBaseQuests() {
    if (!els.baseQuestList) return;
    var quests = Array.isArray(cat.QUESTS_REF) ? cat.QUESTS_REF : [];
    els.baseQuestList.innerHTML = quests.length
      ? quests
          .map(function (q) {
            return (
              '<li class="ref-list__item"><span class="ref-list__name">' +
              escapeHtml(q.title || q.id) +
              '</span><span class="ref-list__meta muted">' +
              escapeHtml(q.id || "") +
              " · " +
              escapeHtml(q.monster || "") +
              "</span></li>"
            );
          })
          .join("")
      : '<li class="ref-list__empty muted">Aucune quête.</li>';
  }

  function renderQuestList() {
    if (!els.questList) return;
    var quests = loadQuests();
    if (!quests.length) {
      els.questList.innerHTML = '<li class="weapon-list__empty">Aucune quête personnalisée.</li>';
      return;
    }
    els.questList.innerHTML = quests
      .map(function (q) {
        return (
          '<li class="weapon-item"><div class="weapon-item__col">' +
          '<div class="weapon-item__main"><span class="weapon-item__name">' +
          escapeHtml(q.title) +
          '</span><span class="weapon-item__id muted">' +
          escapeHtml(q.id) +
          "</span></div>" +
          '<div class="weapon-item__stats muted">' +
          escapeHtml(q.giverVillage) +
          " · " +
          escapeHtml(q.monster) +
          " · x" +
          (q.enemyCount || 1) +
          " · " +
          (q.repeatable ? "répétable" : "unique") +
          "</div>" +
          '<div class="weapon-item__actions"><button type="button" class="btn btn-sm quest-edit" data-id="' +
          escapeHtml(q.id) +
          '">Modifier</button><button type="button" class="btn btn-sm weapon-del quest-del" data-id="' +
          escapeHtml(q.id) +
          '">Supprimer</button></div></div></li>'
        );
      })
      .join("");

    els.questList.querySelectorAll(".quest-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openQuestForm(btn.getAttribute("data-id"));
      });
    });
    els.questList.querySelectorAll(".quest-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        if (!confirm("Supprimer cette quête ?")) return;
        saveQuests(loadQuests().filter(function (q) { return q.id !== id; }));
        showToast("Quête supprimée.");
        renderQuestList();
      });
    });
  }

  function resetQuestForm(hide) {
    els.questForm.reset();
    els.quIdHidden.value = "";
    els.quId.readOnly = false;
    els.quId.classList.remove("field__input--locked");
    els.questFormTitle.textContent = "Quête";
    els.btnCancelQuest.hidden = true;
    if (hide) els.questFormSection.hidden = true;
  }

  function openQuestForm(id) {
    els.questFormSection.hidden = false;
    els.btnCancelQuest.hidden = false;
    if (!id) {
      resetQuestForm(false);
      els.quId.value = "";
      els.quTitle.value = "";
      els.quGiver.value = "";
      els.quVillage.value = "Nordhaven";
      els.quDesc.value = "";
      els.quZone.value = "";
      els.quMonster.value = "";
      els.quCount.value = "1";
      els.quRepeatable.value = "false";
      els.quRewardGold.value = "30";
      els.quRewardItem.value = "";
      els.questFormTitle.textContent = "Nouvelle quête";
      return;
    }
    var q = loadQuests().find(function (x) { return x.id === id; });
    if (!q) return showToast("Quête introuvable.", true);
    els.quIdHidden.value = q.id;
    els.quId.value = q.id;
    els.quId.readOnly = true;
    els.quId.classList.add("field__input--locked");
    els.quTitle.value = q.title || "";
    els.quGiver.value = q.giver || "";
    els.quVillage.value = q.giverVillage || "Nordhaven";
    els.quDesc.value = q.description || "";
    els.quZone.value = q.targetZone || "";
    els.quMonster.value = q.monster || "";
    els.quCount.value = String(q.enemyCount || 1);
    els.quRepeatable.value = q.repeatable ? "true" : "false";
    els.quRewardGold.value = String(q.rewardGold || 0);
    els.quRewardItem.value = q.rewardItem || "";
    els.questFormTitle.textContent = "Modifier — " + q.title;
  }

  async function init() {
    els = {
      toast: document.getElementById("editor-toast"),
      baseWeaponList: document.getElementById("base-weapon-list"),
      baseItemList: document.getElementById("base-item-list"),
      baseArmorList: document.getElementById("base-armor-list"),
      weaponList: document.getElementById("weapon-list"),
      weaponFormSection: document.getElementById("weapon-form-section"),
      weaponForm: document.getElementById("weapon-form"),
      formHeading: document.getElementById("form-heading"),
      btnNewWeapon: document.getElementById("btn-new-weapon"),
      btnCancel: document.getElementById("btn-cancel-form"),
      wId: document.getElementById("w-id"),
      wName: document.getElementById("w-name"),
      wCost: document.getElementById("w-cost"),
      wAtkMin: document.getElementById("w-atk-min"),
      wAtkMax: document.getElementById("w-atk-max"),
      wAtkSpeed: document.getElementById("w-atk-speed"),
      wRarity: document.getElementById("w-rarity"),
      wIconFile: document.getElementById("w-icon-file"),
      wIconPreviewWrap: document.getElementById("w-icon-preview-wrap"),
      wIconPreviewFrame: document.getElementById("w-icon-preview-frame"),
      wIconClear: document.getElementById("w-icon-clear"),
      itemList: document.getElementById("item-list"),
      spellList: document.getElementById("spell-list-editor"),
      spellFormSection: document.getElementById("spell-form-section"),
      spellForm: document.getElementById("spell-form"),
      spFormTitle: document.getElementById("spell-form-title"),
      btnNewSpell: document.getElementById("btn-new-spell"),
      btnCancelSpell: document.getElementById("btn-cancel-spell"),
      spIdHidden: document.getElementById("sp-id-hidden"),
      spId: document.getElementById("sp-id"),
      spName: document.getElementById("sp-name"),
      spDesc: document.getElementById("sp-desc"),
      spMana: document.getElementById("sp-mana"),
      spEffect: document.getElementById("sp-effect"),
      spPMin: document.getElementById("sp-pmin"),
      spPMax: document.getElementById("sp-pmax"),
      spScale: document.getElementById("sp-scale"),
      spSkill: document.getElementById("sp-skill"),
      spXp: document.getElementById("sp-xp"),
      spGlyph: document.getElementById("sp-glyph"),
      spIconFile: document.getElementById("sp-icon-file"),
      spIconPreviewWrap: document.getElementById("sp-icon-preview-wrap"),
      spIconPreviewFrame: document.getElementById("sp-icon-preview-frame"),
      spIconClear: document.getElementById("sp-icon-clear"),
      itemFormSection: document.getElementById("item-form-section"),
      itemForm: document.getElementById("item-form"),
      itemFormTitle: document.getElementById("item-form-title"),
      btnNewItem: document.getElementById("btn-new-item"),
      btnCancelItem: document.getElementById("btn-cancel-item"),
      itId: document.getElementById("it-id"),
      itIdInput: document.getElementById("it-id-input"),
      itName: document.getElementById("it-name"),
      itCost: document.getElementById("it-cost"),
      itKind: document.getElementById("it-kind"),
      itEffect: document.getElementById("it-effect"),
      itSpell: document.getElementById("it-spell"),
      itRarity: document.getElementById("it-rarity"),
      itEffectWrap: document.getElementById("it-effect-wrap"),
      itSpellWrap: document.getElementById("it-spell-wrap"),
      itIconFile: document.getElementById("it-icon-file"),
      itIconPreviewWrap: document.getElementById("it-icon-preview-wrap"),
      itIconPreviewFrame: document.getElementById("it-icon-preview-frame"),
      itIconClear: document.getElementById("it-icon-clear"),
      armorList: document.getElementById("armor-list"),
      armorFormSection: document.getElementById("armor-form-section"),
      armorForm: document.getElementById("armor-form"),
      armorFormTitle: document.getElementById("armor-form-title"),
      btnNewArmor: document.getElementById("btn-new-armor"),
      btnCancelArmor: document.getElementById("btn-cancel-armor"),
      arId: document.getElementById("ar-id"),
      arIdInput: document.getElementById("ar-id-input"),
      arName: document.getElementById("ar-name"),
      arCost: document.getElementById("ar-cost"),
      arVit: document.getElementById("ar-vit"),
      arMag: document.getElementById("ar-mag"),
      arEnd: document.getElementById("ar-end"),
      arDef: document.getElementById("ar-def"),
      arRarity: document.getElementById("ar-rarity"),
      arSlot: document.getElementById("ar-slot"),
      arIconFile: document.getElementById("ar-icon-file"),
      arIconPreviewWrap: document.getElementById("ar-icon-preview-wrap"),
      arIconPreviewFrame: document.getElementById("ar-icon-preview-frame"),
      arIconClear: document.getElementById("ar-icon-clear"),
      raceBaseTable: document.getElementById("race-base-table"),
      raceExtraList: document.getElementById("race-extra-list"),
      raceExtraForm: document.getElementById("race-extra-form"),
      rxId: document.getElementById("rx-id"),
      rxLabel: document.getElementById("rx-label"),
      rxVit: document.getElementById("rx-vit"),
      rxInt: document.getElementById("rx-int"),
      rxEnd: document.getElementById("rx-end"),
      rxDef: document.getElementById("rx-def"),
      rxIconFile: document.getElementById("rx-icon-file"),
      baseMonsterList: document.getElementById("base-monster-list"),
      monsterList: document.getElementById("monster-list"),
      monsterFormSection: document.getElementById("monster-form-section"),
      monsterForm: document.getElementById("monster-form"),
      monsterFormTitle: document.getElementById("monster-form-title"),
      btnNewMonster: document.getElementById("btn-new-monster"),
      btnCancelMonster: document.getElementById("btn-cancel-monster"),
      moIdHidden: document.getElementById("mo-id"),
      moIdInput: document.getElementById("mo-id-input"),
      moName: document.getElementById("mo-name"),
      moHp: document.getElementById("mo-hp"),
      moDefense: document.getElementById("mo-defense"),
      moAtkSpeed: document.getElementById("mo-atk-speed"),
      moAtkMin: document.getElementById("mo-atk-min"),
      moAtkMax: document.getElementById("mo-atk-max"),
      moXp: document.getElementById("mo-xp"),
      moGold: document.getElementById("mo-gold"),
      moLoot: document.getElementById("mo-loot"),
      moLootScroll: document.getElementById("mo-loot-scroll"),
      moLootPickFixed: document.getElementById("mo-loot-pick-fixed"),
      moLootPickTable: document.getElementById("mo-loot-pick-table"),
      moLootTable: document.getElementById("mo-loot-table"),
      moIconFile: document.getElementById("mo-icon-file"),
      moIconPreviewWrap: document.getElementById("mo-icon-preview-wrap"),
      moIconPreviewFrame: document.getElementById("mo-icon-preview-frame"),
      moIconClear: document.getElementById("mo-icon-clear"),
      monsterSimText: document.getElementById("monster-sim-text"),
      baseQuestList: document.getElementById("base-quest-list"),
      questList: document.getElementById("quest-list"),
      questFormSection: document.getElementById("quest-form-section"),
      questForm: document.getElementById("quest-form"),
      questFormTitle: document.getElementById("quest-form-title"),
      btnNewQuest: document.getElementById("btn-new-quest"),
      btnCancelQuest: document.getElementById("btn-cancel-quest"),
      quIdHidden: document.getElementById("qu-id-hidden"),
      quId: document.getElementById("qu-id"),
      quTitle: document.getElementById("qu-title"),
      quGiver: document.getElementById("qu-giver"),
      quVillage: document.getElementById("qu-village"),
      quDesc: document.getElementById("qu-desc"),
      quZone: document.getElementById("qu-zone"),
      quMonster: document.getElementById("qu-monster"),
      quCount: document.getElementById("qu-count"),
      quRepeatable: document.getElementById("qu-repeatable"),
      quRewardGold: document.getElementById("qu-reward-gold"),
      quRewardItem: document.getElementById("qu-reward-item"),
      quLootScroll: document.getElementById("qu-loot-scroll"),
      quLootPick: document.getElementById("qu-loot-pick"),
      quZoneScroll: document.getElementById("qu-zone-scroll"),
      quZonePick: document.getElementById("qu-zone-pick"),
      quMonsterScroll: document.getElementById("qu-monster-scroll"),
      quMonsterPick: document.getElementById("qu-monster-pick")
    };

    await hydrateFromServer();
    resetLegacyQuestsMonstersOnce();
    bindTabs();
    renderBaseWeapons();
    renderBaseItems();
    renderBaseArmors();
    renderWeaponList();
    renderItemList();
    renderSpellList();
    refreshSpellSelectOptions();
    renderArmorList();
    renderRaceBase();
    renderRaceExtraList();
    renderNavIconPreviews();
    bindNavIconEditor();
    bindSkillsThemeEditor();
    renderSkillsEditorPanel();
    renderCursorPreviews();
    bindCursorEditor();
    renderSoundPreviews();
    bindSoundEditor();
    renderVillageArtPreviews();
    bindVillageArtEditor();
    renderBaseMonsters();
    renderMonsterList();
    renderBaseQuests();
    renderQuestList();
    renderLootScrollLists();
    renderQuestScrollLists();

    els.btnNewWeapon.addEventListener("click", function () {
      openWeaponForm(null);
    });
    els.btnCancel.addEventListener("click", function () {
      resetWeaponForm(true);
    });
    if (els.wIconFile) {
      els.wIconFile.addEventListener("change", function () {
        readFileAsIcon(els.wIconFile, function (url) {
          weaponIconDataUrl = url || weaponIconDataUrl;
          updateWeaponIconPreview();
        });
      });
    }
    if (els.wIconClear) {
      els.wIconClear.addEventListener("click", function () {
        weaponIconDataUrl = "";
        if (els.wIconFile) els.wIconFile.value = "";
        updateWeaponIconPreview();
      });
    }

    els.weaponForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var existingId = els.wId.value.trim();
      var newId = existingId;
      if (!newId) {
        newId = "edit_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
      }
      var candidate = normalizeWeapon(
        {
          id: newId,
          name: els.wName.value,
          cost: els.wCost.value,
          atkMin: els.wAtkMin.value,
          atkMax: els.wAtkMax.value,
          attackSpeed: els.wAtkSpeed ? els.wAtkSpeed.value : "1",
          rarity: els.wRarity.value
        },
        weaponIconDataUrl
      );

      var list = loadWeapons().filter(function (w) {
        return w.kind === "weapon";
      });
      var clash = list.some(function (w) {
        return w.id === candidate.id && w.id !== existingId;
      });
      if (clash) {
        showToast("Un autre objet utilise déjà cet identifiant.", true);
        return;
      }

      if (existingId) {
        list = list.map(function (w) {
          return w.id === existingId ? candidate : w;
        });
      } else {
        list.push(candidate);
      }
      saveWeapons(list);
      showToast(existingId ? "Arme mise à jour." : "Arme créée.");
      resetWeaponForm(true);
      renderWeaponList();
      renderLootScrollLists();
    });

    els.btnNewItem.addEventListener("click", function () {
      openItemForm(null);
    });
    els.btnNewSpell.addEventListener("click", function () {
      openSpellForm(null);
    });
    els.btnCancelSpell.addEventListener("click", function () {
      resetSpellForm(true);
    });
    if (els.spIconFile) {
      els.spIconFile.addEventListener("change", function () {
        readFileAsIcon(els.spIconFile, function (url) {
          spellIconDataUrl = url || spellIconDataUrl;
          updateSpellIconPreview();
        });
      });
    }
    if (els.spIconClear) {
      els.spIconClear.addEventListener("click", function () {
        spellIconDataUrl = "";
        if (els.spIconFile) els.spIconFile.value = "";
        updateSpellIconPreview();
      });
    }
    els.spellForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var existingId = String(els.spIdHidden.value || "").trim();
      var typedId = String(els.spId.value || "").trim();
      if (!typedId) return showToast("Identifiant requis.", true);
      var raw = {
        id: existingId || typedId,
        name: els.spName.value,
        description: els.spDesc.value,
        manaCost: els.spMana.value,
        effect: els.spEffect.value,
        powerMin: els.spPMin.value,
        powerMax: els.spPMax.value,
        scaleAttr: els.spScale.value,
        skillId: els.spSkill.value,
        xpGain: els.spXp.value,
        glyph: els.spGlyph.value
      };
      var candidate = normalizeSpell(raw, spellIconDataUrl);
      if (!candidate) return showToast("Sort invalide.", true);
      var list = loadSpells();
      var clash = list.some(function (s) { return s.id === candidate.id && s.id !== existingId; });
      if (clash) return showToast("Cet identifiant est deja utilise.", true);
      if (existingId) {
        list = list.map(function (s) { return s.id === existingId ? candidate : s; });
      } else {
        list.push(candidate);
      }
      saveSpells(list);
      renderSpellList();
      refreshSpellSelectOptions();
      resetSpellForm(true);
      showToast(existingId ? "Sort mis a jour." : "Sort cree.");
    });
    els.btnCancelItem.addEventListener("click", function () {
      resetItemForm(true);
    });
    els.itKind.addEventListener("change", toggleItemKindFields);
    if (els.itIconFile) {
      els.itIconFile.addEventListener("change", function () {
        readFileAsIcon(els.itIconFile, function (url) {
          itemIconDataUrl = url || itemIconDataUrl;
          updateItemIconPreview();
        });
      });
    }
    if (els.itIconClear) {
      els.itIconClear.addEventListener("click", function () {
        itemIconDataUrl = "";
        if (els.itIconFile) els.itIconFile.value = "";
        updateItemIconPreview();
      });
    }

    els.itemForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var existingId = els.itId.value.trim();
      var idInput = els.itIdInput.value.trim();
      if (!idInput) {
        showToast("Identifiant requis.", true);
        return;
      }
      var newId = existingId || idInput;
      var raw = {
        id: newId,
        name: els.itName.value,
        cost: els.itCost.value,
        kind: els.itKind.value,
        effect: els.itEffect.value,
        spellId: els.itSpell.value,
        rarity: els.itRarity.value
      };
      var candidate = normalizeItem(raw, itemIconDataUrl);
      if (!candidate) {
        showToast("Type d'objet invalide.", true);
        return;
      }

      var list = loadItems();
      var clash = list.some(function (w) {
        return w.id === candidate.id && w.id !== existingId;
      });
      if (clash) {
        showToast("Cet identifiant est déjà utilisé.", true);
        return;
      }

      if (existingId) {
        list = list.map(function (w) {
          return w.id === existingId ? candidate : w;
        });
      } else {
        list.push(candidate);
      }
      saveItems(list);
      showToast(existingId ? "Objet mis à jour." : "Objet créé.");
      resetItemForm(true);
      renderItemList();
      renderLootScrollLists();
    });

    els.btnNewArmor.addEventListener("click", function () {
      openArmorForm(null);
    });
    els.btnCancelArmor.addEventListener("click", function () {
      resetArmorForm(true);
    });
    if (els.arIconFile) {
      els.arIconFile.addEventListener("change", function () {
        readFileAsIcon(els.arIconFile, function (url) {
          armorIconDataUrl = url || armorIconDataUrl;
          updateArmorIconPreview();
        });
      });
    }
    if (els.arIconClear) {
      els.arIconClear.addEventListener("click", function () {
        armorIconDataUrl = "";
        if (els.arIconFile) els.arIconFile.value = "";
        updateArmorIconPreview();
      });
    }

    els.armorForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var existingId = els.arId.value.trim();
      var idInput = els.arIdInput.value.trim();
      if (!idInput) {
        showToast("Identifiant requis.", true);
        return;
      }
      var newId = existingId || idInput;
      var candidate = normalizeArmor(
        {
          id: newId,
          name: els.arName.value,
          cost: els.arCost.value,
          vitalite: els.arVit.value,
          magie: els.arMag.value,
          endurance: els.arEnd.value,
          defense: els.arDef.value,
          rarity: els.arRarity.value,
          slot: els.arSlot ? els.arSlot.value : "armor"
        },
        armorIconDataUrl
      );

      var list = loadArmors();
      var clash = list.some(function (w) {
        return w.id === candidate.id && w.id !== existingId;
      });
      if (clash) {
        showToast("Cet identifiant est déjà utilisé.", true);
        return;
      }

      if (existingId) {
        list = list.map(function (w) {
          return w.id === existingId ? candidate : w;
        });
      } else {
        list.push(candidate);
      }
      saveArmors(list);
      showToast(existingId ? "Armure mise à jour." : "Armure créée.");
      resetArmorForm(true);
      renderArmorList();
      renderLootScrollLists();
    });

    els.raceExtraForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var rawSnapshot = {
        id: els.rxId.value,
        label: els.rxLabel.value,
        vit: els.rxVit.value,
        int: els.rxInt.value,
        end: els.rxEnd.value,
        def: els.rxDef.value
      };
      var rxFile = els.rxIconFile;

      function done(iconUrl) {
        var n = normalizeRaceExtra(rawSnapshot, iconUrl || "");
        if (!n) {
          showToast("Identifiant invalide (lettres minuscules, chiffres, _).", true);
          return;
        }
        var list = loadRacesExtra();
        if (list.some(function (x) {
          return x.id === n.id;
        })) {
          showToast("Cette race existe déjà dans la liste ajoutée.", true);
          return;
        }
        list.push(n);
        saveRacesExtra(list);
        els.raceExtraForm.reset();
        if (rxFile) rxFile.value = "";
        showToast("Race ajoutée.");
        renderRaceExtraList();
      }

      if (rxFile && rxFile.files && rxFile.files[0]) {
        readFileAsIcon(rxFile, function (url) {
          done(url);
        });
      } else {
        done("");
      }
    });

    els.btnNewMonster.addEventListener("click", function () {
      openMonsterForm(null);
    });
    els.btnCancelMonster.addEventListener("click", function () {
      resetMonsterForm(true);
    });
    if (els.moIconFile) {
      els.moIconFile.addEventListener("change", function () {
        readFileAsIcon(els.moIconFile, function (url) {
          monsterIconDataUrl = url || monsterIconDataUrl;
          updateMonsterIconPreview();
        });
      });
    }
    if (els.moIconClear) {
      els.moIconClear.addEventListener("click", function () {
        monsterIconDataUrl = "";
        if (els.moIconFile) els.moIconFile.value = "";
        updateMonsterIconPreview();
      });
    }
    els.monsterForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var existingId = els.moIdHidden.value.trim();
      var candidate = normalizeMonster(
        {
          id: existingId || els.moIdInput.value,
          name: els.moName.value,
          hp: els.moHp.value,
          defense: els.moDefense.value,
          attackSpeed: els.moAtkSpeed.value,
          atkMin: els.moAtkMin.value,
          atkMax: els.moAtkMax.value,
          xp: els.moXp.value,
          combatGold: els.moGold.value,
          loot: els.moLoot.value,
          lootTable: els.moLootTable.value
        },
        monsterIconDataUrl
      );
      if (!candidate) {
        showToast("Monstre invalide.", true);
        return;
      }
      var list = loadMonsters();
      var clash = list.some(function (m) {
        return m.id === candidate.id && m.id !== existingId;
      });
      if (clash) {
        showToast("Cet identifiant monstre existe déjà.", true);
        return;
      }
      if (existingId) {
        list = list.map(function (m) {
          return m.id === existingId ? candidate : m;
        });
      } else {
        list.push(candidate);
      }
      saveMonsters(list);
      showToast(existingId ? "Monstre mis à jour." : "Monstre créé.");
      resetMonsterForm(true);
      renderMonsterList();
      renderQuestScrollLists();
    });
    if (els.moLootPickFixed) {
      els.moLootPickFixed.addEventListener("click", function () {
        if (!els.moLootScroll || !els.moLootScroll.value) return;
        els.moLoot.value = els.moLootScroll.value;
        updateMonsterSimulationPreview();
      });
    }
    if (els.moLootPickTable) {
      els.moLootPickTable.addEventListener("click", function () {
        if (!els.moLootScroll || !els.moLootScroll.value) return;
        var line = els.moLootScroll.value + ":25";
        var cur = (els.moLootTable.value || "").trim();
        els.moLootTable.value = cur ? cur + "\n" + line : line;
        updateMonsterSimulationPreview();
      });
    }
    [els.moHp, els.moDefense, els.moAtkSpeed, els.moAtkMin, els.moAtkMax, els.moXp, els.moGold, els.moLoot, els.moLootTable].forEach(function (input) {
      if (!input) return;
      input.addEventListener("input", updateMonsterSimulationPreview);
    });

    els.btnNewQuest.addEventListener("click", function () {
      openQuestForm(null);
    });
    els.btnCancelQuest.addEventListener("click", function () {
      resetQuestForm(true);
    });
    els.questForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var existingId = els.quIdHidden.value.trim();
      var candidate = normalizeQuest({
        id: existingId || els.quId.value,
        title: els.quTitle.value,
        giver: els.quGiver.value,
        giverVillage: els.quVillage.value,
        description: els.quDesc.value,
        targetZone: els.quZone.value,
        monster: els.quMonster.value,
        enemyCount: els.quCount.value,
        repeatable: els.quRepeatable.value === "true",
        rewardGold: els.quRewardGold.value,
        rewardItem: els.quRewardItem.value
      });
      if (!candidate) {
        showToast("Quête invalide.", true);
        return;
      }
      var list = loadQuests();
      var clash = list.some(function (q) {
        return q.id === candidate.id && q.id !== existingId;
      });
      if (clash) {
        showToast("Cet identifiant quête existe déjà.", true);
        return;
      }
      if (existingId) {
        list = list.map(function (q) {
          return q.id === existingId ? candidate : q;
        });
      } else {
        list.push(candidate);
      }
      saveQuests(list);
      showToast(existingId ? "Quête mise à jour." : "Quête créée.");
      resetQuestForm(true);
      renderQuestList();
      renderQuestScrollLists();
    });
    if (els.quLootPick) {
      els.quLootPick.addEventListener("click", function () {
        if (!els.quLootScroll || !els.quLootScroll.value) return;
        els.quRewardItem.value = els.quLootScroll.value;
      });
    }
    if (els.quZonePick) {
      els.quZonePick.addEventListener("click", function () {
        if (!els.quZoneScroll || !els.quZoneScroll.value) return;
        els.quZone.value = els.quZoneScroll.value;
      });
    }
    if (els.quMonsterPick) {
      els.quMonsterPick.addEventListener("click", function () {
        if (!els.quMonsterScroll || !els.quMonsterScroll.value) return;
        els.quMonster.value = els.quMonsterScroll.value;
      });
    }

    var editorResetGame = document.getElementById("editor-reset-game-save");
    if (editorResetGame) {
      editorResetGame.addEventListener("click", function () {
        if (
          !confirm(
            "Effacer la sauvegarde du jeu (personnage, or, quetes en cours) ? Les donnees de l'editeur (armes, monstres, etc.) ne sont pas supprimees."
          )
        ) {
          return;
        }
        try {
          localStorage.removeItem(GAME_SAVE_KEY);
          showToast("Sauvegarde du jeu supprimee. Ouvre le jeu pour une nouvelle partie.");
        } catch (err) {
          showToast("Impossible d'effacer la sauvegarde.", true);
        }
      });
    }
  }

  function renderNavIconPreviews() {
    var t = loadNavIcons();
    NAV_ICON_KEYS.forEach(function (k) {
      var prev = document.getElementById("nav-icon-" + k + "-preview");
      var wrap = document.getElementById("nav-icon-" + k + "-wrap");
      if (!prev || !wrap) return;
      var url = t[k] && isAllowedIconDataUrl(t[k]) ? t[k] : "";
      prev.innerHTML = "";
      if (url) {
        var img = document.createElement("img");
        img.className = "nav-icons-frame__img";
        img.src = url;
        img.alt = "";
        prev.appendChild(img);
        wrap.hidden = false;
      } else {
        wrap.hidden = true;
      }
    });
  }

  function setNavIconTexture(key, dataUrl) {
    var t = loadNavIcons();
    if (dataUrl && isAllowedIconDataUrl(dataUrl)) {
      t[key] = dataUrl;
    } else {
      delete t[key];
    }
    saveNavIcons(t);
    renderNavIconPreviews();
  }

  function bindNavIconEditor() {
    NAV_ICON_KEYS.forEach(function (k) {
      var file = document.getElementById("nav-icon-" + k + "-file");
      var clear = document.getElementById("nav-icon-" + k + "-clear");
      if (file) {
        file.addEventListener("change", function () {
          readFileAsIcon(file, function (url) {
            if (url) {
              setNavIconTexture(k, url);
              showToast("Icône enregistrée (" + k + ").");
            }
          });
        });
      }
      if (clear) {
        clear.addEventListener("click", function () {
          setNavIconTexture(k, "");
          if (file) file.value = "";
          showToast("Icône retirée (" + k + ").");
        });
      }
    });
  }

  function bindSkillsThemeEditor() {
    var map = {
      rowBg: document.getElementById("skills-theme-row-bg"),
      rowBorder: document.getElementById("skills-theme-row-border"),
      barStart: document.getElementById("skills-theme-bar-start"),
      barEnd: document.getElementById("skills-theme-bar-end"),
      text: document.getElementById("skills-theme-text"),
      lvl: document.getElementById("skills-theme-lvl"),
      tooltipBg: document.getElementById("skills-theme-tip-bg"),
      tooltipBorder: document.getElementById("skills-theme-tip-border")
    };
    if (!map.rowBg) return;
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
    var current = loadSkillsTheme();
    Object.keys(map).forEach(function (k) {
      map[k].value = String(current[k] || defaults[k]);
    });

    var saveBtn = document.getElementById("skills-theme-save");
    var resetBtn = document.getElementById("skills-theme-reset");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        var out = {};
        Object.keys(map).forEach(function (k) {
          out[k] = String(map[k].value || defaults[k]);
        });
        saveSkillsTheme(out);
        showToast("Theme competences enregistre.");
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        saveSkillsTheme(defaults);
        Object.keys(map).forEach(function (k) {
          map[k].value = defaults[k];
        });
        showToast("Theme competences reinitialise.");
      });
    }
  }

  function wrapSelectedText(textarea, before, after) {
    if (!textarea) return;
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || start;
    var val = textarea.value || "";
    var left = val.slice(0, start);
    var mid = val.slice(start, end) || "texte";
    var right = val.slice(end);
    textarea.value = left + before + mid + after + right;
    textarea.focus();
  }

  function renderSkillsEditorPanel() {
    var root = document.getElementById("skills-editor-list");
    if (!root) return;
    var cfg = loadSkillsEditorConfig();
    root.innerHTML = SKILL_EDITOR_DEFS.map(function (def) {
      var cur = cfg[def.id] && typeof cfg[def.id] === "object" ? cfg[def.id] : {};
      var preview = isAllowedIconDataUrl(cur.iconDataUrl)
        ? '<img class="skills-editor-card__img" src="' + cur.iconDataUrl + '" alt="" />'
        : '<div class="skills-editor-card__img-empty" aria-hidden="true"></div>';
      return (
        '<article class="skills-editor-card">' +
        '<h3 class="editor-subtitle">' + escapeHtml(def.label) + ' <span class="muted">(' + escapeHtml(def.id) + ")</span></h3>" +
        '<label class="field"><span class="field__label">Nom affiche</span>' +
        '<input class="field__input" data-skill-name="' + def.id + '" maxlength="64" value="' + escapeHtml(cur.label || def.label) + '" /></label>' +
        '<label class="field"><span class="field__label">Tooltip HTML</span>' +
        '<textarea class="field__input field__input--textarea" data-skill-tip="' + def.id + '" maxlength="1600">' + escapeHtml(cur.tooltipHtml || def.hint) + "</textarea>" +
        '<p class="field__hint">Balises autorisees: &lt;strong&gt;, &lt;em&gt;, &lt;mark&gt;, &lt;br&gt;.</p>' +
        "</label>" +
        '<div class="weapon-item__actions">' +
        '<button type="button" class="btn btn-sm" data-skill-wrap="' + def.id + '" data-before="<strong>" data-after="</strong>">Gras</button>' +
        '<button type="button" class="btn btn-sm" data-skill-wrap="' + def.id + '" data-before="<em>" data-after="</em>">Italique</button>' +
        '<button type="button" class="btn btn-sm" data-skill-wrap="' + def.id + '" data-before="<mark>" data-after="</mark>">Surbrillance</button>' +
        "</div>" +
        '<div class="field"><span class="field__label">Texture</span>' +
        '<input type="file" class="field__input" data-skill-file="' + def.id + '" accept="image/png,image/jpeg,image/webp,image/gif" />' +
        '<div class="skills-editor-card__preview">' + preview + "</div></div>" +
        '<div class="weapon-item__actions">' +
        '<button type="button" class="btn btn-sm" data-skill-save="' + def.id + '">Enregistrer</button>' +
        '<button type="button" class="btn btn-sm" data-skill-reset="' + def.id + '">Reinitialiser</button>' +
        "</div>" +
        "</article>"
      );
    }).join("");

    root.querySelectorAll("[data-skill-wrap]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-skill-wrap");
        wrapSelectedText(
          root.querySelector('[data-skill-tip="' + id + '"]'),
          btn.getAttribute("data-before") || "",
          btn.getAttribute("data-after") || ""
        );
      });
    });
    root.querySelectorAll("[data-skill-file]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var id = inp.getAttribute("data-skill-file");
        readFileAsIcon(inp, function (url) {
          if (!url) return;
          var o = loadSkillsEditorConfig();
          o[id] = o[id] && typeof o[id] === "object" ? o[id] : {};
          o[id].iconDataUrl = url;
          saveSkillsEditorConfig(o);
          renderSkillsEditorPanel();
          showToast("Texture enregistree (" + id + ").");
        });
      });
    });
    root.querySelectorAll("[data-skill-save]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-skill-save");
        var o = loadSkillsEditorConfig();
        o[id] = o[id] && typeof o[id] === "object" ? o[id] : {};
        o[id].label = String((root.querySelector('[data-skill-name="' + id + '"]') || {}).value || "").trim().slice(0, 64);
        o[id].tooltipHtml = String((root.querySelector('[data-skill-tip="' + id + '"]') || {}).value || "").trim().slice(0, 1600);
        saveSkillsEditorConfig(o);
        showToast("Competence enregistree (" + id + ").");
      });
    });
    root.querySelectorAll("[data-skill-reset]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-skill-reset");
        var o = loadSkillsEditorConfig();
        delete o[id];
        saveSkillsEditorConfig(o);
        renderSkillsEditorPanel();
        showToast("Competence reinitialisee (" + id + ").");
      });
    });
  }

  function renderCursorPreviews() {
    var c = loadCursors();
    CURSOR_KEYS.forEach(function (k) {
      var prev = document.getElementById("cursor-" + k + "-preview");
      var wrap = document.getElementById("cursor-" + k + "-wrap");
      if (!prev || !wrap) return;
      var url = c[k] && isAllowedIconDataUrl(c[k]) ? c[k] : "";
      prev.innerHTML = "";
      if (!url) return (wrap.hidden = true);
      var img = document.createElement("img");
      img.className = "nav-icons-frame__img";
      img.src = url;
      prev.appendChild(img);
      wrap.hidden = false;
    });
  }

  function setCursorTexture(key, dataUrl) {
    var c = loadCursors();
    if (dataUrl && isAllowedIconDataUrl(dataUrl)) c[key] = dataUrl;
    else delete c[key];
    saveCursors(c);
    renderCursorPreviews();
  }

  function bindCursorEditor() {
    CURSOR_KEYS.forEach(function (k) {
      var file = document.getElementById("cursor-" + k + "-file");
      var clear = document.getElementById("cursor-" + k + "-clear");
      if (file) {
        file.addEventListener("change", function () {
          readFileAsIcon(file, function (url) {
            if (!url) return;
            setCursorTexture(k, url);
            showToast("Curseur enregistre (" + k + ").");
          });
        });
      }
      if (clear) {
        clear.addEventListener("click", function () {
          setCursorTexture(k, "");
          if (file) file.value = "";
          showToast("Curseur retire (" + k + ").");
        });
      }
    });
  }

  function renderSoundPreviews() {
    var s = loadSounds();
    SOUND_KEYS.forEach(function (k) {
      var wrap = document.getElementById("sound-" + k + "-wrap");
      var audio = document.getElementById("sound-" + k + "-audio");
      if (!wrap || !audio) return;
      var url = s[k] && isAllowedAudioDataUrl(s[k]) ? s[k] : "";
      audio.removeAttribute("src");
      audio.src = "";
      if (!url) return (wrap.hidden = true);
      audio.src = url;
      wrap.hidden = false;
    });
  }

  function setSoundDataUrl(key, dataUrl) {
    var s = loadSounds();
    if (dataUrl && isAllowedAudioDataUrl(dataUrl)) s[key] = dataUrl;
    else delete s[key];
    saveSounds(s);
    renderSoundPreviews();
  }

  function bindSoundEditor() {
    SOUND_KEYS.forEach(function (k) {
      var file = document.getElementById("sound-" + k + "-file");
      var clear = document.getElementById("sound-" + k + "-clear");
      if (file) {
        file.addEventListener("change", function () {
          readFileAsSound(file, function (url) {
            if (!url) return;
            setSoundDataUrl(k, url);
            showToast("Son enregistre (" + k + ").");
          });
        });
      }
      if (clear) {
        clear.addEventListener("click", function () {
          setSoundDataUrl(k, "");
          if (file) file.value = "";
          showToast("Son retire (" + k + ").");
        });
      }
    });
  }

  function renderVillageArtPreviews() {
    var a = loadVillageArt();
    VILLAGE_ART_KEYS.forEach(function (k) {
      var prev = document.getElementById("village-art-" + k + "-preview");
      var wrap = document.getElementById("village-art-" + k + "-wrap");
      if (!prev || !wrap) return;
      var url = a[k] && isAllowedIconDataUrl(a[k]) ? a[k] : "";
      prev.innerHTML = "";
      if (!url) return (wrap.hidden = true);
      var img = document.createElement("img");
      img.className = "nav-icons-frame__img";
      img.src = url;
      prev.appendChild(img);
      wrap.hidden = false;
    });
  }

  function setVillageArtTexture(key, dataUrl) {
    var a = loadVillageArt();
    if (dataUrl && isAllowedIconDataUrl(dataUrl)) a[key] = dataUrl;
    else delete a[key];
    saveVillageArt(a);
    renderVillageArtPreviews();
  }

  function bindVillageArtEditor() {
    VILLAGE_ART_KEYS.forEach(function (k) {
      var file = document.getElementById("village-art-" + k + "-file");
      var clear = document.getElementById("village-art-" + k + "-clear");
      if (file) {
        file.addEventListener("change", function () {
          readFileAsIcon(file, function (url) {
            if (!url) return;
            setVillageArtTexture(k, url);
            showToast("Illustration enregistree (" + k + ").");
          });
        });
      }
      if (clear) {
        clear.addEventListener("click", function () {
          setVillageArtTexture(k, "");
          if (file) file.value = "";
          showToast("Illustration retiree (" + k + ").");
        });
      }
    });
  }

  init().then(function () {
    scheduleServerSync();
  });
})();
