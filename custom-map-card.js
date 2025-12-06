// =========================================================================
// 🧩 Custom Home Assistant Card: color-map-card
// =========================================================================
//
// 📜 CONFIGURATION (YAML ATTRIBUTES):
//
// Global Map Options:
// map_height: (Optional, integer) Height of the map in pixels (e.g., 500). Default: 400.
// default_zoom: (Optional, integer) Initial map zoom level. Default: 12.
// auto_fit: (Optional, boolean) If set to `false`, prevents the map from automatically 
//           zooming/centering to fit all markers on load and update. Default: true.
// fit_padding: (Optional, integer) Padding in pixels applied around the bounds when auto-fitting.
//              Default: 50.
//
// Entity List (Required):
// entities: (Required, list) A list of entity objects to display.
//   - entity: (Required, string) The entity ID (e.g., 'device_tracker.my_phone').
//     color: (Optional, string) The color for the marker and history line (e.g., '#00FF00' or 'green'). 
//            Default: '#3b82f6' (blue).
//     hours_to_show: (Optional, integer) The number of hours of history trail to display for this entity.
//                    Set to 0 or omit to disable history. Default: 0.
//     visibility_entity: (Optional, string) An entity (e.g., 'input_boolean.show_person') whose 'off' 
//                        state will hide this entity's marker and history from the map.
//
// Current Card Features:
// * Zone Snapping: If an entity's coordinates fall within a defined Home Assistant Zone, 
//                  its location is snapped to the Zone's center coordinates.
// * Marker Staggering: Entities sharing the exact same calculated location (e.g., when snapped to a zone center) 
//                      are visually offset (staggered) in a circle to ensure all markers remain visible.
//
// =========================================================================

class ColorMapCard extends HTMLElement {
  constructor() {
    super();
    this.map = null;
    this.markerLayerGroup = null; 
    this.markers = {};
    this.polylines = {};
    this.historyFetchingStatus = {}; 
    this.historyRedrawTimers = {}; 
    this.historyCache = {}; 
    this.leafletLoaded = false;
    this.manualInteraction = false; 
    this.mapLayers = {}; 
    this.historyDots = {}; 
    this.zoneStates = {};
    this.zoneBoundaries = {}; 
    
    this.isHistoryVisible = true; 
    this.isAutoFitEnabled = true; 
    this.fitPadding = 50; 
    
    this.fadeDuration = 500; 
    // 🚩 Staggering constants
    this.STAGGER_DISTANCE_PX = 10; 
    this.STAGGER_MAX_ENTITIES = 8; 
    this.defaultIconAnchor = [12, 12];
  }

  setConfig(config) {
    if (!config.entities) {
      throw new Error("You need to define entities");
    }
    this.config = config;
    this.defaultZoom = this.config.default_zoom || 12;
    this.isAutoFitEnabled = this.config.auto_fit !== false; 
    this.fitPadding = this.config.fit_padding !== undefined ? parseInt(this.config.fit_padding) : 50; 
    
    const cardHeight = this.config.map_height ? `${this.config.map_height}px` : '400px';
    this.style.setProperty('--map-card-height', cardHeight);

    this.innerHTML = `
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      
      <style>
        ha-card { 
            height: var(--map-card-height); 
            display: flex; 
            flex-direction: column; 
            overflow: hidden; 
            border-radius: 12px; 
            position: relative;
        }
        #map-container { flex: 1; width: 100%; height: 100%; z-index: 0; background: #e5e7eb; }
        .custom-marker { border: 2px solid white; border-radius: 50%; box-shadow: 0 0 5px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; font-weight: bold; color: white; font-size: 10px; }
        .leaflet-control-custom-bar { margin-top: 10px; border-radius: 4px; overflow: hidden; box-shadow: 0 1px 5px rgba(0,0,0,0.4); }
        .leaflet-control-custom-bar button {
            background-color: var(--card-background-color, #fff); border: none; cursor: pointer;
            width: 30px; height: 30px; line-height: 30px; color: var(--primary-text-color, #212121); 
            padding: 0; display: flex; align-items: center; justify-content: center; transition: background-color 0.1s;
            border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.1)); 
        }
        .leaflet-control-custom-bar button:last-child { border-bottom: none; }
        .leaflet-control-custom-bar button:hover { background-color: var(--secondary-background-color, #f0f0f0); }
        
        /* --- ACTIVE STATE STYLING FOR LIGHT MODE (Black Icons) --- */
        .leaflet-control-custom-bar button.active { 
            color: #000000;
            background-color: var(--primary-color-opacity-10, rgba(3, 169, 244, 0.1)); 
        }

        /* --- ACTIVE STATE STYLING FOR DARK MODE (White Icons) --- */
        :host([style*="--dark-primary-color"]) .leaflet-control-custom-bar button.active,
        :host([style*="--dark-primary-color"]) .leaflet-control-custom-bar button.active:hover {
            color: #FFFFFF; 
            background-color: rgba(3, 169, 244, 0.3); 
        }
        
        /* --- CSS Transition for smooth history layer updates --- */
        .leaflet-container .leaflet-overlay-pane svg path,
        .leaflet-container .leaflet-overlay-pane svg circle {
            transition: none; 
        }
      </style>
      <ha-card>
        <div id="map-container"></div>
      </ha-card>
    `;
  }
  
