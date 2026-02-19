/**
 * Carte interactive des lieux importants de l'Université de Saint-Denis
 * Charge et affiche le fichier KMZ avec OpenLayers
 */

// Configuration de la carte
const mapConfig = {
    // Centré sur le campus de Saint-Denis
    center: ol.proj.fromLonLat([55.4835, -20.902]),
    zoom: 17,
    kmzUrl: 'Carte de fac lieux important.kmz',
    kmlFallback: 'data.kml',
    // URL directe vers Google Maps My Maps (peut retourner un KMZ)
    googleMapsUrl: 'https://www.google.com/maps/d/kml?mid=1efHg3DJrBuE2uBpgKnpTDEJZACIPw89X'
};

// Palette de couleurs pour les différents types de lieux
const categoryColors = {
    'batiment': '#3b82f6',      // Bleu
    'vert': '#22c55e',          // Vert
    'restaurant': '#ef4444',    // Rouge
    'parking': '#f97316',       // Orange
    'service': '#a855f7',       // Violet
    'default': '#6b7280'        // Gris
};

/**
 * Détermine la couleur en fonction du nom du lieu
 */
function getColorByName(name) {
    if (!name) return categoryColors.default;
    
    const lowerName = name.toLowerCase();
    
    if (lowerName.includes('restaurant') || lowerName.includes('cafet') || lowerName.includes('ru ') || lowerName.includes('cantine') || lowerName.includes('ru\t')) {
        return categoryColors.restaurant;
    }
    if (lowerName.includes('parking') || lowerName.includes('park')) {
        return categoryColors.parking;
    }
    if (lowerName.includes('jardin') || lowerName.includes('parc') || lowerName.includes('vert')) {
        return categoryColors.vert;
    }
    if (lowerName.includes('biblio') || lowerName.includes('admin') || lowerName.includes('scolarité') || lowerName.includes('scolarite')) {
        return categoryColors.service;
    }
    if (lowerName.includes('bât') || lowerName.includes('batiment') || lowerName.includes('salle') || lowerName.includes('amphi') || lowerName.includes('hall')) {
        return categoryColors.batiment;
    }
    
    return categoryColors.default;
}

/**
 * Crée un style personnalisé pour les marqueurs
 */
function createMarkerStyle(color, name) {
    return new ol.style.Style({
        image: new ol.style.Circle({
            radius: 12,
            fill: new ol.style.Fill({ color: color }),
            stroke: new ol.style.Stroke({
                color: '#ffffff',
                width: 3
            })
        }),
        text: new ol.style.Text({
            text: name || '',
            font: 'bold 12px Roboto, sans-serif',
            fill: new ol.style.Fill({ color: '#000000' }),
            stroke: new ol.style.Stroke({
                color: '#ffffff',
                width: 4
            }),
            offsetY: -25,
            textAlign: 'center'
        })
    });
}

/**
 * Extrait le fichier KML d'un KMZ (fichier ZIP)
 */
async function extractKMLFromKMZ(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    // Cherche le fichier .kml dans l'archive
    const kmlFile = Object.keys(zip.files).find(filename => filename.endsWith('.kml'));
    
    if (!kmlFile) {
        throw new Error('Aucun fichier KML trouvé dans le KMZ');
    }
    
    const kmlContent = await zip.file(kmlFile).async('string');
    return kmlContent;
}

/**
 * Tente de récupérer du KML (soit direct, soit depuis un KMZ)
 */
async function fetchKMLContent(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Erreur HTTP: ${response.status}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    const arrayBuffer = await response.arrayBuffer();
    
    // Vérifie si c'est du XML (KML pur)
    const textPreview = new TextDecoder().decode(arrayBuffer.slice(0, 100));
    const isXML = textPreview.trim().startsWith('<?xml') || textPreview.trim().startsWith('<kml');
    
    if (isXML) {
        // C'est du KML pur
        return new TextDecoder().decode(arrayBuffer);
    } else {
        // C'est probablement un KMZ (ZIP)
        console.log('📦 Fichier compressé détecté, extraction en cours...');
        return await extractKMLFromKMZ(arrayBuffer);
    }
}

