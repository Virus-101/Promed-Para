'use strict';
// One-time: creates the update signing key pair.
//   private key -> C:\Users\<you>\PromedPara-keys\update-private.pem   (NEVER copy it to the USB kit, the till or GitHub)
//   public key  -> build\update-public.pem                              (shipped to the till inside config\update.json)
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const keyDir = path.join(os.homedir(), 'PromedPara-keys');
const privatePath = path.join(keyDir, 'update-private.pem');
const publicPath = path.join(__dirname, 'update-public.pem');
if (fs.existsSync(privatePath)) { console.log('Key already exists, not touching it:', privatePath); process.exit(0); }
fs.mkdirSync(keyDir, { recursive: true });
const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
fs.writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(publicPath, pair.publicKey.export({ type: 'spki', format: 'pem' }));
console.log('Private key:', privatePath);
console.log('Public key :', publicPath);
