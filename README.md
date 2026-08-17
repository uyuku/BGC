# Better Great Circle

A single page web application for calculating air, sea, and road distances
between locations worldwide, with an interactive map, a hotel guest travel
calculator, and batch Excel processing. Everything runs client side. There
is no backend server and no API keys are required.

## Features

### Air Distance
Calculates great circle (haversine) distance between two airports or
cities. Locations can be entered as an IATA code, a city name, or a city
and country. Istanbul and a handful of other major cities are routed to
their preferred hub airport automatically. An optional toggle adds a
standard 8 percent detour allowance to approximate real airway routing.

### Sea Route
Calculates maritime passage distance using the Eurostat Maritime Network
data via `searoute-ts`. Two options are tucked under an "Advanced" panel
below the main calculator:

- **Via waypoint**: force the route through a specific port or strait,
  useful for testing alternate passages.
- **Vessel draft**: routes are recalculated for a chosen draft in meters
  (5 to 25 m, default 14 m) so shallow canal shortcuts are avoided for
  vessels that cannot use them.

Any straits or canals the route passes through (for example the Suez
Canal or the Strait of Gibraltar) are listed as passages under the
result.

### Road Distance
Calculates driving distance and estimated travel time using OSRM (Open
Source Routing Machine).

### Hotel Guest Travel
Estimates a guest's travel distance to a hotel in two legs:

1. **Air leg**: great circle distance from the guest's nearest airport to
   the airport nearest the hotel.
2. **Last mile leg**: real road driving distance (via OSRM) from that
   airport to the hotel's exact location.

The hotel location can be entered as an address, a city, or manual GPS
coordinates (for example `41.0082, 28.9784`) when an exact point is
needed. The last mile mode (taxi, shuttle, or transit) is a label only;
all three use the same routed road distance, since it does not change
with vehicle type. A toggle lets you include or exclude the last mile leg
from the total, since many standard flight only travel calculators
exclude it by default.

The full guest journey (both legs, plus markers for the guest's airport,
the hotel's airport, and the hotel itself) is drawn on the map in its own
color so it does not overwrite the Air, Sea, or Road calculators above.

An optional panel below lets you estimate room night emissions
separately: enter a number of room nights and a kg CO2e per room night
factor (for example from Greenview's Hotel Footprinting Tool) to get a
stay total. This is not combined with the travel distance figures.

### Interactive Map
Renders air, sea, road, and hotel guest travel geometries using MapLibre
GL JS, with CARTO Positron basemap tiles (light and dark variants) and an
optional OpenSeaMap nautical seamarks overlay. The map theme follows the
app's light/dark mode toggle.

### Batch Excel Calculation
Processes an uploaded `.xlsx` or `.xls` file entirely in the browser and
returns a new file with distance columns filled in. Six starter templates
are available from the Batch Calculator section:

| Template | Columns expected | What it calculates |
| :------- | :---------------- | :------------------ |
| T1: Simple | departure, arrival | air_km, sea_km, road_km |
| T2: Split City/Country | departure_country, departure_city, arrival_country, arrival_city | air_km, sea_km, road_km |
| T3: Vessel Draft | departure, arrival, vessel_draft_m | air_km, sea_km, road_km, sea_passages |
| T4: Sea Waypoint | departure, arrival, via_waypoint | air_km, sea_km, road_km, sea_passages |
| T5: Master Suite | split columns plus vessel_draft_m, via_waypoint | air_km, sea_km, road_km, sea_passages |
| T6: Hotel Guest Travel | hotel_location, guest_origin, last_mile_mode | air_km, last_mile_km, total_km |

The batch calculator auto detects which format a file uses by inspecting
its header row, falling back to the first two columns as departure and
arrival if nothing else matches. Missing distance columns are appended
automatically rather than requiring an exact template match.

For the hotel format (T6), a Methodology sheet is added to the output
workbook explaining exactly how each figure was derived and what is and
is not included, since travel emissions figures are often audited.

## Usage

Run `npm install` once, then `npm run dev` to start a local dev server,
or build for production with `npm run build` followed by
`npm run preview`.

## Stack and Data Sources

- UI framework: Jelly UI web components
- Map rendering: MapLibre GL JS
- Basemap tiles: CARTO Positron, light and dark
- Nautical tiles: OpenSeaMap
- Sea routing engine: searoute-ts, Eurostat Maritime Network
- Road routing engine: OSRM public API
- Geocoding: an embedded IATA coded airport database, with OpenStreetMap
  Nominatim as a fallback for locations that are not airports
- Excel parsing: SheetJS (xlsx)

## Notes on Accuracy

All figures produced by this app are distances only, in kilometers. No
emission factors are applied anywhere in the app or in batch output
files. To convert a distance to kg CO2e, apply an emission factor set of
your choice, for example the UK DEFRA GHG Conversion Factors for Company
Reporting, which are published annually. Hotel room night emissions are
calculated separately from a user supplied factor and are never combined
with travel distance automatically.

Made by Necdet Omer Barut.
