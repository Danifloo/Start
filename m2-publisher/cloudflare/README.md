# M2 Publisher — Cloudflare Free

Aplicación privada para programar **posts/carruseles** de Instagram **@maqued2** en los minutos **00, 15, 30 y 45**, hora **America/New_York**, con **Cloudflare Workers + D1** y GitHub. Independiente del límite mensual de Metricool; **no evita los límites de la API oficial de Meta**.

**Estado actual: código preparado y probado, NO desplegado y NO conectado a Instagram.** La publicación está **deshabilitada por defecto** (`ENABLE_PUBLISHING=false`), no hay credenciales Meta en el código ni en GitHub. Un cron no equivale a una publicación realizada. La primera versión **no investiga noticias ni genera diseños en Canva automáticamente**; admite carruseles de fotos que ya hayas preparado con licencias y fuentes. Más adelante se puede integrar un módulo editorial automatizado.

## Características

- Interfaz móvil privada de una sola cuenta; contraseña larga, cookie HttpOnly/SameSite, HMAC, control de origen y límite de intentos fallidos.
- D1: noticias, fuentes, derechos de imágenes, cuatro slots/hora, estado y registro; titular y fuente no se duplican.
- Cron `*/15 * * * *` en **UTC**: intervalos :00/:15/:30/:45 también en Nueva York, incluso cuando cambia al horario de invierno.
- Solo procesa posts a su hora (tolera un retraso máximo de 12 minutos). Un slot vencido queda `MISSED`, no se publica tarde por accidente.
- Envíos seguros: `SCHEDULED → SENDING → VERIFYING → PUBLISHED`; cuando Meta da error ambiguo, queda `REVIEW` y no se reintenta automáticamente. Solo se confirma `PUBLISHED` con enlace directo real `instagram.com/p/...`.
- Identidad exacta @maqued2 y cuota oficial de Meta comprobadas antes de cada publicación (no se fija arbitrariamente un máximo de 50/100). Si no están disponibles, no publica.
- Opcional: fotos JPG/PNG autorizadas subidas desde Android a un bucket **R2** configurado por el usuario. La URL de medios se sirve directamente desde el Worker. Si no se habilita R2, introduce fotos desde alojamiento HTTPS público estable. No uses URLs temporales de exportación de Canva que caduquen.
- Pantalla de cuota, estado de la cola, cancelación y reprogramación de publicaciones bloqueadas antes del envío.

## Coste y límites

Workers Free incluye cuotas de solicitudes y CPU, y D1 Free cuotas diarias de lecturas/escrituras y almacenamiento. No se garantiza servicio infalible ni una publicación cada 15 minutos al segundo exacto. Meta limita las publicaciones por periodo de 24 horas; nuestra app consulta la cuota real disponible antes de publicar. **Crear/activar R2 podría exigir configurar facturación**, por lo que es opcional y debe comprobarse antes de utilizarlo.

