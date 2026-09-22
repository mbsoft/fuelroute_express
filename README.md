# FuelRoute Express

A fuel cost optimization API for long-haul trucking routes. Given an origin, destination, and vehicle specs, the API calculates the cheapest fuel stops along the driving route using spatial queries and greedy windowed optimization with realistic fuel tracking.

## How It Works

```
Client Request
  → Input validation (Joi)
  → Geocode origin & destination (NextBillion.ai Discovery)
  → Compute truck route + alternatives (NextBillion.ai Directions API)
  → Find fuel stations within configurable deviation of route (Cloud SQL fuel price data + PostGIS)
  → Greedy windowed stop selection: cheapest station in lookahead window
  → Track exact gallons, cost, and fuel level at each stop
  → Interpolate fuel levels across the full polyline for gradient rendering
  → Return routes with stops, fuel costs, encoded polyline, and fuel level array
```

### Optimization Algorithm

1. **Station discovery** — A PostGIS spatial query (`find_stations_along_route`) finds all fuel stations within `deviation_miles` of the route geometry. Each station's position along the route is computed as a fraction via `ST_LineLocatePoint`. Stations where the retail price is less than the negotiated "your price" are filtered out.

2. **Node ordering** — Nodes are `[START, ...stations, END]`, sorted by distance along the route.

3. **Greedy windowed stop selection** — The truck drives until fuel drops to the `refuel_threshold_pct` level, then searches a bounded lookahead window for the cheapest station. The window size equals the distance it takes to consume fuel from full down to the threshold (capped at half-threshold range to avoid running too low). The cheapest station in this window is selected and the truck fills to full. If no station exists in the preferred window, the search extends to the full remaining fuel range. This repeats until the destination is reachable without hitting the threshold.

4. **Fuel tracking** — At each selected stop, the algorithm records exact gallons purchased (always fills to full), fuel cost, and arrival/departure fuel percentages.

5. **Fuel level interpolation** — The fuel level is computed at every decoded polyline coordinate by linearly interpolating consumption between path nodes. This produces a `fuel_levels` array (integers 0–100, same length as the decoded polyline) that clients can use for gradient-colored route rendering (green at 100% through red at 20% and below).

## API

### `GET /api/route`

Calculate optimal fuel stops along a route.

**Query Parameters**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `start_location` | string | yes | — | Origin city/address (e.g. `Columbus, OH`) |
| `finish_location` | string | yes | — | Destination city/address (e.g. `Minneapolis, MN`) |
| `start_lat` | number | no | — | Origin latitude (skips geocoding if provided with `start_lon`) |
| `start_lon` | number | no | — | Origin longitude |
| `finish_lat` | number | no | — | Destination latitude (skips geocoding if provided with `finish_lon`) |
| `finish_lon` | number | no | — | Destination longitude |
| `waypoints` | string | no | — | Pipe-separated intermediate stops: `lat,lon\|lat,lon` |
| `tank_capacity` | number | no | `250` | Fuel tank capacity in gallons |
| `current_gallons` | number | no | `250` | Gallons of fuel currently onboard (must not exceed `tank_capacity`) |
| `mpg` | number | no | `10` | Fuel efficiency (miles per gallon) |
| `deviation_miles` | number | no | `10` | Max distance off-route to search for stations |
| `refuel_threshold_pct` | number | no | `80` | Fuel level % at which the truck will consider stopping (see below) |
| `range_miles` | number | no | — | **Legacy.** If provided without `tank_capacity`, derives `tank_capacity = range_miles / mpg` |

**Refuel Threshold**

The `refuel_threshold_pct` parameter controls when the truck is allowed to stop for fuel. The truck will only stop at a station if its fuel level upon arrival would be at or below this percentage. For example, with `refuel_threshold_pct=80` and a 200-gallon tank, the truck will not stop at any station until fuel drops to 160 gallons (80%) or below. Lower values mean the truck drives longer before each stop.

