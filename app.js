// --- CONFIGURATION SUPABASE (À connecter avec tes clés si besoin) ---
const SUPABASE_URL = 'https://ton-projet.supabase.co';
const SUPABASE_ANON_KEY = 'ton-anon-key';

let supabaseClient = null;
if (typeof supabase !== 'undefined' && SUPABASE_URL.includes('supabase.co') === false) {
  try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch(e) { console.warn("Supabase init error:", e); }
}

// Données fictives initiales ultra-réalistes (Tunisie)
let allReports = [
  { id: 1, product: 'Essence Sans Plomb', status: 'Disponible', store: 'Station Agil (Avenue Habib Bourguiba, Tunis)', lat: 36.8065, lng: 10.1815, time: 'Il y a 5 min', helpful: 14, obsolete: 1 },
  { id: 2, product: 'Lait', status: 'Rupture', store: 'Monoprix (El Menzah 6, Ariana)', lat: 36.8381, lng: 10.1872, time: 'Il y a 12 min', helpful: 8, obsolete: 0 },
  { id: 3, product: 'Bouteille de gaz', status: 'Disponible', store: 'Station TotalEnergies (La Marsa)', lat: 36.8782, lng: 10.3256, time: 'Il y a 25 min', helpful: 22, obsolete: 2 },
  { id: 4, product: 'Eau minérale', status: 'Disponible', store: 'Carrefour Market (Bardo)', lat: 36.8101, lng: 10.1398, time: 'Il y a 40 min', helpful: 11, obsolete: 0 }
];

let map;
let markersLayer;
let userLatLng = { lat: 36.8065, lng: 10.1815 }; // Position par défaut (Tunis)
let userMarker = null;
let currentFilterStatus = 'all';
let currentProductFilter = '';
let currentRadiusKm = 'all';

// Stations / Commerces tunisiens de référence pour le formulaire
const referenceStores = [
  { name: "Station Agil - Centre Ville", lat: 36.8065, lng: 10.1815 },
  { name: "Station TotalEnergies - El Menzah", lat: 36.8381, lng: 10.1872 },
  { name: "Station Ola Energy - Ariana", lat: 36.8625, lng: 10.1956 },
  { name: "Monoprix - Ariana Centre", lat: 36.8601, lng: 10.1643 },
  { name: "Carrefour Market - La Marsa", lat: 36.8782, lng: 10.3256 },
  { name: "Magasin Général - Bardo", lat: 36.8101, lng: 10.1398 },
  { name: "Station Shell - Carthage", lat: 36.8532, lng: 10.3341 }
];

document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  initMap();
  populateStoreDropdown();
  renderReportsFeed(allReports);
  setupFormListener();
  startLiveTicker();
});

// --- 1. DARK MODE ---
function initDarkMode() {
  const savedTheme = localStorage.getItem('win_nal9a_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeButtonIcon(savedTheme);
}

function toggleDarkMode() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('win_nal9a_theme', newTheme);
  updateThemeButtonIcon(newTheme);
}

function updateThemeButtonIcon(theme) {
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// --- 2. CARTE & GÉOLOCALISATION ---
function initMap() {
  map = L.map('map').setView([userLatLng.lat, userLatLng.lng], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  plotMarkers(allReports);

  // Clic sur la carte pour pointer un nouveau lieu
  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    document.getElementById('selected-lat').value = lat;
    document.getElementById('selected-lng').value = lng;
    document.getElementById('selected-custom-address').value = `Position géographique (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    // Ajouter ou déplacer le marqueur temporaire de sélection
    if (window.tempMarker) {
      map.removeLayer(window.tempMarker);
    }
    window.tempMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: 'custom-pin', html: '📍', iconSize: [30, 30] })
    }).addTo(map).bindPopup("<b>Lieu sélectionné sur la carte !</b>").openPopup();

    // Mettre à jour le select store
    const storeSelect = document.getElementById('store-select');
    const opt = document.createElement('option');
    opt.value = `📍 Point personnalisé (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
    opt.textContent = `📍 Point personnalisé sur la carte`;
    opt.selected = true;
    storeSelect.appendChild(opt);
  });

  // Géolocalisation automatique du navigateur
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      userLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setView([userLatLng.lat, userLatLng.lng], 14);
      
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.marker([userLatLng.lat, userLatLng.lng], {
        icon: L.divIcon({ className: 'user-pin', html: '🔵', iconSize: [25, 25] })
      }).addTo(map).bindPopup("<b>Vous êtes ici (GPS)</b>");
    }, (err) => {
      console.log("Géolocalisation refusée ou indisponible, position par défaut (Tunis).");
    });
  }
}

