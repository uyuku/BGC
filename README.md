https://bettergreatcircle.pages.dev (use WARP, or vpn to access the site, Turkey has blocked pages domains)
Better Great Circle

A single-page web application for calculating air, sea, and road distances
between global locations with interactive map visualisations and batch Excel
processing.

Features

  - Air Distance: Calculates great-circle air distance between airports or
    cities with an optional +8% routing detour toggle.
  - Sea Distance: Calculates maritime passage distances using Eurostat Maritime
    Network data via searoute-ts. Enforces a 14m vessel draft limit to avoid
    shallow canal shortcuts and supports optional via waypoints.
  - Road Distance: Calculates driving distance and estimated travel time via
    OSRM (Open Source Routing Machine).
  - Interactive Map: Renders air, sea, and road geometries using MapLibre GL JS
    with CARTO Positron basemap tiles and an OpenSeaMap nautical seamarks
    overlay.
  - Batch Excel Calculation: Processes uploaded .xlsx spreadsheets entirely
    client-side and exports updated files with calculated distances.

Usage

Open index.html in any modern web browser. No backend server or API keys
required.

Batch Spreadsheet Specification

The batch calculator accepts .xlsx or .xls files with either of the following
column header structures:

Option 1: Combined Location Columns

| departure | arrival  |
| :-------- | :------- |
| London    | Paris    |
| Hamburg   | Istanbul |

Option 2: Split Country and City Columns

| departure\_country | departure\_city | arrival\_country | arrival\_city |
| :----------------- | :-------------- | :--------------- | :------------ |
| Germany            | Hamburg         | Turkey           | Istanbul      |
| United Kingdom     | London          | France           | Paris         |

The batch process appends three output columns to each row:

  - km: Air great-circle distance
  - sea_km: Maritime route distance
  - road_km: Driving distance

Stack and Data Sources

  - UI Framework: Jelly UI
  - Map Rendering: MapLibre GL JS
  - Basemap Tiles: CARTO Positron
  - Nautical Tiles: OpenSeaMap
  - Sea Routing Engine: searoute-ts (Eurostat Maritime Network)
  - Road Routing Engine: OSRM API
  - Geocoding: OpenStreetMap Nominatim and global airport database
  - Excel Parsing: SheetJS (xlsx)
