// Configuration Supabase
const SUPABASE_URL = "https://iahzasnluqapwppclfmn.supabase.co";
const SUPABASE_KEY = "sb_publishable_TIb7eyfTYz5x-DhexGOWDw_VkPja_E-";

let supabaseClient = null;
let realtimeChannel = null;
let realtimeSubscribed = false;

let map;
let userPos = { lat: 36.8065, lng: 10.1815 }; // Position par défaut (Tunis)
let nearbyStores = [];

const markersMap = new Map();
const processedReportIds = new Set();

document.addEventListener("DOMContentLoaded", () => {
  try {
    if (window.supabase && window.supabase.createClient) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false }
      });
    }
  } catch (err) {
    console.warn("Supabase init error:", err);
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

  setTimeout(() => { map.invalidateSize(); }, 400);

  fetchReports();
  listenRealtimeReports();

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        map.setView([userPos.lat, userPos.lng], 15);

        L.circleMarker([userPos.lat, userPos.lng], {
          color: "#2563eb",
          fillColor: "#3b82f6",
          fillOpacity: 0.8,
          radius: 7
        }).addTo(map).bindPopup("Vous êtes ici");

        fetchNearbyShopsOSM(userPos.lat, userPos.lng);
      },
      () => fetchNearbyShopsOSM(userPos.lat, userPos.lng),
      { timeout: 8000 }
    );
  } else {
    fetchNearbyShopsOSM(userPos.lat, userPos.lng);
  }
}

window.recenterMap = function() {
  if (map && userPos) {
    map.setView([userPos.lat, userPos.lng], 15, { animate: true });
  }
};

async function getAddressFromCoords(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    if (data && data.address) {
      const road = data.address.road || data.address.pedestrian || data.address.suburb || "";
      const city = data.address.city || data.address.town || data.address.village || "";
      return [road, city].filter(Boolean).join(", ") || data.display_name.split(",")[0];
    }
  } catch (err) {
    console.warn("Adresse indisponible:", err);
  }
  return "Localisation enregistrée";
}

window.focusOnMapMarker = function(reportId, lat, lng) {
  if (!map) return;
  map.setView([lat, lng], 17, { animate: true });
  const marker = markersMap.get(String(reportId));
  if (marker) marker.openPopup();
  
  document.getElementById("map")?.scrollIntoView({ behavior: "smooth", block: "center" });
};

async function fetchNearbyShopsOSM(lat, lng) {
  const storeSelect = document.getElementById("store-select");
  if (!storeSelect) return;

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
    const response = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: query });
    const data = await response.json();

    storeSelect.innerHTML = "";
    nearbyStores = data.elements || [];

    if (nearbyStores.length === 0) {
      storeSelect.innerHTML = "<option value=''>Épicerie de quartier / Position actuelle</option>";
      return;
    }

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "-- Sélectionner un commerce proche --";
    storeSelect.appendChild(defaultOpt);

    nearbyStores.forEach((store, index) => {
      const name = store.tags.name || "Commerce de proximité";
      const opt = document.createElement("option");
      opt.value = index;
      opt.textContent = name;
      storeSelect.appendChild(opt);
    });
  } catch (err) {
    storeSelect.innerHTML = "<option value=''>Épicerie de quartier (Saisie manuelle)</option>";
  }
}

async function fetchReports() {
  if (!supabaseClient) return;

  const { data: reports, error } = await supabaseClient
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return;

  const feedContainer = document.getElementById("reports-feed");
  if (feedContainer) feedContainer.innerHTML = "";

  if (reports && reports.length > 0) {
    reports.forEach((report) => addReportToUI(report, false));
  } else if (feedContainer) {
    feedContainer.innerHTML = "<p style='color:var(--text-muted); text-align:center;'>Aucun signalement pour le moment.</p>";
  }
}

