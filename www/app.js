/* =======================================================
   EcoAlert · app.js — Weather + AI + Auth Integration
   ======================================================= */

/* ── Groq AI Config ── */
// The API key is stored securely in the user's localStorage and never hardcoded in the repository
const GROQ_STORAGE_KEY = 'ecoalert-groq-api-key';
function getGroqApiKey() {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(GROQ_STORAGE_KEY) || window.ECOALERT_GROQ_KEY || '';
  }
  return process.env.GROQ_API_KEY || '';
}
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS  = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
const GROQ_MODEL   = GROQ_MODELS[0];

/* ── Constants & State ── */
const DEFAULT_LOCATION = {
  name: 'Hyderabad', admin1: 'Telangana', country: 'India',
  latitude: 17.385044, longitude: 78.486671, timezone: 'Asia/Kolkata'
};
const STORAGE_KEY = 'ecoalert-state-v3';
const DEFAULT_SETTINGS = {
  rainThreshold: 60, storm: true,
  heatThreshold: 38, coldThreshold: 10,
  aqiThreshold: 150, dust: true,
  notifications: false, dailyBrief: true
};
const state = {
  location: { ...DEFAULT_LOCATION },
  weather: null, air: null,
  alerts: [], locations: [],
  settings: { ...DEFAULT_SETTINGS },
  filter: 'all',
  charts: {}, maps: {},
  loading: false,
  aiHistory: [],   // [{role, content, ts}]
  aiTyping: false
};
const CITY_PINS = [
  { name: 'Hyderabad', lat: 17.3850, lon: 78.4867 },
  { name: 'Bengaluru',  lat: 12.9716, lon: 77.5946 },
  { name: 'Chennai',    lat: 13.0827, lon: 80.2707 },
  { name: 'Mumbai',     lat: 19.0760, lon: 72.8777 },
  { name: 'Delhi',      lat: 28.6139, lon: 77.2090 },
  { name: 'Kolkata',    lat: 22.5726, lon: 88.3639 }
];

/* ── Utilities ── */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const num = x => Number.isFinite(Number(x)) ? Math.round(Number(x) * 10) / 10 : '--';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function persist() {
  const user = AuthManager.getCurrentUser();
  const data = {
    location: state.location,
    locations: state.locations,
    settings: state.settings,
    theme: document.documentElement.dataset.theme || 'light'
  };
  localStorage.setItem(STORAGE_KEY + (user?.id || '_guest'), JSON.stringify(data));
}

function loadState() {
  try {
    const user = AuthManager.getCurrentUser();
    const raw = localStorage.getItem(STORAGE_KEY + (user?.id || '_guest')) || '{}';
    const saved = JSON.parse(raw);
    Object.assign(state, {
      location: saved.location || DEFAULT_LOCATION,
      locations: saved.locations || [],
      settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) }
    });
    if (saved.theme === 'dark') applyTheme('dark', false);
  } catch { /* ignore */ }
}

function showToast(msg, type = 'default') {
  const el = document.createElement('div');
  el.className = 'toast';
  if (type === 'error') el.style.background = '#c03838';
  if (type === 'ok')    el.style.background = '#1a6640';
  el.innerHTML = msg;
  $('toastStack').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; el.style.transition = '.25s';
    setTimeout(() => el.remove(), 280);
  }, 3500);
}

function setLoading(flag) {
  state.loading = flag;
  document.body.classList.toggle('loading', flag);
  const btn = $('refreshBtn');
  if (btn) { btn.disabled = flag; btn.querySelector('span').textContent = flag ? 'Loading…' : 'Refresh'; }
}

/* ── Weather Helpers ── */
const WEATHER_MAP = {
  0:['Clear sky','☀️'],1:['Mainly clear','🌤️'],2:['Partly cloudy','⛅'],3:['Overcast','☁️'],
  45:['Fog','🌫️'],48:['Rime fog','🌫️'],51:['Light drizzle','🌦️'],53:['Drizzle','🌦️'],
  55:['Heavy drizzle','🌧️'],61:['Light rain','🌦️'],63:['Rain','🌧️'],65:['Heavy rain','🌧️'],
  71:['Light snow','🌨️'],73:['Snow','🌨️'],75:['Heavy snow','❄️'],77:['Snow grains','🌨️'],
  80:['Rain showers','🌦️'],81:['Rain showers','🌧️'],82:['Heavy showers','⛈️'],
  85:['Snow showers','🌨️'],86:['Heavy snow showers','❄️'],
  95:['Thunderstorm','⛈️'],96:['Thunderstorm+hail','⛈️'],99:['Severe storm','⛈️']
};
function weatherInfo(code) { return WEATHER_MAP[Number(code)] || ['Mixed conditions','🌥️']; }

function aqiInfo(aqi) {
  const n = Math.round(aqi || 0);
  if (n <= 50)  return ['Good', 'Good'];
  if (n <= 100) return ['Moderate', 'Moderate'];
  if (n <= 150) return ['Unhealthy for sensitive groups', 'Watch'];
  if (n <= 200) return ['Unhealthy', 'High'];
  if (n <= 300) return ['Very unhealthy', 'High'];
  return ['Hazardous', 'Emergency'];
}
function aqiColor(aqi) {
  if (aqi <= 50)  return '#3a9e5c';
  if (aqi <= 100) return '#c8a83c';
  if (aqi <= 150) return '#e0882a';
  if (aqi <= 200) return '#d04040';
  if (aqi <= 300) return '#9a2090';
  return '#7a1010';
}
function severityRank(s) { return {emergency:4,high:3,watch:2,info:1}[s]||0; }
function greetingText() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
}

