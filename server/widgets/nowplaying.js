export default {
  type: 'nowplaying',
  name: 'Now playing',
  description: 'The song playing over AirPlay, with album art and progress.',
  size: { w: 2, h: 1 },
  fields: [],
  // Data comes live from the AirPlay receiver (server/audio.js), not from a fetch.
  live: true,
  summarize: (data) => (data?.state === 'playing' && data.title ? `Music playing: ${data.title}${data.artist ? ` by ${data.artist}` : ''}.` : null),
};
