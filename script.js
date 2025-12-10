// ------------ Utilitaires de mise à l'échelle ------------

// Pour les points : taille des cercles proportionnelle au nb de captifs
function createSizeScale(maxValue, minRadius = 4, maxRadius = 25) {
  const maxRoot = Math.sqrt(maxValue || 1);

  return function (value) {
    if (!value || value <= 0) return minRadius;
    const root = Math.sqrt(value);
    const ratio = root / maxRoot;
    return minRadius + (maxRadius - minRadius) * ratio;
  };
}

// ------------ Variables globales ------------

const map = L.map("map");

// Fond de carte
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
  maxZoom: 10,
  attribution: '&copy; CartoDB &copy; OpenStreetMap contributors'
}).addTo(map);

// Échelle cartographique
L.control.scale().addTo(map);

// Calques pour gérer facilement mises à jour
const portsLayer = L.layerGroup().addTo(map);
const flowsLayer = L.layerGroup().addTo(map);

// Données globales
let ouidahFeature = null;
let ouidahLatLng = null;
let ouidahMarker = null;

let portsFeatures = []; // toutes les features des ports de débarquement

// Échelles globales
let maxValue = 0;
let minPositive = 0;
let sizeScale = null;
let minLog = 0;
let maxLog = 0;

// Pour ajuster l’emprise une seule fois
const bounds = L.latLngBounds();

// ------------ Fonctions d’échelle pour les lignes ------------

function initScales(values) {
  maxValue = Math.max(...values);
  minPositive = Math.min(...values.filter((v) => v > 0));

  sizeScale = createSizeScale(maxValue);

  minLog = Math.log10(minPositive);
  maxLog = Math.log10(maxValue);
}

// largeur de ligne proportionnelle au nombre de captifs (logarithmique)
function lineWidthFromTotal(total) {
  if (!total || total <= 0) return 1;
  const tLog = Math.log10(total);
  const ratio = (tLog - minLog) / (maxLog - minLog);
  const r = Math.max(0, Math.min(1, ratio)); // borne 0–1
  return 1 + r * 9; // entre 1 et 10 px
}

// ------------ Dessin des modes selon le zoom ------------

// Mode détaillé : tous les ports + tous les flux individuels
function drawDetailed() {
  portsLayer.clearLayers();
  flowsLayer.clearLayers();

  portsFeatures.forEach((f) => {
    if (!f.geometry || f.geometry.type !== "Point") return;

    const props = f.properties || {};
    const total = Number(props.total_disembarked);
    if (isNaN(total)) return;

    const coords = f.geometry.coordinates; // [lon, lat, ...]
    const latLng = [coords[1], coords[0]];
    const name = props.Principa_1 || "Port inconnu";

    // Cercle proportionnel (orange clair)
    const radius = sizeScale(total);

    const portMarker = L.circleMarker(latLng, {
      radius: radius,
      fillColor: "#ff8c00", // orange clair
      color: "#cc7000",
      weight: 1,
      fillOpacity: 0.8,
    }).addTo(portsLayer);

    // Popup "normale" pour port non agrégé
    portMarker.bindPopup(
      `<strong>${name}</strong><br>` +
        `${total.toLocaleString(
          "fr-FR"
        )} captifs ont été débarqués ici.`
    );

    // Flux Ouidah → port (violet)
    const latLngs = [ouidahLatLng, latLng];
    const weight = lineWidthFromTotal(total);

    const path = L.polyline(latLngs, {
      weight: weight,
      color: "#7b3294", // violet
      opacity: 0.8,
      className: "flow-line",
    }).addTo(flowsLayer);

    // Popup flux détaillé
    path.bindPopup(
      `${total.toLocaleString(
        "fr-FR"
      )} captifs déportés vers ${name}.`
    );
  });
}

// Mode agrégé : ports regroupés en N clusters
function drawClustered(clusterCount) {
  portsLayer.clearLayers();
  flowsLayer.clearLayers();

  // Construire un FeatureCollection Turf
  const fc = {
    type: "FeatureCollection",
    features: portsFeatures,
  };

  // Clustering par K-means
  const clustered = turf.clustersKmeans(fc, {
    numberOfClusters: clusterCount,
  });

  // Regrouper par identifiant de cluster
  const clusters = {}; // id -> {features:[], total: number}
  clustered.features.forEach((f) => {
    const cid = f.properties.cluster;
    if (!clusters[cid]) {
      clusters[cid] = { features: [], total: 0 };
    }
    clusters[cid].features.push(f);
    const t = Number(f.properties.total_disembarked) || 0;
    clusters[cid].total += t;
  });

  // Pour chaque cluster, on crée un point (centroïde) + un flux agrégé
  Object.values(clusters).forEach((cluster) => {
    const clusterFc = {
      type: "FeatureCollection",
      features: cluster.features,
    };

    // Centroïde géographique du cluster
    const centroid = turf.centroid(clusterFc);
    const coords = centroid.geometry.coordinates; // [lon, lat]
    const latLng = [coords[1], coords[0]];
    const total = cluster.total;

    // Nombre de ports dans le cluster
    const nbPorts = cluster.features.length;

    // Liste des noms de ports pour la popup de flux
    const portNames = Array.from(
      new Set(
        cluster.features
          .map((f) => f.properties && f.properties.Principa_1)
          .filter(Boolean)
      )
    );

    // Symbole proportionnel pour le regroupement (orange plus foncé)
    const radius = sizeScale(total);

    const marker = L.circleMarker(latLng, {
      radius: radius,
      fillColor: "#d97a00", // orange foncé
      color: "#995700", // contour orangé foncé
      weight: 1,
      fillOpacity: 0.85,
    }).addTo(portsLayer);

    // Popup des ports agrégés
    marker.bindPopup(
      `<strong>Regroupement de ${nbPorts} ports</strong><br>` +
        `${total.toLocaleString(
          "fr-FR"
        )} captifs ont été débarqués ici.`
    );

    // Flux Ouidah → centroïde du cluster (violet foncé)
    const latLngs = [ouidahLatLng, latLng];
    const weight = lineWidthFromTotal(total);

    const path = L.polyline(latLngs, {
      weight: weight,
      color: "#542788", // violet plus sombre
      opacity: 0.9,
      className: "flow-line",
    }).addTo(flowsLayer);

    // Contenu de la popup du flux agrégé
    let listHtml = "";
    if (portNames.length > 0) {
      listHtml =
        "<ul>" +
        portNames.map((n) => `<li>${n}</li>`).join("") +
        "</ul>";
    }

    path.bindPopup(
      `${total.toLocaleString(
        "fr-FR"
      )} captifs déportés vers :<br>` + listHtml
    );
  });
}

