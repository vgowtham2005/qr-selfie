let stream = null;
let currentFacing = 'user';
let lastBlobUrl = null;
let videoDevices = [];
let currentDeviceIndex = -1;

const els = {
  video: document.getElementById('video'),
  canvas: document.getElementById('canvas'),
  status: document.getElementById('status'),
  btnPerm: document.getElementById('btn-permissions'),
  btnSwitch: document.getElementById('btn-switch'),
  btnCapture: document.getElementById('btn-capture'),
  result: document.getElementById('result'),
  thumb: document.getElementById('thumb'),
  qrImg: document.getElementById('qrImg'),
  viewLink: document.getElementById('viewLink'),
  btnRetake: document.getElementById('btn-retake'),
  btnOpen: document.getElementById('btn-open'),
  fileInput: document.getElementById('file-fallback'),
  fileLabel: document.getElementById('file-fallback-label'),
};

async function getStream(facingOrDevice){
  if (stream) stopStream();
  const buildFacing = (facing) => ({
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1080 },
      height: { ideal: 1440 }
    }
  });
  const buildDevice = (deviceId) => ({
    audio: false,
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 1080 },
      height: { ideal: 1440 }
    }
  });
  try {
    if (facingOrDevice && typeof facingOrDevice === 'string' && facingOrDevice.startsWith('device:')){
      const id = facingOrDevice.slice('device:'.length);
      stream = await navigator.mediaDevices.getUserMedia(buildDevice(id));
    } else {
      const facing = facingOrDevice || currentFacing || 'user';
      stream = await navigator.mediaDevices.getUserMedia(buildFacing(facing));
    }
  } catch (err) {
    // If facing mode failed, try any available camera device
    try {
      if (videoDevices.length > 0){
        const fallbackId = videoDevices[0].deviceId;
        currentDeviceIndex = 0;
        stream = await navigator.mediaDevices.getUserMedia(buildDevice(fallbackId));
      } else {
        // Last resort: broad request
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    } catch (e2) {
      throw e2;
    }
  }
  els.video.srcObject = stream;
}

function stopStream(){
  if (!stream) return;
  stream.getTracks().forEach(t=>t.stop());
  stream = null;
}

function drawToCanvas(){
  const video = els.video;
  const canvas = els.canvas;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  return canvas;
}

async function uploadBlob(blob){
  const fd = new FormData();
  fd.append('photo', blob, 'selfie.jpg');
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

function setQR(text){
  els.qrImg.src = '/api/qr?text=' + encodeURIComponent(text);
}

function setStatus(msg){
  els.status.textContent = msg;
}

async function enableCamera(){
  try{
    // Prime device list
    try {
      await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (_) { /* ignore */ }
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoDevices = devices.filter(d => d.kind === 'videoinput');

    if (videoDevices.length === 0){
      setStatus('No camera devices found. You can choose an image instead.');
      if (els.fileLabel) els.fileLabel.style.display = '';
      return;
    }

    // Prefer front camera if available
    let preferredIndex = -1;
    for (let i=0;i<videoDevices.length;i++){
      const label = (videoDevices[i].label || '').toLowerCase();
      if (label.includes('front')) { preferredIndex = i; break; }
    }
    currentDeviceIndex = preferredIndex !== -1 ? preferredIndex : 0;
    await getStream('device:' + videoDevices[currentDeviceIndex].deviceId);
    els.btnSwitch.disabled = videoDevices.length <= 1;
    els.btnCapture.disabled = false;
    setStatus('Camera ready.');
  }catch(err){
    console.error(err);
    setStatus('Camera permission denied or unavailable.');
  }
}

els.btnPerm.addEventListener('click', enableCamera);

els.btnSwitch.addEventListener('click', async () => {
  if (videoDevices.length <= 1) return;
  currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
  const dev = videoDevices[currentDeviceIndex];
  try{
    await getStream('device:' + dev.deviceId);
    setStatus(`Switched camera${dev.label ? ': ' + dev.label : ''}`);
  }catch(err){
    console.error(err);
    setStatus('Unable to switch camera.');
  }
});

els.btnCapture.addEventListener('click', async () => {
  const canvas = drawToCanvas();
  if (!canvas){ setStatus('Waiting for camera...'); return; }
  canvas.toBlob(async (blob) => {
    if (!blob){ setStatus('Capture failed.'); return; }
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = URL.createObjectURL(blob);
    try{
      setStatus('Uploading...');
      const { id, viewUrl } = await uploadBlob(blob);
      els.thumb.src = lastBlobUrl;
      els.viewLink.href = viewUrl;
      els.viewLink.textContent = viewUrl;
      els.btnOpen.href = viewUrl;
      setQR(viewUrl);
      els.result.classList.remove('hidden');
      setStatus('Done! Share the QR.');
    }catch(err){
      console.error(err);
      setStatus('Upload failed. Try again.');
    }
  }, 'image/jpeg', 0.9);
});

els.btnRetake.addEventListener('click', () => {
  els.result.classList.add('hidden');
  setStatus('Camera ready.');
});

// Auto-start camera on compatible contexts (localhost is treated secure)
(async () => {
  try{
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1'){
      await enableCamera();
    }
  }catch{}
})();

// Fallback: allow selecting an image file when no camera is available
if (els.fileInput){
  els.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try{
      setStatus('Uploading...');
      const blobUrl = URL.createObjectURL(file);
      if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
      lastBlobUrl = blobUrl;
      const fd = new FormData();
      fd.append('photo', file, file.name || 'photo.jpg');
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Upload failed');
      const { viewUrl } = await res.json();
      els.thumb.src = blobUrl;
      els.viewLink.href = viewUrl;
      els.viewLink.textContent = viewUrl;
      els.btnOpen.href = viewUrl;
      setQR(viewUrl);
      els.result.classList.remove('hidden');
      setStatus('Done! Share the QR.');
    }catch(err){
      console.error(err);
      setStatus('Upload failed. Try again.');
    }
  });
}
