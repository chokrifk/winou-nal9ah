const SUPABASE_URL = "https://iahzasnluqapwppclfmn.supabase.co";
const SUPABASE_KEY = "sb_publishable_TIb7eyfTYz5x-DhexGOWDw_VkPja_E-";

let supabaseClient = null;
let realtimeChannel = null;
let realtimeSubscribed = false;

let map;
let userPos = { lat: 36.8065, lng: 10.1815 }; // Ariana / Tunis par défaut
let nearbyStores = [];

const markersMap = new Map();
const osmMarkersGroup = L.layerGroup(); // Groupe pour les stations/magasins OSM
const processedReportIds = new Set();

document.addEventListener("DOMContentLoaded", () => {
  try {
    if (window.supabase && window.supabase.createClient) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false }
      });
    }
  } catch (err) {
    console.warn("Supabase error:", err);
  }

  const reportForm = document.getElementById("report-form");
  if (reportForm) {
    reportForm.addEventListener("submit", handleReportSubmit);
  }

  initMap();
});

function toggleCustomProductInput(selectEl) {
  const customGroup = document.getElementById("custom-product-group");
  const customInput = document.getElementById("product-custom");

  if (selectEl.value === "Autre") {
    customGroup.style.display = "block";
    customInput.required = true;
  } else {
    customGroup.style.display = "none";
    customInput.required = false;
    customInput.value = "";
  }
}

