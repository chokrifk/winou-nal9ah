// Configuration des clés Supabase
const SUPABASE_URL = "https://iahzasnluqapwppclfmn.supabase.co";
const SUPABASE_KEY = "sb_publishable_TIb7eyfTYz5x-DhexGOWDw_VkPja_E-";

let supabaseClient = null;
let map;
let userPos = { lat: 36.8065, lng: 10.1815 }; // Position par défaut (Tunis)
let nearbyStores = [];

// Initialisation au chargement du DOM
document.addEventListener("DOMContentLoaded", () => {
  // Initialisation sécurisée du client Supabase
  try {
    if (window.supabase && window.supabase.createClient) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false }
      });
    }
  } catch (err) {
    console.warn("Connexion Supabase en mode fallback:", err);
  }

  // Écoute de la soumission du formulaire
  const reportForm = document.getElementById("report-form");
  if (reportForm) {
    reportForm.addEventListener("submit", handleReportSubmit);
  }

  // Initialisation de la carte et des données
  initMap();
});

function initMap() {
  // 1. Déclaration de la carte
  map = L.map("map").setView([userPos.lat, userPos.lng], 14);

  // 2. Couche OpenStreetMap
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(map);

  // Force le rendu d'affichage de la carte
  setTimeout(() => {
    map.invalidateSize();
  }, 400);

  // 3. Géolocalisation de l'utilisateur
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        userPos = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        map.setView([userPos.lat, userPos.lng], 15);

        L.circleMarker([userPos.lat, userPos.lng], {
          color: "#2563eb",
          fillColor: "#3b82f6",
          fillOpacity: 0.9,
          radius: 8
        }).addTo(map).bindPopup("Vous êtes ici");

        fetchNearbyShopsOSM(userPos.lat, userPos.lng);
        fetchReports();
        listenRealtimeReports();
      },
      (err) => {
        console.warn("GPS non disponible ou refusé, utilisation position par défaut.");
        fetchNearbyShopsOSM(userPos.lat, userPos.lng);
        fetchReports();
        listenRealtimeReports();
      },
      { timeout: 10000 }
    );
  } else {
    fetchNearbyShopsOSM(userPos.lat, userPos.lng);
    fetchReports();
    listenRealtimeReports();
  }
}

// Recherche des commerces à proximité via l'API Overpass (OpenStreetMap)
async function fetchNearbyShopsOSM(lat, lng) {
  const storeSelect = document.getElementById("store-select");
  if (!storeSelect) return;

  storeSelect.innerHTML = "<option value=''>Chargement des commerces proches...</option>";

  const query = `
    [out:json];
    (
      node["shop"="supermarket"](around:2000, ${lat}, ${lng});
      node["shop"="convenience"](around:2000, ${lat}, ${lng});
      way["shop"="supermarket"](around:2000, ${lat}, ${lng});
      way["shop"="convenience"](around:2000, ${lat}, ${lng});
    );
    out center 20;
  `;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query
    });
    const data = await response.json();

    storeSelect.innerHTML = "";
    nearbyStores = data.elements || [];

    if (nearbyStores.length === 0) {
      storeSelect.innerHTML = "<option value=''>Aucun magasin détecté (Position actuelle utilisée)</option>";
      return;
    }

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "-- Sélectionner un magasin --";
    storeSelect.appendChild(defaultOpt);

    nearbyStores.forEach((store, index) => {
      const storeName = store.tags.name || "Épicerie / Commerce de proximité";
      const storeLat = store.lat || (store.center && store.center.lat);
      const storeLng = store.lon || (store.center && store.center.lon);

      if (storeLat && storeLng) {
        L.marker([storeLat, storeLng])
          .addTo(map)
          .bindPopup(`🏬 <strong>${storeName}</strong>`);
      }

      const opt = document.createElement("option");
      opt.value = index;
      opt.textContent = storeName;
      storeSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("Erreur API Overpass :", err);
    storeSelect.innerHTML = "<option value=''>Position actuelle (Saisie manuelle)</option>";
  }
}

