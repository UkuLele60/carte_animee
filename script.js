// Fonction utilitaire pour créer une échelle de taille de symboles
function createSizeScale(maxValue, minRadius = 4, maxRadius = 25) {
  const maxRoot = Math.sqrt(maxValue || 1);

  return function(value) {
    if (!value || value <= 0) return minRadius;
    const root = Math.sqrt(value);
    const ratio = root / maxRoot;
    return minRadius + (maxRadius - minRadius) * ratio;
  };
}

// Création de la carte Leaflet
const map = L.map('map');

// Fond de carte OpenStreetMap
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 10,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Ajoute une échelle graphique
L.control.scale().addTo(map);

// On va d’abord charger Ouidah, puis les ports
let ouidahFeature = null;
let ouidahLatLng = null;

// Pour ajuster l’emprise de la carte
const bounds = L.latLngBounds();

// 1. Charger Ouidah
fetch('data/ouidah.geojson')
  .then(response => response.json())
  .then(data => {
    if (!data.features || data.features.length === 0) {
      console.error("Pas de feature dans ouidah.geojson");
      return;
    }

    // On suppose qu’il n’y a qu’un point pour Ouidah
    ouidahFeature = data.features[0];

    const coords = ouidahFeature.geometry.coordinates; // [lon, lat, ...]
    ouidahLatLng = [coords[1], coords[0]];

    // On force des propriétés cohérentes
    if (!ouidahFeature.properties) ouidahFeature.properties = {};
    if (!ouidahFeature.properties.Principa_1) {
      ouidahFeature.properties.Principa_1 = "Ouidah";
    }
    // On fixe le nombre de captifs à 1 300 000
    ouidahFeature.properties.total_disembarked = 1300000;

    bounds.extend(ouidahLatLng);

    // Puis on charge les ports de débarquement
    return fetch('data/disembarkations_america.geojson');
  })
  .then(response => {
    if (!response) return;
    return response.json();
  })
  .then(portsData => {
    if (!portsData) return;

    const features = portsData.features || [];

    if (features.length === 0) {
      console.error("Pas de ports dans disembarkations_america.geojson");
      return;
    }

    // On récupère les valeurs de total_disembarked pour calculer l’échelle
    const values = features
      .map(f => Number(f.properties && f.properties.total_disembarked))
      .filter(v => !isNaN(v) && v > 0);

    // On inclut aussi la valeur d’Ouidah (1 300 000)
    values.push(ouidahFeature.properties.total_disembarked);

    const maxValue = Math.max(...values);

    // Fonction qui convertit nb de captifs -> rayon de cercle
    const sizeScale = createSizeScale(maxValue);

    // 2. Ajouter le point de Ouidah (symbole proportionnel)
    const ouidahRadius = sizeScale(ouidahFeature.properties.total_disembarked);

    const ouidahMarker = L.circleMarker(ouidahLatLng, {
      radius: ouidahRadius,
      fillColor: '#800026',
      color: '#400013',
      weight: 1,
      fillOpacity: 0.8
    }).addTo(map);

    ouidahMarker.bindPopup(
      `<strong>Port de ${ouidahFeature.properties.Principa_1}</strong><br>` +
      `Nombre de captifs : ${ouidahFeature.properties.total_disembarked.toLocaleString('fr-FR')}`
    );

    // 3. Ajouter les ports de débarquement + flux vers eux
    features.forEach(f => {
      if (!f.geometry || f.geometry.type !== 'Point') return;

      const props = f.properties || {};
      const total = Number(props.total_disembarked);
      if (isNaN(total)) return;

      const coords = f.geometry.coordinates; // [lon, lat, ...]
      const latLng = [coords[1], coords[0]];

      const name = props.Principa_1 || 'Port inconnu';

      bounds.extend(latLng);

      // 3.1 Cercle proportionnel pour le port
      const radius = sizeScale(total);

      const portMarker = L.circleMarker(latLng, {
        radius: radius,
        fillColor: '#1f78b4',
        color: '#084d74',
        weight: 1,
        fillOpacity: 0.8
      }).addTo(map);

      portMarker.bindPopup(
        `<strong>Port de ${name}</strong><br>` +
        `Nombre de captifs : ${total.toLocaleString('fr-FR')}`
      );

      // 3.2 Ligne ou ligne animée (flux) entre Ouidah et ce port
      const latLngs = [ouidahLatLng, latLng];

      // Épaisseur de la ligne : proportionnelle au nombre de captifs
      const weight = 1 + 4 * (Math.sqrt(total) / Math.sqrt(maxValue)); // entre ~1 et 5

      let path;

      // Si le plugin antPath est bien chargé et dispo
      if (L.polyline && L.polyline.antPath) {
        path = L.polyline.antPath(latLngs, {
          delay: 800,                // vitesse de l'animation
          dashArray: [10, 20],       // motif en pointillés
          weight: weight,
          color: '#0000ff',
          pulseColor: '#ffffff',
          paused: false,
          reverse: false,
          hardwareAccelerated: true
        });
      } else {
        // Fallback : simple polyline sans animation
        path = L.polyline(latLngs, {
          weight: weight,
          color: '#0000ff',
          opacity: 0.6
        });
      }

      path.addTo(map);

      path.bindPopup(
        `Nombre de captifs : ${total.toLocaleString('fr-FR')}`
      );
    });

    // Ajuster la vue pour englober Ouidah + tous les ports
    map.fitBounds(bounds, { padding: [20, 20] });

  })
  .catch(err => {
    console.error("Erreur lors du chargement des données :", err);
  });
