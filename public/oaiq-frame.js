// Runs inside /oaiq-frame.html, the hidden same-origin iframe that hosts the ChatGPT ads pixel.
// See that page and apps/crm/src/lib/openaiAdsLoader.ts. Plain script, no build step.
(function () {
  'use strict';
  var CHANNEL = 'mesaas-oaiq';
  var ALLOWED = { init: true, consent: true, measure: true };

  // Only ever driven by the Mesaas page that embeds it.
  if (window.parent === window) return;

  // OpenAI's base-code stub: calls queue on `.q` until oaiq.min.js loads and replays them.
  if (!window.oaiq) {
    var stub = function () {
      stub.q.push(arguments);
    };
    stub.q = [];
    window.oaiq = stub;
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.channel !== CHANNEL || !Array.isArray(data.call)) return;
    if (typeof data.call[0] !== 'string' || !ALLOWED[data.call[0]]) return;
    window.oaiq.apply(null, data.call);
  });

  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';
  document.head.appendChild(script);

  window.parent.postMessage({ channel: CHANNEL, ready: true }, window.location.origin);
})();
