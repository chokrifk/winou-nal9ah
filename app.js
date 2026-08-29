// Configuration des clés Supabase
const SUPABASE_URL = "https://iahzasnluqapwppclfmn.supabase.co";
const SUPABASE_KEY = "sb_publishable_TIb7eyfTYz5x-DhexGOWDw_VkPja_E-";

let supabaseClient = null;
let realtimeChannel = null;
let map;
let userPos = { lat: 36.8065, lng: 10.1815 }; // Position par défaut (Tunis)
let nearbyStores = [];
const markersMap = new Map(); // Stocke les marqueurs Leaflet

// Initialisation au chargement du DOM
document.addEventListener("DOMContentLoaded", () => {
  try {
    if (window.supabase && window.supabase.createClient) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false }
      });
    }
  } catch (err) {
    console.warn("Connexion Supabase en mode fallback:", err);
  }

  const reportForm = document.getElementById("report-form");
  if (reportForm) {
    reportForm.addEventListener("submit", handleReportSubmit);
  }

  initMap();
});

function initMap() {
  map = L.map("map").setView([userPos.lat, userPos.lng], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(map);

  setTimeout(() => {
    map.invalidateSize();
  }, 400);

  // Charger les données initiales une seule fois
  fetchReports();
  listenRealtimeReports();

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
      },
      (err) => {
        console.warn("GPS non disponible ou refusé, utilisation position par défaut.");
        fetchNearbyShopsOSM(userPos.lat, userPos.lng);
      },
      { timeout: 10000 }
    );
  } else {
    fetchNearbyShopsOSM(userPos.lat, userPos.lng);
  }
}

// Récupération de l'adresse lisible via Reverse Geocoding
async function getAddressFromCoords(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    if (data && data.address) {
      const road = data.address.road || data.address.pedestrian || data.address.suburb || "";
      const city = data.address.city || data.address.town || data.address.village || data.address.state || "";
      const fullAddr = [road, city].filter(Boolean).join(", ");
      return fullAddr || data.display_name.split(",")[0];
    }
  } catch (err) {
    console.warn("Erreur récupération adresse:", err);
  }
  return "Adresse non disponible";
}

// Focus sur la carte
window.focusOnMapMarker = function(reportId, lat, lng) {
  if (!map) return;
  map.setView([lat, lng], 17, { animate: true });
  
  const marker = markersMap.get(String(reportId));
  if (marker) {
    marker.openPopup();
  }
  
  const mapElement = document.getElementById("map");
  if (mapElement) {
    mapElement.scrollIntoView({ behavior: "smooth", block: "center" });
  }
};

// Recherche des commerces à proximité
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

// Récupération initiale des signalements
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
    // Inverser pour ajouter du plus ancien au plus récent avec `prepend`
    reports.reverse().forEach((report) => {
      addReportToUI(report);
    });
  } else if (feedContainer) {
    feedContainer.innerHTML = "<p class='empty-feed'>Aucun signalement pour le moment.</p>";
  }
}

// Ajouter un signalement (anti-doublon strict carte & liste)
function addReportToUI(report) {
  const reportId = String(report.id || `${report.latitude}_${report.longitude}`);

  // 1. SÉCURITÉ ANTI-DOUBLON : si déjà dans le DOM ou la carte, on stoppe
  if (markersMap.has(reportId) || document.querySelector(`[data-report-id="${reportId}"]`)) {
    return;
  }

  const statusText = report.status === "Disponible" ? "🟢 En stock" : "🔴 En rupture";
  const formattedDate = new Date(report.created_at).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  const addressText = report.address || "Adresse non disponible";

  // Marqueur sur la carte
  const marker = L.marker([report.latitude, report.longitude])
    .addTo(map)
    .bindPopup(`
      <strong>${report.product_name}</strong><br/>
      🏬 <b>${report.store_name || "Commerce"}</b><br/>
      📍 <small>${addressText}</small><br/>
      Statut : ${statusText}<br/>
      🕒 <small>Signalé le : ${formattedDate}</small>
    `);

  markersMap.set(reportId, marker);

  // Ajouter à la liste UI
  const feedContainer = document.getElementById("reports-feed");
  if (feedContainer) {
    const emptyMsg = feedContainer.querySelector(".empty-feed");
    if (emptyMsg) emptyMsg.remove();

    const item = document.createElement("div");
    item.className = `feed-item ${report.status === "Disponible" ? "disponible" : "rupture"}`;
    item.setAttribute("data-report-id", reportId);
    item.style.cursor = "pointer";
    item.onclick = () => window.focusOnMapMarker(reportId, report.latitude, report.longitude);

    item.innerHTML = `
      <div class="feed-details">
        <strong>${report.product_name} (${statusText})</strong>
        <span>🏬 <b>${report.store_name || "Commerce"}</b></span>
        <span class="feed-address">📍 ${addressText} <i style="font-size: 0.75rem; color: #2563eb;">(Cliquer pour voir sur la carte)</i></span>
      </div>
      <div class="feed-time">🕒 ${formattedDate}</div>
    `;

    feedContainer.prepend(item);
  }
}

// Affichage notification
function showInstantNotification(report) {
  const formattedDate = new Date(report.created_at).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  const reportId = String(report.id || `${report.latitude}_${report.longitude}`);
  const addressText = report.address || "Localisation enregistrée";

  const toast = document.createElement("div");
  toast.className = "toast-notification";
  toast.style.cursor = "pointer";
  toast.onclick = () => window.focusOnMapMarker(reportId, report.latitude, report.longitude);

  toast.innerHTML = `
    <strong>🚨 Nouveau Signalement Instantané !</strong><br/>
    📦 <b>${report.product_name}</b> - ${report.status === "Disponible" ? "🟢 En stock" : "🔴 En rupture"}<br/>
    🏬 <b>${report.store_name || "Commerce"}</b><br/>
    📍 <small>${addressText}</small> <u>(Voir sur la carte)</u><br/>
    🕒 <small>Signalé le : ${formattedDate}</small>
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 7000);
}

// Écoute Realtime unique
function listenRealtimeReports() {
  if (!supabaseClient) return;

  // Si un canal existe déjà, on le détruit pour éviter les écoutes multiples
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel("public:reports")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "reports" },
      (payload) => {
        const newReport = payload.new;
        addReportToUI(newReport);
        showInstantNotification(newReport);
      }
    )
    .subscribe();
}

// Soumission du formulaire avec désactivation anti double-clic
async function handleReportSubmit(e) {
  e.preventDefault();

  const submitBtn = e.target.querySelector("button[type='submit']");
  if (submitBtn) submitBtn.disabled = true;

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
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  const fetchedAddress = await getAddressFromCoords(reportLat, reportLng);

  const newRecord = {
    product_name: productName,
    status: status,
    store_name: storeName,
    address: fetchedAddress,
    latitude: reportLat,
    longitude: reportLng
  };

  const { error } = await supabaseClient
    .from("reports")
    .insert([newRecord]);

  if (error) {
    alert("Erreur lors de l'envoi du signalement.");
    console.error("Erreur Supabase insert:", error);
  } else {
    document.getElementById("report-form").reset();
  }

  if (submitBtn) submitBtn.disabled = false;
}