**Waypoints**

Intermediate stops are specified as pipe-separated `lat,lon` pairs. When waypoints are present, only a single route is returned (alternative routes are not available with waypoints due to routing API constraints). Waypoint coordinates should be on or near truck-accessible roads — downtown coordinates in restricted urban areas may cause routing failures.

**Example Requests**

New parameters (full fuel tracking):
```
GET /api/route?start_location=Columbus,OH&finish_location=Minneapolis,MN
  &tank_capacity=150&current_gallons=75&mpg=6&deviation_miles=15&refuel_threshold_pct=80
```

With coordinates and waypoints:
```
GET /api/route?start_location=Columbus,OH&finish_location=Minneapolis,MN
  &start_lat=39.9612&start_lon=-82.9988&finish_lat=44.9778&finish_lon=-93.2650
  &waypoints=41.4993,-81.6944|41.6032,-87.3345
  &tank_capacity=200&current_gallons=100&mpg=7&deviation_miles=12
```

Legacy (backward compatible):
```
GET /api/route?start_location=Columbus,OH&finish_location=Minneapolis,MN&range_miles=500&mpg=10
```

**Success Response (200)**

```json
{
  "start": "Columbus, OH",
  "finish": "Minneapolis, MN",
  "routes": [
    {
      "route_index": 0,
      "total_distance_miles": 768.2,
      "total_duration_minutes": 907.4,
      "fuel_cost": 43.76,
      "stops": [
        {
          "station": "Kwik Trip #593",
          "city": "MENOMONIE",
          "state": "WI",
          "price": 2.968,
          "gallons": 14.8,
          "cost": 43.76,
          "lat": 44.9041,
          "lon": -91.9341,
          "fuel_level_arriving": 2,
          "fuel_level_after": 17
        }
      ],
      "route_polyline": "encoded_polyline_string",
      "fuel_levels": [100, 99, 98, 97, "...", 2, 17, 16, "...", 5]
    }
  ]
}
```

**Response Fields**

| Field | Type | Description |
|---|---|---|
| `routes` | array | 1–4 route options (1 when waypoints are used) |
| `routes[].route_index` | number | Index of this route option |
| `routes[].total_distance_miles` | number | Total driving distance |
| `routes[].total_duration_minutes` | number | Estimated driving time |
| `routes[].fuel_cost` | number | Total fuel cost for all stops on this route |
| `routes[].stops` | array | Ordered list of recommended fuel stops |
| `routes[].stops[].station` | string | Station name |
| `routes[].stops[].city` | string | City |
| `routes[].stops[].state` | string | 2-letter state code |
| `routes[].stops[].price` | number | Diesel price per gallon |
| `routes[].stops[].gallons` | number | Gallons to purchase |
| `routes[].stops[].cost` | number | Cost at this stop |
| `routes[].stops[].lat` | number | Station latitude |
| `routes[].stops[].lon` | number | Station longitude |
| `routes[].stops[].fuel_level_arriving` | number | Fuel level % when arriving at this stop |
| `routes[].stops[].fuel_level_after` | number | Fuel level % after refueling |
| `routes[].route_polyline` | string | Encoded polyline (Google format) |
| `routes[].fuel_levels` | array | Integer array (0–100) of fuel level % at each polyline coordinate, for gradient rendering |

**Backward Compatibility**

| Caller sends | Behavior |
|---|---|
| Only `range_miles=500` (legacy) | `tank_capacity = 500/mpg`, `current_gallons = tank_capacity`. Equivalent to old behavior. |
| `tank_capacity` + `current_gallons` (new) | `range_miles` ignored. Full fuel tracking. |
| Neither | Defaults: 250 gal tank, 250 gal onboard, 10 mpg = 2500 mi range. |

**Error Responses**