/* ── API Calls ── */
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fetchWeather(loc) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  const p = url.searchParams;
  p.set('latitude', loc.latitude); p.set('longitude', loc.longitude);
  p.set('timezone','auto'); p.set('forecast_days','7');
  p.set('current','temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day');
  p.set('hourly','temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,uv_index');
  p.set('daily','weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset');
  return fetchJSON(url.toString());
}
async function fetchAir(loc) {
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  const p = url.searchParams;
  p.set('latitude', loc.latitude); p.set('longitude', loc.longitude);
  p.set('timezone','auto'); p.set('forecast_days','5');
  p.set('current','us_aqi,pm2_5,pm10,ozone,dust');
  p.set('hourly','us_aqi,pm2_5,pm10,ozone,dust');
  return fetchJSON(url.toString());
}
async function reverseGeocode(lat, lon) {
  try {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', `${lat.toFixed(1)}`);
    url.searchParams.set('count', '1');
    const w = await fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&forecast_days=1&current=temperature_2m`);
    return { name:`${Math.abs(lat).toFixed(2)}°${lat>=0?'N':'S'}, ${Math.abs(lon).toFixed(2)}°${lon>=0?'E':'W'}`, admin1:'', country:'GPS Location', latitude:lat, longitude:lon, timezone: w.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone };
  } catch {
    return { name:'My Location', admin1:'', country:'', latitude:lat, longitude:lon, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }
}

/* ── Alert Engine ── */
function buildAlerts() {
  if (!state.weather) return [];
  const w=state.weather, a=state.air?.current||{}, d=w.daily, h=w.hourly, c=w.current;
  const alerts=[];
  const peakRain=Math.max(...(d.precipitation_probability_max||[0]));
  const maxTemp=Math.max(...(d.temperature_2m_max||[0]));
  const minTemp=Math.min(...(d.temperature_2m_min||[0]));
  const maxGust=Math.max(...(d.wind_gusts_10m_max||[0]));
  const stormSoon=(h.weather_code||[]).slice(0,48).some(x=>[95,96,99].includes(Number(x)));
  const heavyRain=(h.precipitation_probability||[]).slice(0,48).some((x,i)=>Number(x)>=80&&Number(h.precipitation?.[i]||0)>=8);
  const aqi=Number(a.us_aqi||0);

  if(stormSoon||maxGust>=60) alerts.push({type:'emergency',severity:'emergency',icon:'⛈️',title:'Severe weather risk',body:`Thunderstorm or damaging winds may develop. Peak gust: ${Math.round(maxGust)} km/h.`,time:'Next 48 hours'});
  if(heavyRain||peakRain>=90) alerts.push({type:'weather',severity:'high',icon:'🌧️',title:'Heavy rain likely',body:`Rain probability peaks at ${Math.round(peakRain)}%. Carry rain protection.`,time:'Today / next 48 h'});
  else if(peakRain>=Number(state.settings.rainThreshold)) alerts.push({type:'weather',severity:'watch',icon:'☔',title:'Rain is likely',body:`Rain probability reaches ${Math.round(peakRain)}% in the forecast window.`,time:'Today / next 48 h'});
  if(maxTemp>=Number(state.settings.heatThreshold)) alerts.push({type:'comfort',severity:maxTemp>=42?'emergency':maxTemp>=40?'high':'watch',icon:'🔥',title:'Heat alert',body:`Forecast high may reach ${Math.round(maxTemp)}°C. Hydrate and limit midday exposure.`,time:'Forecast week'});
  if(minTemp<=Number(state.settings.coldThreshold)) alerts.push({type:'comfort',severity:minTemp<=5?'high':'watch',icon:'🥶',title:'Cold alert',body:`Forecast lows may fall to ${Math.round(minTemp)}°C. Dress warmly for early mornings.`,time:'Forecast week'});
  if(aqi>=300) alerts.push({type:'air',severity:'emergency',icon:'🫁',title:'Hazardous air quality',body:`US AQI is ${Math.round(aqi)}. Avoid all outdoor exposure.`,time:'Now'});
  else if(aqi>=Number(state.settings.aqiThreshold)) alerts.push({type:'air',severity:aqi>=200?'high':'watch',icon:'🍃',title:'Air quality alert',body:`US AQI is ${Math.round(aqi)} (${aqiInfo(aqi)[0]}). Sensitive groups should limit outdoor activity.`,time:'Now'});
  if(state.settings.dust&&Number(a.dust||0)>50) alerts.push({type:'air',severity:'watch',icon:'🌪️',title:'Elevated dust levels',body:`Dust: ${num(a.dust)} μg/m³. Consider a mask outdoors.`,time:'Now'});
  if(Number(c.relative_humidity_2m||0)>=85) alerts.push({type:'comfort',severity:'watch',icon:'💧',title:'High humidity',body:`Humidity is ${Math.round(c.relative_humidity_2m)}%, making it feel hotter and muggy.`,time:'Now'});
  if(!alerts.length) alerts.push({type:'weather',severity:'info',icon:'✅',title:'No major alerts',body:'Conditions look broadly stable for your current thresholds.',time:'Now'});
  return alerts.sort((a,b)=>severityRank(b.severity)-severityRank(a.severity));
}

/* ── Groq AI Integration ── */
function buildWeatherContext() {
  if (!state.weather) return 'Weather data not loaded yet.';
  const c = state.weather.current, d = state.weather.daily, a = state.air?.current || {};
  const [wDesc] = weatherInfo(c.weather_code);
  const aqi = Math.round(a.us_aqi || 0);
  const [aqiText] = aqiInfo(aqi);
  const activeAlerts = state.alerts.filter(x => x.severity !== 'info').map(x => `• [${x.severity.toUpperCase()}] ${x.title}: ${x.body}`).join('\n') || 'No active alerts.';
  return `
📍 Location: ${state.location.name}, ${state.location.admin1 || ''} ${state.location.country}
📅 Date/Time: ${new Date().toLocaleString('en-IN', { timeZone: state.location.timezone || 'Asia/Kolkata' })}

🌡️ CURRENT CONDITIONS:
  Temperature: ${Math.round(c.temperature_2m)}°C (feels like ${Math.round(c.apparent_temperature)}°C)
  Conditions: ${wDesc}
  Humidity: ${Math.round(c.relative_humidity_2m)}%
  Wind speed: ${Math.round(c.wind_speed_10m)} km/h | Gusts: ${Math.round(c.wind_gusts_10m || 0)} km/h
  Precipitation: ${num(c.precipitation)} mm

🌿 AIR QUALITY:
  US AQI: ${aqi} (${aqiText})
  PM2.5: ${num(a.pm2_5)} μg/m³
  PM10: ${num(a.pm10)} μg/m³
  Ozone: ${num(a.ozone)} μg/m³
  Dust: ${num(a.dust)} μg/m³

📆 TODAY'S FORECAST:
  High: ${Math.round(d.temperature_2m_max[0])}°C | Low: ${Math.round(d.temperature_2m_min[0])}°C
  Rain probability: ${Math.round(d.precipitation_probability_max[0] || 0)}%
  Peak wind gust: ${Math.round(d.wind_gusts_10m_max[0])} km/h
  UV index peak: ${num(d.uv_index_max?.[0])}
  Sunrise: ${d.sunrise?.[0]?.slice(11) || 'N/A'} | Sunset: ${d.sunset?.[0]?.slice(11) || 'N/A'}

⚠️ ACTIVE ALERTS:
${activeAlerts}

📊 7-DAY SUMMARY:
  Peak temperature: ${Math.round(Math.max(...d.temperature_2m_max))}°C
  Peak rain probability: ${Math.round(Math.max(...d.precipitation_probability_max))}%
  Peak wind gust: ${Math.round(Math.max(...d.wind_gusts_10m_max))} km/h`.trim();
}

async function askGroqStreaming(userMessage, onChunk) {
  const systemPrompt = `You are EcoAI, an intelligent, friendly weather and environmental assistant built into the EcoAlert app. You help users understand their local weather, air quality, health risks, and what actions to take.

Here is the LIVE weather data for the user right now:

${buildWeatherContext()}

GUIDELINES:
- Answer directly and practically based on the real data above
- Give specific, actionable advice (what to wear, when to go out, etc.)
- Use emojis naturally to make responses readable
- Keep responses concise but complete (2-4 paragraphs max unless a detailed breakdown is needed)
- If asked something unrelated to weather/environment, kindly redirect to your specialty
- Format clearly with line breaks for readability
- Always personalize to the user's actual conditions shown above`;

  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error('Please configure your Groq API key in Settings (⚙) to chat with EcoAI.');
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...state.aiHistory.slice(-12).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage }
  ];

  let response = null;
  let lastError = null;

  for (const model of GROQ_MODELS) {
    try {
      response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 1024,
          temperature: 0.72,
          stream: true
        })
      });

      if (response.ok) {
        break;
      } else {
        const err = await response.json().catch(() => ({}));
        lastError = new Error(err.error?.message || `Groq error (${response.status}) on ${model}`);
        response = null;
      }
    } catch (e) {
      lastError = e;
      response = null;
    }
  }

  if (!response) {
    throw lastError || new Error('Could not get a response from AI models.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;
      try {
        const data = JSON.parse(trimmed.slice(6));
        const delta = data.choices?.[0]?.delta?.content || '';
        if (delta) { fullText += delta; onChunk(fullText); }
      } catch { /* ignore malformed SSE */ }
    }
  }
  return fullText;
}

