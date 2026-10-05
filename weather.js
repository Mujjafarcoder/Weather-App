'use strict';

const DEFAULT_CITIES = ['Mumbai', 'Pune', 'Delhi', 'Bangalore', 'Chennai'];

// Map OpenWeatherMap's "main" condition to a background video.
// Unmapped conditions (Mist, Fog, Haze, Snow, Thunderstorm, etc.) fall back to 'Clouds'.
const WEATHER_VIDEO_MAP = {
    Clear: './assets/sun.mp4',
    Clouds: './assets/cloud.mp4',
    Rain: './assets/rain.mp4',
    Drizzle: './assets/rain.mp4',
    Thunderstorm: './assets/rain.mp4',
};
const DEFAULT_VIDEO = './assets/cloud.mp4';

const els = {
    container: document.getElementById('weather-container'),
    cityInput: document.getElementById('city'),
    searchBtn: document.getElementById('btn'),
    spinner: document.getElementById('btn-spinner'),
    banner: document.getElementById('status-banner'),
    videoA: document.getElementById('bg-video-a'),
    videoB: document.getElementById('bg-video-b'),
};

let swiper = null;
let activeVideo = els.videoA;
let inactiveVideo = els.videoB;

// Simple in-memory caches to reduce network requests during a session
const weatherCache = new Map();
const forecastCache = new Map();

// Network / device heuristics to reduce heavy background work on mobile/slow connections
const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const saveData = connection?.saveData ?? false;
const effectiveType = connection?.effectiveType ?? '';
const disableVideoOnThisDevice = saveData || /2g|slow-2g/.test(effectiveType);

function setVideoMode() {
    if (disableVideoOnThisDevice) {
        [els.videoA, els.videoB].forEach(v => {
            try { v.pause(); } catch (e) {}
            // remember what would have played so we can restore it if user enables
            v.dataset.backupSrc = v.dataset.src || v.src || v.getAttribute('data-src') || '';
            v.removeAttribute('src');
            v.classList.add('hidden-by-performance');
            try { v.load(); } catch (e) {}
            v.style.display = 'none';
        });
        const overlay = document.querySelector('.overlay');
        if (overlay) overlay.style.background = 'rgba(0,0,0,0.25)';
        showEnableVideoButton();
    } else {
        [els.videoA, els.videoB].forEach(v => v.style.display = 'block');
    }
}

function showEnableVideoButton() {
    if (document.getElementById('enable-video-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'enable-video-btn';
    btn.className = 'enable-vid-btn';
    btn.textContent = 'Enable background video';
    btn.addEventListener('click', enableBackgroundVideoUser);
    document.body.appendChild(btn);
}

function enableBackgroundVideoUser() {
    const btn = document.getElementById('enable-video-btn');
    [els.videoA, els.videoB].forEach(v => {
        const src = v.dataset.backupSrc || v.getAttribute('data-src') || DEFAULT_VIDEO;
        v.muted = true;
        v.playsInline = true;
        v.src = src;
        try { v.load(); } catch (e) {}
        v.classList.remove('hidden-by-performance');
        v.style.display = 'block';
        v.play().catch(err => console.warn('User-enabled video play failed:', err));
    });
    if (btn) btn.remove();
}

// Wire up search immediately — this must never depend on the slider or
// default-city fetches succeeding, so a network/library failure elsewhere
// can't silently take the search box down with it.
els.searchBtn.addEventListener('click', handleSearch);
els.cityInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSearch();
});

// Diagnostics: if a background video can't actually load (wrong path,
// missing file, unsupported format) you'll see this in the console instead
// of just a silent black screen.
[els.videoA, els.videoB].forEach(v => {
    v.addEventListener('error', () => {
        console.error(`Video failed to load: ${v.currentSrc || v.src}. Check the ./assets/ path.`);
    });
});

initSwiper();
els.container.addEventListener('click', handleSlideCardClick);
window.setInterval(updateDaylightIndicators, 60_000);

// Keep the weather rendering independent from the video feature so refreshes
// still show the cards even when mobile/video logic runs first.
window.addEventListener('DOMContentLoaded', () => {
    loadDefaultCities().catch(() => {
        console.warn('Default city loading failed');
    });
    setVideoMode();
});

function initSwiper() {
    if (typeof Swiper === 'undefined') {
        console.warn('Swiper library did not load (CDN blocked or offline). Falling back to a simple layout.');
        els.container.classList.add('plain-layout');
        return;
    }

    try {
        swiper = new Swiper('.mySwiper', {
            slidesPerView: 1,
            spaceBetween: 20,
            loop: false,
            autoHeight: true,
            pagination: { el: '.swiper-pagination', clickable: true },
            navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
        });
            swiper.on('slideChange', updateVideoForActiveSlide);
    } catch (err) {
        console.error('Swiper failed to initialize:', err);
        showBanner('Could not start the slider. See console for details.', true);
    }
}

