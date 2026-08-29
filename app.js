// Initialisation de la carte centrée sur Ariana, Tunisie
const map = L.map('map').setView([36.8625, 10.1956], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

// Liste initiale des signalements avec positions géographiques et lieux
let signals = [
    { id: 1, product: "Essence Sans Plomb", status: "En rupture", lat: 36.8650, lng: 10.1900, location: "Station Agil (Avenue Habib Bourguiba)" },
    { id: 2, product: "Eau minérale", status: "En stock", lat: 36.8600, lng: 10.2000, location: "Epicerie Proche (Ennasr)" },
    { id: 3, product: "Essence Sans Plomb", status: "En stock", lat: 36.8550, lng: 10.1850, location: "Station Total (Ariana Ville)" }
];

let markersLayer = L.layerGroup().addTo(map);

function renderApp(statusFilter = "all", productFilter = "all") {
    markersLayer.clearLayers();
    const stream = document.getElementById('alerts-stream');
    stream.innerHTML = "";

    const locationsList = [];

    signals.forEach(sig => {
        // Filtrage par statut
        if (statusFilter === "stock" && sig.status !== "En stock") return;
        if (statusFilter === "rupture" && sig.status !== "En rupture") return;

        // Filtrage par produit
        if (productFilter !== "all" && sig.product !== productFilter) return;

        locationsList.push(sig.location);

        // Ajout du marqueur sur la carte
        const color = sig.status === "En stock" ? "#10b981" : "#ef4444";
        const markerHtml = `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.3);"></div>`;
        
        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: markerHtml,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });

        const marker = L.marker([sig.lat, sig.lng], { icon: customIcon });
        marker.bindPopup(`<b>${sig.product}</b><br>Statut: <b>${sig.status}</b><br>Lieu: ${sig.location}`);
        markersLayer.addLayer(marker);

        // Alimentation du flux des alertes
        const div = document.createElement('div');
        div.className = 'alert-item';
        div.innerHTML = `<strong>${sig.product}</strong> - <span style="color:${color}">${sig.status}</span><br><small>📍 ${sig.location}</small>`;
        stream.appendChild(div);
    });

    updateTopLocation(locationsList);
}

function updateTopLocation(locations) {
    if (locations.length === 0) {
        document.getElementById('top-location').innerText = "Aucun";
        return;
    }
    const counts = {};
    let maxEl = locations[0], maxCount = 1;
    
    locations.forEach(loc => {
        counts[loc] = (counts[loc] || 0) + 1;
        if (counts[loc] > maxCount) {
            maxCount = counts[loc];
            maxEl = loc;
        }
    });

    document.getElementById('top-location').innerText = maxEl;
}

// Gestion des filtres par statut (Tout, Stock, Rupture)
let currentStatusFilter = "all";
document.querySelectorAll('.filter-actions .btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-actions .btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentStatusFilter = e.target.getAttribute('data-filter');
        const selectedProduct = document.getElementById('product-filter').value;
        renderApp(currentStatusFilter, selectedProduct);
    });
});

// Gestion du filtre par produit
document.getElementById('product-filter').addEventListener('change', (e) => {
    const selectedProduct = e.target.value;
    renderApp(currentStatusFilter, selectedProduct);
});

// Soumission d'un nouveau signalement
document.getElementById('signal-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const product = document.getElementById('signal-product').value;
    const status = document.getElementById('signal-status').value;
    const locationName = document.getElementById('signal-location').value;

    const center = map.getCenter();
    signals.push({
        id: signals.length + 1,
        product,
        status,
        lat: center.lat + (Math.random() - 0.5) * 0.008,
        lng: center.lng + (Math.random() - 0.5) * 0.008,
        location: locationName
    });

    renderApp(currentStatusFilter, document.getElementById('product-filter').value);
    document.getElementById('signal-form').reset();
});

// Toggle responsive du menu mobile
document.getElementById('toggle-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
});

// Lancement initial de l'application
renderApp();