/**
 * Parse le KML et crée les features OpenLayers
 */
function parseKMLFeatures(kmlContent) {
    const parser = new ol.format.KML({
        extractStyles: false,
        extractAttributes: true
    });
    
    const features = parser.readFeatures(kmlContent, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
    });
    
    return features;
}

/**
 * Charge le KMZ local ou distant et l'affiche sur la carte
 */
async function loadKMZLayer(map) {
    const loadingEl = document.getElementById('features-list');
    
    try {
        let kmlContent = null;
        let sourceName = '';
        
        // Essaie d'abord le fichier KMZ local
        try {
            console.log('📂 Chargement du fichier KMZ local...');
            loadingEl.innerHTML = '<p class="loading">📂 Lecture du fichier KMZ local...</p>';
            
            const response = await fetch(mapConfig.kmzUrl);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                kmlContent = await extractKMLFromKMZ(arrayBuffer);
                sourceName = 'fichier KMZ local';
                
                // Vérifie si c'est juste un NetworkLink (ancien format)
                if (kmlContent.includes('<NetworkLink>') && !kmlContent.includes('<Placemark>')) {
                    console.log('🔗 NetworkLink détecté, utilisation du fichier KML de fallback...');
                    throw new Error('NetworkLink uniquement');
                }
            }
        } catch (localError) {
            console.log('⚠️ Fichier KMZ indisponible ou incomplet:', localError.message);
        }
        
        // Essaie le fichier KML de fallback
        if (!kmlContent) {
            try {
                console.log('📄 Chargement du fichier KML de fallback...');
                loadingEl.innerHTML = '<p class="loading">📄 Chargement des données...</p>';
                
                const response = await fetch(mapConfig.kmlFallback);
                if (response.ok) {
                    kmlContent = await response.text();
                    sourceName = 'données locales (KML)';
                    console.log('✅ Fichier KML chargé avec succès');
                }
            } catch (fallbackError) {
                console.log('⚠️ Fichier KML de fallback indisponible:', fallbackError.message);
            }
        }
        
        // Si toujours pas de contenu, essaie l'URL Google Maps
        if (!kmlContent) {
            console.log('🌐 Chargement depuis Google Maps...');
            loadingEl.innerHTML = '<p class="loading">🌐 Chargement depuis Google Maps...</p>';
            
            kmlContent = await fetchKMLContent(mapConfig.googleMapsUrl);
            sourceName = 'Google Maps';
        }
        
        // Parse le KML
        console.log('🔍 Parsing du KML...');
        loadingEl.innerHTML = '<p class="loading">🔍 Analyse des données...</p>';
        
        const features = parseKMLFeatures(kmlContent);
        console.log(`✅ ${features.length} lieux trouvés depuis ${sourceName}`);
        
        if (features.length === 0) {
            throw new Error('Aucun lieu trouvé dans le fichier');
        }
        
        // Crée une source vectorielle
        const vectorSource = new ol.source.Vector({
            features: features
        });
        
        // Applique les styles personnalisés
        features.forEach(feature => {
            const name = feature.get('name') || '';
            const color = getColorByName(name);
            const style = createMarkerStyle(color, name);
            feature.setStyle(style);
        });
        
        // Crée la couche vectorielle
        const vectorLayer = new ol.layer.Vector({
            source: vectorSource,
            title: 'Lieux importants'
        });
        
        map.addLayer(vectorLayer);
        
        // Ajuste la vue pour voir tous les points
        map.getView().fit(vectorSource.getExtent(), {
            padding: [100, 100, 100, 100],
            maxZoom: 18,
            duration: 1000
        });
        
        // Met à jour la liste des lieux
        updateFeaturesList(features);
        
        // Notification de succès
        showNotification(`✅ ${features.length} lieux chargés depuis ${sourceName}`, 'success');
        
    } catch (error) {
        console.error('❌ Erreur lors du chargement:', error);
        loadingEl.innerHTML = `<p class="error">❌ Erreur: ${error.message}</p>`;
        showNotification('Erreur de chargement des données', 'error');
        
        // Charge une carte par défaut centrée sur Saint-Denis
        loadDefaultMap(map);
    }
}

