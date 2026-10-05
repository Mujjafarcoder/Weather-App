'use strict';

const OPENWEATHER_ENDPOINTS = {
    current: 'https://api.openweathermap.org/data/2.5/weather',
    forecast: 'https://api.openweathermap.org/data/2.5/forecast',
    onecall: 'https://api.openweathermap.org/data/2.5/onecall',
    geocode: 'https://api.openweathermap.org/geo/1.0/direct',
};

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
        console.error('OPENWEATHER_API_KEY is not configured.');
        return res.status(500).json({ error: 'Weather service is not configured.' });
    }

    const url = new URL(req.url, 'http://localhost');
    const type = url.searchParams.get('type');
    const endpoint = OPENWEATHER_ENDPOINTS[type];
    if (!endpoint) {
        return res.status(400).json({ error: 'Unsupported weather request.' });
    }

    const q = (url.searchParams.get('q') || '').trim();
    const latValue = url.searchParams.get('lat');
    const lonValue = url.searchParams.get('lon');
    const lat = Number(latValue);
    const lon = Number(lonValue);

    if (q.length > 100) {
        return res.status(400).json({ error: 'City name is too long.' });
    }

    const hasValidCoordinates = latValue !== null && lonValue !== null
        && Number.isFinite(lat) && lat >= -90 && lat <= 90
        && Number.isFinite(lon) && lon >= -180 && lon <= 180;

    if (type === 'geocode' && !q) {
        return res.status(400).json({ error: 'A city name is required.' });
    }

    if (type === 'current' && !q) {
        return res.status(400).json({ error: 'A city name is required.' });
    }

    if ((type === 'onecall' || type === 'forecast') && !hasValidCoordinates && !q) {
        return res.status(400).json({ error: 'A city name or valid coordinates are required.' });
    }

    const providerUrl = new URL(endpoint);
    providerUrl.searchParams.set('appid', apiKey);

    if (type === 'geocode') {
        providerUrl.searchParams.set('q', q);
        providerUrl.searchParams.set('limit', '1');
    } else if ((type === 'onecall' || type === 'forecast') && hasValidCoordinates) {
        providerUrl.searchParams.set('lat', String(lat));
        providerUrl.searchParams.set('lon', String(lon));
        providerUrl.searchParams.set('units', 'metric');
        if (type === 'onecall') {
            providerUrl.searchParams.set('exclude', 'current,minutely,hourly,alerts');
        }
    } else {
        providerUrl.searchParams.set('q', q);
        if (type === 'current' || type === 'forecast') {
            providerUrl.searchParams.set('units', 'metric');
        }
    }

    try {
        const providerResponse = await fetch(providerUrl);
        const data = await providerResponse.json();
        return res.status(providerResponse.status).json(data);
    } catch (error) {
        console.error('OpenWeather request failed:', error);
        return res.status(502).json({ error: 'Weather provider is unavailable.' });
    }
};