  getCardSize() {
    const height = this.config.map_height || 400;
    return Math.max(1, Math.round(height / 50)); 
  }

  set hass(hass) {
    this._hass = hass;
    
    this.updateZoneStates();
    
    if (!this.map) {
        this.loadLeafletJS()
            .then(() => setTimeout(() => this.initMap(), 100))
            .catch(error => console.error("Failed to load map dependencies:", error));
    } else {
        this.updateMap(); 
        
        if (this.isHistoryVisible) {
            this.config.entities.forEach(entConfig => {
                const entityId = entConfig.entity;
                const stateObj = this._hass.states[entityId];
                
                let isVisible = true;
                if (entConfig.visibility_entity) {
                    const visState = this._hass.states[entConfig.visibility_entity];
                    if (visState && (visState.state === 'off' || visState.state === 'unavailable')) {
                        isVisible = false;
                    }
                }
                
                if (isVisible && stateObj && stateObj.attributes.latitude && entConfig.hours_to_show > 0) {
                    this.doDrawHistory(entityId, entConfig.color || '#3b82f6', entConfig.hours_to_show);
                }
            });
        }
    }
  }
  
  updateZoneStates() {
    this.zoneStates = {};
    this.zoneBoundaries = {};
    Object.keys(this._hass.states).forEach(entityId => {
      if (entityId.startsWith('zone.')) {
        const stateObj = this._hass.states[entityId];
        if (stateObj.attributes.latitude && stateObj.attributes.longitude && stateObj.attributes.radius) {
          const zoneName = stateObj.attributes.friendly_name || stateObj.entity_id.split('.')[1];
          const center = {
            lat: stateObj.attributes.latitude,
            lng: stateObj.attributes.longitude
          };
          
          this.zoneStates[zoneName] = center;
          this.zoneStates[stateObj.state] = center;
          
          this.zoneBoundaries[zoneName] = {
            center: center,
            radius: stateObj.attributes.radius 
          };
        }
      }
    });
  }
  
  getZoneMatch(lat, lng) {
    if (typeof L === "undefined") return null;

    const point = L.latLng(lat, lng);
    
    for (const zoneName in this.zoneBoundaries) {
      const zone = this.zoneBoundaries[zoneName];
      const zoneCenter = L.latLng(zone.center.lat, zone.center.lng);
      
      const distance = point.distanceTo(zoneCenter);
      
      if (distance < zone.radius) {
        return zone.center;
      }
    }
    return null; 
  }

  animateMarker(marker, newLatlng, duration = 250) {
    if (!marker || !marker.getLatLng) return;

    const start = marker.getLatLng();
    const startTime = performance.now();
    
    function step(timestamp) {
        const elapsed = timestamp - startTime;
        const progress = Math.min(1, elapsed / duration);
        
        const lat = start.lat + (newLatlng[0] - start.lat) * progress;
        const lng = start.lng + (newLatlng[1] - start.lat) * progress;
        
        marker.setLatLng([lat, lng]);

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
             marker.setLatLng(newLatlng);
        }
    }
    