/* ── AI Chat Render ── */
function formatAIMessage(text) {
  // Simple markdown-like formatting
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^• (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

function renderAIMessages() {
  const container = $('aiMessages');
  if (!container) return;

  if (!state.aiHistory.length) {
    const user = AuthManager.getCurrentUser();
    const name = user && !user.isGuest ? user.name.split(' ')[0] : 'there';
    container.innerHTML = `
      <div class="ai-welcome">
        <div class="ai-avatar-big">🌿</div>
        <h3>Hi ${esc(name)}, I'm EcoAI!</h3>
        <p>I'm your personal weather and environmental assistant. I have access to your real-time conditions right now. Ask me anything!</p>
      </div>`;
    renderAISuggestions();
    return;
  }

  container.innerHTML = state.aiHistory.map((m, i) => {
    const isUser = m.role === 'user';
    const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="ai-message ${isUser ? 'user' : 'assistant'}" data-idx="${i}">
      ${!isUser ? '<div class="ai-msg-avatar">🌿</div>' : ''}
      <div class="ai-msg-bubble">
        <div class="ai-msg-content">${isUser ? esc(m.content) : formatAIMessage(m.content)}</div>
        <div class="ai-msg-time">${time}</div>
      </div>
      ${isUser ? '<div class="ai-msg-avatar user">👤</div>' : ''}
    </div>`;
  }).join('');

  if (state.aiTyping) {
    container.innerHTML += `<div class="ai-message assistant typing-msg">
      <div class="ai-msg-avatar">🌿</div>
      <div class="ai-msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>
    </div>`;
  }

  container.scrollTop = container.scrollHeight;
}

function renderAISuggestions() {
  const el = $('aiSuggestions');
  if (!el) return;
  if (state.aiHistory.length > 0) { el.innerHTML = ''; return; }

  const suggestions = [
    '🌦️ Should I carry an umbrella today?',
    '👗 What should I wear going outside right now?',
    '😷 Is the air quality safe for my morning run?',
    "☀️ What's the UV risk today and how do I protect myself?",
    '📅 Give me a full weather briefing for this week',
    '🌡️ Why does it feel hotter than the actual temperature?'
  ];

  el.innerHTML = suggestions.map((s, i) =>
    `<button class="ai-suggestion-chip" data-suggestion-index="${i}">${esc(s)}</button>`
  ).join('');

  el.querySelectorAll('.ai-suggestion-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.suggestionIndex);
      if (suggestions[idx]) sendAIMessage(suggestions[idx]);
    });
  });
}

async function sendAIMessage(text) {
  if (!text?.trim() || state.aiTyping) return;
  const input = $('aiInput');
  const message = text.trim();

  // Add user message to history
  state.aiHistory.push({ role: 'user', content: message, ts: Date.now() });
  if (input && input.value === message) input.value = '';
  state.aiTyping = true;
  renderAIMessages();
  renderAISuggestions();

  // Add placeholder AI message
  const placeholder = { role: 'assistant', content: '', ts: Date.now() };
  state.aiHistory.push(placeholder);

  try {
    await askGroqStreaming(message, (partialText) => {
      placeholder.content = partialText;
      // Update just the last message bubble for streaming effect
      const msgs = $('aiMessages');
      if (!msgs) return;
      const lastBubble = msgs.querySelectorAll('.ai-message.assistant:not(.typing-msg) .ai-msg-content');
      if (lastBubble.length) {
        lastBubble[lastBubble.length - 1].innerHTML = formatAIMessage(partialText);
        msgs.scrollTop = msgs.scrollHeight;
      }
    });
  } catch (err) {
    placeholder.content = `Sorry, I couldn't get a response right now. ${err.message}`;
    console.error('Groq error:', err);
  }

  placeholder.ts = Date.now();
  state.aiTyping = false;
  renderAIMessages();
}

function renderAIContextCard() {
  const el = $('aiContextInfo');
  if (!el || !state.weather) return;
  const c = state.weather.current;
  const [wDesc, wIcon] = weatherInfo(c.weather_code);
  const aqi = Math.round(state.air?.current?.us_aqi || 0);
  const [aqiText] = aqiInfo(aqi);
  el.innerHTML = `
    <div class="ai-ctx-item"><span>📍 Location</span><strong>${esc(state.location.name)}</strong></div>
    <div class="ai-ctx-item"><span>${wIcon} Now</span><strong>${Math.round(c.temperature_2m)}°C · ${wDesc}</strong></div>
    <div class="ai-ctx-item"><span>💧 Humidity</span><strong>${Math.round(c.relative_humidity_2m)}%</strong></div>
    <div class="ai-ctx-item"><span>💨 Wind</span><strong>${Math.round(c.wind_speed_10m)} km/h</strong></div>
    <div class="ai-ctx-item"><span>🍃 AQI</span><strong>${aqi} · ${aqiText}</strong></div>
    <div class="ai-ctx-item"><span>⚠️ Alerts</span><strong>${state.alerts.filter(x=>x.severity!=='info').length} active</strong></div>
    <p class="ai-ctx-note">EcoAI uses this live data to answer your questions accurately.</p>`;
}

/* ── Auth UI ── */
function showAuthOverlay() {
  const overlay = $('authOverlay');
  if (overlay) overlay.classList.add('show');
}
function hideAuthOverlay() {
  const overlay = $('authOverlay');
  if (overlay) {
    overlay.classList.add('hiding');
    setTimeout(() => { overlay.classList.remove('show','hiding'); }, 500);
  }
}
function showAuthPanel(panel) {
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.add('hidden'));
  $(panel)?.classList.remove('hidden');
  $(`${panel}Error`) && ($(`${panel}Error`).textContent = '');
}
function setAuthError(id, msg) {
  const el = $(id);
  if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}
function setAuthLoading(formId, loading) {
  const btn = document.querySelector(`#${formId} button[type=submit]`);
  if (btn) { btn.disabled = loading; btn.textContent = loading ? 'Please wait…' : btn.dataset.label || btn.textContent; }
}

/* ── Profile Render ── */
function renderTopbarUser() {
  const user = AuthManager.getCurrentUser();
  const profileBtn = $('profileBtn');
  if (!profileBtn) return;

  if (user && !user.isGuest) {
    profileBtn.textContent = user.avatar || user.name.slice(0, 2).toUpperCase();
    profileBtn.style.background = `linear-gradient(135deg, ${user.avatarColor || '#174032'}, ${user.avatarColor || '#174032'}cc)`;
    profileBtn.title = user.name;
  } else if (user?.isGuest) {
    profileBtn.textContent = '👤';
    profileBtn.style.background = '#607068';
    profileBtn.title = 'Guest';
  } else {
    profileBtn.textContent = '?';
    profileBtn.style.background = '#607068';
  }
}

function renderProfileView() {
  const user = AuthManager.getCurrentUser();
  if (!user) return;

  // Avatar
  const avatarEl = $('profileAvatar');
  if (avatarEl) {
    avatarEl.textContent = user.isGuest ? '👤' : (user.avatar || user.name.slice(0,2).toUpperCase());
    avatarEl.style.background = user.avatarColor || '#174032';
  }

  // Fields
  const fields = { profileName: user.name, profileEmail: user.email || '—', profileCity: user.city || '', profileBio: user.bio || '' };
  Object.entries(fields).forEach(([id, val]) => { const el = $(id); if (el) el.value = val; });
  const nameDisplay = $('profileDisplayName');
  if (nameDisplay) nameDisplay.textContent = user.name || 'User';

  // Meta
  const metaEl = $('profileMeta');
  if (metaEl) {
    metaEl.innerHTML = user.isGuest
      ? `<span>👤 Guest mode — <button class="link-inline" id="guestSignupPrompt">Create an account</button> to save your data.</span>`
      : `<span>📅 Member since ${new Date(user.createdAt).toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'})}</span>`;
    if (user.isGuest) {
      const btn = $('guestSignupPrompt');
      if (btn) btn.onclick = () => { setView('dashboard'); showAuthOverlay(); showAuthPanel('signupPanel'); };
    }
  }

  // Account section visibility
  const accountSection = $('accountSection');
  if (accountSection) accountSection.style.display = user.isGuest ? 'none' : 'block';

  // Color picker
  const colorPicker = $('avatarColorPicker');
  if (colorPicker) {
    colorPicker.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === (user.avatarColor || '#174032'));
    });
  }
}