// Récupération initiale de tous les signalements
async function fetchReports() {
  if (!supabaseClient) return;

  const { data: reports, error } = await supabaseClient
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Erreur de lecture des signalements Supabase :", error);
    return;
  }

  const feedContainer = document.getElementById("reports-feed");
  if (feedContainer) feedContainer.innerHTML = "";

  if (reports && reports.length > 0) {
    reports.forEach((report) => {
      addReportToUI(report, false);
    });
  } else if (feedContainer) {
    feedContainer.innerHTML = "<p class='empty-feed'>Aucun signalement pour le moment.</p>";
  }
}

// Ajouter un signalement sur la carte et dans le flux d'informations
function addReportToUI(report, isNew = false) {
  const statusText = report.status === "Disponible" ? "🟢 En stock" : "🔴 En rupture";
  const formattedDate = new Date(report.created_at).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  // 1. Ajouter / Mettre à jour le marqueur sur la carte
  L.marker([report.latitude, report.longitude])
    .addTo(map)
    .bindPopup(`
      <strong>${report.product_name}</strong><br/>
      🏬 ${report.store_name || "Commerce"}<br/>
      Statut : ${statusText}<br/>
      🕒 <small>Signalé le : ${formattedDate}</small>
    `);

  // 2. Ajouter la ligne dans la liste des signalements
  const feedContainer = document.getElementById("reports-feed");
  if (feedContainer) {
    // Retirer le message "Aucun signalement" s'il existe
    const emptyMsg = feedContainer.querySelector(".empty-feed");
    if (emptyMsg) emptyMsg.remove();

    const item = document.createElement("div");
    item.className = `feed-item ${report.status === "Disponible" ? "disponible" : "rupture"}`;
    item.innerHTML = `
      <div class="feed-details">
        <strong>${report.product_name} (${statusText})</strong>
        <span>🏬 ${report.store_name || "Commerce"}</span>
      </div>
      <div class="feed-time">🕒 ${formattedDate}</div>
    `;

    feedContainer.prepend(item);
  }
}

// Affichage de la notification flottante temporaire
function showInstantNotification(report) {
  const formattedDate = new Date(report.created_at).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  const toast = document.createElement("div");
  toast.className = "toast-notification";
  toast.innerHTML = `
    <strong>🚨 Nouveau Signalement Instantané !</strong><br/>
    📦 <b>${report.product_name}</b> - ${report.status === "Disponible" ? "🟢 En stock" : "🔴 En rupture"}<br/>
    🏬 ${report.store_name || "Commerce"}<br/>
    🕒 <small>Signalé le : ${formattedDate}</small>
  `;

  document.body.appendChild(toast);

  // Supprime la notification au bout de 5 secondes
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

// Écoute en temps réel des nouveaux signalements Supabase
function listenRealtimeReports() {
  if (!supabaseClient) return;

  supabaseClient
    .channel("public:reports")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "reports" },
      (payload) => {
        const newReport = payload.new;
        addReportToUI(newReport, true);
        showInstantNotification(newReport);
      }
    )
    .subscribe();
}

// Soumission d'un nouveau signalement
async function handleReportSubmit(e) {
  e.preventDefault();

  const storeSelect = document.getElementById("store-select");
  const storeIndex = storeSelect ? storeSelect.value : "";
  const productName = document.getElementById("product-name").value;
  const status = document.getElementById("status").value;

  let storeName = "Commerce de proximité";
  let reportLat = userPos.lat;
  let reportLng = userPos.lng;

  if (storeIndex !== "" && nearbyStores[storeIndex]) {
    const selected = nearbyStores[storeIndex];
    storeName = selected.tags.name || "Épicerie proche";
    reportLat = selected.lat || (selected.center && selected.center.lat) || userPos.lat;
    reportLng = selected.lon || (selected.center && selected.center.lon) || userPos.lng;
  }

  if (!supabaseClient) {
    alert("Problème d'initialisation de la base de données.");
    return;
  }

  const newRecord = {
    product_name: productName,
    status: status,
    store_name: storeName,
    latitude: reportLat,
    longitude: reportLng
  };

  const { data, error } = await supabaseClient
    .from("reports")
    .insert([newRecord])
    .select();

  if (error) {
    alert("Erreur lors de l'envoi du signalement.");
    console.error("Erreur Supabase insert:", error);
  } else {
    document.getElementById("report-form").reset();
    
    // Si la souscription Realtime ne déclenche pas immédiatement, on rafraîchit localement
    if (data && data.length > 0) {
      addReportToUI(data[0], true);
      showInstantNotification(data[0]);
    }
  }
}
