# Rolas

App web personal tipo Spotify para escuchar música de YouTube, con una sección de **Salud** para el gym, la dieta, el sueño y el progreso físico. Funciona en el navegador y se instala en Android desde Brave.

**Demo:** https://w0rmd4rk.github.io/rolas/ (requiere cuenta; el registro está cerrado)

## Funciones

**Música**
- Búsqueda de canciones con la YouTube Data API y reproducción con el reproductor oficial de YouTube.
- Interfaz tipo Spotify: mini reproductor, pantalla de reproducción, cola, aleatorio y repetir.
- Reproducción continua: al acabarse la búsqueda o la cola, agrega más canciones.
- Música en segundo plano y controles en la notificación de Android (en Brave).
- Modo ahorro de datos: video a 144p e imágenes reducidas.
- Playlists, "Escuchado recientemente" y un **Mix del gym** basado en lo que más escuchas.

**Salud**
- **Gym:** rutinas por día con series, repeticiones, variantes (dropset, unilateral, biserie…) y explicación; sesión de entrenamiento con temporizador de descanso, aviso con vibración y resumen; registro de pesos mínimos y máximos por ejercicio.
- **Comida:** protocolos por mes, comidas con calorías y consumo diario.
- **Dormir:** temporizador que baja el volumen poco a poco y detiene la música.
- **Progreso:** calendario de constancia, medidas corporales personalizables (peso, IMC, pliegues…) y gráficas de medidas, fuerza y calorías.

## Tecnologías

- HTML, CSS y JavaScript sin frameworks ni proceso de build.
- YouTube IFrame Player API y YouTube Data API v3.
- Supabase: autenticación (JWT) y PostgreSQL con Row Level Security.
- GitHub Pages para el hosting y service worker para instalarla como app (PWA).

## Seguridad

- **Autenticación** con Supabase (contraseñas con hash bcrypt, sesiones con JWT) y **registro de cuentas cerrado**.
- **Row Level Security:** cada usuario solo puede leer y modificar su propia fila; los visitantes sin sesión no tienen ningún permiso sobre la tabla.
- **Restricciones en la base de datos** de tamaño y formato de los datos.
- **Content-Security-Policy** sin scripts en línea: solo se permiten scripts del propio sitio, de YouTube y de la librería de Supabase.
- **Validación y escapado** de todo dato que entra (archivos importados, nube, navegador) para prevenir XSS.
- La clave de Supabase incluida en el código es la *publishable key*, pública por diseño. La API key de YouTube no está en el código: cada usuario la guarda en su cuenta.

## Configuración

1. **GitHub Pages:** Settings → Pages → Source: "Deploy from a branch" → rama `main`, carpeta `/ (root)`.
2. **Supabase:** crear un proyecto, ejecutar los scripts SQL de la tabla `user_data` (con RLS), configurar en Authentication → URL Configuration la URL del sitio, y poner la Project URL y la publishable key en `app.js`.
3. **YouTube Data API v3:** crear una clave en Google Cloud, restringirla al dominio del sitio y a esa API, y pegarla en Rolas → Ajustes.
4. **Instalar en Android:** abrir el sitio en Brave → ⋮ → "Instalar app" y verificar que los Shields estén activos.

## Estructura

| Archivo | Contenido |
|---|---|
| `index.html` | Estructura, estilos y Content-Security-Policy |
| `app.js` | Toda la lógica de la app |
| `sw.js` | Service worker |
| `manifest.json`, `icon-*.png` | Instalación como app |
| `CLAUDE.md` | Guía del proyecto para Claude Code |

## Aviso

Proyecto personal sin fines de lucro. La música se reproduce únicamente con el reproductor oficial de YouTube; la app no descarga ni extrae audio.