/* ── Banner, Hours, Forecast, Alerts, Recommendations, Reports, Charts (unchanged logic) ── */
function renderHeroBanner() {
  const serious = state.alerts.find(a => a.severity==='emergency'||a.severity==='high');
  const watch   = state.alerts.find(a => a.severity==='watch');
  const banner  = $('heroAlert');
  if (!banner) return;
  const icon = banner.querySelector('.alert-icon');
  const txt  = banner.querySelector('strong');
  const sub  = banner.querySelector('span');
  if (serious) { banner.className=`alert-banner ${serious.severity}`; icon.textContent=serious.icon; txt.textContent=serious.title; sub.textContent=serious.body; }
  else if (watch) { banner.className='alert-banner watch'; icon.textContent=watch.icon; txt.textContent=watch.title; sub.textContent=watch.body; }
  else { banner.className='alert-banner ok'; icon.textContent='✅'; txt.textContent='All clear — no major alerts'; sub.textContent='Conditions look broadly stable. Enjoy your day!'; }
}

function renderHeader() {
  const c=state.weather?.current, d=state.weather?.daily, a=state.air?.current;
  if (!c) return;
  const [desc,icon]=weatherInfo(c.weather_code);
  $('currentDesc').textContent=desc; $('currentIcon').textContent=icon;
  $('currentTemp').textContent=`${Math.round(c.temperature_2m)}°`;
  $('feelsLike').textContent=`${Math.round(c.apparent_temperature)}°`;
  $('currentHumidity').textContent=`${Math.round(c.relative_humidity_2m)}%`;
  $('currentWind').textContent=`${Math.round(c.wind_speed_10m)} km/h`;
  const rainPeak=Math.max(...(d.precipitation_probability_max||[0]));
  $('currentRain').textContent=`${Math.round(d.precipitation_probability_max[0]||0)}%`;
  $('tempRange').textContent=`${Math.round(d.temperature_2m_max[0])}° / ${Math.round(d.temperature_2m_min[0])}°`;
  $('humidityMetric').textContent=`${Math.round(c.relative_humidity_2m)}%`;
  $('rainMetric').textContent=`${Math.round(rainPeak)}%`;
  const tHot=Number(state.settings.heatThreshold);
  $('tempNote').textContent=d.temperature_2m_max[0]>=tHot?'Hot conditions expected today':'Comfortable range for most activities';
  $('humidityNote').textContent=c.relative_humidity_2m>=70?'Muggy / sticky feel expected':'Comfortable humidity levels';
  $('rainNote').textContent=rainPeak>=60?'Keep rain gear nearby today':'Low rain interruption risk';
  renderMetricBadge('tempBadge',d.temperature_2m_max[0]>=tHot?'warn':'ok',d.temperature_2m_max[0]>=tHot?'Hot':'Comfortable');
  renderMetricBadge('humidityBadge',c.relative_humidity_2m>=80?'warn':'ok',c.relative_humidity_2m>=80?'Muggy':'Comfortable');
  renderMetricBadge('rainBadge',rainPeak>=60?'warn':'ok',rainPeak>=60?'Rainy':'Dry');
  const aqi=Math.round(a?.us_aqi||0);
  const [aqiText,aqiSev]=aqiInfo(aqi);
  $('aqiNumber').textContent=aqi||'--'; $('aqiStatus').textContent=aqiText;
  const pill=$('aqiPill'); pill.textContent=aqiSev; pill.className=`quality-pill ${aqiSev}`;
  $('pm25Value').textContent=`PM2.5 ${num(a?.pm2_5)} μg/m³`;
  $('pm10Value').textContent=`${num(a?.pm10)} μg/m³`;
  $('ozoneValue').textContent=`${num(a?.ozone)} μg/m³`;
  $('dustValue').textContent=`${num(a?.dust)} μg/m³`;
  const pct=clamp((aqi/300)*100,2,100);
  $('aqiProgress').style.width=pct+'%';
  const deg=pct*3.6;
  $('aqiRing').style.background=`conic-gradient(${aqiColor(aqi)} ${deg}deg, var(--surface-2) ${deg}deg)`;
  $('locationLine').textContent=[state.location.name,state.location.admin1,state.location.country].filter(Boolean).join(' · ');
  $('lastUpdated').textContent=`Updated ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
  const nc=state.alerts.filter(x=>x.severity!=='info').length;
  const badge=$('alertCount'); badge.textContent=nc; badge.dataset.count=nc;
  $('notifDot').style.display=state.settings.notifications?'block':'none';
  renderHeroBanner();
  renderHours();
  renderForecast();
  renderAlerts();
  renderRecommendations();
  renderReports();
  renderCharts();
  renderAIContextCard();
}

function renderMetricBadge(id, type, label) { const el=$(id); if(el){el.className=`metric-badge ${type}`;el.textContent=label;} }

function renderHours() {
  const h=state.weather.hourly, nowMs=Date.now();
  let idx=h.time.findIndex(t=>new Date(t).getTime()>=nowMs-30*60*1000);
  if(idx<0)idx=0;
  $('hourStrip').innerHTML=h.time.slice(idx,idx+12).map((t,i)=>{
    const dt=new Date(t), isNow=i===0;
    const [,icon]=weatherInfo(h.weather_code[idx+i]);
    return `<div class="hour-item"><small>${isNow?'Now':dt.toLocaleTimeString([],{hour:'numeric',hour12:true})}</small><div class="hicon">${icon}</div><strong>${Math.round(h.temperature_2m[idx+i])}°</strong><small class="rain-prob">${Math.round(h.precipitation_probability[idx+i]||0)}%</small></div>`;
  }).join('');
}

function renderForecast() {
  const d=state.weather.daily;
  $('forecastList').innerHTML=d.time.map((t,i)=>{
    const dt=new Date(t+'T12:00:00'),[,icon]=weatherInfo(d.weather_code[i]);
    return `<div class="forecast-day"><div class="day">${i===0?'TODAY':dt.toLocaleDateString([],{weekday:'short'}).toUpperCase()}</div><div class="ficon">${icon}</div><strong>${Math.round(d.temperature_2m_max[i])}° <span style="color:var(--muted)">${Math.round(d.temperature_2m_min[i])}°</span></strong><small>${Math.round(d.precipitation_probability_max[i]||0)}% rain</small></div>`;
  }).join('');
  const maxT=Math.max(...d.temperature_2m_max),minT=Math.min(...d.temperature_2m_min),range=Math.max(1,maxT-minT);
  $('forecastDetailed').innerHTML=d.time.map((t,i)=>{
    const dt=new Date(t+'T12:00:00'),[desc,icon]=weatherInfo(d.weather_code[i]);
    const barLeft=clamp(((d.temperature_2m_min[i]-minT)/range)*70+8,5,80);
    const barWidth=clamp(((d.temperature_2m_max[i]-d.temperature_2m_min[i])/range)*40,8,55);
    return `<div class="detail-day"><div><div class="date">${i===0?'Today':dt.toLocaleDateString([],{weekday:'short'})}</div><div class="weekday">${dt.toLocaleDateString([],{day:'numeric',month:'short'})}</div></div><span class="icon">${icon}</span><div><strong style="font-size:12px">${esc(desc)}</strong><div class="bar" style="margin-top:9px"><i style="--left:${barLeft}%;--width:${barWidth}%"></i></div></div><span><small class="muted">High</small><strong>${Math.round(d.temperature_2m_max[i])}°</strong></span><span><small class="muted">Low</small><strong>${Math.round(d.temperature_2m_min[i])}°</strong></span><span><small class="muted">Rain</small><strong>${Math.round(d.precipitation_probability_max[i]||0)}%</strong></span></div>`;
  }).join('');
}

function renderAlerts() {
  const f=state.filter;
  const list=state.alerts.filter(x=>f==='all'||x.type===f).sort((a,b)=>severityRank(b.severity)-severityRank(a.severity));
  if(!list.length){
    $('alertList').innerHTML=`<div class="empty-state"><div class="empty-icon">🌿</div><h3>No ${f==='all'?'':f+' '}alerts</h3><p>No alerts match this filter for your current thresholds.</p></div>`;
    return;
  }
  $('alertList').innerHTML=list.map(x=>`<div class="alert-item ${x.severity}"><div class="alert-symbol">${x.icon}</div><div class="alert-content"><strong>${esc(x.title)}</strong><p>${esc(x.body)}</p><p class="alert-time">⏱ ${esc(x.time)}</p></div><span class="severity ${x.severity}">${x.severity.toUpperCase()}</span></div>`).join('');
}

function renderRecommendations() {
  const w=state.weather.current,d=state.weather.daily,a=state.air?.current||{};
  const peakRain=Math.max(...(d.precipitation_probability_max||[0]));
  const rec=[];
  if(peakRain>=60) rec.push(['☔','Carry rain protection',`Rain probability reaches ${Math.round(peakRain)}% soon.`]);
  if(Number(w.temperature_2m)>=Number(state.settings.heatThreshold)) rec.push(['🧴','Hydrate & seek shade',`It is ${Math.round(w.temperature_2m)}°C right now.`]);
  if(Number(a.us_aqi)>=Number(state.settings.aqiThreshold)) rec.push(['😷','Limit outdoor exertion',`AQI is ${Math.round(a.us_aqi)} — ${aqiInfo(a.us_aqi)[0]}.`]);
  if(Number(w.wind_speed_10m)>=35) rec.push(['🌬️','Secure loose items',`Winds are ${Math.round(w.wind_speed_10m)} km/h.`]);
  if(Number(d.uv_index_max?.[0]||0)>=7) rec.push(['🕶️','Apply sunscreen','UV index peaks at '+num(d.uv_index_max[0])+' today.']);
  if(!rec.length) rec.push(['🌿','Good time to be outdoors','No major weather or air-quality concerns detected.'],['🚶','Plan a comfortable route','Conditions look broadly stable.']);
  $('recommendations').innerHTML=rec.slice(0,4).map(r=>`<div class="recommendation"><div class="r-icon">${r[0]}</div><div><strong>${esc(r[1])}</strong><p>${esc(r[2])}</p></div></div>`).join('');
}

function renderReports() {
  const d=state.weather.daily,a=state.air?.current||{};
  const maxT=Math.max(...(d.temperature_2m_max||[0])),rain=Math.max(...(d.precipitation_probability_max||[0]));
  const aqi=Math.round(a.us_aqi||0),maxGust=Math.round(Math.max(...(d.wind_gusts_10m_max||[0])));
  $('reportHeadline').textContent=`${Math.round(maxT)}°C peak · ${Math.round(rain)}% rain risk this week`;
  $('reportBody').textContent=`For ${state.location.name}, EcoAlert reports a ${aqiInfo(aqi)[0].toLowerCase()} air-quality profile (US AQI ${aqi||'—'}), a ${Math.round(d.temperature_2m_min[0])}–${Math.round(d.temperature_2m_max[0])}°C range today, and ${Math.round(rain)}% maximum precipitation probability in the 7-day outlook. Peak wind gusts at ${maxGust} km/h.`;
  $('reportSubtitle').textContent=`Live forecast data for ${state.location.name} · ${new Date().toLocaleDateString()}`;
  $('reportIndicators').innerHTML=[["Today's range",`${Math.round(d.temperature_2m_min[0])}° – ${Math.round(d.temperature_2m_max[0])}°`],['Peak rain (7 day)',`${Math.round(rain)}%`],['Peak wind gust',`${maxGust} km/h`],['US AQI now',`${aqi||'—'} · ${aqiInfo(aqi)[0]}`],['UV index peak',`${num(Math.max(...(d.uv_index_max||[0])))}`],['PM2.5',`${num(a.pm2_5)} μg/m³`]].map(x=>`<div class="indicator"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('');
}