    requestAnimationFrame(step);
  }
  // ------------------------------------

  async loadLeafletJS() {
    return new Promise((resolve, reject) => {
      if (typeof L !== "undefined") {
        this.leafletLoaded = true;
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => {
        this.leafletLoaded = true;
        resolve();
      };
      script.onerror = () => reject(new Error("Failed to load Leaflet JS"));
      document.head.appendChild(script);
    });
  }


  async initMap() {
    if (this.map) return;
    if (typeof L === "undefined") {
        this.querySelector("#map-container").innerHTML = `<div style="padding: 20px;">Error: Failed to load map libraries (Leaflet).</div>`;
        return;
    }

    const mapContainer = this.querySelector("#map-container");

    try {
        this.map = L.map(mapContainer).setView([0, 0], this.defaultZoom);
        
        this.mapLayers = {
            light: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> & <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                maxZoom: 19,
                subdomains: 'abcd'
            }),
            dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; CartoDB & OpenStreetMap contributors',
                maxZoom: 19,
                subdomains: 'abcd'
            })
        };
        
        this.updateMapTheme(this._hass.themes.darkMode);
        
        this.markerLayerGroup = L.layerGroup();
        this.map.addLayer(this.markerLayerGroup);
        
        this.addCustomControlsBar();

        this.map.on('dragstart zoomstart', () => {
            this.manualInteraction = true;
        });
        
        this.map.on('moveend zoomend', () => {
             this.staggerMarkersAtSameLocation();
        });
        
        setTimeout(() => {
            this.map.invalidateSize();
            this.updateMap(); 
        }, 200);
        
    } catch (error) {
        console.error("Map Init Error:", error);
    }
  }
  
  staggerMarkersAtSameLocation() {
    const locations = {};
    const entityLocations = {}; 
    const entitiesAtLocation = {}; 
    
    // 1. Group entities by their current map coordinates (in L.latLng form)
    for (const entityId in this.markers) {
        const marker = this.markers[entityId];
        const latlng = marker.getLatLng();
        // Use a high-precision string key to identify identical locations
        const key = `${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}`;
        
        if (!entitiesAtLocation[key]) {
            entitiesAtLocation[key] = [];
            locations[key] = latlng;
        }
        entitiesAtLocation[key].push(entityId);
        entityLocations[entityId] = latlng;
    }
    
    // 2. Iterate through groups of stacked entities and apply stagger
    for (const key in entitiesAtLocation) {
        const entityIds = entitiesAtLocation[key];
        const count = entityIds.length;
        
        if (count > 1) {
            const startAngle = Math.PI / 2; 
            
            const staggerDist = count > this.STAGGER_MAX_ENTITIES ? this.STAGGER_DISTANCE_PX * 0.7 : this.STAGGER_DISTANCE_PX;

            entityIds.forEach((entityId, index) => {
                const marker = this.markers[entityId];
                
                const angle = startAngle + (2 * Math.PI / count) * index;
                const offsetX = staggerDist * Math.cos(angle);
                const offsetY = staggerDist * Math.sin(angle);
                
                const newAnchor = [
                    this.defaultIconAnchor[0] - offsetX, 
                    this.defaultIconAnchor[1] - offsetY
                ];
                
                const currentIcon = marker.options.icon;
                if (currentIcon && JSON.stringify(currentIcon.options.iconAnchor) !== JSON.stringify(newAnchor)) {
                    const newIcon = L.divIcon({
                        className: currentIcon.options.className,
                        html: currentIcon.options.html,
                        iconSize: currentIcon.options.iconSize,
                        iconAnchor: newAnchor
                    });
                    marker.setIcon(newIcon);
                }
            });
            
        } else {
            // If only one entity, ensure anchor is set back to default
            const marker = this.markers[entityIds[0]];
            const currentIcon = marker.options.icon;
            if (currentIcon && JSON.stringify(currentIcon.options.iconAnchor) !== JSON.stringify(this.defaultIconAnchor)) {
                const newIcon = L.divIcon({
                    className: currentIcon.options.className,
                    html: currentIcon.options.html,
                    iconSize: currentIcon.options.iconSize,
                    iconAnchor: this.defaultIconAnchor
                });
                marker.setIcon(newIcon);
            }
        }
    }
  }

  addCustomControlsBar() {
    const self = this;
    
    const CustomControlsBar = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-control-custom-bar leaflet-bar');

            const recenterButton = L.DomUtil.create('button', 'recenter-button', container);
            recenterButton.type = 'button';
            recenterButton.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16px" height="16px">
                    <circle cx="12" cy="12" r="5"/>
                </svg>
            `;
            recenterButton.title = "Recenter Map";
            L.DomEvent.on(recenterButton, 'click', self.recenterMap, self);

            const historyButton = L.DomUtil.create('button', `history-button ${self.isHistoryVisible ? 'active' : ''}`, container);
            historyButton.type = 'button';
            historyButton.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20px" height="20px">
                    <path d="M0 0h24v24H0z" fill="none"/>
                    <path d="M4 11h2v2H4zm4 0h2v2H8zm4 0h2v2h-2zm4 0h2v2h-2zm4 0h2v2h-2z"/>
                </svg>
            `;
            historyButton.title = "Toggle History Lines (ON/OFF)";
            self.historyButton = historyButton;
            L.DomEvent.on(historyButton, 'click', self.toggleHistory, self);
            
            L.DomEvent.disableClickPropagation(container);
            return container;
        }
    });

    new CustomControlsBar().addTo(this.map);
  }

  toggleHistory() {
    this.isHistoryVisible = !this.isHistoryVisible;
    this.historyButton.classList.toggle('active', this.isHistoryVisible);
    
    if (!this.isHistoryVisible) {
        Object.keys(this.polylines).forEach(entityId => {
            this.removeHistoryLayers(entityId);
            if (this.historyRedrawTimers[entityId]) {
                clearTimeout(this.historyRedrawTimers[entityId]);
                delete this.historyRedrawTimers[entityId];
            }
        });
        this.historyCache = {}; 
        
    } else {
         this.config.entities.forEach(entConfig => {
            const entityId = entConfig.entity;
            const stateObj = this._hass.states[entityId];
            
            let isVisible = true;
            if (entConfig.visibility_entity) {
                const visState = this._hass.states[entConfig.visibility_entity];
                if (visState && (visState.state === 'off' || visState.state === 'unavailable')) {
                    isVisible = false;
                }
            }

            if (isVisible && stateObj && stateObj.attributes.latitude && entConfig.hours_to_show > 0) {
                 this.doDrawHistory(entityId, entConfig.color || '#3b82f6', entConfig.hours_to_show);
            }
         });
    }
  }

  recenterMap() {
    this.manualInteraction = false;
    this.updateMap(true); 
  }

  updateMapTheme(isDark) {
    const newLayer = isDark ? this.mapLayers.dark : this.mapLayers.light;
    const oldLayer = isDark ? this.mapLayers.light : this.mapLayers.dark;
    
    if (!this.map || !newLayer) return;

    if (oldLayer && this.map.hasLayer(oldLayer) && oldLayer !== newLayer) {
        this.map.removeLayer(oldLayer);
    }

    if (!this.map.hasLayer(newLayer)) {
        newLayer.addTo(this.map);
    }
  }
  
  async updateMap(forceAutoFit = false) {
    if (!this.map || !this.config.entities || !this._hass) return;

    this.updateMapTheme(this._hass.themes.darkMode);
    this.map.invalidateSize(); 

    const visibleBounds = [];
    const currentlyTracked = new Set(Object.keys(this.markers));

    for (const entConfig of this.config.entities) {
      const entityId = entConfig.entity;
      const stateObj = this._hass.states[entityId];
      const color = entConfig.color || '#3b82f6';
      
      let isVisible = true;
      if (entConfig.visibility_entity) {
        const visState = this._hass.states[entConfig.visibility_entity];
        if (visState && (visState.state === 'off' || visState.state === 'unavailable')) {
          isVisible = false;
        }
      }
      
      const isCurrentlyOnMap = !!this.markers[entityId];

      if (!stateObj || !isVisible) {
        if (isCurrentlyOnMap) {
            this.removeEntityFromMap(entityId); 
        }
        currentlyTracked.delete(entityId);
        continue;
      }

      // --- Entity is visible from here on ---
      let lat = stateObj.attributes.latitude;
      let lng = stateObj.attributes.longitude;
      
      if (!lat || !lng) {
        if (isCurrentlyOnMap) {
            this.removeEntityFromMap(entityId);
        }
        currentlyTracked.delete(entityId);
        continue;
      }
      
      // ZONE SNAPPING: Check if the reported coordinates are inside a zone
      const zoneMatch = this.getZoneMatch(lat, lng);
      
      if (zoneMatch) {
          // If inside a zone, snap coordinates to the zone center
          lat = zoneMatch.lat;
          lng = zoneMatch.lng;
      } else {
          // Fallback: Check if the state itself is a zone (e.g., 'home' without coordinates)
          const currentState = stateObj.state;
          if (this.zoneStates[currentState]) {
            lat = this.zoneStates[currentState].lat;
            lng = this.zoneStates[currentState].lng;
          }
      }
      // --- ZONE SNAPPING LOGIC END ---

      currentlyTracked.delete(entityId);
      visibleBounds.push([lat, lng]);

      const entityName = stateObj.attributes.friendly_name || entityId;
      const newLatlng = [lat, lng];
      
      if (isCurrentlyOnMap) {
        const marker = this.markers[entityId];
        const currentLatlng = marker.getLatLng();

        // COORDINATE GUARD CLAUSE: Only proceed if the position is actually different
        if (currentLatlng.lat === lat && currentLatlng.lng === lng) {
             marker.setPopupContent(entityName);
             
             if (this.isHistoryVisible && entConfig.hours_to_show > 0) {
                 this.doDrawHistory(entityId, color, entConfig.hours_to_show);
             }
             continue; 
        }

        // --- Position HAS changed, continue with updates ---
        this.animateMarker(marker, newLatlng);
        marker.setPopupContent(entityName);
        
        // Check if the color has changed and update the icon if necessary
        try {
            const currentIcon = marker.options.icon;
            const currentHtml = currentIcon.options.html;
            const match = currentHtml.match(/background-color:\s*(.*?);/);
            const currentColor = match ? match[1].trim() : null;

            if (currentColor !== color) {
                const newIconHtml = `<div style="background-color: ${color}; width: 100%; height: 100%; border-radius: 50%;"></div>`;
                const newIcon = L.divIcon({
                  className: 'custom-marker',
                  html: newIconHtml,
                  iconSize: [24, 24],
                  // Preserve current anchor/offset, which will be reset later by staggerMarkersAtSameLocation
                  iconAnchor: currentIcon.options.iconAnchor 
                });
                marker.setIcon(newIcon);
            }
        } catch (e) {
            console.warn("Could not check/update marker icon color.", e);
        }
        
        if (this.isHistoryVisible && entConfig.hours_to_show > 0) {
            this.doDrawHistory(entityId, color, entConfig.hours_to_show);
        }

      } else {
        // --- Marker is NEW, create it and add it to the map ---
        const iconHtml = `<div style="background-color: ${color}; width: 100%; height: 100%; border-radius: 50%;"></div>`;
        const icon = L.divIcon({
          className: 'custom-marker',
          html: iconHtml,
          iconSize: [24, 24],
          iconAnchor: this.defaultIconAnchor 
        });

        this.markers[entityId] = L.marker(newLatlng, { icon: icon })
          .bindPopup(entityName);
          
        if (this.markerLayerGroup) {
            this.markerLayerGroup.addLayer(this.markers[entityId]);
        }
        
        if (this.isHistoryVisible && entConfig.hours_to_show && entConfig.hours_to_show > 0) {
           this.doDrawHistory(entityId, color, entConfig.hours_to_show);
        }
      }
    }

    currentlyTracked.forEach(entityId => {
        this.removeEntityFromMap(entityId);
    });
    
    const shouldAutoFit = visibleBounds.length > 0 && this.isAutoFitEnabled && (forceAutoFit || !this.manualInteraction);
                          
    if (shouldAutoFit) {
       this.map.fitBounds(visibleBounds, { padding: [this.fitPadding, this.fitPadding] });
    }
    
    this.staggerMarkersAtSameLocation();
  }
  
  fadeRemoveHistoryLayers(entityId) {
      if (!this.polylines[entityId] && !this.historyDots[entityId]) return;

      if (this.polylines[entityId]) {
          this.polylines[entityId].setStyle({ opacity: 0 });
      }
      if (this.historyDots[entityId]) {
          this.historyDots[entityId].eachLayer(layer => layer.setStyle({ opacity: 0, fillOpacity: 0 }));
      }
      
      setTimeout(() => {
          this.removeHistoryLayers(entityId, true); 
      }, this.fadeDuration);
  }
  
  removeHistoryLayers(entityId, silent = false) {
    if (this.polylines[entityId]) {
      this.map.removeLayer(this.polylines[entityId]);
      delete this.polylines[entityId];
    }
    if (this.historyDots[entityId]) {
        this.map.removeLayer(this.historyDots[entityId]);
        delete this.historyDots[entityId];
    }
    if (this.historyRedrawTimers[entityId]) {
        clearTimeout(this.historyRedrawTimers[entityId]);
        delete this.historyRedrawTimers[entityId];
    }
  }

  removeEntityFromMap(entityId) {
    if (this.markers[entityId]) {
      if (this.markerLayerGroup) {
          this.markerLayerGroup.removeLayer(this.markers[entityId]);
      }
      delete this.markers[entityId];
    }
    
    delete this.historyCache[entityId]; 
    delete this.historyFetchingStatus[entityId];
    if (this.historyRedrawTimers[entityId]) {
      clearTimeout(this.historyRedrawTimers[entityId]);
      delete this.historyRedrawTimers[entityId];
    }

    this.removeHistoryLayers(entityId, true); 
    
    this.staggerMarkersAtSameLocation();
  }

  // --- Core history drawing logic ---
  async doDrawHistory(entityId, color, hours) {
    if (this.historyFetchingStatus[entityId]) return; 
    
    this.historyFetchingStatus[entityId] = true; 
    
    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - (hours * 60 * 60 * 1000));
      
      const history = await this._hass.callApi(
        "GET", 
        `history/period/${startTime.toISOString()}?filter_entity_id=${entityId}&end_time=${endTime.toISOString()}&significant_changes_only=0`
      );

      if (history && history[0]) {
        const latlngs = [];

        history[0]
          .filter(h => h.attributes.latitude && h.attributes.longitude)
          .forEach(h => {
            let lat = h.attributes.latitude;
            let lng = h.attributes.longitude;
            const historyState = h.state;
            
            // Apply zone snapping to history points for consistency
            const zoneMatch = this.getZoneMatch(lat, lng);
            
            if (zoneMatch) {
                lat = zoneMatch.lat;
                lng = zoneMatch.lng;
            } else if (this.zoneStates[historyState]) {
                lat = this.zoneStates[historyState].lat;
                lng = this.zoneStates[historyState].lng;
            }
            // --- END HISTORY SNAPPING ---
            
            latlngs.push([lat, lng]);
          });
          
        const newCoordinatesString = JSON.stringify(latlngs);

        if (this.historyCache[entityId] === newCoordinatesString) {
            this.historyFetchingStatus[entityId] = false;
            return;
        }

        const oldPolyline = this.polylines[entityId];
        const oldDots = this.historyDots[entityId];
        if (oldPolyline || oldDots) {
            this.fadeRemoveHistoryLayers(entityId); 
        }
        await new Promise(resolve => setTimeout(resolve, this.fadeDuration));

        const dots = latlngs.map(latlng => L.circleMarker(latlng, {
            radius: 4,
            fillColor: color,
            color: '#fff',
            weight: 1,
            opacity: 0.8, 
            fillOpacity: 0.8 
        }));

        this.polylines[entityId] = L.polyline(latlngs, {
          color: color,
          weight: 3,
          opacity: 0.7 
        }).addTo(this.map);
        
        this.historyDots[entityId] = L.layerGroup(dots);
        this.historyDots[entityId].addTo(this.map);
        
        this.historyCache[entityId] = newCoordinatesString;

      } else {
           this.removeHistoryLayers(entityId); 
           delete this.historyCache[entityId];
      }
    } catch (e) {
      console.error("Error fetching history for map", e);
    } finally {
      this.historyFetchingStatus[entityId] = false;
    }
  }
}

customElements.define('color-map-card', ColorMapCard);