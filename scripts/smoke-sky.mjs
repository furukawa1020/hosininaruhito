import { createApp } from '../src/server/app.js';

const keys = ['HCR_ACCESS_TOKEN', 'HOSHIMIRU_API_TOKEN', 'HCR_SMOKE_LAT', 'HCR_SMOKE_LNG'];
if (keys.some(key => !process.env[key]?.trim()) || process.env.HCR_SMOKE_SEND_LOCATION !== 'yes') {
  console.error('LIVE SKY NOT RUN: configure HCR_ACCESS_TOKEN, HOSHIMIRU_API_TOKEN, HCR_SMOKE_LAT, HCR_SMOKE_LNG and HCR_SMOKE_SEND_LOCATION=yes locally. No fixture fallback.');
  process.exitCode = 1;
} else {
  try {
    const response = await createApp().request('/api/sky', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.HCR_ACCESS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: Number(process.env.HCR_SMOKE_LAT), lng: Number(process.env.HCR_SMOKE_LNG) })
    });
    const data = await response.json();
    if (!response.ok || data.source !== 'hoshimiru-live' || !Array.isArray(data.constellations)) {
      console.error('LIVE SKY FAILED: HTTP ' + response.status + ' / ' + (data.code || 'invalid_response'));
      process.exitCode = 1;
    } else {
      console.log('LIVE SKY PASSED: ' + data.constellations.length + ' constellations; timeBasis=' + data.timeBasis);
    }
  } catch {
    console.error('LIVE SKY FAILED: unexpected local or transport error. No fixture fallback.');
    process.exitCode = 1;
  }
}

