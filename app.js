const map = L.map('map').setView([36.8625, 10.1956], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

// Chargement initial ou depuis le LocalStorage pour la persistance
let signals = JSON.parse(localStorage.getItem('win_nal9a_signals')) || [
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
        if (statusFilter === "stock" && sig.status !== "En stock") return;
        if (statusFilter === "rupture" && sig.status !== "En rupture") return;
        if (productFilter !== "all" && sig.product !== productFilter) return;

        locationsList.push(sig.location);

        const color = sig.status === "En stock" ? "#10b981" : "#ef4444";
        const markerHtml = `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.3);"></div>`;
        
        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: markerHtml,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });

        // Lien direct vers Waze / Google Maps dans la popup
        const wazeUrl = `https://www.waze.com/ul?ll=${sig.lat},${sig.lng}&navigate=yes`;
        const popupContent = `<b>${sig.product}</b><br>Statut: <b>${sig.status}</b><br>Lieu: ${sig.location}<br><br><a href="${wazeUrl}" target="_blank" style="background:#0284c7; color:white; padding:4px 8px; text-decoration:none; border-radius:4px; font-size:11px;">🚗 Itinéraire Waze</a>`;

        const marker = L.marker([sig.lat, sig.lng], { icon: customIcon });
        marker.bindPopup(popupContent);
        markersLayer.addLayer(marker);

        const div = document.createElement('div');
        div.className = 'alert-item';
        div.innerHTML = `<strong>${sig.product}</strong> - <span style="color:${color}">${sig.status}</span><br><small>📍 ${sig.location}</small>`;
        stream.appendChild(div);
    });

    updateTopLocation(locationsList);
    localStorage.setItem('win_nal9a_signals', JSON.stringify(signals));
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

// Géolocalisation GPS réelle de l'utilisateur
document.getElementById('btn-gps').addEventListener('click', () => {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            map.setView([lat, lng], 15);
            L.marker([lat, lng]).addTo(map).bindPopup("📍 Vous êtes ici").openPopup();
        }, () => {
            alert("Impossible de récupérer votre position GPS.");
        });
    } else {
        alert("La géolocalisation n'est pas supportée par votre navigateur.");
    }
});

let currentStatusFilter = "all";
document.querySelectorAll('.filter-actions .btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-actions .btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentStatusFilter = e.target.getAttribute('data-filter');
        renderApp(currentStatusFilter, document.getElementById('product-filter').value);
    });
});

document.getElementById('product-filter').addEventListener('change', (e) => {
    renderApp(currentStatusFilter, e.target.value);
});

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
        lat: center.lat + (Math.random() - 0.5) * 0.005,
        lng: center.lng + (Math.random() - 0.5) * 0.005,
        location: locationName
    });

    renderApp(currentStatusFilter, document.getElementById('product-filter').value);
    document.getElementById('signal-form').reset();
});

document.getElementById('toggle-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
});

renderApp();
