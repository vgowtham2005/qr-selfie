import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();
const BASE_URL = `http://${LOCAL_IP}:${PORT}`;

const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');

for (const dir of [PUBLIC_DIR, UPLOADS_DIR, DATA_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadManifest() {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}
function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}
let manifest = loadManifest();

app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

// Prevent favicon 404 noise
app.get('/favicon.ico', (req, res) => res.status(204).end());

const storage = multer.memoryStorage();
const upload = multer({ storage });

const mimeToExt = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif'
};

app.post('/api/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    const id = nanoid(10);
    const ext = mimeToExt[req.file.mimetype] || path.extname(req.file.originalname) || '.jpg';
    const filename = id + ext;
    const filepath = path.join(UPLOADS_DIR, filename);

    await fs.promises.writeFile(filepath, req.file.buffer);

    manifest[id] = { filename, createdAt: Date.now() };
    saveManifest(manifest);

    const viewUrl = `${BASE_URL}/view/${id}`;
    return res.json({ id, viewUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/api/meta/:id', (req, res) => {
  const { id } = req.params;
  const rec = manifest[id];
  if (!rec) return res.status(404).json({ error: 'Not found' });
  const imageUrl = `/uploads/${rec.filename}`;
  const viewUrl = `${BASE_URL}/view/${id}`;
  res.json({ id, imageUrl, viewUrl });
});

// Server-side QR code generation
app.get('/api/qr', async (req, res) => {
  const text = req.query.text || '';
  if (!text) return res.status(400).send('Missing text');
  try {
    const buf = await QRCode.toBuffer(text, { width: 256, margin: 1 });
    res.setHeader('Content-Type', 'image/png');
    res.send(buf);
  } catch (e) {
    res.status(500).send('QR generation failed');
  }
});

app.get('/view/:id', (req, res) => {
  const { id } = req.params;
  const rec = manifest[id];
  if (!rec) return res.status(404).send('Not found');
  const viewUrl = `${req.protocol}://${req.get('host')}/view/${id}`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>QR Selfie Viewer</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header>
    <a href="/" class="brand">QR Selfie</a>
  </header>
  <main>
    <section class="viewer">
      <img id="photo" alt="Selfie" />
      <div>
        <h2>Scan this QR</h2>
        <img id="qrImg" alt="QR code" />
        <p><a id="link" target="_blank" rel="noopener">Open link</a></p>
      </div>
    </section>
  </main>
  <script>
    (async () => {
      const res = await fetch('/api/meta/${id}');
      if (!res.ok) return;
      const meta = await res.json();
      document.getElementById('photo').src = meta.imageUrl;
      document.getElementById('link').href = meta.viewUrl;
      document.getElementById('link').textContent = meta.viewUrl;
      const qrImg = document.getElementById('qrImg');
      qrImg.src = '/api/qr?text=' + encodeURIComponent(meta.viewUrl);
    })();
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Accessible at ${BASE_URL}`);
});
