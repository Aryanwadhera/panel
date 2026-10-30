export default {
  type: 'photos',
  name: 'Photo frame',
  description: 'A slideshow of photos from your phone, stored on the panel.',
  size: { w: 2, h: 2 },
  // Photos live on the panel (server/photos.js), so there's nothing to fetch.
  live: true,
  defaultTitle: 'Photos',
  fields: [
    { key: 'every', label: 'Change photo every', type: 'select', default: '60', options: [
      { value: '15', label: '15 seconds' }, { value: '60', label: 'Minute' },
      { value: '300', label: '5 minutes' }, { value: '900', label: '15 minutes' }, { value: '3600', label: 'Hour' },
    ] },
    { key: 'fit', label: 'Show the whole photo', type: 'toggle', default: false, help: 'Off fills the space and may crop the edges.' },
    { key: 'full', label: 'Fill the whole screen at set times', type: 'toggle', default: false },
    { key: 'fullFrom', label: 'From', type: 'time', default: '22:00', half: true, showIf: { key: 'full', in: [true] } },
    { key: 'fullUntil', label: 'Until', type: 'time', default: '07:00', half: true, showIf: { key: 'full', in: [true] } },
  ],
  display: (c) => ({
    every: +c.every || 60, fit: !!c.fit,
    full: c.full ? { from: c.fullFrom || '22:00', until: c.fullUntil || '07:00' } : null,
  }),
};
