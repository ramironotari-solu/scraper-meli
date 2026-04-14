#!/usr/bin/env node
/**
 * One-time MeLi OAuth authorization.
 * Run this once to get a refresh_token saved to .env
 * Usage: node auth.js
 */
require('dotenv').config();
const http = require('http');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.MELI_CLIENT_ID;
const CLIENT_SECRET = process.env.MELI_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/callback';
const PORT = 3000;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ MELI_CLIENT_ID and MELI_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const authUrl =
  `https://auth.mercadolibre.com.ar/authorization` +
  `?response_type=code` +
  `&client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

console.log('\n🔐 MeLi OAuth — one-time setup');
console.log('─'.repeat(60));
console.log('1. Open this URL in your browser:\n');
console.log('   ' + authUrl);
console.log('\n2. Log in and authorize the app.');
console.log('3. You will be redirected to localhost — this page will handle the rest.\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    res.writeHead(400);
    res.end('Authorization failed: ' + (error || 'no code received'));
    server.close();
    process.exit(1);
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    });

    const { data } = await axios.post(
      'https://api.mercadolibre.com/oauth/token',
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // Save tokens to .env
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');

    const set = (key, value) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    };

    set('MELI_ACCESS_TOKEN', data.access_token);
    set('MELI_REFRESH_TOKEN', data.refresh_token);
    set('MELI_TOKEN_EXPIRES_AT', String(Date.now() + data.expires_in * 1000));

    fs.writeFileSync(envPath, envContent, 'utf8');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>✅ Autorizado correctamente. Puedes cerrar esta ventana.</h2>');

    console.log('✅ Token obtenido y guardado en .env');
    console.log(`   Access token: ${data.access_token.substring(0, 30)}...`);
    console.log(`   Expira en: ${data.expires_in / 3600}h`);
    console.log(`   Refresh token: ${data.refresh_token ? 'guardado' : 'no disponible'}`);
    console.log('\nAhora puedes correr el scraper normalmente.\n');
  } catch (err) {
    res.writeHead(500);
    res.end('Token exchange failed: ' + err.message);
    console.error('❌ Token exchange failed:', err.response?.data || err.message);
  }

  server.close();
});

server.listen(PORT, () => {
  console.log(`⏳ Esperando callback en http://localhost:${PORT}...\n`);
});
