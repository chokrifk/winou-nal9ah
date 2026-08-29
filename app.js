const SUPABASE_URL = "https://iahzasnluqapwppclfmn.supabase.co";
const SUPABASE_KEY = "sb_publishable_TIb7eyfTYz5x-DhexGOWDw_VkPja_E-";
const BASE_ONLINE_USERS = 2903;

let supabaseClient = null;
let realtimeChannel = null;
let presenceChannel = null;
let realtimeSubscribed = false;

let map;
let userPos = { lat: 36.8065, lng: 10.1815 }; // Ariana / Tunis par défaut
let nearbyStores = [];
let allReportsData = [];
let currentFilter = 'all';
let currentSearchQuery = '';
let interactivePinMarker = null;

const markersMap = new Map();
const osmMarkersGroup = L.layerGroup();
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
  initPresenceTracking();
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
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  osmMarkersGroup.addTo(map);

  map.on("click", async (e) => {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    
    document.getElementById("selected-lat").value = lat;
    document.getElementById("selected-lng").value = lng;

    if (interactivePinMarker) {
      map.removeLayer(interactivePinMarker);
    }

    interactivePinMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'interactive-target-pin',
        html: `<div style="background:#2563eb; color:white; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; box-shadow:0 0 10px rgba(37,99,235,0.7); border:2px solid white;">📍</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    }).addTo(map);

    const address = await getAddressFromCoords(lat, lng);
    document.getElementById("selected-custom-address").value = address;

    const storeSelect = document.getElementById("store-select");
    if (storeSelect) {
      let customOpt = storeSelect.querySelector("option[value='custom_map_point']");
      if (!customOpt) {
        customOpt = document.createElement("option");
        customOpt.value = "custom_map_point";
        storeSelect.insertBefore(customOpt, storeSelect.firstChild);
      }
      customOpt.textContent = `🎯 Point personnalisé : ${address}`;
      storeSelect.value = "custom_map_point";
    }

    showToastNotification("🎯 Lieu épinglé sur la carte avec succès !");
  });

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
          radius: 8,
          weight: 2
        }).addTo(map).bindPopup("<b>📍 Vous êtes ici (GPS)</b>");

        fetchNearbyShopsAndFuelOSM(userPos.lat, userPos.lng);
      },
      (err) => {
        console.warn("Géolocalisation refusée, utilisation Ariana/Tunis par défaut.", err);
        fetchNearbyShopsAndFuelOSM(userPos.lat, userPos.lng);
      },
      { timeout: 10000, enableHighAccuracy: false }
    );
  } else {
    fetchNearbyShopsAndFuelOSM(userPos.lat, userPos.lng);
  }
}

window.recenterMap = function() {
  if (map && userPos) {
    map.setView([userPos.lat, userPos.lng], 15, { animate: true });
    showToastNotification("🎯 Recentré sur votre position GPS");
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
    console.warn("Reverse geocode err:", err);
  }
  return "Tunisie (Lieu sélectionné)";
}

window.focusOnMapMarker = function(reportId, lat, lng) {
  if (!map) return;
  map.setView([lat, lng], 17, { animate: true });
  const marker = markersMap.get(String(reportId));
  if (marker) marker.openPopup();
  document.getElementById("map")?.scrollIntoView({ behavior: "smooth", block: "center" });
};

function initPresenceTracking() {
  if (!supabaseClient) return;
  presenceChannel = supabaseClient.channel("winou-presence-room", {
    config: { presence: { key: "user_" + Math.random().toString(36).substring(2, 9) } }
  });

  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      const liveCount = Object.keys(state).length;
      const totalOnline = BASE_ONLINE_USERS + Math.max(0, liveCount);

      const countEl = document.getElementById("connected-users-count");
      if (countEl) countEl.textContent = totalOnline;

      const statOnlineEl = document.getElementById("stat-online");
      if (statOnlineEl) statOnlineEl.textContent = totalOnline;
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({ online_at: new Date().toISOString() });
      }
    });
}

window.selectStoreFromMap = function(index) {
  const storeSelect = document.getElementById("store-select");
  if (storeSelect) {
    storeSelect.value = index;
    storeSelect.style.borderColor = "#10b981";
    storeSelect.style.boxShadow = "0 0 0 3px rgba(16, 185, 129, 0.2)";
    setTimeout(() => {
      storeSelect.style.borderColor = "";
      storeSelect.style.boxShadow = "";
    }, 1500);
  }
  document.getElementById("report-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
};

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
    osmMarkersGroup.clearLayers();
    nearbyStores = data.elements || [];

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = nearbyStores.length > 0 ? "-- Sélectionnez un commerce ou station --" : "Aucun commerce détecté à proximité";
    storeSelect.appendChild(defaultOpt);

    nearbyStores.forEach((store, index) => {
      const isFuel = store.tags.amenity === "fuel";
      const defaultName = isFuel ? "Station-Service" : "Commerce de proximité";
      const name = store.tags.name || store.tags.brand || defaultName;
      const iconText = isFuel ? "⛽ " : "🏬 ";

      const opt = document.createElement("option");
      opt.value = index;
      opt.textContent = `${iconText}${name}`;
      storeSelect.appendChild(opt);

      const sLat = store.lat || (store.center && store.center.lat);
      const sLng = store.lon || (store.center && store.center.lon);

      if (sLat && sLng) {
        const markerColor = isFuel ? "#f97316" : "#0ea5e9";
        const pinIcon = L.divIcon({
          className: 'custom-osm-pin',
          html: `<div style="background-color: ${markerColor}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; box-shadow: 0 2px 8px rgba(0,0,0,0.3); white-space: nowrap;">${iconText}${name}</div>`,
          iconSize: [0, 0],
          iconAnchor: [15, 15]
        });

        const osmMarker = L.marker([sLat, sLng], { icon: pinIcon })
          .bindPopup(`
            <div style="font-family: inherit;">
              <b>${iconText}${name}</b><br/>
              <span style="color: #64748b; font-size: 0.85rem;">${isFuel ? "Station-service" : "Commerce"}</span><br/>
              <button onclick="selectStoreFromMap('${index}')" style="margin-top: 8px; background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: bold;">📍 Sélectionner ce lieu</button>
            </div>
          `);

        osmMarkersGroup.addLayer(osmMarker);
      }
    });
  } catch (err) {
    storeSelect.innerHTML = "<option value=''>Erreur de chargement des lieux proches</option>";
  }
}

async function fetchReports() {
  if (!supabaseClient) return;

  const { data: reports, error } = await supabaseClient
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return;

  allReportsData = reports || [];
  updateStatsDashboard();
  renderReportsFeed();
  renderMapMarkers();
}

window.handleListSearch = function(productName) {
  currentSearchQuery = productName.toLowerCase().trim();
  renderReportsFeed();
  renderMapMarkers();
};

window.filterReports = function(status, btnEl) {
  currentFilter = status;
  document.querySelectorAll('.filter-pills .pill-btn').forEach(btn => btn.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  renderReportsFeed();
  renderMapMarkers();
};

function renderReportsFeed() {
  const feedContainer = document.getElementById("reports-feed");
  if (!feedContainer) return;

  feedContainer.innerHTML = "";

  let filtered = allReportsData.filter(r => {
    const matchStatus = (currentFilter === 'all' || r.status === currentFilter);
    const matchQuery = !currentSearchQuery || 
      (r.product_name && r.product_name.toLowerCase().includes(currentSearchQuery)) ||
      (r.store_name && r.store_name.toLowerCase().includes(currentSearchQuery)) ||
      (r.address && r.address.toLowerCase().includes(currentSearchQuery));
    return matchStatus && matchQuery;
  });

  if (filtered.length === 0) {
    feedContainer.innerHTML = "<p style='color:#64748b; text-align:center; padding: 24px;'>Aucun signalement ne correspond à votre sélection.</p>";
    return;
  }

  filtered.forEach(report => {
    const reportId = String(report.id);
    const isDispo = report.status === "Disponible";
    const badgeClass = isDispo ? "badge-dispo" : "badge-rupture";
    const statusLabel = isDispo ? "En stock" : "En rupture";

    const formattedDate = new Date(report.created_at).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });

    const item = document.createElement("div");
    item.className = `feed-item ${isDispo ? "disponible" : "rupture"}`;
    item.setAttribute("data-report-id", reportId);
    item.onclick = () => window.focusOnMapMarker(reportId, report.latitude, report.longitude);

    item.innerHTML = `
      <div class="feed-details">
        <strong>📦 ${report.product_name} <span class="badge-status ${badgeClass}">${statusLabel}</span></strong>
        <span class="feed-store" style="color: #0284c7; font-weight: 600; margin-top: 2px; display: block;">📍 ${report.store_name || "Lieu"}</span>
        <span class="feed-address">🏙️ ${report.address || "Tunisie"}</span>
      </div>
      <div class="feed-time">🕒 ${formattedDate}</div>
    `;

    feedContainer.appendChild(item);
  });
}

function renderMapMarkers() {
  markersMap.forEach(marker => map.removeLayer(marker));
  markersMap.clear();

  let filtered = allReportsData.filter(r => {
    const matchStatus = (currentFilter === 'all' || r.status === currentFilter);
    const matchQuery = !currentSearchQuery || 
      (r.product_name && r.product_name.toLowerCase().includes(currentSearchQuery)) ||
      (r.store_name && r.store_name.toLowerCase().includes(currentSearchQuery)) ||
      (r.address && r.address.toLowerCase().includes(currentSearchQuery));
    return matchStatus && matchQuery;
  });

  filtered.forEach(report => {
    const reportId = String(report.id);
    const isDispo = report.status === "Disponible";
    const badgeClass = isDispo ? "badge-dispo" : "badge-rupture";
    const statusLabel = isDispo ? "En stock" : "En rupture";
    const markerColor = isDispo ? "#10b981" : "#ef4444";

    const customPin = L.divIcon({
      className: 'custom-report-pin',
      html: `<div style="background-color: ${markerColor}; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); border: 2px solid white;">${isDispo ? '✓' : '✕'}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const formattedDate = new Date(report.created_at).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });

    const marker = L.marker([report.latitude, report.longitude], { icon: customPin })
      .addTo(map)
      .bindPopup(`
        <div style="font-family: inherit; line-height: 1.5; min-width: 180px;">
          <b style="font-size: 1.05rem; color: #0f172a;">📦 ${report.product_name}</b> <span class="badge-status ${badgeClass}">${statusLabel}</span><br/>
          <span style="color: #0284c7; font-weight: 600;">📍 ${report.store_name || "Lieu"}</span><br/>
          <span style="color: #64748b; font-size: 0.85rem;">🏙️ ${report.address || "Tunisie"}</span><br/>
          <span style="color: #94a3b8; font-size: 0.78rem; display: block; margin-top: 4px;">🕒 ${formattedDate}</span>
        </div>
      `);

    markersMap.set(reportId, marker);
  });
}