document.addEventListener('click', () => {
    ensureVideoPlayback(activeVideo);
    ensureVideoPlayback(inactiveVideo);
}, { once: false });

async function loadDefaultCities() {
    showSkeleton(DEFAULT_CITIES.length);

    let results;
    try {
        results = await Promise.allSettled(
            DEFAULT_CITIES.map(city => fetchWeather(city))
        );
    } catch (err) {
        console.error('Unexpected error loading default cities:', err);
        showBanner('Something went wrong loading weather. See console for details.', true);
        return;
    }

    const failures = results.filter(r => r.status === 'rejected' || !r.value);
    if (failures.length) {
        console.warn(`${failures.length} of ${DEFAULT_CITIES.length} default cities failed to load.`, failures);
    }

    const slidesHtml = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => buildSlide(r.value))
        .join('');

    els.container.innerHTML = slidesHtml || '';

    if (!slidesHtml) {
        showBanner('Could not load weather right now. Open the browser console for details (likely a network issue or invalid API key).', true);
        return;
    }

    if (swiper) {
        swiper.update();
        if (swiper.slides.length > 1) {
            swiper.params.loop = true;
            swiper.loopDestroy();
            swiper.loopCreate();
            swiper.update();
        }
        updateVideoForActiveSlide();
        ensureVideoPlayback(activeVideo);
    }
}

async function handleSearch() {
    const cityName = els.cityInput.value.trim();
    if (!cityName) return;

    if (!swiper) {
        showBanner('The slider failed to load, so results can\'t be displayed. Reload the page.', true);
        return;
    }

    // If it's already loaded, just slide to it instead of duplicating.
    const existingIndex = findSlideIndexByCity(cityName);
    if (existingIndex !== -1) {
        swiper.slideToLoop ? swiper.slideToLoop(existingIndex) : swiper.slideTo(existingIndex);
        return;
    }

    setLoading(true);
    hideBanner();

    const data = await fetchWeather(cityName);

    setLoading(false);

    if (!data) {
        showBanner(`Couldn't find "${cityName}". Check the spelling and try again.`, true);
        return;
    }

    const slideHtml = buildSlide(data);

    if (swiper.slides.length === 0) {
        els.container.innerHTML = slideHtml;
        swiper.update();
    } else {
        swiper.appendSlide(slideHtml);
    }

    const newIndex = swiper.slides.length - 1;
    swiper.slideTo(newIndex);
    els.cityInput.value = '';
}

function findSlideIndexByCity(cityName) {
    if (!swiper) return -1;
    const target = cityName.toLowerCase();
    for (let i = 0; i < swiper.slides.length; i++) {
        if (swiper.slides[i].dataset.city?.toLowerCase() === target) return i;
    }
    return -1;
}

async function fetchWeather(city) {
    if (!city) return null;
    const key = city.toLowerCase();
    if (weatherCache.has(key)) return weatherCache.get(key);

    try {
        const res = await fetchOpenWeather('current', { q: city });
        const data = await res.json();

        if (!res.ok || data?.cod != 200) return null;
        weatherCache.set(key, data);
        return data;
    } catch (err) {
        console.error('Weather fetch failed:', err);
        return null;
    }
}

