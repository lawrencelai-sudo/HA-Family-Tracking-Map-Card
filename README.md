# 🗺️ Family Tracking Map Card

A custom Home Assistant Lovelace card designed to display device trackers with customizable colors, dynamic history trails, and zone snapping. It includes visual staggering to ensure multiple entities at the same location (like a zone center) are all visible.

## ✨ Features

* **Customizable Colors:** Set unique colors for each entity's marker and history line.
* **History Trails:** Display recent path history for each device (configurable by hours).
* **Zone Snapping:** Automatically snaps a device's location to the center of a Home Assistant zone if the device is inside that zone.
* **Marker Staggering:** Automatically offsets markers that share the exact same geographical coordinates to prevent stacking and ensure all are clickable and visible.
* **Visibility Control:** Optionally link the card's visibility to an `input_boolean` or other entity state.

## ⬇️ Installation (HACS)

1.  Open the **HACS** sidebar panel in Home Assistant.
2.  Go to **Frontend** and click the **+** icon in the bottom right corner.
3.  Search for `Color Map Card` (or add the URL of this repository if it's not yet officially listed).
4.  Click **Install**.
5.  **Important:** Refresh your browser cache after installation is complete (Ctrl + F5 or similar).

## ⚙️ Configuration

Add the following to a Lovelace dashboard using the **Manual Card** or **Custom: Color Map Card** type.

### Example YAML

```yaml
type: custom:color-map-card
map_height: 500
default_zoom: 14
auto_fit: true
fit_padding: 80
entities:
  - entity: device_tracker.person_a_phone
    color: '#E91E63' # Pink
    hours_to_show: 4
  - entity: device_tracker.person_b_phone
    color: '#03A9F4' # Blue
    hours_to_show: 24
    # Hide this entity if input_boolean.show_b is off
    visibility_entity: input_boolean.show_person_b
  - entity: device_tracker.car_gps
    color: '#4CAF50' # Green
    hours_to_show: 1