function updateStatsDashboard() {
  const total = allReportsData.length;
  const dispo = allReportsData.filter(r => r.status === "Disponible").length;
  const rupture = allReportsData.filter(r => r.status === "Rupture").length;

  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-dispo").textContent = dispo;
  document.getElementById("stat-rupture").textContent = rupture;

  const regionEl = document.getElementById("stat-top-region");
  if (regionEl) {
    if (allReportsData.length === 0) {
      regionEl.textContent = "Aucune donnée nationale";
    } else {
      const counts = {};
      allReportsData.forEach(r => {
        if (r.address) {
          const parts = r.address.split(",");
          const city = parts[parts.length - 1].trim();
          if (city) {
            counts[city] = (counts[city] || 0) + 1;
          }
        }
      });

      let topCity = "Grand Tunis / Ariana";
      let maxCount = 0;
      for (const [city, count] of Object.entries(counts)) {
        if (count > maxCount) {
          maxCount = count;
          topCity = city;
        }
      }
      regionEl.textContent = topCity;
    }
  }
}

function showToastNotification(text) {
  const toast = document.createElement("div");
  toast.className = "toast-notification";
  toast.innerHTML = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function listenRealtimeReports() {
  if (!supabaseClient || realtimeSubscribed) return;

  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel("winou-realtime-reports")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "reports" },
      (payload) => {
        const newReport = payload.new;
        if (newReport && newReport.id) {
          const reportId = String(newReport.id);
          if (!processedReportIds.has(reportId)) {
            processedReportIds.add(reportId);
            allReportsData.unshift(newReport);
            updateStatsDashboard();
            renderReportsFeed();
            renderMapMarkers();
            showToastNotification(`🚨 Nouvelle alerte : <b>${newReport.product_name}</b> (${newReport.status})`);
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

  let storeName = "Commerce de proximité";
  let reportLat = userPos.lat;
  let reportLng = userPos.lng;

  if (storeIndex === "custom_map_point") {
    reportLat = parseFloat(document.getElementById("selected-lat").value) || userPos.lat;
    reportLng = parseFloat(document.getElementById("selected-lng").value) || userPos.lng;
    storeName = "Lieu épinglé sur carte";
  } else if (storeIndex !== "" && nearbyStores[storeIndex]) {
    const selected = nearbyStores[storeIndex];
    const isFuel = selected.tags.amenity === "fuel";
    const defaultName = isFuel ? "Station-Service" : "Commerce de proximité";
    storeName = selected.tags.name || selected.tags.brand || defaultName;
    reportLat = selected.lat || (selected.center && selected.center.lat) || userPos.lat;
    reportLng = selected.lon || (selected.center && selected.center.lon) || userPos.lng;
  }

  let fetchedAddress = document.getElementById("selected-custom-address").value;
  if (!fetchedAddress || storeIndex !== "custom_map_point") {
    fetchedAddress = await getAddressFromCoords(reportLat, reportLng);
  }

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
    alert("Erreur lors de l'envoi de l'alerte. Veuillez réessayer.");
  } else {
    document.getElementById("report-form").reset();
    document.getElementById("custom-product-group").style.display = "none";
    if (interactivePinMarker) {
      map.removeLayer(interactivePinMarker);
      interactivePinMarker = null;
    }
    showToastNotification("✅ Alerte diffusée avec succès sur tout le réseau !");
  }

  if (submitBtn) submitBtn.disabled = false;
}

// Logique de l'Assistant IA Winou
window.openAIAssistantModal = function() {
  const modal = document.getElementById("ai-chat-modal");
  if (modal) modal.style.display = "flex";
};

window.closeAIAssistantModal = function() {
  const modal = document.getElementById("ai-chat-modal");
  if (modal) modal.style.display = "none";
};

window.handleAIPressKey = function(e) {
  if (e.key === "Enter") sendAIMessage();
};

window.sendAIMessage = function() {
  const inputEl = document.getElementById("ai-user-input");
  const messagesContainer = document.getElementById("ai-chat-messages");
  const query = inputEl.value.trim();
  if (!query) return;

  messagesContainer.innerHTML += `<div class="ai-msg user">${escapeHtml(query)}</div>`;
  inputEl.value = "";
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  setTimeout(() => {
    let botReply = "Je n'ai pas trouvé assez de détails, essayez de consulter le flux en direct.";
    const lowerQ = query.toLowerCase();

    if (lowerQ.includes("lait") || lowerQ.includes("carburant") || lowerQ.includes("essence") || lowerQ.includes("eau") || lowerQ.includes("sucre") || lowerQ.includes("gasoil")) {
      const found = allReportsData.filter(r => r.product_name && lowerQ.includes(r.product_name.toLowerCase()) && r.status === "Disponible");
      if (found.length > 0) {
        botReply = `✅ Oui ! J'ai trouvé ${found.length} signalement(s) en stock :\n` + found.map(f => `• ${f.product_name} chez ${f.store_name} (${f.address})`).join("\n");
      } else {
        botReply = `❌ Désolé, aucun stock récent n'est actuellement signalé pour cette recherche. Pensez à publier une alerte si vous en trouvez !`;
      }
    } else if (lowerQ.includes("combien") || lowerQ.includes("total") || lowerQ.includes("stat")) {
      const dispoCount = allReportsData.filter(r => r.status === "Disponible").length;
      botReply = `📊 Il y a actuellement ${allReportsData.length} signalements au total sur le réseau, dont ${dispoCount} produits disponibles.`;
    } else {
      botReply = `💡 Astuce : Vous pouvez me demander si un produit spécifique (ex: "lait", "essence", "eau") est disponible, ou utiliser le filtre par liste en haut à gauche !`;
    }

    messagesContainer.innerHTML += `<div class="ai-msg bot">${escapeHtml(botReply).replace(/\n/g, '<br>')}</div>`;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }, 500);
};

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}
