# M2 Publisher · Cloudflare Workers Free

**Estado:** versión programada en GitHub. No se ha desplegado, no hay cuenta Cloudflare conectada ni publicaciones realizadas desde esta app.

M2 Publisher administra posts de Instagram **@maqued2** sin el límite de Metricool. Usa Cloudflare Workers Cron cada 15 minutos y Cloudflare D1 para conservar una cola única, incluyendo noches y fines de semana. No necesita un proceso Python encendido permanentemente.

## Funciones implementadas

- Panel privado móvil en español con login y cookie firmada HttpOnly/Secure/SameSite=Strict.
- Guarda cada noticia con clave única, fuente verificable, fecha de origen y crédito/autorización de imágenes.
- Tres imágenes públicas HTTPS diferentes para cada carrusel, ya alojadas fuera de la app.
- Horarios :00/:15/:30/:45; D1 impide reservar dos noticias para la misma hora o clave editorial.
- Estados: QUEUED, CLAIMED, VERIFYING, PUBLISHED, QUOTA_PAUSED, REVIEW_REQUIRED, MISSED, CANCELLED.
- Publicación por la API oficial de Instagram solo si se activa explícitamente; antes verifica la identidad @maqued2 y consulta la cuota oficial.
- Marca PUBLISHED solo si devuelve permalink auténtico de Instagram.
- Ante error de resultado incierto no reintenta y solicita revisión para evitar duplicados.

## Limitaciones relevantes

Este primer Worker **NO investiga las noticias ni edita diseños automáticamente en Canva**. Recibe carruseles previamente preparados. Esa integración editorial se añade más adelante. **No añade música nativa** a los carruseles de fotos: la API no soporta ese paso. **No tiene un botón OAuth** en el panel: la autorización oficial de Meta debe realizarse antes del despliegue y el token debe guardarse en secretos del servidor.

Cloudflare Free y D1 Free tienen límites publicados: consulta https://developers.cloudflare.com/workers/platform/limits/ y https://developers.cloudflare.com/d1/platform/pricing/ . Esta variante no exige contratar R2: las imágenes deben estar en URLs HTTPS públicas duraderas con derechos de publicación; una URL temporal que caduque no es adecuada. La cuota de Meta también limita la cantidad de posts. No se pueden prometer 96 publicaciones diarias sin verificarla ni asegurar ejecución puntual de un cron.

## Instalación en Cloudflare Free

1. El titular crea su cuenta en https://dash.cloudflare.com/sign-up ; selecciona y verifica Workers Free.
2. Descarga/clona la rama feature/m2-publisher de https://github.com/Danifloo/Start ; entra en la carpeta m2-cloudflare usando una computadora con Node.js 22 o superior.
3. Ejecuta: npm install
4. Autoriza Cloudflare con: npx wrangler login
5. Crea D1: npx wrangler d1 create m2-publisher-db
6. Copia wrangler.toml.example a wrangler.toml; reemplaza REPLACE_WITH_YOUR_D1_DATABASE_ID por el database_id real devuelto por D1.
7. Aplica la estructura: npx wrangler d1 execute m2-publisher-db --remote --file=./schema.sql
8. Establece secretos privados (nunca GitHub):
   - npx wrangler secret put ADMIN_PASSWORD   (contraseña única de 16 caracteres o más)
   - npx wrangler secret put SESSION_SECRET   (cadena aleatoria privada de 32 caracteres o más)
9. Ejecuta: npx wrangler deploy ; comprueba la URL workers.dev, /health y el panel privado.
10. Crea o autoriza una integración oficial de Meta para una cuenta Instagram profesional con permisos suficientes; conserva el token según las reglas de renovación de Meta. Establece:
   - npx wrangler secret put IG_USER_ID
   - npx wrangler secret put IG_ACCESS_TOKEN
11. Solo tras verificar el ID, los permisos, cuota y autorización de una publicación de prueba, cambia en wrangler.toml PUBLISHING_ENABLED = "true" y ejecuta npx wrangler deploy de nuevo.
12. Programa una noticia real con tres imágenes autorizadas para una franja futura. Comprueba el permalink auténtico de Instagram en el panel. **No activar noticias de relleno ni duplicadas.**

**Nota:** la app no puede registrarse por sí misma en Cloudflare ni pedir permisos de Meta a nombre del usuario; ambos exigen una acción explícita del titular. GitHub solo almacena el código y realiza pruebas, no aloja el programador de forma permanente.

## Seguridad

El repositorio Danifloo/Start es público. Nunca publiques ADMIN_PASSWORD, SESSION_SECRET, IG_ACCESS_TOKEN, archivos .env o credenciales en issues, código ni chats. El panel permite una contraseña privada; para mayor protección, activa Cloudflare Access y limitación de intentos de acceso cuando la cuenta lo permita. Los envíos con respuesta incierta de Meta se ponen en revisión en lugar de reintentarse. Los slots omitidos por más de 15 minutos se marcan MISSED.

## Pruebas y archivos

Ejecuta: node --test tests/*.test.mjs

GitHub Actions ejecuta esas pruebas sin credenciales; la publicación real debe probarse después con la cuenta autorizada. Los archivos son src/index.js (worker), src/ui.js (panel), schema.sql (base D1), wrangler.toml.example (configuración), tests/worker.test.mjs (pruebas), package.json (comandos).

## Derechos

Únicamente fotografías reales y autorizadas con créditos. El contenido publicado debe corresponder a hechos comprobados con fuentes confiables. Esta app no elude los límites de Meta ni publica contenido dentro de ChatGPT.
