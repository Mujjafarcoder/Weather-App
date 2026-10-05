# Weather App

A responsive weather app showing current conditions, forecasts, and sunrise/sunset times, with day/night visuals. Built with HTML, CSS, JavaScript, and the OpenWeather API.

## Features

- Loads weather cards for Mumbai, Pune, Delhi, Bangalore, and Chennai.
- Search for another city.
- Shows temperature, feels-like temperature, humidity, wind, pressure, visibility, and cloud coverage.
- Displays sunrise and sunset in Indian Standard Time (IST), with a day/night indicator.
- Shows a forecast when a weather card is expanded.
- Changes the background video based on weather conditions, with a darker appearance at night.
- Adapts the layout for mobile screens and respects Save-Data and slow-network preferences.

## Deploy to Vercel

1. Import this GitHub repository into Vercel.
2. In the Vercel project settings, add an environment variable named `OPENWEATHER_API_KEY` with your OpenWeather API key.
3. Redeploy the project after adding or changing the environment variable.

The app uses OpenWeather's Current Weather, Geocoding, and forecast APIs through the Vercel function in `api/openweather.js`. For local testing with Vercel Functions, use the Vercel CLI and configure `OPENWEATHER_API_KEY` in a local `.env.local` file; do not commit that file. Forecast availability may depend on the API access enabled for your account.

## Project files

- `index.html` — page structure and video elements.
- `index.css` — responsive layout and styling.
- `weather.js` — client-side weather rendering, forecast interactions, and background video behavior.
- `api/openweather.js` — server-side OpenWeather API proxy; reads the API key from the Vercel environment.
- `assets/` — background videos and local images.

## API key security

Never put the API key in `weather.js` or another client-side file. If a key was committed to Git, revoke or rotate it in your OpenWeather account before deploying; removing it from the latest code does not erase it from repository history. Keep `.env.local` out of Git.