/**
 * Affiche une notification
 */
function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = message;
    notif.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        animation: slideIn 0.3s ease;
        background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    `;
    
    document.body.appendChild(notif);
    
    setTimeout(() => {
        notif.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

/**
 * Charge une carte par défaut si les données ne sont pas disponibles
 */
function loadDefaultMap(map) {
    const defaultCoords = ol.proj.fromLonLat([55.4515, -20.9015]); // Saint-Denis
    
    map.getView().setCenter(defaultCoords);
    map.getView().setZoom(16);
    
    // Ajoute un marqueur par défaut
    const defaultSource = new ol.source.Vector();
    const defaultFeature = new ol.Feature({
        geometry: new ol.geom.Point(defaultCoords),
        name: 'Université de Saint-Denis'
    });
    defaultFeature.setStyle(createMarkerStyle(categoryColors.batiment, 'Université de Saint-Denis'));
    defaultSource.addFeature(defaultFeature);
    
    map.addLayer(new ol.layer.Vector({
        source: defaultSource
    }));
    
    document.getElementById('features-list').innerHTML = `
        <p class="error">
            ⚠️ Impossible de charger les données.<br>
            <small>Affichage de la position par défaut.</small>
        </p>
    `;
}

/**
 * Met à jour la liste des lieux dans le panneau latéral
 */
function updateFeaturesList(features) {
    const listContainer = document.getElementById('features-list');
    
    if (!features || features.length === 0) {
        listContainer.innerHTML = '<p class="empty">Aucun lieu trouvé</p>';
        return;
    }
    
    // Trie les features par nom
    const sortedFeatures = [...features].sort((a, b) => {
        const nameA = (a.get('name') || '').toLowerCase();
        const nameB = (b.get('name') || '').toLowerCase();
        return nameA.localeCompare(nameB);
    });
    
    const html = sortedFeatures.map((feature, index) => {
        const name = feature.get('name') || 'Lieu sans nom';
        const description = feature.get('description') || '';
        const color = getColorByName(name);
        
        // Extrait un aperçu de la description (sans HTML)
        const descText = description.replace(/<[^>]*>/g, '').substring(0, 60);
        
        return `
            <div class="feature-item" data-index="${index}">
                <span class="feature-color" style="background-color: ${color}"></span>
                <div class="feature-info">
                    <strong>${escapeHtml(name)}</strong>
                    ${descText ? `<small>${escapeHtml(descText)}${descText.length >= 60 ? '...' : ''}</small>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    listContainer.innerHTML = html;
    
    // Ajoute les événements de clic
    listContainer.querySelectorAll('.feature-item').forEach(item => {
        item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index);
            const feature = sortedFeatures[index];
            const geometry = feature.getGeometry();
            
            if (geometry) {
                const coordinates = geometry.getFirstCoordinate();
                
                // Animation de zoom
                window.map.getView().animate({
                    center: coordinates,
                    zoom: 19,
                    duration: 600
                });
                
                // Met en évidence l'élément cliqué
                listContainer.querySelectorAll('.feature-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                
                // Affiche le popup
                showFeaturePopup(feature, coordinates);
            }
        });
    });
}

/**
 * Échappe les caractères HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Affiche un popup pour une feature
 */
function showFeaturePopup(feature, coordinates) {
    const name = feature.get('name') || 'Lieu sans nom';
    const description = feature.get('description') || '';
    
    // Supprime l'ancien popup s'il existe
    const oldPopup = document.querySelector('.custom-popup');
    if (oldPopup) oldPopup.remove();
    
    // Crée le nouveau popup
    const popup = document.createElement('div');
    popup.className = 'custom-popup';
    popup.innerHTML = `
        <div class="popup-header">
            <h3>${escapeHtml(name)}</h3>
            <button class="popup-close">&times;</button>
        </div>
        ${description ? `<div class="popup-body">${description}</div>` : ''}
    `;
    
    document.body.appendChild(popup);
    
    // Positionne le popup
    const pixel = window.map.getPixelFromCoordinate(coordinates);
    popup.style.left = `${pixel[0]}px`;
    popup.style.top = `${pixel[1] - 20}px`;
    
    // Ferme le popup au clic sur le bouton
    popup.querySelector('.popup-close').addEventListener('click', () => popup.remove());
    
    // Ferme le popup au clic sur la carte
    const closeOnClick = () => {
        popup.remove();
        window.map.un('click', closeOnClick);
    };
    setTimeout(() => window.map.once('click', closeOnClick), 100);
}

/**
 * Initialise la carte
 */
function initMap() {
    // Crée la carte
    const map = new ol.Map({
        target: 'map',
        layers: [
            // Couche de base OpenStreetMap
            new ol.layer.Tile({
                source: new ol.source.OSM({
                    attributions: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                }),
                title: 'OpenStreetMap'
            })
        ],
        view: new ol.View({
            center: mapConfig.center,
            zoom: mapConfig.zoom
        }),
        controls: ol.control.defaults.defaults().extend([
            new ol.control.ScaleLine(),
            new ol.control.FullScreen(),
            new ol.control.ZoomSlider(),
            new ol.control.Attribution()
        ])
    });
    
    // Stocke la carte globalement
    window.map = map;
    
    // Charge le fichier KMZ
    loadKMZLayer(map);
    
    // Gestion du clic sur un marqueur
    map.on('click', (event) => {
        const feature = map.forEachFeatureAtPixel(event.pixel, (f) => f);
        
        if (feature) {
            const name = feature.get('name');
            if (name) {
                showFeaturePopup(feature, event.coordinate);
            }
        } else {
            // Ferme les popups existants
            document.querySelectorAll('.custom-popup').forEach(p => p.remove());
        }
    });
    
    // Change le curseur au survol d'un marqueur
    map.on('pointermove', (event) => {
        const pixel = map.getEventPixel(event.originalEvent);
        const hit = map.hasFeatureAtPixel(pixel);
        map.getTargetElement().style.cursor = hit ? 'pointer' : '';
    });
}

// Ajoute les styles CSS pour les animations
const styleSheet = document.createElement('style');
styleSheet.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(styleSheet);

// Fonction pour fermer l'avertissement d'orientation
function dismissOrientationWarning() {
    const warning = document.getElementById('orientation-warning');
    if (warning) {
        warning.style.display = 'none';
        localStorage.setItem('orientationWarningDismissed', 'true');
    }
}

// Vérifie si on doit afficher l'avertissement d'orientation
function checkOrientation() {
    const warning = document.getElementById('orientation-warning');
    const wasDismissed = localStorage.getItem('orientationWarningDismissed') === 'true';
    
    if (warning && !wasDismissed && window.innerWidth < window.innerHeight && window.innerWidth < 768) {
        // Mode portrait sur mobile
        warning.style.display = 'flex';
    } else if (warning) {
        warning.style.display = 'none';
    }
}

// Gestion du redimensionnement
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        checkOrientation();
        if (window.map) {
            window.map.updateSize();
        }
    }, 250);
});

// Détecte les appareils tactiles
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    document.body.classList.add('touch-device');
}

// Rend les fonctions globales
window.dismissOrientationWarning = dismissOrientationWarning;

// Initialise la carte au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    checkOrientation();
});
