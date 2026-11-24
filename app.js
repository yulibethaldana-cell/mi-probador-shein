const personInput = document.querySelector('#personPhoto');
const garmentInput = document.querySelector('#garmentPhoto');
const personPreview = document.querySelector('#personPreview');
const garmentPreview = document.querySelector('#garmentPreview');
const tryButton = document.querySelector('#tryButton');
const resetButton = document.querySelector('#resetButton');
const statusText = document.querySelector('#status');
const resultSection = document.querySelector('#result');
const resultImage = document.querySelector('#resultImage');
const downloadResult = document.querySelector('#downloadResult');
const accessCodeInput = document.querySelector('#accessCode');

let personUrl = '';
let garmentUrl = '';
let isWorking = false;

function setStatus(message, kind = '') {
  statusText.textContent = message;
  statusText.className = `status ${kind}`.trim();
}

function updateButton() {
  tryButton.disabled = isWorking || !personInput.files?.[0] || !garmentInput.files?.[0] || !accessCodeInput.value.trim();
}

function showPreview(input, image, which) {
  const file = input.files?.[0];
  if (!file) {
    updateButton();
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    input.value = '';
    setStatus('Elige una imagen JPG, PNG o WEBP.');
    updateButton();
    return;
  }
  if (file.size > 30 * 1024 * 1024) {
    input.value = '';
    setStatus('La imagen supera 30 MB. Elige una más pequeña.');
    updateButton();
    return;
  }

  const url = URL.createObjectURL(file);
  if (which === 'person') {
    if (personUrl) URL.revokeObjectURL(personUrl);
    personUrl = url;
  } else {
    if (garmentUrl) URL.revokeObjectURL(garmentUrl);
    garmentUrl = url;
  }
  image.src = url;
  image.hidden = false;
  const card = image.closest('.upload-card');
  card.querySelector('.symbol').hidden = true;
  card.querySelector('small').hidden = true;
  resultSection.hidden = true;
  setStatus('Foto cargada. Cuando estén las dos, podrás generar el resultado.');
  updateButton();
}

// FASHN accepts data URIs. Resize only enough to keep uploads within Netlify's
// request limit while retaining useful detail for virtual try-on.
async function imageToDataUri(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('No se pudo leer una de las fotos. Prueba con JPG o PNG.');
  }

  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    bitmap.close?.();
    throw new Error('Tu navegador no pudo preparar la imagen.');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  let quality = 0.9;
  let dataUri = canvas.toDataURL('image/jpeg', quality);
  while (dataUri.length > 1_950_000 && quality > 0.65) {
    quality -= 0.07;
    dataUri = canvas.toDataURL('image/jpeg', quality);
  }
  if (dataUri.length > 1_950_000) {
    throw new Error('La foto sigue siendo demasiado pesada. Elige una imagen más pequeña.');
  }
  return dataUri;
}

async function callTryOnFunction(payload, accessCode) {
  const response = await fetch('/.netlify/functions/tryon', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-app-access-code': accessCode
    },
    body: JSON.stringify(payload)
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('El servidor respondió de una forma inesperada. Revisa que la página esté publicada con Netlify.');
  }
  if (!response.ok) {
    throw new Error(data.error || 'No se pudo conectar con FASHN AI.');
  }
  return data;
}

async function generateTryOn() {
  if (isWorking) return;
  const accessCode = accessCodeInput.value.trim();
  if (!accessCode) {
    setStatus('Escribe el código privado configurado en Netlify.');
    return;
  }
  if (!personInput.files?.[0] || !garmentInput.files?.[0]) return;

  isWorking = true;
  updateButton();
  resetButton.disabled = true;
  resultSection.hidden = true;
  try {
    setStatus('Preparando las fotos…');
    const [modelImage, productImage] = await Promise.all([
      imageToDataUri(personInput.files[0]),
      imageToDataUri(garmentInput.files[0])
    ]);

    setStatus('Enviando las fotos a FASHN AI…');
    const started = await callTryOnFunction({ action: 'start', modelImage, productImage }, accessCode);
    if (!started.id) throw new Error('FASHN no devolvió un identificador de generación.');

    const startedAt = Date.now();
    let completed = false;
    while (Date.now() - startedAt < 120_000) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const current = await callTryOnFunction({ action: 'status', id: started.id }, accessCode);
      if (current.status === 'completed') {
        const output = Array.isArray(current.output) ? current.output[0] : null;
        if (typeof output !== 'string' || !output.startsWith('data:image/')) {
          throw new Error('FASHN terminó, pero no entregó la imagen en el formato esperado.');
        }
        resultImage.src = output;
        downloadResult.href = output;
        resultSection.hidden = false;
        setStatus('¡Listo! Tu conjunto se generó correctamente.', 'success');
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        completed = true;
        break;
      }
      if (current.status === 'failed') {
        throw new Error(current.error || 'FASHN no pudo generar esta imagen. Prueba con otras fotos.');
      }
      setStatus('FASHN está trabajando en tu imagen. Esto puede tardar un poco…');
    }
    if (!completed) throw new Error('La generación tardó demasiado. Vuelve a intentarlo más tarde.');
  } catch (error) {
    setStatus(error?.message || 'Ocurrió un problema al generar la imagen.', 'error');
  } finally {
    isWorking = false;
    resetButton.disabled = false;
    updateButton();
  }
}

function clearPhotos() {
  if (isWorking) return;
  personInput.value = '';
  garmentInput.value = '';
  [personPreview, garmentPreview].forEach(image => {
    image.hidden = true;
    image.removeAttribute('src');
    const card = image.closest('.upload-card');
    card.querySelector('.symbol').hidden = false;
    card.querySelector('small').hidden = false;
  });
  if (personUrl) URL.revokeObjectURL(personUrl);
  if (garmentUrl) URL.revokeObjectURL(garmentUrl);
  personUrl = '';
  garmentUrl = '';
  resultImage.removeAttribute('src');
  downloadResult.removeAttribute('href');
  resultSection.hidden = true;
  setStatus('Escribe tu código privado y elige las dos fotografías.');
  updateButton();
}

personInput.addEventListener('change', () => showPreview(personInput, personPreview, 'person'));
garmentInput.addEventListener('change', () => showPreview(garmentInput, garmentPreview, 'garment'));
accessCodeInput.addEventListener('input', updateButton);
tryButton.addEventListener('click', generateTryOn);
resetButton.addEventListener('click', clearPhotos);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