function initMap() {
  map = L.map("map").setView([userPos.lat, userPos.lng], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(map);

  osmMarkersGroup.addTo(map);

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

        fetchNearbyShopsAndFuelOSM(userPos.lat, userPos.lng);
      },
      () => fetchNearbyShopsAndFuelOSM(userPos.lat, userPos.lng),
      { timeout: 8000 }
    );
  } else {
    fetchNearbyShopsAndFuelOSM(userPos.lat, userPos.lng);
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

// RECHERCHE DES STATIONS ET COMMERCES ET AFFICHAGE SUR LA CARTE + LISTE
async function fetchNearbyShopsAndFuelOSM(lat, lng) {
  const storeSelect = document.getElementById("store-select");
  if (!storeSelect) return;

  const query = `
    [out:json];
    (
      node["shop"="supermarket"](around:4000, ${lat}, ${lng});
      node["shop"="convenience"](around:4000, ${lat}, ${lng});
      node["amenity"="fuel"](around:4000, ${lat}, ${lng});
      way["shop"="supermarket"](around:4000, ${lat}, ${lng});
      way["shop"="convenience"](around:4000, ${lat}, ${lng});
      way["amenity"="fuel"](around:4000, ${lat}, ${lng});
    );
    out center 40;
  `;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: query });
    const data = await response.json();

    storeSelect.innerHTML = "";
    osmMarkersGroup.clearLayers(); // Nettoyer les anciens marqueurs sur la carte
    nearbyStores = data.elements || [];

    if (nearbyStores.length === 0) {
      storeSelect.innerHTML = "<option value=''>Station / Commerce de proximité</option>";
      return;
    }

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "-- Sélectionner une station ou commerce --";
    storeSelect.appendChild(defaultOpt);

    nearbyStores.forEach((store, index) => {
      const isFuel = store.tags.amenity === "fuel";
      const defaultName = isFuel ? "Station-Service" : "Commerce de proximité";
      const name = store.tags.name || store.tags.brand || defaultName;
      const iconText = isFuel ? "⛽ " : "🏬 ";

      // 1. Ajouter dans la liste déroulante
      const opt = document.createElement("option");
      opt.value = index;
      opt.textContent = `${iconText}${name}`;
      storeSelect.appendChild(opt);

      // 2. Coordonnées du lieu (pour les 'way', Overpass renvoie 'center')
      const sLat = store.lat || (store.center && store.center.lat);
      const sLng = store.lon || (store.center && store.center.lon);

      if (sLat && sLng) {
        // Création d'un marqueur visuel sur la carte pour chaque station/commerce trouvé
        const markerColor = isFuel ? "#f97316" : "#0ea5e9"; // Orange pour essence, Bleu pour commerce
        const pinIcon = L.divIcon({
          className: 'custom-osm-pin',
          html: `<div style="background-color: ${markerColor}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; box-shadow: 0 2px 5px rgba(0,0,0,0.3); white-space: nowrap;">${iconText}${name}</div>`,
          iconSize: [0, 0],
          iconAnchor: [15, 15]
        });

        const osmMarker = L.marker([sLat, sLng], { icon: pinIcon })
          .bindPopup(`
            <div style="font-family: inherit;">
              <b>${iconText}${name}</b><br/>
              <span style="color: #64748b; font-size: 0.85rem;">${isFuel ? "Station-service" : "Commerce"}</span><br/>
              <button onclick="document.getElementById('store-select').value='${index}'; document.getElementById('report-form').scrollIntoView({behavior:'smooth'});" style="margin-top: 6px; background: #10b981; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">Sélectionner pour signaler</button>
            </div>
          `);

        osmMarkersGroup.addLayer(osmMarker);
      }
    });
  } catch (err) {
    storeSelect.innerHTML = "<option value=''>Station / Commerce de proximité</option>";
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
  const storeName = report.store_name || "Station / Commerce";
  const productName = report.product_name || "Produit";

  if (!markersMap.has(reportId)) {
    const marker = L.marker([report.latitude, report.longitude])
      .addTo(map)
      .bindPopup(`
        <div style="font-family: inherit; line-height: 1.4;">
          <b style="font-size: 1.05rem; color: #0f172a;">📦 ${productName}</b> <span class="badge-status ${badgeClass}">${statusLabel}</span><br/>
          <span style="color: #0284c7; font-weight: 600;">📍 ${storeName}</span><br/>
          <span style="color: #64748b; font-size: 0.85rem;">🏙️ ${addressText}</span><br/>
          <span style="color: #94a3b8; font-size: 0.78rem;">🕒 ${formattedDate}</span>
        </div>
      `);
    markersMap.set(reportId, marker);
  }

  const feedContainer = document.getElementById("reports-feed");
  if (feedContainer) {
    if (feedContainer.querySelector("p")) {
      feedContainer.innerHTML = "";
    }

    const item = document.createElement("div");
    item.className = `feed-item ${isDispo ? "disponible" : "rupture"}`;
    item.setAttribute("data-report-id", reportId);
    item.onclick = () => window.focusOnMapMarker(reportId, report.latitude, report.longitude);

    item.innerHTML = `
      <div class="feed-details">
        <strong>📦 ${productName} <span class="badge-status ${badgeClass}">${statusLabel}</span></strong>
        <span class="feed-store" style="color: #0284c7; font-weight: 600; margin-top: 2px; display: block;">📍 ${storeName}</span>
        <span class="feed-address">🏙️ ${addressText}</span>
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
    📍 <small>${report.store_name || "Lieu"}</small>
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

  const productSelect = document.getElementById("product-select");
  let productName = productSelect.value;

  if (productName === "Autre") {
    productName = document.getElementById("product-custom").value.trim() || "Produit divers";
  }

  const storeSelect = document.getElementById("store-select");
  const storeIndex = storeSelect ? storeSelect.value : "";
  const status = document.getElementById("status").value;

  let storeName = "Station / Commerce de proximité";
  let reportLat = userPos.lat;
  let reportLng = userPos.lng;

  if (storeIndex !== "" && nearbyStores[storeIndex]) {
    const selected = nearbyStores[storeIndex];
    const isFuel = selected.tags.amenity === "fuel";
    const defaultName = isFuel ? "Station-Service" : "Commerce de proximité";
    storeName = selected.tags.name || selected.tags.brand || defaultName;
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
    document.getElementById("custom-product-group").style.display = "none";
  }

  if (submitBtn) submitBtn.disabled = false;
}