function addReportToUI(report, isNew = true) {
  if (!report || !report.id) return;
  const reportId = String(report.id);

  // SÉCURITÉ ANTI-DOUBLON
  if (processedReportIds.has(reportId) || document.querySelector(`[data-report-id="${reportId}"]`)) {
    return;
  }
  processedReportIds.add(reportId);

  const isDispo = report.status === "Disponible";
  const badgeClass = isDispo ? "badge-dispo" : "badge-rupture";
  const statusLabel = isDispo ? "En stock" : "En rupture";

  const formattedDate = new Date(report.created_at).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  const addressText = report.address || "Adresse non renseignée";

  // Marqueur sur la carte
  if (!markersMap.has(reportId)) {
    const marker = L.marker([report.latitude, report.longitude])
      .addTo(map)
      .bindPopup(`
        <strong>${report.product_name}</strong> <span class="badge-status ${badgeClass}">${statusLabel}</span><br/>
        🏬 <b>${report.store_name || "Commerce"}</b><br/>
        📍 <small>${addressText}</small><br/>
        🕒 <small>${formattedDate}</small>
      `);
    markersMap.set(reportId, marker);
  }

  // Ajout dans le flux HTML
  const feedContainer = document.getElementById("reports-feed");
  if (feedContainer) {
    const item = document.createElement("div");
    item.className = `feed-item ${isDispo ? "disponible" : "rupture"}`;
    item.setAttribute("data-report-id", reportId);
    item.onclick = () => window.focusOnMapMarker(reportId, report.latitude, report.longitude);

    item.innerHTML = `
      <div class="feed-details">
        <strong>${report.product_name} <span class="badge-status ${badgeClass}">${statusLabel}</span></strong>
        <span class="feed-store">🏬 ${report.store_name || "Commerce"}</span>
        <span class="feed-address">📍 ${addressText}</span>
      </div>
      <div class="feed-time">🕒 ${formattedDate}</div>
    `;

    if (isNew) {
      feedContainer.prepend(item);
    } else {
      feedContainer.appendChild(item);
    }
  }
}

function showInstantNotification(report) {
  const reportId = String(report.id);
  const toast = document.createElement("div");
  toast.className = "toast-notification";
  toast.onclick = () => window.focusOnMapMarker(reportId, report.latitude, report.longitude);

  toast.innerHTML = `
    <strong>🚨 Nouveau Signalement !</strong><br/>
    📦 <b>${report.product_name}</b> - ${report.status}<br/>
    🏬 <small>${report.store_name || "Commerce"}</small>
  `;

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

function listenRealtimeReports() {
  if (!supabaseClient || realtimeSubscribed) return;

  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel("public-reports-channel")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "reports" },
      (payload) => {
        const newReport = payload.new;
        if (newReport && newReport.id) {
          const reportId = String(newReport.id);
          if (!processedReportIds.has(reportId)) {
            addReportToUI(newReport, true);
            showInstantNotification(newReport);
          }
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        realtimeSubscribed = true;
      }
    });
}

async function handleReportSubmit(e) {
  e.preventDefault();

  const submitBtn = e.target.querySelector("button[type='submit']");
  if (submitBtn) submitBtn.disabled = true;

  const storeSelect = document.getElementById("store-select");
  const storeIndex = storeSelect ? storeSelect.value : "";
  const productName = document.getElementById("product-name").value.trim();
  const status = document.getElementById("status").value;

  let storeName = "Épicerie de quartier";
  let reportLat = userPos.lat;
  let reportLng = userPos.lng;

  if (storeIndex !== "" && nearbyStores[storeIndex]) {
    const selected = nearbyStores[storeIndex];
    storeName = selected.tags.name || "Épicerie de quartier";
    reportLat = selected.lat || (selected.center && selected.center.lat) || userPos.lat;
    reportLng = selected.lon || (selected.center && selected.center.lon) || userPos.lng;
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

  const { error } = await supabaseClient.from("reports").insert([newRecord]);

  if (error) {
    alert("Erreur lors de l'envoi du signalement.");
  } else {
    document.getElementById("report-form").reset();
  }

  if (submitBtn) submitBtn.disabled = false;
}