// Choix du mode selon le niveau de zoom
function updateMapForZoom(z) {
  // On met la vue détaillée plus souvent : à partir de zoom 5
  if (z >= 5) {
    drawDetailed();
  } else if (z >= 3) {
    drawClustered(20); // zoom intermédiaire : 20 regroupements
  } else {
    drawClustered(5); // zoom très éloigné : 5 grands regroupements
  }
}

// ------------ Chargement des données ------------

// 1. Charger Ouidah
fetch("data/ouidah.geojson")
  .then((response) => response.json())
  .then((data) => {
    if (!data.features || data.features.length === 0) {
      console.error("Pas de feature dans ouidah.geojson");
      return;
    }

    // On suppose qu’il n’y a qu’un point pour Ouidah
    ouidahFeature = data.features[0];

    const coords = ouidahFeature.geometry.coordinates; // [lon, lat, ...]
    ouidahLatLng = [coords[1], coords[0]];

    if (!ouidahFeature.properties) ouidahFeature.properties = {};
    if (!ouidahFeature.properties.Principa_1) {
      ouidahFeature.properties.Principa_1 = "Ouidah";
    }
    // On fixe le nombre de captifs à 1 300 000
    ouidahFeature.properties.total_disembarked = 1300000;

    bounds.extend(ouidahLatLng);

    // Icône personnalisée pour Ouidah
const ouidahIcon = L.icon({
  iconUrl: 'img/bateau.svg', // Chemin vers ton SVG
  iconSize: [60, 60],        // Taille de l'icône (à ajuster)
  iconAnchor: [28, 35],      // Point de l'icône qui correspond à la position sur la carte
  popupAnchor: [0, -20]      // Position du popup par rapport à l'icône
});

// Placer le marqueur Ouidah avec l'icône bateau
ouidahMarker = L.marker(ouidahLatLng, {
  icon: ouidahIcon
}).addTo(map);

    // Popup de Ouidah
    ouidahMarker.bindPopup(
      `<strong>Port de Ouidah</strong><br>` +
        `Nombre total de captifs : ${ouidahFeature.properties.total_disembarked.toLocaleString(
          "fr-FR"
        )}`
    );

    // Centrer grossièrement pour commencer
    map.setView(ouidahLatLng, 3);

    // Puis on charge les ports de débarquement
    return fetch("data/disembarkations_america.geojson");
  })
  .then((response) => {
    if (!response) return;
    return response.json();
  })
  .then((portsData) => {
    if (!portsData) return;

    const features = portsData.features || [];

    if (features.length === 0) {
      console.error("Pas de ports dans disembarkations_america.geojson");
      return;
    }

    portsFeatures = features;

    // Récupérer les valeurs de total_disembarked pour les échelles
    const values = features
      .map((f) => Number(f.properties && f.properties.total_disembarked))
      .filter((v) => !isNaN(v) && v > 0);

    // Inclure aussi Ouidah (1 300 000)
    values.push(ouidahFeature.properties.total_disembarked);

    initScales(values);

    // Ajuster le rayon d’Ouidah selon la même échelle que les ports
    const ouidahRadius = sizeScale(
      ouidahFeature.properties.total_disembarked
    );
    //ouidahMarker.setRadius(ouidahRadius);

    // Étendre les bornes à tous les ports
    portsFeatures.forEach((f) => {
      if (!f.geometry || f.geometry.type !== "Point") return;
      const c = f.geometry.coordinates;
      bounds.extend([c[1], c[0]]);
    });

    // Adapter la vue à toutes les données
    map.fitBounds(bounds, { padding: [20, 20] });

    // Premier dessin en fonction du zoom actuel
    updateMapForZoom(map.getZoom());

    // Mettre à jour à chaque zoom
    map.on("zoomend", () => {
      updateMapForZoom(map.getZoom());
    });
  })
  .catch((err) => {
    console.error("Erreur lors du chargement des données :", err);
  });






