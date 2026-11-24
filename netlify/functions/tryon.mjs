const FASHN_API_URL = 'https://api.fashn.ai/v1';
const MAX_BODY_BYTES = 5_500_000;
const MAX_DATA_URI_LENGTH = 1_950_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function messageFrom(data, fallback) {
  if (typeof data?.error === 'string') return data.error;
  if (typeof data?.error?.message === 'string') return data.error.message;
  if (typeof data?.message === 'string') return data.message;
  return fallback;
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Usa el método POST.' }, 405);

  const expectedCode = process.env.APP_ACCESS_CODE;
  const suppliedCode = request.headers.get('x-app-access-code') || '';
  if (!expectedCode) {
    return json({ error: 'Falta configurar APP_ACCESS_CODE en las variables de Netlify.' }, 503);
  }
  if (suppliedCode !== expectedCode) {
    return json({ error: 'El código privado no coincide. Comprueba el código configurado en Netlify.' }, 403);
  }

  const apiKey = process.env.FASHN_API_KEY;
  if (!apiKey) {
    return json({ error: 'Falta configurar FASHN_API_KEY en Netlify. La clave no debe escribirse en esta página.' }, 503);
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return json({ error: 'No se pudo leer la solicitud.' }, 400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ error: 'Las fotos pesan demasiado para enviarlas juntas. Reduce su tamaño e inténtalo de nuevo.' }, 413);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'La solicitud no tiene un formato válido.' }, 400);
  }

  try {
    if (body.action === 'start') {
      const { modelImage, productImage } = body;
      const validImage = (value) => typeof value === 'string'
        && value.length <= MAX_DATA_URI_LENGTH
        && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value);
      if (!validImage(modelImage) || !validImage(productImage)) {
        return json({ error: 'Las fotos no tienen un formato válido. Selecciona de nuevo ambas imágenes.' }, 400);
      }

      const response = await fetch(`${FASHN_API_URL}/run`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model_name: 'tryon-max',
          inputs: {
            model_image: modelImage,
            product_image: productImage,
            resolution: '1k',
            generation_mode: 'quality',
            num_images: 1,
            output_format: 'jpeg',
            return_base64: true
          }
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return json({ error: messageFrom(data, `FASHN respondió con el código ${response.status}.`) }, 502);
      if (!data.id) return json({ error: 'FASHN no devolvió el identificador de la generación.' }, 502);
      return json({ id: data.id });
    }

    if (body.action === 'status') {
      const predictionId = body.id;
      if (typeof predictionId !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(predictionId)) {
        return json({ error: 'El identificador de generación no es válido.' }, 400);
      }
      const response = await fetch(`${FASHN_API_URL}/status/${encodeURIComponent(predictionId)}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return json({ error: messageFrom(data, `FASHN respondió con el código ${response.status}.`) }, 502);
      if (!data.status) {
        return json({ error: messageFrom(data, 'FASHN no devolvió el estado de la generación.') }, 502);
      }
      if (data.status === 'failed') {
        return json({ status: 'failed', error: messageFrom(data, 'FASHN no pudo generar la imagen.') });
      }
      return json({ status: data.status, output: data.output || null });
    }

    return json({ error: 'Acción no reconocida.' }, 400);
  } catch {
    return json({ error: 'No se pudo conectar con FASHN. Comprueba la conexión e inténtalo de nuevo.' }, 502);
  }
};