function buildSlide(data) {
    const windKmh = Math.round(data.wind.speed * 3.6);
    const cityName = escapeHtml(data.name || 'City');
    const desc = escapeHtml(data.weather?.[0]?.description || 'Weather');
    const sunrise = data.sys?.sunrise;
    const sunset = data.sys?.sunset;
    const daylightState = getDaylightState(sunrise, sunset);
    const isClear = data.weather?.[0]?.main === 'Clear';
    const iconCode = String(data.weather?.[0]?.icon || '01d').replace(/[dn]$/, '');
    const dayIconUrl = `https://openweathermap.org/img/wn/${iconCode}d@2x.png`;
    const nightIconUrl = isClear
        ? './assets/moon-image.jpg'
        : `https://openweathermap.org/img/wn/${iconCode}n@2x.png`;
    const isClearNight = isClear && daylightState === 'night';
    const iconUrl = daylightState === 'night' ? nightIconUrl : dayIconUrl;

    return `
        <div class="swiper-slide" data-city="${cityName}" data-weather="${escapeHtml(data.weather?.[0]?.main || '')}" data-lat="${data.coord?.lat ?? ''}" data-lon="${data.coord?.lon ?? ''}">
            <div class="weather-card">
                <div class="card-main">
                    <h2 class="city-name">${cityName}</h2>
                    <img class="weather-icon${isClearNight ? ' moon-weather-icon' : ''}" src="${iconUrl}" data-day-icon="${dayIconUrl}" data-night-icon="${nightIconUrl}" data-is-clear="${isClear}" alt="${isClearNight ? 'Moon' : desc}" width="100" height="100">
                    <h1 class="temp">${Math.round(data.main.temp)}°C</h1>
                    <p class="weather-desc">${desc}</p>
                    <div class="daylight-info" data-sunrise="${Number.isFinite(sunrise) ? sunrise : ''}" data-sunset="${Number.isFinite(sunset) ? sunset : ''}" data-daylight-state="${daylightState}">
                        <span class="daylight-status">${daylightState === 'unknown' ? 'Sun times unavailable' : daylightState === 'day' ? 'Daytime' : 'Nighttime'}</span>
                        <span class="sun-times">Sunrise ${formatIndiaTime(sunrise)} IST <span aria-hidden="true">·</span> Sunset ${formatIndiaTime(sunset)} IST</span>
                    </div>
                    <div class="details-grid">
                        <div>Feels like<br><strong>${Math.round(data.main.feels_like)}°C</strong></div>
                        <div>Humidity<br><strong>${data.main.humidity}%</strong></div>
                        <div>Wind<br><strong>${windKmh} km/h</strong></div>
                        <div>Pressure<br><strong>${data.main.pressure} hPa</strong></div>
                        <div>Visibility<br><strong>${Math.round((data.visibility || 0) / 1000)} km</strong></div>
                        <div>Clouds<br><strong>${data.clouds?.all ?? 0}%</strong></div>
                    </div>
                </div>
                <p class="more-info">Tap to expand details and 8-day forecast</p>
                <div class="forecast-panel d-none"></div>
            </div>
        </div>
    `;
}

function getDaylightState(sunrise, sunset, now = Date.now()) {
    if (!Number.isFinite(sunrise) || !Number.isFinite(sunset) || sunset <= sunrise) {
        return 'unknown';
    }

    const nowSeconds = now / 1000;
    return nowSeconds >= sunrise && nowSeconds < sunset ? 'day' : 'night';
}

function formatIndiaTime(timestamp) {
    if (!Number.isFinite(timestamp)) return '--';

    return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(timestamp * 1000));
}

function updateDaylightIndicators() {
    document.querySelectorAll('.daylight-info').forEach(indicator => {
        const sunrise = indicator.dataset.sunrise ? Number(indicator.dataset.sunrise) : NaN;
        const sunset = indicator.dataset.sunset ? Number(indicator.dataset.sunset) : NaN;
        const state = getDaylightState(sunrise, sunset);
        indicator.dataset.daylightState = state;
        indicator.querySelector('.daylight-status').textContent =
            state === 'unknown' ? 'Sun times unavailable' : state === 'day' ? 'Daytime' : 'Nighttime';

        if (state !== 'unknown') {
            const weatherIcon = indicator.closest('.weather-card')?.querySelector('.weather-icon');
            if (weatherIcon) {
                const isNight = state === 'night';
                weatherIcon.src = isNight ? weatherIcon.dataset.nightIcon : weatherIcon.dataset.dayIcon;
                const showMoon = isNight && weatherIcon.dataset.isClear === 'true';
                weatherIcon.classList.toggle('moon-weather-icon', showMoon);
                weatherIcon.alt = showMoon ? 'Moon' : indicator.closest('.weather-card')?.querySelector('.weather-desc')?.textContent || 'Weather';
            }
        }
    });
    updateVideoForActiveSlide();
}

