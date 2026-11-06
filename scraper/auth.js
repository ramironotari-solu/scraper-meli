#!/usr/bin/env node
/**
 * Get a MeLi app token via client_credentials (no redirect URI needed).
 * Run: node auth.js
 * Token is saved to scraper/.env automatically.
 */
require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const CLIENT_ID     = process.env.MELI_CLIENT_ID;
const CLIENT_SECRET = process.env.MELI_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ MELI_CLIENT_ID and MELI_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

(async () => {
  console.log('\n🔐 Obteniendo token de MeLi (client_credentials)...');

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const { data } = await axios.post(
    'https://api.mercadolibre.com/oauth/token',
    body.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

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

  set('MELI_ACCESS_TOKEN',     data.access_token);
  set('MELI_TOKEN_EXPIRES_AT', String(Date.now() + data.expires_in * 1000));

  fs.writeFileSync(envPath, envContent, 'utf8');

  console.log('✅ Token guardado en scraper/.env');
  console.log(`   Access token: ${data.access_token.substring(0, 30)}...`);
  console.log(`   Expira en: ${data.expires_in / 3600}h\n`);
})().catch((err) => {
  console.error('❌ Error:', err.response?.data || err.message);
  process.exit(1);
});
