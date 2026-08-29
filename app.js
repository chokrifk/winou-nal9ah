// Configuration des clés
const SUPABASE_URL = "https://iahzasnluqapwppclfmn.supabase.co";
const SUPABASE_KEY = "sb_publishable_TIb7eyfTYz5x-DhexGOWDw_VkPja_E-";

let supabaseClient = null;
let map;
let userPos = { lat: 36.8065, lng: 10.1815 }; // Tunis par défaut
let nearbyStores = [];

// Initialisation au chargement de la page
document.addEventListener("DOMContentLoaded", () => {
  // Initialisation sécurisée de Supabase
  try {
    if (window.supabase && window.supabase.createClient) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false }
      });
    }
  } catch (err) {
    console.warn("Connexion Supabase en mode fallback:", err);
  }

  // Lancement de la carte Leaflet
  initMap();
});

function initMap() {
  // 1. Déclarer la carte
  map = L.map("map").setView([userPos.lat, userPos.lng], 14);

  // 2. Ajouter les tuiles OpenStreetMap
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(map);

  // Force le rendu d'affichage de la carte
  setTimeout(() => {
    map.invalidateSize();
  }, 400);

  // 3. Géolocalisation utilisateur
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
      },
      (err) => {
        console.warn("GPS non activé ou refusé, utilisation position par défaut.");
        fetchNearbyShopsOSM(userPos.lat, userPos.lng);
        fetchReports();
      },
      { timeout: 10000 }
    );
  } else {
    fetchNearbyShopsOSM(userPos.lat, userPos.lng);
    fetchReports();
  }
}

// Recherche des magasins via l'API gratuite Overpass
async function fetchNearbyShopsOSM(lat, lng) {
  const storeSelect = document.getElementById("store-select");
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

// Récupération des signalements
async function fetchReports() {
  if (!supabaseClient) return;

  const { data: reports, error } = await supabaseClient
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Erreur Supabase :", error);
    return;
  }

  if (reports) {
    reports.forEach((report) => {
      const statusText = report.status === "Disponible" ? "🟢 En stock" : "🔴 En rupture";
      
      L.marker([report.latitude, report.longitude])
        .addTo(map)
        .bindPopup(`
          <strong>${report.product_name}</strong><br/>
          🏬 ${report.store_name || "Commerce"}<br/>
          Statut : ${statusText}<br/>
          <small>${new Date(report.created_at).toLocaleString()}</small>
        `);
    });
  }
}

// Envoi du formulaire
async function handleReportSubmit(e) {
  e.preventDefault();

  const storeIndex = document.getElementById("store-select").value;
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
    alert("Problème de connexion à la base de données.");
    return;
  }

  const { error } = await supabaseClient.from("reports").insert([
    {
      product_name: productName,
      status: status,
      store_name: storeName,
      latitude: reportLat,
      longitude: reportLng
    }
  ]);

  if (error) {
    alert("Erreur lors de l'envoi du signalement.");
    console.error(error);
  } else {
    alert("Signalement ajouté avec succès !");
    document.getElementById("report-form").reset();
    fetchReports();
  }
}