function renderCharts() {
  const TICK = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()||'#607068';
  const GRID = getComputedStyle(document.documentElement).getPropertyValue('--line').trim()||'#dce8d8';
  const h=state.weather.hourly,nowMs=Date.now();
  let si=h.time.findIndex(t=>new Date(t).getTime()>=nowMs-30*60*1000);
  if(si<0)si=0;
  const labels=h.time.slice(si,si+24).map(t=>new Date(t).toLocaleTimeString([],{hour:'numeric',hour12:true}));
  const temps=h.temperature_2m.slice(si,si+24),rain=h.precipitation_probability.slice(si,si+24);
  if(state.charts.trend)state.charts.trend.destroy();
  state.charts.trend=new Chart($('trendChart'),{type:'line',data:{labels,datasets:[{label:'Temperature (°C)',data:temps,borderColor:'#2e7a5a',backgroundColor:'rgba(46,122,90,.07)',borderWidth:2.5,tension:.38,pointRadius:2,pointHoverRadius:5,yAxisID:'y',fill:true},{label:'Rain probability (%)',data:rain,borderColor:'#4a8dcc',backgroundColor:'rgba(74,141,204,.07)',borderWidth:2,borderDash:[5,4],tension:.38,pointRadius:0,pointHoverRadius:4,yAxisID:'p',fill:true}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:TICK,maxTicksLimit:8,font:{size:10}}},y:{grid:{color:GRID},ticks:{color:TICK,font:{size:10},callback:v=>v+'°'}},p:{position:'right',min:0,max:100,grid:{drawOnChartArea:false},ticks:{color:TICK,font:{size:10},callback:v=>v+'%'}}}}});
  const d=state.weather.daily;
  if(state.charts.weekly)state.charts.weekly.destroy();
  state.charts.weekly=new Chart($('weeklyChart'),{type:'bar',data:{labels:d.time.map((t,i)=>i===0?'Today':new Date(t+'T12:00:00').toLocaleDateString([],{weekday:'short'})),datasets:[{label:'High °C',data:d.temperature_2m_max,backgroundColor:'#e07050cc',borderRadius:6,borderWidth:0},{label:'Low °C',data:d.temperature_2m_min,backgroundColor:'#4a8dcccc',borderRadius:6,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:'top',align:'end',labels:{font:{size:10},boxWidth:12,padding:16,color:TICK}}},scales:{x:{grid:{display:false},ticks:{font:{size:10},color:TICK}},y:{grid:{color:GRID},ticks:{font:{size:10},color:TICK,callback:v=>v+'°'}}}}});
}

