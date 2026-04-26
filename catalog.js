/* Catalogue partagé : boutique de base et races jouables (éditeur + jeu). */
(function (global) {
  "use strict";

  global.NORDHAVEN_CATALOG = {
    /* Vide : tout le contenu marchand vient de l’éditeur (localStorage) ou d’ajouts futurs. */
    SHOP_ITEMS: [],

    /**
     * Bonus de race appliqués en plus de la classe (VIT / INT / END / DEF).
     * vit / int / end : bonus de stats. def : ignore (la defense vient de l'armure en jeu).
     */
    RACES: [
      { id: "nordique", label: "Nordique", vit: 1, int: 0, end: 1, def: 0 },
      { id: "elfe_sylvestre", label: "Elfe des bois", vit: 0, int: 2, end: 1, def: 0 },
      { id: "orc_collines", label: "Orque des collines", vit: 2, int: 0, end: 0, def: 0 },
      { id: "breton_rivage", label: "Breton du rivage", vit: 0, int: 2, end: 0, def: 0 },
      { id: "felin_argent", label: "Peau d'argent", vit: 0, int: 0, end: 2, def: 0 }
    ],

    /**
     * Référence quêtes (ids / titres / nom du monstre cible) — aligné sur game.js pour l’éditeur (textures combat).
     */
    QUESTS_REF: []
  };
})(typeof window !== "undefined" ? window : this);