Documentación oficial: [Workers Free límites](https://developers.cloudflare.com/workers/platform/limits/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [D1](https://developers.cloudflare.com/d1/platform/pricing/).

## Cómo instalar en Cloudflare sin contratar planes pagados

1. Regístrate personalmente con tu correo en [Cloudflare](https://dash.cloudflare.com/sign-up), escoge **Free**. El asistente no puede abrir una cuenta en tu nombre ni conocer tus credenciales. Al desplegar, revisa cualquier pantalla de facturación y no autorices cargos que no quieras.
2. En GitHub, conserva este código en una rama separada de tus otros proyectos y descarga/clona el repositorio. Necesitas **Node.js 20+** en un ordenador o un entorno de desarrollo en la nube que lo ejecute. Entra a `m2-publisher/cloudflare`.
3. `npm install`, `npx wrangler login` (autoriza tu cuenta Cloudflare) y `npx wrangler d1 create m2-publisher-db`.
4. Sustituye `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID` en `wrangler.jsonc` por el `database_id` real devuelto por Cloudflare.
5. `npx wrangler d1 migrations apply m2-publisher-db --remote` para crear las tablas D1 y **después** `npx wrangler deploy`. Cloudflare devuelve una URL `https://m2-publisher-free.<subdominio>.workers.dev`.
6. Protege el panel: ejecuta `npx wrangler secret put ADMIN_PASSWORD` y establece una contraseña aleatoria de al menos 16 caracteres; `npx wrangler secret put SESSION_SECRET` para una cadena aleatoria de 32+ caracteres. Al terminar prueba abrir la URL en Android e iniciar sesión. Estas credenciales son **solo del panel**, no de Instagram. **No las escribas en el chat ni las subas a GitHub.**
7. En [Meta for Developers](https://developers.facebook.com/), crea/configura una aplicación autorizada para Instagram Content Publishing con los permisos adecuados y cuenta profesional. Tras realizar el proceso oficial, configura `npx wrangler secret put IG_USER_ID` y `npx wrangler secret put IG_ACCESS_TOKEN`. Hay requisitos de Meta que dependen del tipo de cuenta y revisión de la aplicación. Esta versión NO tiene un botón de OAuth de Instagram: la autorización inicial se realiza en Meta. Verifica cuenta y cuota desde el panel.
8. Con el Worker ya protegido, Meta autorizada, imágenes HTTPS persistentes y cuota suficiente, realiza una **prueba controlada** con una noticia verificada. Comprueba que el enlace final aparece en el panel. Solo después cambia `ENABLE_PUBLISHING` a `true` en `wrangler.jsonc` y despliega otra vez (`npx wrangler deploy`). De no hacerlo, **no se publicará nada**; esto es intencional. **Nota:** la prueba real también requiere habilitar publishing temporalmente; hazlo solo con una publicación autorizada y vuelve a desactivarlo si se detecta cualquier problema.
9. Opcional R2: si decides habilitarlo tras revisar condiciones y cualquier método de pago requerido, crea el bucket `m2-publisher-media` en Cloudflare, agrega en `wrangler.jsonc` una sección `"r2_buckets":[{"binding":"MEDIA","bucket_name":"m2-publisher-media"}]`, y redespliega. El panel permitirá subir imágenes desde el teléfono. Los archivos son públicos vía URL aleatoria porque Instagram debe descargarlos para publicar.

### Antes de activar publicación real

- El entorno debe funcionar con HTTPS público; no publiques desde un Worker de pruebas ni con una cuenta equivocada.
- Comprueba que las fotos sean auténticas y con derechos adecuados, que todas las fuentes estén verificadas y que no repitas noticias. El panel no verifica automáticamente la fiabilidad de las noticias ni las licencias de las fotos: requiere proceso editorial externo.
- La entrega de Cron puede retrasarse. Tras 12 minutos de retraso, una publicación queda en `MISSED` para evitar contenido publicado fuera de horario.
- Si aparece `REVIEW` después de `media_publish`, comprueba manualmente Instagram. Nunca reenvíes el mismo post sin confirmar que no existe.
- Si Meta no devuelve datos de cuota (`content_publishing_limit`), la app bloquea el envío. Algunos endpoints/permisos varían entre modalidades de login de Instagram; hay que ajustar la configuración oficial correspondiente antes de habilitar la cola.

## Pruebas sin cuentas ni pagos

```sh
node --version
npm test
npm run check
python3 test/schema_test.py
```

Para simular Cron localmente después de configurar tu D1 local:

```sh
npx wrangler d1 migrations apply m2-publisher-db --local
npx wrangler dev --test-scheduled
# Otra terminal: curl 'http://localhost:8787/cdn-cgi/local/scheduled'
```

**Seguridad:** variables reales exclusivamente en **Workers Secrets**. No publicar `.dev.vars`, `.env`, `IG_ACCESS_TOKEN`, `SESSION_SECRET` ni contraseñas en repositorios, comentarios o capturas. El repositorio `Danifloo/Start` es público: la app usa autenticación privada, pero el código es visible a terceros.
