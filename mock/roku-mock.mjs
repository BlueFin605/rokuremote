import http from 'node:http';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import { WebSocketServer } from 'ws';
import { createCanvas } from './icon-gen.mjs';

const PORT = 8060;

// --- State ---
let activeAppId = null;
let limitedMode = false;
let audioOutputTarget = null; // "ip:port" where we send mock RTP
let rtpInterval = null;

const apps = [
  { id: '12', name: 'Netflix', version: '14.0.0', color: '#E50914' },
  { id: '13', name: 'Amazon Prime Video', version: '9.2.0', color: '#00A8E1' },
  { id: '14', name: 'Disney+', version: '3.1.0', color: '#113CCF' },
  { id: '15', name: 'YouTube', version: '5.0.0', color: '#FF0000' },
  { id: '16', name: 'Hulu', version: '7.4.0', color: '#1CE783' },
  { id: '17', name: 'HBO Max', version: '8.1.0', color: '#B537F2' },
  { id: '18', name: 'Apple TV+', version: '2.3.0', color: '#333333' },
  { id: '19', name: 'Spotify', version: '4.1.0', color: '#1DB954' },
  { id: '20', name: 'Plex', version: '6.0.0', color: '#E5A00D' },
  { id: '21', name: 'Tubi', version: '5.2.0', color: '#FA382F' },
  { id: '22', name: 'Peacock', version: '3.5.0', color: '#000000' },
  { id: '23', name: 'Paramount+', version: '4.0.0', color: '#0064FF' },
  { id: '24', name: 'Crunchyroll', version: '2.1.0', color: '#F47521' },
  { id: '25', name: 'Roku Channel', version: '1.0.0', color: '#6C3A9B' },
];

// --- Device Info ---
const deviceInfoXml = `<?xml version="1.0" encoding="UTF-8" ?>
<device-info>
  <udn>00000000-0000-0000-0000-000000000000</udn>
  <serial-number>MOCK123456</serial-number>
  <device-id>MOCK-DEVICE-001</device-id>
  <advertising-id>mock-ad-id</advertising-id>
  <vendor-name>Roku</vendor-name>
  <model-name>Roku Mock Device</model-name>
  <model-number>0000</model-number>
  <model-region>NZ</model-region>
  <is-tv>false</is-tv>
  <is-stick>false</is-stick>
  <supports-ethernet>true</supports-ethernet>
  <wifi-mac>00:00:00:00:00:00</wifi-mac>
  <network-type>wifi</network-type>
  <friendly-device-name>Mock Roku</friendly-device-name>
  <default-device-name>Mock Roku Streaming Device</default-device-name>
  <user-device-name>Living Room Roku (Mock)</user-device-name>
  <user-device-location>Living Room</user-device-location>
  <build-number>MOCK.000</build-number>
  <software-version>14.0.0</software-version>
  <software-build>0000</software-build>
  <power-mode>PowerOn</power-mode>
  <supports-private-listening>true</supports-private-listening>
  <developer-enabled>false</developer-enabled>
  <keyed-developer-id></keyed-developer-id>
  <search-enabled>true</search-enabled>
  <search-channels-enabled>true</search-channels-enabled>
  <voice-search-enabled>true</voice-search-enabled>
  <notifications-enabled>true</notifications-enabled>
  <notifications-first-use>true</notifications-first-use>
  <supports-suspend>true</supports-suspend>
  <headphones-connected>false</headphones-connected>
  <supports-find-remote>false</supports-find-remote>
  <supports-audio-guide>true</supports-audio-guide>
  <supports-rva>true</supports-rva>
  <developer-enabled>false</developer-enabled>
</device-info>`;

// --- Handlers ---
function handleDeviceInfo(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(deviceInfoXml);
}