/* ── Maps ── */
function makeMap(id) {
  const el=$(id); if(!el)return null;
  const map=L.map(el,{scrollWheelZoom:false,zoomControl:true}).setView([state.location.latitude,state.location.longitude],9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:18}).addTo(map);
  return map;
}
function riskFor(w,a) {
  const maxRain=Math.max(...(w.daily.precipitation_probability_max||[0])),maxGust=Math.max(...(w.daily.wind_gusts_10m_max||[0])),maxTemp=Math.max(...(w.daily.temperature_2m_max||[0])),aqi=Number(a?.current?.us_aqi||0);
  if(maxRain>=90||maxGust>=60||aqi>=300)return['emergency','#c03838'];
  if(maxRain>=80||maxTemp>=40||aqi>=200)return['high','#cc7030'];
  if(maxRain>=60||maxTemp>=38||aqi>=100)return['watch','#c8a83c'];
  return['safe','#5ab870'];
}
async function updateMap(map,withPins=true) {
  if(!map)return;
  map.eachLayer(l=>{if(l instanceof L.CircleMarker)map.removeLayer(l)});
  L.circleMarker([state.location.latitude,state.location.longitude],{radius:10,color:'#fff',weight:3,fillColor:'#174032',fillOpacity:1}).addTo(map).bindPopup(`<strong>${esc(state.location.name)}</strong><br>Current location`);
  if(!withPins)return;
  const pins=CITY_PINS.filter(c=>Math.abs(c.lat-state.location.latitude)>0.5||Math.abs(c.lon-state.location.longitude)>0.5);
  const results=await Promise.allSettled(pins.map(async c=>({c,w:await fetchWeather({latitude:c.lat,longitude:c.lon}),a:await fetchAir({latitude:c.lat,longitude:c.lon})})));
  for(const res of results){
    if(res.status!=='fulfilled')continue;
    const{c,w,a}=res.value,[risk,color]=riskFor(w,a),[wDesc]=weatherInfo(w.current.weather_code);
    L.circleMarker([c.lat,c.lon],{radius:9,color:'#fff',weight:2.5,fillColor:color,fillOpacity:.9}).addTo(map).bindPopup(`<strong>${esc(c.name)}</strong><br>${wDesc} · ${Math.round(w.current.temperature_2m)}°C<br>US AQI ${Math.round(a?.current?.us_aqi||0)}<br><span style="text-transform:capitalize;color:${color}">${risk} risk</span>`);
  }
}
async function initMaps() {
  if(!state.maps.mini)state.maps.mini=makeMap('miniMap');
  if(!state.maps.full)state.maps.full=makeMap('fullMap');
  state.maps.mini?.setView([state.location.latitude,state.location.longitude],9);
  state.maps.full?.setView([state.location.latitude,state.location.longitude],5);
  await Promise.all([updateMap(state.maps.mini,false),updateMap(state.maps.full,true)]);
  renderMapLocations();
}
function renderMapLocations() {
  const rows=[state.location,...state.locations.filter(x=>x.latitude!==state.location.latitude||x.longitude!==state.location.longitude)];
  $('mapLocations').innerHTML=rows.map((x,i)=>`<div class="map-location" data-map-index="${i}"><strong>${esc(x.name)}${i===0?' <span style="font-size:9px;color:var(--forest-3)">●</span>':''}</strong><small>${esc(x.admin1||x.country||'Location')}</small></div>`).join('');
  $('mapLocations').querySelectorAll('.map-location').forEach((el,i)=>el.onclick=()=>{const x=rows[i];state.maps.full?.setView([x.latitude,x.longitude],9);});
}

/* ── Load Location ── */
async function loadLocation(loc) {
  setLoading(true);
  try {
    state.location=loc;
    const[w,a]=await Promise.all([fetchWeather(loc),fetchAir(loc)]);
    state.weather=w; state.air=a; state.alerts=buildAlerts();
    persist(); renderHeader(); renderSavedLocations(); renderMapLocations();
    await initMaps(); checkLocalNotifications();
    showToast(`✅ Live data loaded for ${loc.name}`,'ok');
  } catch(err) {
    console.error(err); showToast('Could not load live data. Check your connection.','error');
  } finally { setLoading(false); }
}

/* ── Search ── */
async function searchLocations(q) {
  if(!q.trim())return;
  const resultsEl=$('searchResults');
  resultsEl.innerHTML='<div class="search-result"><strong>Searching…</strong></div>';
  try {
    const u=new URL('https://geocoding-api.open-meteo.com/v1/search');
    u.searchParams.set('name',q);u.searchParams.set('count','8');u.searchParams.set('language','en');u.searchParams.set('format','json');
    const data=await fetchJSON(u.toString()),res=data.results||[];
    if(!res.length){resultsEl.innerHTML='<div class="search-result"><strong>No matching locations found.</strong></div>';return;}
    window._searchResults=res;
    resultsEl.innerHTML=res.map((x,i)=>`<button class="search-result" data-result="${i}"><strong>${esc(x.name)}, ${esc(x.admin1||x.country||'')}</strong><small>${esc(x.country||'')} · ${x.latitude.toFixed(3)}°, ${x.longitude.toFixed(3)}°</small></button>`).join('');
    resultsEl.querySelectorAll('[data-result]').forEach(btn=>btn.onclick=()=>{const x=window._searchResults[Number(btn.dataset.result)];loadLocation({name:x.name,admin1:x.admin1||'',country:x.country||'',latitude:x.latitude,longitude:x.longitude,timezone:x.timezone});$('locationModal').classList.remove('show');});
  } catch { showToast('Location search failed.','error'); resultsEl.innerHTML='<div class="search-result"><strong>Search failed. Try again.</strong></div>'; }
}

