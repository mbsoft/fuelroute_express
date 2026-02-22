# FuelRoute Express

A fuel cost optimization API for long-haul trucking routes. Given an origin, destination, and vehicle specs, the API calculates the cheapest fuel stops along the driving route using spatial queries and Dijkstra's shortest-path algorithm.

## How It Works

```
Client Request
  → Input validation (Joi)
  → Geocode origin & destination (Nominatim)
  → Compute truck route (NextBillion.ai Directions API)
  → Find fuel stations within 25 mi of route (Supabase + PostGIS)
  → Optimize fuel stops to minimize total cost (Dijkstra on a DAG)
  → Return stops, route geometry, and total fuel cost
```

The optimizer builds a directed acyclic graph where nodes are fuel stations (sorted by position along the route) and edge weights represent the fuel cost to travel between them. Dijkstra's algorithm finds the minimum-cost path from origin to destination, selecting only the stops that minimize total fuel spend.

## API

### `GET /api/route`

Calculate optimal fuel stops along a route.

**Query Parameters**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `start_location` | string | yes | — | Origin (e.g. `Columbus,OH`) |
| `finish_location` | string | yes | — | Destination (e.g. `Minneapolis,MN`) |
| `range_miles` | number | no | `500` | Vehicle fuel tank range in miles |
| `mpg` | number | no | `10` | Fuel efficiency (miles per gallon) |

**Example Request**

```
GET /api/route?start_location=Columbus,OH&finish_location=Minneapolis,MN&range_miles=120&mpg=10
```

**Success Response (200)**

```json
{
  "start": "Columbus,OH",
  "finish": "Minneapolis,MN",
  "total_distance_miles": 710.4,
  "total_duration_minutes": 645.2,
  "fuel_cost": 198.53,
  "stops": [
    {
      "station": "LOVES #466 TRAVEL STOP",
      "city": "RICHMOND",
      "state": "IN",
      "price": 3.29,
      "gallons": 12.5,
      "cost": 41.13,
      "lat": 39.83,
      "lon": -84.89
    }
  ],
  "route_geometry": [[39.96, -82.99], ...]
}
```

**Error Responses**

| Status | Condition |
|---|---|
| 400 | Invalid parameters or geocoding failure |
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
- **Database:** Supabase (PostgreSQL + PostGIS)
- **Geocoding:** OpenStreetMap Nominatim (route endpoints), NextBillion.ai Discover (fuel stations)
- **Routing:** NextBillion.ai Directions API (truck mode)
- **Infrastructure:** Google Cloud Run, Artifact Registry, Secret Manager (Terraform)

## Prerequisites

- Node.js >= 20
- A [Supabase](https://supabase.com) project with PostGIS enabled
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
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXTBILLION_API_KEY=your-nextbillion-api-key
```

### 3. Set up the database

Run the following SQL scripts in the Supabase SQL Editor (in order):

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

## Deployment

The project deploys to **Google Cloud Run** with infrastructure managed by **Terraform**.

### Infrastructure (Terraform)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

terraform init
terraform apply
```

Terraform provisions:
- **Artifact Registry** — Docker image repository
- **Secret Manager** — stores `SUPABASE_SERVICE_ROLE_KEY` and `NEXTBILLION_API_KEY`
- **Cloud Run v2 service** — scales 0–2 instances, 1 vCPU / 512 Mi RAM, public ingress
- **Service account** — dedicated identity with secret access

### Build & Deploy

```bash
bash deploy.sh
```

This builds the Docker image (`linux/amd64`, Node 20 slim), pushes to Artifact Registry, and updates the Cloud Run service.

## Project Structure

```
├── src/
│   ├── index.js                    # Express app entry point
│   ├── config/
│   │   ├── db.js                   # Supabase client
│   │   └── swagger.js              # OpenAPI spec config
│   ├── middleware/
│   │   └── errorHandler.js         # Global error handler
│   ├── routes/
│   │   └── route.js                # GET /api/route endpoint
│   ├── services/
│   │   ├── geocodingService.js     # Nominatim geocoder
│   │   ├── routingService.js       # NextBillion.ai directions
│   │   └── fuelOptimizationService.js  # Dijkstra fuel optimizer
│   └── utils/
│       ├── dijkstra.js             # Min-heap Dijkstra implementation
│       ├── errors.js               # Custom error classes
│       └── validation.js           # Joi request validation
├── scripts/
│   ├── geocode_stations.js         # Bulk geocode + insert stations
│   ├── create_rpc_function.sql     # PostGIS RPC function
│   ├── import_fuel_prices.sql      # CSV import workflow
│   └── insert_fuel_prices.sql      # Bulk INSERT seed data
├── terraform/                      # GCP infrastructure
├── Dockerfile
├── deploy.sh
└── .env.example
```

## License

ISC
