const { lookup } = require('node:dns/promises');
const https = require('node:https');
const { BlockList, isIP } = require('node:net');
const { parse } = require('parse5');
const { publicQuery } = require('./security.cjs');

const blocked = new BlockList();
for (const [subnet, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]
]) blocked.addSubnet(subnet, bits);

const userAgent = 'BujiV2/1.0 (https://github.com/Devchandrasen/buji)';
const ignored = new Set(['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'nav', 'header', 'footer', 'form', 'aside']);
const paragraphs = new Set(['p', 'div', 'section', 'li', 'br', 'pre', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function publicUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Provide a public HTTPS URL under 2,048 characters.');
  const url = new URL(value);
  const host = url.hostname.replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !host.includes('.') ||
      isIP(host) || /(?:^|\.)(?:localhost|local|localdomain|internal|test|invalid|example|lan|home\.arpa)$/.test(host)) {
    throw new Error('Web research accepts public HTTPS hostnames on port 443.');
  }
  url.hash = '';
  for (const [name, value] of url.searchParams) if (value && /^(?:api[_-]?key|access[_-]?token|token|password|secret|authorization|signature|sig|x-amz-.+)$/i.test(name))
    throw new Error('Do not use credential-bearing or signed private URLs in public research.');
  return url;
}

async function publicAddress(host, resolve = lookup) {
  const addresses = await resolve(host, { family: 4, all: true });
  if (!addresses.length || addresses.some(item => item.family !== 4 || isIP(item.address) !== 4 || blocked.check(item.address))) {
    throw new Error('The host resolves to an unavailable or non-public IPv4 address.');
  }
  return addresses[0];
}

function get(url, endpoint, signal, accept) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      agent: false, family: 4, signal, headers: { 'User-Agent': userAgent, Accept: accept, 'Accept-Encoding': 'identity' },
      lookup: (_host, options, callback) => options.all ? callback(null, [endpoint]) : callback(null, endpoint.address, 4)
    }, resolve);
    request.once('error', reject);
  });
}

async function readPublic(value, abort, accept) {
  const deadline = AbortSignal.timeout(12000);
  const signal = abort ? AbortSignal.any([abort, deadline]) : deadline;
  let url = publicUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const address = await publicAddress(url.hostname);
    signal.throwIfAborted();
    const response = await get(url, address, signal, accept);
    const status = response.statusCode;
    if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
      response.destroy();
      url = publicUrl(new URL(response.headers.location, url).href);
      continue;
    }
    const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (status !== 200 || !accept.split(', ').includes(type)) {
      response.destroy();
      throw new Error(status === 200 ? 'This URL did not return a supported text document.' : `Web source returned HTTP ${status}.`);
    }
    const maxBytes = 2 * 1024 * 1024;
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('Web source exceeded the 2 MiB download limit.');
      chunks.push(chunk);
    }
    return { url: url.href, type, body: Buffer.concat(chunks).toString('utf8') };
  }
  throw new Error('Web source redirected too many times.');
}

function find(node, tags) {
  if (tags.includes(node.tagName)) return node;
  for (const child of node.childNodes || []) {
    const match = find(child, tags);
    if (match) return match;
  }
}

function textFrom(node) {
  if (node.nodeName === '#text') return node.value;
  if (ignored.has(node.tagName)) return '';
  const children = (node.childNodes || []).map(textFrom).join('');
  return paragraphs.has(node.tagName) ? `\n${children}\n` : children;
}