| Status | Condition |
|---|---|
| 400 | Invalid parameters, geocoding failure, or `current_gallons > tank_capacity` |
| 404 | No driving route found between locations |
| 422 | Route exceeds vehicle range without reachable stations (includes route geometry in response) |
| 429 | Rate limit exceeded (100 requests per 24 hours) |
| 500 | Internal server error |

### `GET /health`

Health check endpoint. Returns `{ "status": "ok" }`.

### `GET /api/schema/swagger-ui`

Interactive Swagger UI documentation.

### `GET /api/schema`

Raw OpenAPI 3.0.3 JSON specification.

## Tech Stack

- **Runtime:** Node.js 20, Express 5
- **Database:** Google Cloud SQL (PostgreSQL + PostGIS)
- **Geocoding:** OpenStreetMap Nominatim (route endpoints), NextBillion.ai Discover (fuel stations)
- **Routing:** NextBillion.ai Directions API (truck mode, up to 3 alternative routes)
- **Infrastructure:** Google Cloud Run, Artifact Registry, Secret Manager (Terraform)

## Prerequisites

- Node.js >= 20
- A Google Cloud SQL for PostgreSQL instance with the `postgis` extension enabled
- [`cloud-sql-proxy`](https://cloud.google.com/sql/docs/postgres/sql-proxy) for local development
- A [NextBillion.ai](https://nextbillion.ai) API key

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

```env
PORT=3000
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your-db-password
DB_HOST=127.0.0.1
DB_PORT=5432
NEXTBILLION_API_KEY=your-nextbillion-api-key
```

For local development, run the Cloud SQL Auth Proxy in another terminal so `DB_HOST=127.0.0.1` reaches the instance:

```bash
cloud-sql-proxy your-gcp-project-id:us-central1:your-instance
```

On Cloud Run, `INSTANCE_CONNECTION_NAME` is set instead of `DB_HOST`, and the app connects through the `/cloudsql` unix socket.

### 3. Set up the database

Run the following SQL scripts against the database with `psql` (in order):

1. **Create the RPC function** — `scripts/create_rpc_function.sql`

   Creates the `find_stations_along_route` PostGIS function that finds fuel stations within a buffer distance of a route linestring.

2. **Create a spatial index** (recommended for performance):

   ```sql
   CREATE INDEX IF NOT EXISTS idx_fuelstation_location
   ON fuel_api_fuelstation USING GIST (location);
   ```

3. **Import fuel price data** — `scripts/import_fuel_prices.sql`

   Creates the `fuel_price_import` staging table and provides the workflow for importing CSV price data and merging it into the main `fuel_api_fuelstation` table.

4. **Geocode and insert new stations:**

   ```bash
   npm run geocode
   ```

   Reads the staging table, geocodes each station via NextBillion.ai Discover API, and inserts into `fuel_api_fuelstation` with coordinates and a PostGIS geometry.

### 4. Run the server

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

## Database Schema

### `fuel_api_fuelstation`

The main fuel station table used by the API.

| Column | Type | Description |
|---|---|---|
| `id` | integer | Auto-incrementing primary key |
| `opis_id` | integer | OPIS station ID (synthetic for imported stations) |
| `name` | text | Station name |
| `address` | text | Street address or interstate/exit info |
| `city` | text | City |
| `state` | text | 2-letter state code |
| `rack_id` | integer | Rack pricing ID (0 for imported) |
| `retail_price` | numeric | Diesel retail price per gallon |
| `our_price` | numeric(6,3) | Discounted price |
| `savings` | numeric(6,3) | Savings vs retail |
| `fee` | numeric(6,3) | Transaction fee |
| `your_price` | numeric(6,3) | Net price after fee |
| `your_savings` | numeric(6,3) | Net savings after fee |
| `latitude` | double precision | WGS84 latitude |
| `longitude` | double precision | WGS84 longitude |
| `location` | geometry(Point, 4326) | PostGIS geometry for spatial queries |

### `fuel_price_import` (staging)

Temporary table for bulk-importing fuel price data from CSV files.

| Column | Type | Description |
|---|---|---|
| `vendor` | text | Chain name (Loves, PFJ, TA/Petro, etc.) |
| `store` | text | Store name |
| `address` | text | Location description |
| `city` | text | City |
| `state` | text | 2-letter state code |
| `retail_price` | numeric(6,3) | Retail diesel price |
| `our_price` | numeric(6,3) | Discounted price |
| `savings` | numeric(6,3) | Savings vs retail |
| `fee` | numeric(6,3) | Transaction fee |
| `your_price` | numeric(6,3) | Net price after fee |
| `your_savings` | numeric(6,3) | Net savings after fee |
| `insufficient_discount` | text | Flag for locations with negative net savings |

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start the production server |
| `npm run dev` | Start with file watching (auto-restart) |
| `npm run geocode` | Geocode staging table stations and insert into main table |
| `npm run geocode -- --schema` | Print the `fuel_api_fuelstation` table schema |
| `npm run update-prices -- <csv-file>` | Update fuel prices from a vendor CSV file |
| `npm run regeocode-loves` | Re-geocode Loves stations |
| `npm run regeocode-caseys` | Re-geocode Casey's stations |
| `npm run regeocode-kwiktrip` | Re-geocode Kwik Trip stations |

## Deployment

The project deploys to **Google Cloud Run**.

### Build & Deploy

```bash
bash deploy.sh
```

This script:
1. Detects GCP project and region from `gcloud config` (overridable via `GCP_PROJECT_ID` and `GCP_REGION` env vars)
2. Creates an Artifact Registry repository if it doesn't exist
3. Builds the Docker image (`linux/amd64`, Node 20 slim)
4. Pushes to Artifact Registry
5. Creates or updates the Cloud Run service

### Infrastructure (Terraform)

Optional Terraform configuration is available in `terraform/` for managing:
- **Artifact Registry** — Docker image repository
- **Secret Manager** — stores `DB_PASSWORD` and `NEXTBILLION_API_KEY`
- **Cloud Run v2 service** — scales 0–2 instances, 1 vCPU / 512 Mi RAM, public ingress
- **Service account** — dedicated identity with secret access and `roles/cloudsql.client`
- **Cloud SQL connection** — mounts the instance's unix socket into the Cloud Run container

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

terraform init
terraform apply
```

## Project Structure

```
├── src/
│   ├── index.js                    # Express app entry point
│   ├── config/
│   │   ├── db.js                   # Postgres (Cloud SQL) connection pool
│   │   └── swagger.js              # OpenAPI spec config
│   ├── middleware/
│   │   └── errorHandler.js         # Global error handler
│   ├── routes/
│   │   └── route.js                # GET /api/route endpoint
│   ├── services/
│   │   ├── geocodingService.js     # Nominatim geocoder
│   │   ├── routingService.js       # NextBillion.ai directions + alternatives
│   │   └── fuelOptimizationService.js  # Greedy windowed fuel stop optimizer
│   └── utils/
│       ├── dijkstra.js             # Min-heap Dijkstra implementation (legacy)
│       ├── errors.js               # Custom error classes
│       └── validation.js           # Joi request validation
├── scripts/
│   ├── geocode_stations.js         # Bulk geocode + insert stations
│   ├── regeocode_chain.js          # Re-geocode a station chain
│   ├── regeocode_loves.js          # Re-geocode Loves stations
│   ├── update_price_columns.js     # Update prices from vendor CSV
│   ├── transform_caseys_csv.js     # Transform Casey's CSV to standard format
│   ├── create_rpc_function.sql     # PostGIS RPC function
│   ├── import_fuel_prices.sql      # CSV import workflow
│   └── insert_fuel_prices.sql      # Bulk INSERT seed data
├── terraform/                      # GCP infrastructure (optional)
├── Dockerfile
├── deploy.sh
└── .env.example
```

## License

ISC
