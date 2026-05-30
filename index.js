import('./artifacts/api-server/dist/index.mjs').catch(err => {
  console.error('Failed to start NexusBot:', err);
  process.exit(1);
});