/* ── Saved Locations ── */
function addSaved(loc) {
  if(state.locations.some(x=>x.latitude===loc.latitude&&x.longitude===loc.longitude)){showToast('Location already saved');return;}
  state.locations.push(loc); persist(); renderSavedLocations(); showToast(`📍 ${loc.name} added`,'ok');
}
function renderSavedLocations() {
  const rows=[{...state.location,isCurrent:true},...state.locations];
  $('savedLocations').innerHTML=rows.map((x,i)=>`<div class="card saved-location"><div><strong>${esc(x.name)} ${x.isCurrent?'<span style="font-size:9px;color:var(--forest-3);font-weight:800">CURRENT</span>':''}</strong><small>${esc(x.admin1||x.country||'')}</small></div><div class="location-actions"><button class="tiny-btn" data-load-loc="${i}">View</button>${x.isCurrent?'':`<button class="tiny-btn" data-remove-loc="${i-1}" style="color:var(--danger)">Remove</button>`}</div></div>`).join('');
  document.querySelectorAll('[data-load-loc]').forEach(b=>b.onclick=()=>loadLocation(rows[Number(b.dataset.loadLoc)]));
  document.querySelectorAll('[data-remove-loc]').forEach(b=>b.onclick=()=>{state.locations.splice(Number(b.dataset.removeLoc),1);persist();renderSavedLocations();});
}

/* ── View ── */
function setView(view) {
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelector(`#view-${view}`)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view));
  if(view==='map')setTimeout(()=>{state.maps.full?.invalidateSize();state.maps.full?.setView([state.location.latitude,state.location.longitude],5);},60);
  if(view==='dashboard')setTimeout(()=>state.maps.mini?.invalidateSize(),60);
  if(view==='ai'){renderAIMessages();renderAISuggestions();renderAIContextCard();}
  if(view==='profile')renderProfileView();
  if(window.innerWidth<821)$('sidebar').classList.remove('open');
}

