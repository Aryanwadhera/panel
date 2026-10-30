import { fetchJson } from '../lib/http.js';

// WMO weather interpretation codes, as used by Open-Meteo.
const CODES = {
  0: ['Clear', 'clear'], 1: ['Mostly clear', 'clear'], 2: ['Partly cloudy', 'partly'], 3: ['Overcast', 'cloudy'],
  45: ['Fog', 'fog'], 48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle'], 55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'], 57: ['Freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Heavy showers', 'rain'],
  85: ['Snow showers', 'snow'], 86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorms', 'storm'], 96: ['Thunderstorms with hail', 'storm'], 99: ['Thunderstorms with hail', 'storm'],
};
const describe = (code) => CODES[code] || ['—', 'cloudy'];
const round = (n) => (n == null ? null : Math.round(n));

export default {
  type: 'weather',
  name: 'Weather',
  description: 'Current conditions and the next few days. No API key needed.',
  size: { w: 1, h: 1 },
  interval: 15 * 60,
  fields: [
    { key: 'location', label: 'Location', type: 'location', help: 'Leave empty to use the panel’s location from Settings.' },
    { key: 'showForecast', label: 'Show forecast when there’s room', type: 'toggle', default: true },
  ],
  display: (c) => ({ showForecast: c.showForecast !== false }),

  async fetch(config, ctx) {
    const loc = config.location?.lat != null ? config.location : ctx.settings.location;
    if (!loc) throw new Error('Set a location in Settings');
    const imperial = ctx.settings.units === 'imperial';
    const q = new URLSearchParams({
      latitude: loc.lat, longitude: loc.lon, timezone: ctx.settings.timezone, forecast_days: '6',
      current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day',
      hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
      temperature_unit: imperial ? 'fahrenheit' : 'celsius',
      wind_speed_unit: imperial ? 'mph' : 'kmh',
    });
    const d = await fetchJson(`https://api.open-meteo.com/v1/forecast?${q}`);
    const c = d.current;
    const [text, icon] = describe(c.weather_code);

    const nowIdx = Math.max(0, d.hourly.time.findIndex((t) => t >= c.time.slice(0, 13)));
    const hours = d.hourly.time.slice(nowIdx, nowIdx + 12).map((t, i) => ({
      time: t, temp: round(d.hourly.temperature_2m[nowIdx + i]),
      icon: describe(d.hourly.weather_code[nowIdx + i])[1],
      day: !!d.hourly.is_day[nowIdx + i],
      rain: d.hourly.precipitation_probability[nowIdx + i] ?? 0,
    }));

    const days = d.daily.time.map((date, i) => ({
      date, hi: round(d.daily.temperature_2m_max[i]), lo: round(d.daily.temperature_2m_min[i]),
      icon: describe(d.daily.weather_code[i])[1], text: describe(d.daily.weather_code[i])[0],
      rain: d.daily.precipitation_probability_max[i] ?? 0,
    }));

    return {
      place: loc.name,
      unit: imperial ? '°F' : '°C',
      windUnit: imperial ? 'mph' : 'km/h',
      current: {
        temp: round(c.temperature_2m), feels: round(c.apparent_temperature), text, icon,
        day: !!c.is_day, wind: round(c.wind_speed_10m), humidity: round(c.relative_humidity_2m),
      },
      today: { ...days[0], sunrise: d.daily.sunrise[0], sunset: d.daily.sunset[0] },
      days: days.slice(1),
      hours,
    };
  },

  summarize(data) {
    if (!data?.current) return null;
    const { current: c, today: t, hours } = data;
    let s = `${data.place}: ${c.temp}${data.unit} and ${c.text.toLowerCase()}, feels like ${c.feels}${data.unit}. Today's high ${t.hi}${data.unit}, low ${t.lo}${data.unit}.`;
    const wet = hours.find((h) => h.rain >= 50);
    if (wet) s += ` Rain likely from around ${wet.time.slice(11, 16)} (${wet.rain}%).`;
    else if (t.rain >= 30) s += ` ${t.rain}% chance of rain today.`;
    if (data.days[0]) s += ` Tomorrow: ${data.days[0].text.toLowerCase()}, ${data.days[0].lo}–${data.days[0].hi}${data.unit}.`;
    return s;
  },
};