function recenterMap() {
  map.setView([userLatLng.lat, userLatLng.lng], 14);
  if (userMarker) userMarker.openPopup();
}

function plotMarkers(reportsToDisplay) {
  if (!markersLayer) return;
  markersLayer.clearLayers();

  reportsToDisplay.forEach(r => {
    const colorPin = r.status === 'Disponible' ? '🟢' : '🔴';
    const customIcon = L.divIcon({
      className: 'map-status-icon',
      html: `<div style="background:var(--card-bg); padding:4px 8px; border-radius:20px; border:2px solid ${r.status === 'Disponible' ? '#22c55e' : '#ef4444'}; font-size:12px; font-weight:bold; box-shadow:0 2px 6px rgba(0,0,0,0.2);">${colorPin} ${r.product}</div>`,
      iconSize: [120, 30],
      iconAnchor: [60, 15]
    });

    const marker = L.marker([r.lat, r.lng], { icon: customIcon });
    
    // Lien Waze / Google Maps direct
    const wazeUrl = `https://www.waze.com/ul?ll=${r.lat},${r.lng}&navigate=yes`;
    const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`;

    marker.bindPopup(`
      <div style="font-family:sans-serif; min-width:180px;">
        <b style="font-size:14px;">${r.product}</b><br>
        <span style="color:${r.status === 'Disponible' ? '#16a34a' : '#dc2626'}; font-weight:bold;">● ${r.status}</span><br>
        <span style="font-size:12px; color:#555;">📍 ${r.store}</span><br><br>
        <div style="display:flex; gap:6px;">
          <a href="${wazeUrl}" target="_blank" style="flex:1; background:#33ccff; color:#000; padding:4px 8px; border-radius:4px; text-decoration:none; font-size:11px; font-weight:bold; text-align:center;">🚗 Waze</a>
          <a href="${gmapsUrl}" target="_blank" style="flex:1; background:#4285F4; color:#fff; padding:4px 8px; border-radius:4px; text-decoration:none; font-size:11px; font-weight:bold; text-align:center;">🗺️ Maps</a>
        </div>
      </div>
    `);

    markersLayer.addLayer(marker);
  });
}

// --- 3. GESTION DES STORES DU FORMULAIRE ---
function populateStoreDropdown() {
  const select = document.getElementById('store-select');
  select.innerHTML = '<option value="" disabled selected>-- Sélectionnez un commerce ou station --</option>';
  
  referenceStores.forEach(st => {
    const opt = document.createElement('option');
    opt.value = st.name;
    opt.textContent = `📍 ${st.name}`;
    opt.dataset.lat = st.lat;
    opt.dataset.lng = st.lng;
    select.appendChild(opt);
  });
}

document.getElementById('store-select')?.addEventListener('change', (e) => {
  const selectedOpt = e.target.selectedOptions[0];
  if (selectedOpt && selectedOpt.dataset.lat) {
    document.getElementById('selected-lat').value = selectedOpt.dataset.lat;
    document.getElementById('selected-lng').value = selectedOpt.dataset.lng;
    document.getElementById('selected-custom-address').value = selectedOpt.value;
    map.setView([parseFloat(selectedOpt.dataset.lat), parseFloat(selectedOpt.dataset.lng)], 15);
  }
});

function toggleCustomProductInput(selectEl) {
  const customGroup = document.getElementById('custom-product-group');
  if (selectEl.value === 'Autre') {
    customGroup.style.display = 'block';
    document.getElementById('product-custom').required = true;
  } else {
    customGroup.style.display = 'none';
    document.getElementById('product-custom').required = false;
  }
}

// --- 4. FILTRAGE & PROXIMITÉ (RAYON KM) ---
function handleListSearch(prod) {
  currentProductFilter = prod;
  applyFilters();
}

function filterReports(status, btnElement) {
  currentFilterStatus = status;
  document.querySelectorAll('.filter-pills .pill-btn').forEach(b => b.classList.remove('active'));
  btnElement.classList.add('active');
  applyFilters();
}

function handleRadiusChange(radiusVal) {
  currentRadiusKm = radiusVal;
  applyFilters();
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Rayon de la terre en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function applyFilters() {
  let filtered = allReports;

  // Filtre par statut
  if (currentFilterStatus !== 'all') {
    filtered = filtered.filter(r => r.status === currentFilterStatus);
  }

  // Filtre par produit
  if (currentProductFilter) {
    filtered = filtered.filter(r => r.product.toLowerCase().includes(currentProductFilter.toLowerCase()));
  }

  // Filtre par rayon géographique (km)
  if (currentRadiusKm !== 'all') {
    const maxKm = parseFloat(currentRadiusKm);
    filtered = filtered.filter(r => {
      const dist = calculateDistance(userLatLng.lat, userLatLng.lng, r.lat, r.lng);
      return dist <= maxKm;
    });
  }

  renderReportsFeed(filtered);
  plotMarkers(filtered);
}

// --- 5. FLUX DES ALERTES, VOTES & PARTAGE WHATSAPP ---
function renderReportsFeed(reports) {
  const feedContainer = document.getElementById('reports-feed');
  if (!feedContainer) return;

  if (reports.length === 0) {
    feedContainer.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding: 20px;">Aucun signalement ne correspond à vos critères.</p>`;
    return;
  }

  feedContainer.innerHTML = '';
  reports.forEach(r => {
    const badgeClass = r.status === 'Disponible' ? 'disponible' : 'rupture';
    const wazeUrl = `https://www.waze.com/ul?ll=${r.lat},${r.lng}&navigate=yes`;
    
    // Texte formaté pour WhatsApp / Telegram
    const whatsappText = encodeURIComponent(`🚨 *Win Nal9a Tunisie* \n📦 Produit: *${r.product}*\nStatut: *${r.status}*\n📍 Lieu: ${r.store}\n⏱️ Signalé ${r.time}\n👉 Voir sur la carte en direct !`);
    const whatsappUrl = `https://api.whatsapp.com/send?text=${whatsappText}`;

    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = `
      <div class="feed-item-top">
        <div class="feed-item-title">
          <span>${r.status === 'Disponible' ? '🟢' : '🔴'}</span> ${r.product}
        </div>
        <span class="status-badge ${badgeClass}">${r.status}</span>
      </div>
      <div class="feed-item-store">📍 ${r.store}</div>
      <div class="feed-item-footer">
        <span>⏱️ ${r.time}</span>
        <div style="display:flex; gap:6px; align-items:center;">
          <button class="vote-badge-btn" onclick="voteReport(${r.id}, 'helpful')">👍 ${r.helpful}</button>
          <button class="vote-badge-btn" onclick="voteReport(${r.id}, 'obsolete')">👎 ${r.obsolete}</button>
        </div>
      </div>
      <div class="feed-actions-row">
        <a href="${wazeUrl}" target="_blank" class="action-btn-sm" style="background:#0284c7; color:white; border:none;">🚗 Itinéraire Waze</a>
        <a href="${whatsappUrl}" target="_blank" class="action-btn-sm" style="background:#16a34a; color:white; border:none;">💬 Partager WhatsApp</a>
      </div>
    `;
    feedContainer.appendChild(item);
  });
}

function voteReport(id, type) {
  const report = allReports.find(r => r.id === id);
  if (report) {
    if (type === 'helpful') report.helpful++;
    if (type === 'obsolete') report.obsolete++;
    renderReportsFeed(allReports);
  }
}

// --- 6. SOUMISSION D'UN SIGNALEMENT ---
function setupFormListener() {
  const form = document.getElementById('report-form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    let productVal = document.getElementById('product-select').value;
    if (productVal === 'Autre') {
      productVal = document.getElementById('product-custom').value || 'Produit divers';
    }

    const statusVal = document.getElementById('status').value;
    const storeVal = document.getElementById('store-select').value;
    const latVal = parseFloat(document.getElementById('selected-lat').value) || userLatLng.lat + (Math.random() - 0.5) * 0.02;
    const lngVal = parseFloat(document.getElementById('selected-lng').value) || userLatLng.lng + (Math.random() - 0.5) * 0.02;

    if (!storeVal) {
      alert("Veuillez sélectionner ou pointer un lieu sur la carte.");
      return;
    }

    const newReport = {
      id: Date.now(),
      product: productVal,
      status: statusVal,
      store: storeVal,
      lat: latVal,
      lng: lngVal,
      time: "À l'instant",
      helpful: 1,
      obsolete: 0
    };

    allReports.unshift(newReport);
    applyFilters();
    form.reset();
    document.getElementById('custom-product-group').style.display = 'none';
    populateStoreDropdown();

    alert("✅ Votre signalement a été diffusé en direct sur le réseau Win Nal9a !");
  });
}

