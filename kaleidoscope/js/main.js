console.log('kaleidoscope: main.js loaded');

if (new URLSearchParams(location.search).has('selftest')) {
  const { runSelftest } = await import('./selftest.js');
  runSelftest();
}