/* ── Theme ── */
function applyTheme(theme, save=true) {
  document.documentElement.dataset.theme=theme;
  const btn=$('themeToggle');
  if(btn)btn.textContent=theme==='dark'?'☀️':'🌙';
  if(save)persist();
}
function toggleTheme() { applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'); }

/* ── Notifications ── */
async function askNotification() {
  if(!('Notification' in window)){showToast('Browser notifications not supported','error');return false;}
  const p=await Notification.requestPermission();
  if(p==='granted'){
    state.settings.notifications=true; persist();
    $('notifDot').style.display='block';
    const cb=document.querySelector('[data-setting="notifications"]');
    if(cb)cb.checked=true;
    showToast('✅ Notifications enabled','ok'); return true;
  }
  showToast('Notification permission not granted.','error'); return false;
}
function checkLocalNotifications() {
  if(state.settings.notifications&&'Notification' in window&&Notification.permission==='granted'){
    const s=state.alerts.find(a=>a.severity==='emergency'||a.severity==='high');
    if(s)new Notification(`EcoAlert · ${s.title}`,{body:s.body,tag:'ecoalert-live'});
  }
}

/* ── Wire All Events ── */
function wire() {
  /* ---- Auth Events ---- */
  document.addEventListener('auth:changed', e => {
    const user = e.detail;
    if (user) {
      hideAuthOverlay();
      loadState();
      renderTopbarUser();
      loadLocation(state.location);
    } else {
      showAuthOverlay();
      showAuthPanel('loginPanel');
    }
  });

  /* ---- Login Form ---- */
  $('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    setAuthError('loginError', '');
    const email = $('loginEmail').value, password = $('loginPassword').value;
    const btn = $('loginForm').querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await AuthManager.login(email, password);
      // auth:changed event fires automatically
    } catch(err) {
      setAuthError('loginError', err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });

  /* ---- Signup Form ---- */
  $('signupForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    setAuthError('signupError', '');
    const name = $('signupName').value, email = $('signupEmail').value, password = $('signupPassword').value;
    const btn = $('signupForm').querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Creating account…';
    try {
      await AuthManager.register(name, email, password);
    } catch(err) {
      setAuthError('signupError', err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Create account';
    }
  });

  $('goSignup')?.addEventListener('click', () => showAuthPanel('signupPanel'));
  $('goLogin')?.addEventListener('click',  () => showAuthPanel('loginPanel'));
  $('guestBtn')?.addEventListener('click', () => AuthManager.loginAsGuest());

  /* ---- Navigation ---- */
  document.querySelectorAll('.nav-item').forEach(n=>n.onclick=()=>setView(n.dataset.view));
  document.querySelectorAll('[data-view]').forEach(n=>n.addEventListener('click',()=>setView(n.dataset.view)));

  /* ---- Sidebar ---- */
  $('mobileMenu').onclick=()=>$('sidebar').classList.toggle('open');
  document.addEventListener('click',e=>{const sb=$('sidebar');if(window.innerWidth<821&&sb.classList.contains('open')&&!sb.contains(e.target)&&e.target!==$('mobileMenu'))sb.classList.remove('open');});

  /* ---- Refresh ---- */
  $('refreshBtn').onclick=()=>loadLocation(state.location);

  /* ---- Use my location ---- */
  $('useLocationBtn').onclick=()=>{
    if(!navigator.geolocation){showToast('Geolocation unavailable','error');return;}
    showToast('Getting your location…');
    navigator.geolocation.getCurrentPosition(async pos=>{const loc=await reverseGeocode(pos.coords.latitude,pos.coords.longitude);loadLocation(loc);},()=>showToast('Location permission denied.','error'));
  };

  /* ---- Location Search ---- */
  $('locationSearch').onkeydown=e=>{if(e.key==='Enter'){$('locationModal').classList.add('show');$('modalLocationInput').value=e.target.value;searchLocations(e.target.value);}};
  $('notificationBtn').onclick=askNotification;
  $('enableAlertsBtn').onclick=askNotification;
  $('modalClose').onclick=()=>$('locationModal').classList.remove('show');
  $('locationModal').onclick=e=>{if(e.target===$('locationModal'))$('locationModal').classList.remove('show');};
  $('modalSearchBtn').onclick=()=>searchLocations($('modalLocationInput').value);
  $('modalLocationInput').onkeydown=e=>{if(e.key==='Enter')$('modalSearchBtn').click();};

  /* ---- Filters ---- */
  document.querySelectorAll('.filter').forEach(f=>f.onclick=()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));f.classList.add('active');state.filter=f.dataset.filter;renderAlerts();});

  /* ---- Add Location ---- */
  $('addLocationBtn').onclick=async()=>{
    const q=$('addLocationInput').value.trim();if(!q)return;
    try{const u=new URL('https://geocoding-api.open-meteo.com/v1/search');u.searchParams.set('name',q);u.searchParams.set('count','1');u.searchParams.set('language','en');const d=await fetchJSON(u.toString());if(d.results?.[0]){const x=d.results[0];addSaved({name:x.name,admin1:x.admin1||'',country:x.country||'',latitude:x.latitude,longitude:x.longitude,timezone:x.timezone});$('addLocationInput').value='';}else showToast('Location not found.','error');}catch{showToast('Could not search location.','error');}
  };
  $('addLocationInput').onkeydown=e=>{if(e.key==='Enter')$('addLocationBtn').click();};

  /* ---- Map / Report ---- */
  $('centerMapBtn').onclick=()=>state.maps.full?.setView([state.location.latitude,state.location.longitude],9);
  $('exportReportBtn').onclick=()=>{
    if(!state.weather){showToast('No data loaded yet.','error');return;}
    const d=state.weather.daily,a=state.air?.current||{};
    const txt=[`EcoAlert Report`,`Location: ${state.location.name}, ${state.location.country}`,`Generated: ${new Date().toLocaleString()}`,'',`TODAY: ${Math.round(d.temperature_2m_min[0])}–${Math.round(d.temperature_2m_max[0])}°C | Rain: ${Math.round(d.precipitation_probability_max[0]||0)}% | Gust: ${Math.round(d.wind_gusts_10m_max[0])} km/h`,'',`AIR: US AQI ${Math.round(a.us_aqi||0)} (${aqiInfo(a.us_aqi||0)[0]}) | PM2.5 ${num(a.pm2_5)} μg/m³`,'',`ALERTS:`, ...state.alerts.map(x=>`  [${x.severity.toUpperCase()}] ${x.title} — ${x.body}`)].join('\n');
    const blob=new Blob([txt],{type:'text/plain'});const aEl=document.createElement('a');aEl.href=URL.createObjectURL(blob);aEl.download=`ecoalert-${state.location.name.replace(/\s+/g,'-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.txt`;aEl.click();URL.revokeObjectURL(aEl.href);showToast('📄 Report downloaded','ok');
  };

  /* ---- Settings ---- */
  document.querySelectorAll('[data-setting]').forEach(el=>{
    const key=el.dataset.setting;
    if(el.type==='checkbox')el.checked=!!state.settings[key];else el.value=state.settings[key];
    el.addEventListener('change',async()=>{
      state.settings[key]=el.type==='checkbox'?el.checked:Number(el.value);
      if(key==='notifications'&&el.checked){const ok=await askNotification();if(!ok){el.checked=false;state.settings.notifications=false;}}
      persist();state.alerts=buildAlerts();renderHeader();
      $('settingsState').textContent='✓ Saved';setTimeout(()=>$('settingsState').textContent='Autosaved',1200);
    });
  });

  /* ---- Groq API Key Setting ---- */
  const apiKeyInput = $('groqApiKeyInput');
  if (apiKeyInput) {
    const existingKey = localStorage.getItem(GROQ_STORAGE_KEY) || '';
    if (existingKey) apiKeyInput.value = existingKey;
  }
  $('saveApiKeyBtn')?.addEventListener('click', () => {
    const keyVal = $('groqApiKeyInput')?.value.trim();
    if (!keyVal) {
      showToast('Please enter an API key', 'error');
      return;
    }
    localStorage.setItem(GROQ_STORAGE_KEY, keyVal);
    showToast('✅ Groq API key saved locally', 'ok');
  });
  $('clearApiKeyBtn')?.addEventListener('click', () => {
    localStorage.removeItem(GROQ_STORAGE_KEY);
    if ($('groqApiKeyInput')) $('groqApiKeyInput').value = '';
    showToast('API key removed from local storage');
  });

  /* ---- Theme ---- */
  $('themeToggle').onclick=toggleTheme;

  /* ---- Profile Button → Profile View ---- */
  $('profileBtn').onclick=()=>setView('profile');

  /* ---- Logout ---- */
  $('logoutBtn')?.addEventListener('click', () => {
    if(confirm('Sign out of EcoAlert?')) AuthManager.logout();
  });

  /* ---- Profile Save ---- */
  $('profileSaveBtn')?.addEventListener('click', async () => {
    const name  = $('profileName')?.value.trim();
    const city  = $('profileCity')?.value.trim() || '';
    const bio   = $('profileBio')?.value.trim() || '';
    if (!name) { showToast('Name cannot be empty.', 'error'); return; }
    AuthManager.updateProfile({ name, city, bio });
    renderTopbarUser();
    showToast('✅ Profile updated', 'ok');
  });

  /* ---- Change Password ---- */
  $('changePasswordBtn')?.addEventListener('click', async () => {
    const oldPwd = $('oldPassword')?.value;
    const newPwd = $('newPassword')?.value;
    const confPwd = $('confirmPassword')?.value;
    if (!oldPwd || !newPwd) { showToast('Please fill in all password fields.', 'error'); return; }
    if (newPwd !== confPwd) { showToast('New passwords do not match.', 'error'); return; }
    try {
      await AuthManager.changePassword(oldPwd, newPwd);
      showToast('✅ Password changed successfully!', 'ok');
      [$('oldPassword'),$('newPassword'),$('confirmPassword')].forEach(el=>{if(el)el.value='';});
    } catch(err) { showToast(err.message, 'error'); }
  });

  /* ---- Avatar Color ---- */
  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('active'));
      sw.classList.add('active');
      AuthManager.updateProfile({ avatarColor: sw.dataset.color });
      renderTopbarUser();
      renderProfileView();
    });
  });

  /* ---- Delete Account ---- */
  $('deleteAccountBtn')?.addEventListener('click', () => {
    if (confirm('⚠️ Permanently delete your account and all data? This cannot be undone.')) {
      AuthManager.deleteAccount();
    }
  });

  /* ---- AI Chat ---- */
  $('aiSendBtn')?.addEventListener('click', () => {
    const val = $('aiInput')?.value.trim();
    if (val) sendAIMessage(val);
  });
  $('aiInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('aiSendBtn').click(); }
  });
  $('clearChatBtn')?.addEventListener('click', () => {
    if (!state.aiHistory.length) return;
    if (confirm('Clear chat history?')) { state.aiHistory = []; renderAIMessages(); renderAISuggestions(); }
  });

  /* ---- Auto-refresh every 10 min ---- */
  setInterval(()=>loadLocation(state.location), 10*60*1000);
}

/* ── Boot ── */
async function boot() {
  const user = AuthManager.getCurrentUser();

  wire();

  if (!user) {
    // Show auth overlay — user must log in first
    showAuthOverlay();
    return;
  }

  // User is already logged in
  hideAuthOverlay();
  loadState();
  renderTopbarUser();
  $('greeting').textContent = greetingText();
  renderSavedLocations();
  await loadLocation(state.location);
  renderProfileView();

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); } catch { }
  }
}

window.sendAIMessage = sendAIMessage;

boot();