// --- 7. BANDEAU TICKER ANIMÉ ---
function startLiveTicker() {
  const ticker = document.getElementById('live-stock-ticker');
  if (!ticker) return;
  
  const flashes = [
    "⚡ Arrivage de Lait signalé à Monoprix Ariana à l'instant !",
    "🚗 Station Agil Tunis Centre : Essence Sans Plomb disponible.",
    "⚠️ Rupture de bouteilles de gaz signalée à La Marsa.",
    "💧 Eau minérale en stock chez Carrefour Market Bardo."
  ];

  let idx = 0;
  setInterval(() => {
    idx = (idx + 1) % flashes.length;
    ticker.textContent = flashes[idx];
  }, 6000);
}

// --- 8. ASSISTANT IA (WINOU AI) ---
function openAIAssistantModal() {
  document.getElementById('ai-chat-modal').style.display = 'flex';
}

function closeAIAssistantModal() {
  document.getElementById('ai-chat-modal').style.display = 'none';
}

function handleAIPressKey(e) {
  if (e.key === 'Enter') sendAIMessage();
}

function sendQuickPrompt(text) {
  document.getElementById('ai-user-input').value = text;
  sendAIMessage();
}

function sendAIMessage() {
  const inputEl = document.getElementById('ai-user-input');
  const msgContainer = document.getElementById('ai-chat-messages');
  const txt = inputEl.value.trim();
  if (!txt) return;

  // Message Utilisateur
  const userDiv = document.createElement('div');
  userDiv.className = 'ai-msg user';
  userDiv.innerHTML = `<div class="ai-avatar">👤</div><div class="ai-bubble">${txt}</div>`;
  msgContainer.appendChild(userDiv);
  inputEl.value = '';
  msgContainer.scrollTop = msgContainer.scrollHeight;

  // Réponse IA simulée intelligente
  setTimeout(() => {
    let reply = "D'après les derniers signalements en direct sur le réseau en Tunisie : ";
    const lower = txt.toLowerCase();

    if (lower.includes('lait')) {
      const laits = allReports.filter(r => r.product.toLowerCase().includes('lait'));
      reply += laits.length ? laits.map(l => `\n- ${l.product} (${l.status}) chez ${l.store}`).join('') : "\nAucun signalement récent sur le lait pour le moment.";
    } else if (lower.includes('essence') || lower.includes('carburant')) {
      const gas = allReports.filter(r => r.product.toLowerCase().includes('essence') || r.product.toLowerCase().includes('gasoil'));
      reply += gas.length ? gas.map(g => `\n- ${g.product} (${g.status}) à ${g.store}`).join('') : "\nStations ravitaillées signalées sur la carte.";
    } else {
      reply += "Tous les feux sont au vert pour explorer les stations et commerces proches de chez vous sur la carte interactive !";
    }

    const botDiv = document.createElement('div');
    botDiv.className = 'ai-msg bot';
    botDiv.innerHTML = `<div class="ai-avatar">✨</div><div class="ai-bubble">${reply}</div>`;
    msgContainer.appendChild(botDiv);
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }, 700);
}