function handleApps(req, res) {
  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<apps>
${apps.map(a => `  <app id="${a.id}" type="appl" version="${a.version}">${a.name}</app>`).join('\n')}
</apps>`;
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(xml);
}

function handleActiveApp(req, res) {
  const app = apps.find(a => a.id === activeAppId);
  const xml = app
    ? `<?xml version="1.0" encoding="UTF-8" ?>\n<active-app>\n  <app id="${app.id}" type="appl" version="${app.version}">${app.name}</app>\n</active-app>`
    : `<?xml version="1.0" encoding="UTF-8" ?>\n<active-app>\n  <app id="" type="" version="">Roku</app>\n</active-app>`;
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(xml);
}

function handleIcon(req, res, appId) {
  const app = apps.find(a => a.id === appId);
  if (!app) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const png = createCanvas(app.name, app.color);
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': png.length,
  });
  res.end(png);
}

function handleKeypress(req, res, key) {
  console.log(`[keypress] ${key}`);
  res.writeHead(200);
  res.end();
}

function handleKeydown(req, res, key) {
  console.log(`[keydown]  ${key}`);
  res.writeHead(200);
  res.end();
}

function handleKeyup(req, res, key) {
  console.log(`[keyup]    ${key}`);
  res.writeHead(200);
  res.end();
}

function handleLaunch(req, res, appId) {
  const app = apps.find(a => a.id === appId);
  if (app) {
    activeAppId = appId;
    console.log(`[launch]   ${app.name} (${appId})`);
    res.writeHead(200);
    res.end();
  } else {
    console.log(`[launch]   unknown app ${appId}`);
    res.writeHead(400);
    res.end('App not found');
  }
}

function handleLimited(req, res) {
  res.writeHead(403, { 'Content-Type': 'text/plain' });
  res.end('ECP command not allowed in Limited mode.');
}

// --- Server ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (limitedMode && path !== '/query/device-info') {
    return handleLimited(req, res);
  }

  // GET routes
  if (req.method === 'GET') {
    if (path === '/query/device-info') return handleDeviceInfo(req, res);
    if (path === '/query/apps') return handleApps(req, res);
    if (path === '/query/active-app') return handleActiveApp(req, res);

    const iconMatch = path.match(/^\/query\/icon\/(\d+)$/);
    if (iconMatch) return handleIcon(req, res, iconMatch[1]);
  }

  // POST routes
  if (req.method === 'POST') {
    const keypressMatch = path.match(/^\/keypress\/(.+)$/);
    if (keypressMatch) return handleKeypress(req, res, decodeURIComponent(keypressMatch[1]));

    const keydownMatch = path.match(/^\/keydown\/(.+)$/);
    if (keydownMatch) return handleKeydown(req, res, decodeURIComponent(keydownMatch[1]));

    const keyupMatch = path.match(/^\/keyup\/(.+)$/);
    if (keyupMatch) return handleKeyup(req, res, decodeURIComponent(keyupMatch[1]));

    const launchMatch = path.match(/^\/launch\/(\d+)$/);
    if (launchMatch) return handleLaunch(req, res, launchMatch[1]);
  }

  res.writeHead(404);
  res.end('Not found');
});

// --- WebSocket: Private Listening Auth Mock ---
// Implements the same challenge-response protocol as the real Roku.
// After auth, accepts set-audio-output and sends mock RTP Opus packets.

const UUID = '95E610D0-7C29-44EF-FB0F-97F1FCE4C297';
const SHIFT = 9;

function hashChar(c, shift) {
  let val;
  if (c >= '0' && c <= '9') val = c.charCodeAt(0) - 48;
  else if (c >= 'A' && c <= 'F') val = (c.charCodeAt(0) - 65) + 10;
  else return c;
  const result = ((15 - val) + shift) & 15;
  return String.fromCharCode(result < 10 ? result + 48 : (result - 10) + 65);
}

function transformUuid(uuid, shift) {
  return [...uuid].map(c => hashChar(c, shift)).join('');
}

function computeExpectedResponse(challenge) {
  const input = challenge + transformUuid(UUID, SHIFT);
  const hash = crypto.createHash('sha1').update(input).digest();
  return hash.toString('base64');
}

// Generate a silent Opus frame (a valid minimal Opus packet)
// This is a "silence" Opus frame for 48kHz stereo
const SILENT_OPUS_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

function startMockRtp(targetIp, targetPort) {
  stopMockRtp();
  const udp = dgram.createSocket('udp4');
  let seq = 0;
  let timestamp = 0;
  const ssrc = Math.floor(Math.random() * 0xFFFFFFFF);

  console.log(`[rtp]      Sending mock Opus RTP to ${targetIp}:${targetPort}`);

  rtpInterval = setInterval(() => {
    // Build RTP header (12 bytes) + Opus payload
    const header = Buffer.alloc(12);
    header[0] = 0x80; // V=2, no padding, no extension, no CSRC
    header[1] = 97;   // payload type 97 (Opus)
    header.writeUInt16BE(seq & 0xFFFF, 2);
    header.writeUInt32BE(timestamp, 4);
    header.writeUInt32BE(ssrc, 8);

    const packet = Buffer.concat([header, SILENT_OPUS_FRAME]);
    udp.send(packet, targetPort, targetIp);

    seq++;
    timestamp += 960; // 20ms at 48kHz
  }, 20); // 20ms per frame = 50fps

  rtpInterval._udp = udp;
}

function stopMockRtp() {
  if (rtpInterval) {
    clearInterval(rtpInterval);
    if (rtpInterval._udp) rtpInterval._udp.close();
    rtpInterval = null;
    console.log('[rtp]      Stopped');
  }
}

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/ecp-session') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  console.log('[ws]       Client connected to /ecp-session');

  // Send auth challenge
  const challenge = crypto.randomBytes(16).toString('hex');
  const expectedResponse = computeExpectedResponse(challenge);

  ws.send(JSON.stringify({
    notify: 'authenticate',
    'param-challenge': challenge,
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('[ws]       Received:', msg.request || msg.notify || 'unknown');

      if (msg.request === 'authenticate') {
        if (msg['param-response'] === expectedResponse) {
          console.log('[ws]       Auth SUCCESS');
          ws.send(JSON.stringify({
            response: 'authenticate',
            status: '200',
            'status-msg': 'OK',
          }));
        } else {
          console.log('[ws]       Auth FAILED');
          console.log('[ws]       Expected:', expectedResponse);
          console.log('[ws]       Got:     ', msg['param-response']);
          ws.send(JSON.stringify({
            response: 'authenticate',
            status: '401',
            'status-msg': 'Unauthorized',
          }));
        }
      } else if (msg.request === 'set-audio-output') {
        const target = msg['param-devname'] || msg['param-device-name'] || '';
        audioOutputTarget = target;
        console.log(`[ws]       Audio output set to: ${target}`);

        ws.send(JSON.stringify({
          response: 'set-audio-output',
          status: '200',
          'status-msg': 'OK',
        }));

        // Start sending mock RTP packets
        const [ip, port] = target.split(':');
        if (ip && port) {
          startMockRtp(ip, parseInt(port));
        }
      }
    } catch (e) {
      console.error('[ws]       Parse error:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[ws]       Client disconnected');
    stopMockRtp();
  });
});

// --- CLI ---
if (process.argv.includes('--limited')) {
  limitedMode = true;
  console.log('Running in LIMITED mode (most ECP commands blocked)');
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock Roku ECP server listening on port ${PORT}`);
  console.log(`Device: Mock Roku`);
  console.log(`Apps: ${apps.length}`);
  console.log(`\nTip: Run with --limited to simulate Roku OS 14.1+ Limited mode`);
});
