// Variable globale pour éviter les réabonnements multiples
let realtimeSubscribed = false;

// 1. DÉDOUBLONNAGE PAR ID STRICT + CONVERSION STRING
function addReportToUI(report, isNew = true) {
  if (!report || !report.id) return;
  
  const reportId = String(report.id);

  // Vérification stricte dans le Set ET dans le DOM
  if (processedReportIds.has(reportId) || document.querySelector(`[data-report-id="${reportId}"]`)) {
    return;
  }
  
  processedReportIds.add(reportId);

  const statusText = report.status === "Disponible" ? "🟢 En stock" : "🔴 En rupture";
  const formattedDate = new Date(report.created_at).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  const addressText = report.address || "Adresse non disponible";

  // Ajout du marqueur sur la carte
  if (!markersMap.has(reportId)) {
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
  }

  // Ajout dans le flux HTML
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

    if (isNew) {
      feedContainer.prepend(item);
    } else {
      feedContainer.appendChild(item);
    }
  }
}

// 2. SOUSCRIPTION UNIQUE ET SÉCURISÉE
function listenRealtimeReports() {
  if (!supabaseClient || realtimeSubscribed) return;

  // Nettoyage de tout ancien canal
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
          // Ajout uniquement s'il n'existe pas encore
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
