// Ready-made API widgets. {{name}} is filled in from the template's inputs
// when you pick it; {lat}-style variables are filled at every request.
// An input marked `token` goes into the widget's (secret) auth token.

export const TEMPLATES = [
  {
    id: 'github-stars', name: 'GitHub stars', group: 'Developer',
    description: 'Stars on a repository, with a trend line.',
    inputs: [{ key: 'repo', label: 'Repository', placeholder: 'owner/name' }],
    title: '{{repo}}',
    config: { url: 'https://api.github.com/repos/{{repo}}', view: 'stat', valuePath: 'stargazers_count', caption: 'stars', every: '15' },
  },
  {
    id: 'github-prs', name: 'Open pull requests', group: 'Developer',
    description: 'The newest open PRs and who opened them.',
    inputs: [{ key: 'repo', label: 'Repository', placeholder: 'owner/name' }, { key: 'token', label: 'GitHub token (for private repos)', optional: true, token: 'bearer' }],
    title: 'Pull requests',
    w: 1, h: 2,
    config: { url: 'https://api.github.com/repos/{{repo}}/pulls?state=open&per_page=10', view: 'list', itemTitlePath: 'title', itemMetaPath: 'user.login', every: '5' },
  },
  {
    id: 'github-actions', name: 'GitHub Actions', group: 'Developer',
    description: 'Recent workflow runs with pass/fail dots.',
    inputs: [{ key: 'repo', label: 'Repository', placeholder: 'owner/name' }, { key: 'token', label: 'GitHub token (for private repos)', optional: true, token: 'bearer' }],
    title: 'Builds',
    w: 1, h: 2,
    config: { url: 'https://api.github.com/repos/{{repo}}/actions/runs?per_page=8', view: 'list', itemsPath: 'workflow_runs', itemTitlePath: 'display_title', itemMetaPath: 'name', itemStatusPath: 'conclusion', every: '5' },
  },
  {
    id: 'npm', name: 'npm downloads', group: 'Developer',
    description: 'Weekly downloads for a package.',
    inputs: [{ key: 'package', label: 'Package', placeholder: 'react' }],
    title: '{{package}}',
    config: { url: 'https://api.npmjs.org/downloads/point/last-week/{{package}}', view: 'stat', valuePath: 'downloads', caption: 'downloads this week', every: '360' },
  },
  {
    id: 'linear', name: 'Linear: my issues', group: 'Developer',
    description: 'Open issues assigned to you, via Linear’s GraphQL API.',
    inputs: [{ key: 'token', label: 'Linear API key', placeholder: 'lin_api_…', token: 'header:Authorization' }],
    title: 'My issues',
    w: 1, h: 2,
    config: {
      url: 'https://api.linear.app/graphql', method: 'POST', view: 'list', every: '5',
      body: '{"query": "{ viewer { assignedIssues(first: 10, filter: { state: { type: { nin: [\\"completed\\", \\"canceled\\"] } } }) { nodes { identifier title } } } }"}',
      itemsPath: 'data.viewer.assignedIssues.nodes', itemTitlePath: 'title', itemMetaPath: 'identifier',
    },
  },
  {
    id: 'stripe', name: 'Stripe balance', group: 'Business',
    description: 'Your available Stripe balance.',
    inputs: [{ key: 'token', label: 'Restricted key with Balance: read', placeholder: 'rk_live_…', token: 'bearer' }],
    title: 'Stripe balance',
    config: { url: 'https://api.stripe.com/v1/balance', view: 'stat', valuePath: 'available[0].amount', scale: '0.01', decimals: '0', prefix: '$', caption: 'available', every: '15' },
  },
  {
    id: 'plausible', name: 'Plausible: visitors now', group: 'Business',
    description: 'People on your site right now.',
    inputs: [{ key: 'site', label: 'Site domain', placeholder: 'example.com' }, { key: 'token', label: 'Plausible API key', token: 'bearer' }],
    title: 'On the site',
    config: { url: 'https://plausible.io/api/v1/stats/realtime/visitors?site_id={{site}}', view: 'stat', caption: 'visitors right now', every: '1' },
  },
  {
    id: 'crypto', name: 'Crypto price', group: 'Money',
    description: 'Price and 24-hour change from CoinGecko. No key needed.',
    inputs: [{ key: 'coin', label: 'Coin', placeholder: 'bitcoin', default: 'bitcoin' }, { key: 'currency', label: 'Currency', placeholder: 'usd', default: 'usd' }],
    title: '{{coin}}',
    config: {
      url: 'https://api.coingecko.com/api/v3/simple/price?ids={{coin}}&vs_currencies={{currency}}&include_24hr_change=true',
      view: 'stat', valuePath: '{{coin}}.{{currency}}', deltaPath: '{{coin}}.{{currency}}_24h_change', deltaSuffix: '%', prefix: '$', caption: 'in 24 hours', every: '5',
    },
  },
  {
    id: 'fx', name: 'Exchange rate', group: 'Money',
    description: 'What one unit of a currency buys. No key needed.',
    inputs: [{ key: 'from', label: 'From', placeholder: 'USD', default: 'USD' }, { key: 'to', label: 'To', placeholder: 'EUR', default: 'EUR' }],
    title: '{{from}} → {{to}}',
    config: { url: 'https://open.er-api.com/v6/latest/{{from}}', view: 'stat', valuePath: 'rates.{{to}}', decimals: '4', caption: '{{to}} per {{from}}', every: '360' },
  },
  {
    id: 'aqi', name: 'Air quality', group: 'Home',
    description: 'US air quality index where the panel is. No key needed.',
    inputs: [],
    title: 'Air quality',
    config: { url: 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lon}&current=us_aqi', view: 'stat', valuePath: 'current.us_aqi', caption: 'US AQI', every: '60' },
  },
  {
    id: 'homeassistant', name: 'Home Assistant sensor', group: 'Home',
    description: 'Any sensor or entity: temperature, power, a door.',
    inputs: [
      { key: 'server', label: 'Home Assistant address', placeholder: 'http://192.168.1.20:8123', default: 'http://homeassistant.local:8123' },
      { key: 'entity', label: 'Entity ID', placeholder: 'sensor.living_room_temperature' },
      { key: 'token', label: 'Long-lived access token', placeholder: 'From your HA profile → Security', token: 'bearer' },
    ],
    title: '{{entity}}',
    config: { url: '{{server}}/api/states/{{entity}}', view: 'stat', valuePath: 'state', labelPath: 'attributes.friendly_name', every: '1' },
  },
];