function handleSlideCardClick(event) {
    const card = event.target.closest('.weather-card');
    if (!card) return;

    const slide = card.closest('.swiper-slide');
    if (!slide) return;

    const panel = card.querySelector('.forecast-panel');
    if (!panel) return;

    const shouldExpand = !card.classList.contains('is-expanded');
    card.classList.toggle('is-expanded', shouldExpand);
    panel.classList.toggle('d-none', !shouldExpand);

    if (shouldExpand) {
        loadForecastForCity(slide.dataset.city, slide.dataset.lat, slide.dataset.lon, panel)
            .then(() => {
                if (swiper) swiper.updateAutoHeight(300);
                if (window.matchMedia('(max-width: 768px)').matches) {
                    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
    } else if (swiper) {
        swiper.updateAutoHeight(300);
    }
}

async function loadForecastForCity(cityName, lat, lon, panel) {
    panel.innerHTML = '<p class="forecast-loading">Loading forecast…</p>';

    try {
        // Try to ensure we have coordinates
        let latNum = lat;
        let lonNum = lon;
        if (!latNum || !lonNum) {
            const geo = await fetchGeoForCity(cityName);
            if (geo) {
                latNum = geo.lat;
                lonNum = geo.lon;
            }
        }

        if (!latNum || !lonNum) {
            panel.innerHTML = '<p class="forecast-error">Forecast details are not available for this city.</p>';
            return;
        }

        const data = await fetchForecast(cityName, latNum, lonNum);
        if (!data) {
            panel.innerHTML = '<p class="forecast-error">Forecast details could not be loaded right now.</p>';
            return;
        }

        if (data.daily && data.daily.length) {
            const daysHtml = data.daily.slice(0, 8).map(day => {
                const date = new Date(day.dt * 1000);
                const dayName = date.toLocaleDateString('en', { weekday: 'short' });
                const iconUrl = `https://openweathermap.org/img/wn/${day.weather?.[0]?.icon}@2x.png`;
                return `
                    <div class="forecast-day">
                        <div class="forecast-day-name">${dayName}</div>
                        <img src="${iconUrl}" alt="${escapeHtml(day.weather?.[0]?.description || 'forecast')}" width="32" height="32">
                        <div class="forecast-temp">${Math.round(day.temp?.day ?? 0)}°C</div>
                        <div class="forecast-desc">${escapeHtml(day.weather?.[0]?.description || '')}</div>
                    </div>
                `;
            }).join('');

            panel.innerHTML = `
                <div class="forecast-summary">
                    <div><strong>Sunrise</strong><br>${new Date(data.daily[0].sunrise * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                    <div><strong>Sunset</strong><br>${new Date(data.daily[0].sunset * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                    <div><strong>Pressure</strong><br>${Math.round(data.daily[0].pressure)} hPa</div>
                </div>
                <div class="forecast-days">${daysHtml}</div>
            `;
            return;
        }

        // Fallback grouping for 5-day/3-hour forecast
        if (data.list && data.list.length) {
            const groups = {};
            data.list.forEach(item => {
                const d = new Date(item.dt * 1000);
                const key = d.toISOString().slice(0,10);
                groups[key] = groups[key] || [];
                groups[key].push(item);
            });

            const days = Object.keys(groups).slice(0,8);
            const daysHtml = days.map(k => {
                const items = groups[k];
                const avgTemp = Math.round(items.reduce((s,i)=>s+(i.main.temp||0),0)/items.length);
                const first = items[0];
                const iconUrl = `https://openweathermap.org/img/wn/${first.weather?.[0]?.icon}@2x.png`;
                const dayName = new Date(k).toLocaleDateString('en', { weekday: 'short' });
                return `
                    <div class="forecast-day">
                        <div class="forecast-day-name">${dayName}</div>
                        <img src="${iconUrl}" alt="${escapeHtml(first.weather?.[0]?.description||'')}">
                        <div class="forecast-temp">${avgTemp}°C</div>
                        <div class="forecast-desc">${escapeHtml(first.weather?.[0]?.description||'')}</div>
                    </div>
                `;
            }).join('');

            panel.innerHTML = `<div class="forecast-days">${daysHtml}</div>`;
            return;
        }

        panel.innerHTML = '<p class="forecast-error">Forecast details could not be loaded right now.</p>';
    } catch (err) {
        console.error('Forecast fetch failed:', err);
        panel.innerHTML = `
            <p class="forecast-error">Forecast details could not be loaded right now.</p>
            <p class="forecast-debug-toggle"><button class="btn btn-sm btn-light" id="show-forecast-debug">Show debug</button></p>
            <pre id="forecast-debug" class="d-none" style="white-space:pre-wrap;max-height:200px;overflow:auto;background:rgba(0,0,0,0.35);padding:8px;border-radius:8px;margin-top:8px;color:#fff"></pre>
        `;
        const dbgBtn = document.getElementById('show-forecast-debug');
        if (dbgBtn) {
            dbgBtn.addEventListener('click', () => {
                const pre = document.getElementById('forecast-debug');
                if (!pre) return;
                if (pre.classList.contains('d-none')) {
                    pre.classList.remove('d-none');
                    pre.textContent = err && err.message ? err.message : String(err);
                    dbgBtn.textContent = 'Hide debug';
                } else {
                    pre.classList.add('d-none');
                    dbgBtn.textContent = 'Show debug';
                }
            });
        }
    }
}

async function fetchForecast(city, lat, lon) {
    const key = `${lat},${lon}`;
    if (forecastCache.has(key)) return forecastCache.get(key);
    const hasCoordinates = lat !== '' && lon !== ''
        && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));

    if (hasCoordinates) {
        try {
            const res = await fetchOpenWeather('onecall', { lat, lon });
            const data = await res.json();
            if (res.ok && Array.isArray(data?.daily) && data.daily.length) {
                forecastCache.set(key, data);
                return data;
            }
            console.warn('One Call forecast unavailable; trying the 5-day forecast.', data?.message || res.statusText);
        } catch (err) {
            console.warn('One Call forecast request failed; trying the 5-day forecast.', err);
        }
    }

    if (city) {
        try {
            const location = hasCoordinates ? { lat, lon } : { q: city };
            const res2 = await fetchOpenWeather('forecast', location);
            const data2 = await res2.json();
            if (res2.ok && data2?.cod == 200 && Array.isArray(data2.list) && data2.list.length) {
                forecastCache.set(key, data2);
                return data2;
            }
            console.error('5-day forecast request returned no forecast data.', data2?.message || res2.statusText);
        } catch (err) {
            console.error('5-day forecast request failed:', err);
        }
    }

    return null;
}

async function fetchGeoForCity(city) {
    try {
        const res = await fetchOpenWeather('geocode', { q: city });
        const arr = await res.json();
        if (res.ok && Array.isArray(arr) && arr.length) return { lat: arr[0].lat, lon: arr[0].lon };
    } catch (err) {
        console.error('Geocode fetch failed:', err);
    }
    return null;
}

function fetchOpenWeather(type, params) {
    const query = new URLSearchParams({ type, ...params });
    return fetch(`/api/openweather?${query}`);
}

function updateVideoForActiveSlide() {
    if (!swiper || swiper.slides.length === 0) return;
    const slide = swiper.slides[swiper.activeIndex];
    const weatherType = slide?.dataset.weather;
    const daylightState = slide?.querySelector('.daylight-info')?.dataset.daylightState;
    const isNight = daylightState === 'night';
    document.body.classList.toggle('night-mode', isNight);
    const video = isNight && weatherType === 'Clear'
        ? DEFAULT_VIDEO
        : WEATHER_VIDEO_MAP[weatherType] || DEFAULT_VIDEO;
    crossfadeToVideo(video);
}

// --- Video crossfade ---
// Two <video> elements sit stacked on top of each other (see index.html).
// "activeVideo" is the one currently visible (opacity 1).
// "inactiveVideo" is the hidden one we load the next clip into.
// Once the hidden one is ready to play, we fade it in and fade the old one
// out, then swap which variable points to which element.

function crossfadeToVideo(src) {
    if (activeVideo.dataset.src === src) {
        console.log(`Video already showing: ${src}`);
        return;
    }

    console.log(`Loading video: ${src}`);

    inactiveVideo.dataset.src = src;
    inactiveVideo.src = src;
    inactiveVideo.load();

    inactiveVideo.addEventListener('canplay', onVideoReadyToSwap, { once: true });
}

function onVideoReadyToSwap() {
    inactiveVideo.play().catch(err => {
        console.error('Video play() was blocked or failed:', err);
        showBanner('Background video playback is blocked by the browser. Click anywhere on the page to enable it.', true);
    });

    inactiveVideo.classList.add('is-active');
    activeVideo.classList.remove('is-active');

    const temp = activeVideo;
    activeVideo = inactiveVideo;
    inactiveVideo = temp;
}

function ensureVideoPlayback(video) {
    if (!video) return;
    if (video.paused) {
        video.muted = true;
        video.playsInline = true;
        video.play().catch(err => {
            console.error('Initial background video play() was blocked or failed:', err);
        });
    }
}

function showSkeleton(count) {
    els.container.innerHTML = Array.from({ length: count }).map(() => `
        <div class="swiper-slide">
            <div class="skeleton-card">
                <div class="skeleton-block" style="width:60%;height:28px;"></div>
                <div class="skeleton-block" style="width:100px;height:100px;border-radius:50%;"></div>
                <div class="skeleton-block" style="width:40%;height:48px;"></div>
                <div class="skeleton-block" style="width:50%;height:16px;"></div>
            </div>
        </div>
    `).join('');
}

function setLoading(isLoading) {
    els.searchBtn.disabled = isLoading;
    els.spinner.classList.toggle('d-none', !isLoading);
}

function showBanner(message, isError) {
    els.banner.textContent = message;
    els.banner.classList.remove('d-none');
    els.banner.classList.toggle('is-error', !!isError);
}

function hideBanner() {
    els.banner.classList.add('d-none');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
} 