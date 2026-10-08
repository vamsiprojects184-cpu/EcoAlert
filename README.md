# EcoAlert

EcoAlert is a mobile-first weather and environmental alert PWA.

## Included
- Live weather conditions and 7-day forecast
- Rain/storm, heat/cold, humidity, and AQI alert engine
- OpenStreetMap + Leaflet live risk map
- Location search and browser geolocation
- Saved locations
- Smart action recommendations
- Weather/AQI report export
- Browser notification permission flow
- Custom notification thresholds
- Installable PWA with service-worker caching

## Data sources
- Open-Meteo Weather Forecast API
- Open-Meteo Air Quality API
- Open-Meteo Geocoding API
- OpenStreetMap tiles

Open-Meteo documents a default 7-day forecast, precipitation probability, temperature, humidity, wind and weather-code variables. Its geocoding endpoint resolves place names/postcodes to coordinates. The Air Quality API provides hourly air-quality forecasts and current US AQI/particulate variables.

## Run
Because browser geolocation, service workers, and some API behavior are best served over HTTP, run a static server in this folder.

Example:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Production notes
The alert engine in this standalone version is a model/threshold-based risk layer, not an official warning feed. For emergency-grade alerts, integrate official local warning sources (for India, IMD and relevant state/district authorities) and add a server-side push scheduler.

For background mobile push, replace the local Notification API flow with Web Push + VAPID (or Firebase Cloud Messaging) and store subscriptions server-side.