function excerpt(body) {
  return body.replace(/[\t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function selectPassages(text, query, limit = 4500) {
  const words = [...new Set((String(query || '').toLowerCase().match(/[\p{L}\p{N}_.]{3,}/gu) || []).flatMap(word => [word,...word.split('.')])
    .filter(word => word.length >= 3 && !['the','what','how','does','for','and','with','from','this','that','please','explain','official','source','documentation','find','search','https','www','com','org'].includes(word)))].slice(0,24);
  if (!words.length || text.length <= limit) return text.slice(0,limit);
  const chunks=[];
  for(let start=0;start<text.length;start+=800) chunks.push({start:Math.max(0,start-100),text:text.slice(Math.max(0,start-100),start+900)});
  const frequencies=words.map(word=>chunks.filter(chunk=>chunk.text.toLowerCase().includes(word)).length);
  for(const chunk of chunks) chunk.score=words.reduce((score,word,index)=>score+(chunk.text.toLowerCase().includes(word)?Math.log(1+chunks.length/(1+frequencies[index])):0),0);
  const selected=[];
  for(const chunk of [...chunks].sort((a,b)=>b.score-a.score)) if(chunk.score>0&&!selected.some(other=>Math.abs(other.start-chunk.start)<900)) {selected.push(chunk);if(selected.length===4)break;}
  if(!selected.length)return text.slice(0,limit);
  return (text.slice(0,450)+'\n\n[Relevant passages from this page, ordered by relevance]\n'+selected.map(chunk=>chunk.text).join('\n[…]\n')).slice(0,limit);
}
async function fetchPage(url, signal, focus = '') {
  const result = await readPublic(url, signal, 'text/html, text/plain, application/json');
  let title = new URL(result.url).hostname;
  let content = result.body;
  if (result.type === 'text/html') {
    const document = parse(content);
    const heading = find(document, ['title']);
    title = (heading && excerpt(textFrom(heading))) || title;
    content = textFrom(find(document, ['main', 'article']) || find(document, ['body']) || document);
  }
  const clean = excerpt(content);
  if (!clean) throw new Error('No readable text was found on the page.');
  const links = [];
  if (result.type === 'text/html') walk(parse(result.body), node => {
    if (node.tagName !== 'a' || links.length >= 8) return;
    try {
      const target = publicUrl(new URL(attr(node, 'href'), result.url).href).href;
      const label = excerpt(textFrom(node)).slice(0, 100);
      if (label && !links.some(link => link.url === target)) links.push({ url: target, title: label });
    } catch {}
  });
  return { url: result.url, title: title.slice(0, 160), text: selectPassages(clean, focus), truncated: clean.length > 4500,
    fetchedAt: new Date().toISOString(), links };
}

function walk(node, visit) { visit(node); for (const child of node.childNodes || []) walk(child, visit); }
function attr(node, name) { return node.attrs?.find(item => item.name === name)?.value || ''; }
function plain(value) { return excerpt(textFrom(parse(value))); }
function searchTarget(value) {
  const url = new URL(value, 'https://duckduckgo.com');
  const target = /(?:^|\.)duckduckgo\.com$/.test(url.hostname) ? url.searchParams.get('uddg') : null;
  return publicUrl(target || url.href).href;
}
function parseSearch(body, provider) {
  const results = [];
  if (provider === 'Bing') {
    for (const match of body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
      const field = name => plain(match[1].match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'))?.[1] || '');
      try { results.push({ title: field('title'), url: publicUrl(field('link')).href, snippet: field('description').slice(0, 500) }); } catch {}
    }
  } else {
    const anchors = [], snippets = [];
    walk(parse(body), node => {
      const classes = attr(node, 'class').split(/\s+/);
      if (node.tagName === 'a' && classes.some(value => ['result__a', 'result-link'].includes(value))) anchors.push(node);
      if (classes.some(value => ['result__snippet', 'result-snippet'].includes(value))) snippets.push(excerpt(textFrom(node)));
    });
    anchors.forEach((node, i) => {
      try { results.push({ title: excerpt(textFrom(node)), url: searchTarget(attr(node, 'href')), snippet: (snippets[i] || '').slice(0, 500) }); } catch {}
    });
  }
  const seen = new Set();
  return results.filter(item => {
    const host = new URL(item.url).hostname;
    if (!item.title || /(?:^|\.)(?:duckduckgo\.com|bing\.com)$/.test(host) || seen.has(item.url)) return false;
    seen.add(item.url); return true;
  }).slice(0, 8).map(item => ({ ...item, title: item.title.slice(0, 160), provider, fetchedAt: new Date().toISOString() }));
}
async function searchWeb(query, signal, read = readPublic) {
  query = publicQuery(query);
  const providers = [
    { name: 'DuckDuckGo Lite', url: 'https://lite.duckduckgo.com/lite/?' + new URLSearchParams({ q: query }), accept: 'text/html' },
    { name: 'DuckDuckGo', url: 'https://html.duckduckgo.com/html/?' + new URLSearchParams({ q: query }), accept: 'text/html' },
    { name: 'Bing', url: 'https://www.bing.com/search?' + new URLSearchParams({ q: query, format: 'rss' }), accept: 'text/xml, application/rss+xml, application/xml, text/html' }
  ];
  const attempts = [];
  for (const provider of providers) {
    signal?.throwIfAborted();
    try {
      const page = await read(provider.url, signal, provider.accept);
      const words = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter(word => !['the','what','how','for','with','and','today','latest','please','about','search','find','site','com','org'].includes(word)) || [];
      const site = query.match(/\bsite:([a-z0-9.-]+)/i)?.[1].toLowerCase();
      const sources = parseSearch(page.body, provider.name).filter(source => !site || new URL(source.url).hostname === site || new URL(source.url).hostname.endsWith('.' + site))
        .map(source => ({ ...source, relevance: words.reduce((score, word) => score + (source.title.toLowerCase().includes(word) ? 3 : 0) + (source.snippet.toLowerCase().includes(word) ? 1 : 0) + (source.url.toLowerCase().includes(word) ? 2 : 0), 0) }))
        .filter(source => provider.name !== 'Bing' || !words.length || source.relevance > 0).sort((a,b) => b.relevance - a.relevance);
      if (sources.length) return { sources, provider: provider.name, fetchedAt: new Date().toISOString(), attempts };
      attempts.push({ provider: provider.name, status: /captcha|anomaly|challenge|verify you are human/i.test(page.body) ? 'challenge' : 'no-results' });
    } catch (error) { if (signal?.aborted) throw error; attempts.push({ provider: provider.name, status: 'unavailable' }); }
  }
  return { sources: [], provider: null, attempts, error: 'Public search did not return usable results. Try a more specific question or provide a source URL. No challenge was bypassed.' };
}

async function searchWikipedia(query, signal) {
  if (typeof query !== 'string' || !query.trim() || query.length > 220) throw new Error('Use a public search query under 220 characters.');
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '4', srprop: 'snippet', format: 'json' });
  const result = await readPublic(url.href, signal, 'application/json');
  const pages = JSON.parse(result.body).query?.search;
  if (!Array.isArray(pages)) throw new Error('Wikipedia search did not return results.');
  return pages.slice(0, 4).map(page => ({ title: page.title.slice(0, 120), url: `https://en.wikipedia.org/?curid=${page.pageid}`,
    snippet: excerpt(textFrom(parse(page.snippet))).slice(0, 270) }));
}

const weatherLabels = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle', 56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Light rain', 63: 'Moderate rain', 65: 'Heavy rain', 66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Light snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Moderate showers',
  82: 'Heavy showers', 85: 'Light snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm',
  96: 'Thunderstorm with light hail', 97: 'Heavy thunderstorm', 99: 'Thunderstorm with heavy hail'
};

function wantsWeather(text) {
  return /\b(?:weather|forecast|temperature|rain(?:ing)?|mausam|b[aa]rish|baarish)\b|मौसम|बारिश|तापमान/iu.test(text) &&
    /\b(?:today|tonight|tomorrow|now|current(?:ly)?|forecast|aaj|abhi|kal|this week|weather (?:in|for|at))\b|आज|अभी|कल/iu.test(text) &&
    !/\b(?:historical|definition|meaning|climate|yesterday)\b/iu.test(text);
}

async function getWeather(location, signal) {
  if (typeof location !== 'string' || !location.trim() || location.length > 100) throw new Error('Provide a city or town for the weather lookup.');
  const [city, ...regions] = location.split(',').map(part => part.trim()).filter(Boolean);
  if (!city || city.length < 2) throw new Error('Provide a city or town for the weather lookup.');
  const geocode = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geocode.search = new URLSearchParams({ name: city, count: '10', language: 'en', format: 'json' });
  const places = JSON.parse((await readPublic(geocode.href, signal, 'application/json')).body).results || [];
  const normalized = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const matches = places.filter(place => regions.every(region => [place.admin1, place.admin2, place.country, place.country_code]
    .some(value => normalized(value) === normalized(region))));
  const exact = matches.filter(place => normalized(place.name) === normalized(city));
  const selected = exact.length ? exact : matches;
  if (!selected.length) throw new Error('Open-Meteo could not match that location. Check the city and region.');
  const place = selected[0];
  const placeName = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
  const forecast = new URL('https://api.open-meteo.com/v1/forecast');
  forecast.search = new URLSearchParams({ latitude: place.latitude, longitude: place.longitude, timezone: 'auto', forecast_days: '3',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' });
  const response = await readPublic(forecast.href, signal, 'application/json');
  const data = JSON.parse(response.body);
  const current = data.current;
  if (!Number.isFinite(current?.temperature_2m) || typeof current.time !== 'string' || !Array.isArray(data.daily?.time)) {
    throw new Error('Open-Meteo returned an incomplete forecast.');
  }
  return { url: response.url, title: `Open-Meteo forecast for ${placeName}`, location: placeName, timezone: data.timezone,
    current: { local_time: current.time, temperature_c: current.temperature_2m, feels_like_c: current.apparent_temperature,
      humidity_percent: current.relative_humidity_2m, wind_kmh: current.wind_speed_10m, conditions: weatherLabels[current.weather_code] || 'Unavailable' },
    forecast: data.daily.time.map((date, i) => ({ local_date: date, high_c: data.daily.temperature_2m_max?.[i], low_c: data.daily.temperature_2m_min?.[i],
      precipitation_chance_percent: data.daily.precipitation_probability_max?.[i], conditions: weatherLabels[data.daily.weather_code?.[i]] || 'Unavailable' })) };
}

module.exports = { fetchPage, selectPassages, searchWeb, parseSearch, searchWikipedia, publicUrl, publicAddress, getWeather, wantsWeather, readPublic };
