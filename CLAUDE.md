# Rolas

App web personal tipo Spotify (música de YouTube) con una sección de Salud (gym, comida, dormir y progreso).
Publicada con GitHub Pages en https://w0rmd4rk.github.io/rolas/ desde la rama `main`. Se usa en Android desde Brave.

Responde y escribe todo (textos de la interfaz, mensajes de commit y explicaciones) en español de México.

## Archivos

- `index.html`: estructura, estilos y la Content-Security-Policy (meta tag).
- `app.js`: toda la lógica. No hay build ni dependencias que instalar; es JavaScript plano.
- `sw.js`: service worker (red primero, caché de respaldo). Si agregas archivos al shell, súbele la versión a `CACHE`.
- `manifest.json`, `icon-192.png`, `icon-512.png`: instalación como app.

## Servicios

- **YouTube IFrame Player API** con `host: 'https://www.youtube.com'`. No cambiarlo a youtube-nocookie: con youtube.com, Brave mantiene la música en segundo plano.
- **YouTube Data API v3** para búsquedas. La API key la pone el usuario en Ajustes y se guarda en Supabase; nunca va en el código.
- **Supabase** (auth con correo y contraseña, tabla `public.user_data` con RLS). `SUPABASE_URL` y la publishable key en `app.js` son públicas por diseño. Nunca agregar la secret key ni la service_role.
- Columnas de `user_data`: `library`, `recents`, `api_key`, `fitness` (jsonb), `updated_at`.

## Reglas que no se deben romper

1. Seguridad: todo texto que se muestre pasa por `esc()`; todo dato que entra (importado, de la nube o del navegador) pasa por las funciones `clean*` (`cleanTrack`, `cleanLibrary`, `cleanFitness`). Los IDs de video se validan con `ID_RE`.
2. CSP: no usar scripts en línea ni `onclick=` en el HTML; todo el JavaScript va en `app.js`. Si se agrega un dominio externo, actualizar la CSP en `index.html`.
3. No usar herramientas ni servicios para descargar o extraer audio de YouTube (yt-dlp, y2mate, Invidious, etc.). La música solo se reproduce con el reproductor oficial.
4. No subir al repo archivos con datos personales (planes `.json` de rutina o dieta, medidas): el repo es público.
5. Mantener el ahorro de datos (`dataSaver`): el video se queda del tamaño de la miniatura para que YouTube use 144p.
6. El audio silencioso (`keep`) existe para que Android muestre anterior/siguiente en la notificación; no quitarlo.

## Cómo trabajar

- Cambios pequeños y enfocados, con un mensaje de commit claro en español que diga qué cambió.
- Antes de terminar, revisar que `app.js` no tenga errores de sintaxis (`node --check app.js`).
- Explicar al final qué cambió y cómo probarlo en el celular.
