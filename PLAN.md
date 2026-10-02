# Plan de implementación: pi-gather-smart-objects

Estado: decisiones de arquitectura tomadas; implementación pendiente.
Fecha: 2026-10-02.

Este documento sustituye las decisiones de superficie de tools y empaquetado del plan
`~/.nanobot/workspace/plans/pi-extension-gather-objects.md`. Conserva sus restricciones de
seguridad y protocolo, pero adopta **hooks + una sola tool + prompt breve**, según el encargo actual.
Crear este plan no autoriza publicar, modificar credenciales ni detener servicios existentes.

## 1. Objetivo y alcance

Construir un paquete de Pi que:

1. Refleje automáticamente la actividad de Pi en el **estado visual y color** de un Smart Object.
2. Exponga exactamente una tool, `gather_send`, para consultar y controlar objetos configurados:
   nombre, descripción, actividad, contador, interruptor, estado y color.
3. Inyecte un prompt breve que explique cuándo usar esa tool y qué información no publicar.
4. Use `pi-gather-hooks.json`, validado con Valibot, con JSON Schema público generado.
5. Se distribuya precompilado, pequeño y sin dependencias redundantes.
6. Se publique automáticamente en npm desde una GitHub Release, siguiendo los repos de referencia.

### Fuera de alcance de v1

- Crear objetos o cambiar su preset: se hace en el Decorador de Gather.
- Subir iconos, sprites o imágenes. El icono visible depende del preset y de su estado.
- MCP, servidor HTTP, daemon, polling continuo o integración con Telegram.
- Leer prompts, razonamiento o resultados de tools para publicarlos automáticamente.
- Control agregado de múltiples máquinas o de tareas asíncronas de otras extensiones.
- Modificar o parar `chunky-presence` de nanobot.
- Skill y CLI instalador separados: no hacen falta para esta primera versión.

“Scopes” no es una capability documentada de Gather: si se refiere al nombre del objeto,
se modifica con `info.set.name`; no inventar un evento `scope.*` ni permisos configurables del servidor.

## 2. Referencias revisadas y convenciones adoptadas

### Librerías del usuario

Se revisaron README, `package.json`, `.github/workflows/ci.yml`,
`.github/workflows/publish.yml` y `.github/actions/check/action.yml` de:

- https://github.com/dogalyir/oxlint-plugin-golden
- https://github.com/dogalyir/opencode-auto-translate

También se revisó `scripts/generate-schema.ts` de `opencode-auto-translate`.

Patrones observados y adoptados:

- Bun para desarrollo y build; salida ESM compatible con Node.
- `files` como allowlist del tarball: compilado y documentación necesaria.
- CI en pull requests y pushes a `main`, con una acción composite compartida.
- Publicación por `release.published`, checkout del tag y comprobación `tag === v + version`.
- npm Trusted Publishing / OIDC, `id-token: write`, environment `npm`, acceso público.
- Schema público junto al compilado, generado desde el mismo contrato usado en runtime.

Mejoras deliberadas respecto a copiar esos repos literalmente:

- Fijar versiones del toolchain y lockfile; no usar `latest` en CI.
- Empaquetar una vez, probar el tarball real y publicar **ese mismo tarball**.
- No instalar dependencias que ya quedaron incluidas en el bundle.
- No copiar analizadores, framework de tests o hooks Git si no aportan una comprobación necesaria.

### Pi, Gather y Valibot

- API local verificada de Pi 1.0.0: `docs/extensions.md`, `docs/packages.md`,
  `dist/core/extensions/types.d.ts`, `dist/core/system-prompt.d.ts`.
- Ejemplos Pi: `hello.ts`, `prompt-customizer.ts`, `notify.ts`.
- Gather: `~/.nanobot/workspace/skills/gather-smart-objects/references/reference.md`,
  `references/patterns.md` y `scripts/gso.py` como referencia de protocolo.
- https://valibot.dev/guides/json-schema/
- Conversor oficial: `@valibot/to-json-schema`; **Valibot no genera JSON Schema por sí solo**.

La implementación debe comprobar los tipos y comportamiento reales de las versiones fijadas.
El cliente Python es referencia del protocolo, no una dependencia de producción del paquete.

## 3. Decisiones cerradas

| Tema | Decisión |
| --- | --- |
| Paquete | `pi-gather-smart-objects`, ESM, keyword `pi-package` |
| Superficie del modelo | Exactamente una tool directa: `gather_send` |
| Automatización | Hooks de ciclo de vida; activación explícita en configuración |
| Icono | Derivado de `status.set`, no de una propiedad ficticia `icon` |
| Color | `variant.set`, validado contra los colores descubiertos |
| Preset automático v1 | `status`; los demás presets siguen disponibles desde la tool |
| Configuración | JSON estricto global `pi-gather-hooks.json`, sin secretos inline |
| Validación de config | Valibot como única fuente de verdad |
| Schema público | JSON Schema generado durante build, publicado dentro del mismo paquete |
| Parámetros de tool | TypeBox de Pi; no reemplazarlo por Valibot |
| HTTP/firma | SDK oficial Gather, incluida en el bundle; sin Python/subprocesos |
| Estado interno | En memoria, acotado; sin guardar credenciales en el transcript |
| Concurrencia | Cola compartida por objeto para hooks, comando y tool |
| Publicación | GitHub Release → checks → tarball probado → npm OIDC |
| Dependencias instaladas en consumidor | Objetivo: cero dependencias ordinarias; Pi como peer externo |

## 4. Configuración y credenciales

### 4.1 Ubicación y carga

Resolver **un solo archivo**, sin merge implícito:

1. `PI_GATHER_CONFIG`, si está definido, como ruta explícita.
2. En otro caso, `~/.pi/agent/pi-gather-hooks.json`.

Una ruta explícita relativa se resuelve contra el cwd inicial. No buscar automáticamente
configuración del proyecto: evita que un repositorio cambie destinos externos sin consentimiento.
No hardcodear `/home/carmelo`. Cargar en `session_start` y recargar con `/gather reload`.
Sin file watcher. Un reload cancela trabajo obsoleto y reconstruye la configuración validada.

- Archivo ausente: integración inactiva, sin tráfico; `/gather` explica cómo configurarla.
- JSON inválido o propiedades desconocidas: rechazar configuración, no enviar; Pi sigue funcionando.
- `enabled: false`: no publicar ni inyectar prompt; la tool informa que está deshabilitada.
- `$schema` es metadato del editor, nunca una URL que la extensión deba descargar.
- Los diagnósticos muestran claves/rutas de validación, no valores de configuración sensibles.

### 4.2 Ejemplo objetivo

La URL de schema siguiente será válida después de publicar `0.1.0`; aún no se considera existente.

```json
{
  "$schema": "https://unpkg.com/pi-gather-smart-objects@0.1.0/dist/pi-gather-hooks.schema.json",
  "version": 1,
  "enabled": true,
  "defaultObject": "pi",
  "credentialsFile": "~/.pi/agent/gather-objects.env",
  "objects": {
    "pi": {
      "urlEnv": "GSO_PI_URL",
      "secretEnv": "GSO_PI_SECRET"
    }
  },
  "hooks": {
    "enabled": true,
    "object": "pi",
    "modes": ["tui"],
    "states": {
      "ready": { "state": "on", "color": "green" },
      "working": { "state": "working", "color": "blue" },
      "waiting": { "state": "question", "color": "yellow" },
      "error": { "state": "alert", "color": "red" },
      "stopped": { "state": "off", "color": "black" }
    }
  },
  "prompt": { "enabled": true }
}
```

Defaults: `enabled: true` si el archivo existe y es válido; `hooks.enabled: false`;
`hooks.modes: ["tui"]`; `prompt.enabled: true`. Colores opcionales: si se omiten, no modificarlos.
`defaultObject` y `hooks.object` deben referenciar objetos declarados. Objetos normalizados y
nombres de variables ambiguos/duplicados deben producir errores claros.

### 4.3 Secretos

El JSON contiene referencias `urlEnv` y `secretEnv`, nunca `secret`, `token` ni valores `whsec_*`.
Los valores se resuelven de `process.env` sobre el archivo indicado por `credentialsFile`.
Si se omite este campo, usar `~/.pi/agent/gather-objects.env`.

- Formato `.env` mínimo: asignaciones, comentarios, comillas simples/dobles; sin ejecutar shell,
  expandir comandos ni sobrescribir `process.env`.
- Resolver cada par URL/secreto desde una misma fuente completa. Un override de entorno parcial
  se rechaza, evitando mezclar una URL nueva con un secreto antiguo.
- Archivo de credenciales: validar permisos restrictivos en POSIX; rechazar lectura insegura
  con diagnóstico sin valores. Documentar ACL equivalente en otros sistemas.
- Para reutilizar nanobot, configurar explícitamente
  `credentialsFile: "~/.nanobot/gather-smart-objects.env"` y las referencias `GSO_AGENTE_*`.
  No descubrimiento automático ni dependencia oculta de nanobot.
- Nunca guardar secretos/firmas en `content`, `details`, `structuredContent`, logs o errores.
- No volcar objetos `Error`, cliente SDK, request/response completos ni cabeceras firmadas.
- HTTPS y destino Gather permitido; rechazar redirects. Transporte local falso solo en tests
  mediante inyección interna, no como destino arbitrario model-callable.

El secreto no debe ser expuesto **por esta extensión**. Un archivo 600 no aísla el secreto
frente a otras tools que ejecuten código con el mismo usuario: no prometer un sandbox inexistente.
Auditar usando secretos sintéticos; no leer ni imprimir secretos reales durante investigación/tests.

## 5. Hooks: icono y color automáticos

### 5.1 Máquina de estados

| Evento Pi | Comportamiento |
| --- | --- |
| `session_start` | Cargar config; si hooks autorizados, adquirir ownership y descubrir capabilities |
| `agent_start` | Nuevo trabajo: `working`; expira override manual del ciclo anterior |
| `ui_prompt_start` | `waiting` mientras haya prompts bloqueantes de UI abiertos |
| `ui_prompt_end` | Volver al estado efectivo anterior cuando cierre el último prompt |
| `agent_before_settle` | Registrar `outcome` observado; no solicitar continuación ni publicar aquí |
| `agent_settled` | Publicar `ready` o `error`, usando el resultado terminal observado |
| `session_shutdown` | Cancelar pendientes, cierre acotado y liberación idempotente de ownership |

- `agent_end` y `turn_end` **no** significan fin definitivo: puede haber retries/compaction/continuaciones.
- `agent_settled` no trae `outcome`; mantener el valor observado en la frontera previa y probar
  continuaciones iniciadas por otros handlers. Un nuevo `agent_start` reinicia ese resultado.
- Abort solicitado por el usuario → `ready`, no `error`. Fallo terminal → `error`.
- No convertir cada fallo recuperable de tool en una alerta permanente.
- `ui_prompt_*` cubre UI bloqueante de extensiones, no preguntas semánticas del modelo.
- En quit ordenado enviar `stopped` si esta instancia es propietaria. Reload/cambio de sesión
  cancela y transfiere recursos sin un apagado/encendido innecesario; probar cada `reason` real.
- Un kill abrupto no garantiza `off`; sin daemon/TTL del servidor no se puede prometer ese resultado.
- Solo TUI por defecto; RPC/print/json requieren inclusión explícita en `modes`.
- La presencia describe el ciclo de Pi local, no garantiza representar hijos en segundo plano.

### 5.2 Envío eficiente y seguro

- Nada de red, timers, procesos o locks en la fábrica; solo registro.
- Hooks encolan intención y regresan sin esperar una llamada HTTP lenta.
- Worker de sesión supervisado, con errores capturados y shutdown acotado; no promesas abandonadas.
- Coalescer estados automáticos pendientes: enviar el estado más reciente, no toda la historia.
- Dedupe por estado **confirmado**, no por último estado solicitado.
- `status.set` y `variant.set` son dos peticiones, no una transacción. Registrar éxitos parciales
  por separado; reintentar solo lo que falló. Priorizar estado sobre color.
- Cola serial por objeto; límite global pequeño de concurrencia para objetos distintos.
- Ventana inicial de coalescing: 150 ms; separación mínima entre transiciones automáticas: 750 ms.
  Son valores iniciales medibles, no una garantía sobre el rate limit de Gather.
- Timeout inicial de petición 5 s; hasta 3 intentos, dentro del presupuesto de la operación.
  Respetar `Retry-After`/rate limit; coordinar pausa por espacio dentro del proceso.
- SDK es el único dueño del retry de una petición: no multiplicarlo con un segundo bucle.
- No polling ni resync periódico en v1. Reconciliar en nueva actividad, reload o consulta explícita.
- Estado estable: cero peticiones extra. Fallo persistente: diagnóstico local limitado, sin spam.
- Shutdown tiene presupuesto total de 1 s para best-effort; el cierre local no espera indefinidamente.

### 5.3 Ownership y convivencia

El objeto `agente` está siendo escrito por `chunky-presence`. **No activar hooks de Pi contra
ese objeto por defecto.** Recomendación operativa: un objeto `pi` distinto para presencia Pi.
Las tools sí pueden actuar sobre otros objetos, pero se documentará quién controla cada capability.

Dentro de esta librería, usar ownership local exclusivo por endpoint canónico:
lock bajo `~/.pi/agent/`, identidad de proceso/instancia, adquisición atómica, liberación solo por
el propietario y recuperación conservadora de locks huérfanos. No incluir URL completa ni secretos
en el nombre/contenido; usar hash del endpoint. No heartbeat periódico: comprobar liveness al adquirir.

Si otro proceso posee el objeto, hooks quedan en modo observador y se informa al humano.
La tool rechaza cambios de estado/color de un objeto poseído por otra instancia de la librería.
Los locks no coordinan nanobot, clientes externos ni otras máquinas; no afirmar que lo hacen.

## 6. Una sola tool: gather_send

### 6.1 Contrato

```ts
// Esquema conceptual: el discriminador real se llama event.
{ object?: string; event: GatherEvent; data?: EventArguments }
```

- `object` es alias configurado; si falta, usar `defaultObject` explícito.
- Nunca acepta URL de webhook, secreto, firma, preset nuevo ni código a ejecutar.
- `activity.add.data.url` sí es un enlace público permitido del feed; no es el endpoint del webhook.
- `webhook.ping` es un evento válido de **esta misma tool**: no crear `gather_ping` adicional.
- `data` es un objeto cerrado con campos conocidos, no `Unknown` ni JSON libre serializado.
- Para mantener pequeño el esquema enviado al modelo: TypeBox describe `event` como enum y
  `data` como superset cerrado de campos tipados. Un validador por evento exige campos obligatorios,
  rechaza campos ajenos y aplica límites antes de red. Evitar repetir el objeto entero por cada evento.
- Los validadores por evento reutilizan componentes TypeBox; una tabla compacta evento→campos
  describe la relación al modelo y permite errores locales accionables.
- `outputSchema` + `structuredContent` compactos para codemode; `content` y `details` obligatorios.

Eventos soportados:

- `webhook.ping`
- `info.set`, `variant.set`
- `status.set`, `status.reset`, `signal.set`, `signal.reset`
- `switch.set_state`, `switch.toggle`
- `counter.set`, `counter.increment`, `counter.decrement`, `counter.reset`
- `activity.add`, `activity.remove`, `activity.clear`

No hay batch en v1. Un evento por llamada; evita aumentar contratos y complicar errores parciales.
Una sola tool no garantiza por sí misma pocos tokens: medir también el tamaño de su schema.

### 6.2 Descubrimiento y límites

Antes de escribir, el cliente descubre capabilities/colores si no tiene metadata válida.
Cachear metadata por objeto/configuración, TTL inicial 5 min y single-flight de descubrimiento.
Una consulta explícita `webhook.ping` siempre obtiene estado actual; no confundir metadata cacheada
con estado remoto fresco. Invalidar ante cambio de configuración o `capability_not_declared`.

Validar antes de red: textos, IDs, enteros, enums, enlaces, capability y catálogo de colores.
Medir el **envelope completo** serializado en UTF-8: máximo 4096 bytes, incluyendo timestamp.
Los límites individuales no sustituyen el límite total; tests con caracteres multibyte.

- Leer `error` del body, no deducirlo solo por HTTP 404.
- Reconocer `space_idle` como aceptación, no fallo.
- Ante `not_found`: diagnóstico seguro de reloj, URL, secreto y serialización.
- No reintentar 4xx salvo rate limit; conservar `webhook-id` en retry del mismo evento.
- Deduplicación del servidor acotada: no prometer exactly-once ni replay seguro indefinido.
- Feed: mantener IDs estables y no publicar datos confidenciales.
- Respuesta al modelo acotada: resumen, capabilities, colores y hasta 5 entradas, con marca
  explícita de truncado y límite total inicial 8 KiB. No volcar el ping completo en `details`.
- Datos remotos del feed se tratan como datos no confiables, nunca como instrucciones del sistema.

### 6.3 Annotations y permisos

La tool mezcla lectura y mutación; usar hints conservadores:
`readOnlyHint: false`, `openWorldHint: true`, `destructiveHint: true`, `idempotentHint: false`.

**Corrección del análisis anterior:** retries con el mismo `webhook-id` no hacen idempotente
una nueva invocación con los mismos argumentos. `counter.increment` y `switch.toggle` tienen
nuevos efectos; `activity.clear` elimina datos. No etiquetar la tool como idempotente.
Con una sola tool, extensiones de permisos pueden pedir confirmación incluso para ping.
Es el coste aceptado de reducir la superficie; documentarlo, no eludir permisos.

### 6.4 Prioridad entre tool y hooks

Toda escritura pasa por el mismo coordinador. Sobre el objeto de presencia:

- Una escritura explícita de `status` pausa automatización de estado para el ciclo actual.
- Una escritura explícita de `variant` pausa automatización de color para el ciclo actual.
- La pausa se establece al aceptar la intención validada; se reconcilia con el resultado de envío.
  Descartar intents automáticos pendientes para esa capability y ordenar los que ya estén en vuelo.
- Reanudar en el próximo `agent_start` o `/gather auto resume`.
- `info` y `activity` no pausan presencia; no son capabilities propiedad de los hooks.
- Para un color persistente, modificar la configuración y recargar; no esconder persistencia en la tool.

Una respuesta de la tool informa brevemente si creó un override temporal y cuándo expira.
No sobrescribir `question`/`alert` explícito al cerrar inmediatamente ese mismo ciclo.

## 7. Prompt y comando humano

Usar `before_agent_start` y `event.systemPromptOptions.sections.gather_smart_objects`.
No reemplazar `systemPrompt`, no añadir XML manual, no inyectar mensajes artificiales por transición.

Condiciones: configuración válida/habilitada, `prompt.enabled` y `gather_send` activa.
Si deja de aplicar, retirar la sección. Construirla con una función pura compartida con `/gather debug`.

Texto objetivo (adaptar la frase de automatización cuando hooks estén apagados):

> Usa gather_send cuando te pidan controlar Gather o publicar un hito autorizado.
> Los hooks gestionan el estado y color de presencia; no los dupliques por rutina.
> webhook.ping consulta el objeto; info.set cambia nombre/descripción y activity.add publica
> con id estable. El feed es visible para toda la oficina: nunca secretos ni contenido privado.

Menos de 500 caracteres; sin listas enormes de eventos, credenciales, transcript ni estado cambiante.
Tool disponible no significa autorización para publicar todo el trabajo del usuario.

`/gather` no es una segunda tool y no consume un schema del modelo. Subcomandos mínimos:

- Sin argumentos: configuración, alias, preset conocido, ownership y automatización; sin ping automático.
- `ping <objeto>`: consulta explícita para diagnóstico.
- `debug`: tools activas, sección que se inyectaría, estado interno seguro, última entrega y métricas.
- `reload`: recarga validada sin reiniciar Pi.
- `auto pause` / `auto resume`: control de la automatización de esta sesión.

`debug` muestra lo que se construiría; **no prueba por sí solo** que el prompt enviado lo contenga.
Tests de integración deben observar el prompt/transcript efectivo con y sin la tool activa.

## 8. Valibot y publicación del JSON Schema

- `src/config/schema.ts`: schema declarativo Valibot, objetos estrictos, descripciones y defaults.
- Inferir tipos de ese schema; no mantener una interfaz de configuración paralela.
- `scripts/generate-schema.ts`: usar `@valibot/to-json-schema` y emitir
  `dist/pi-gather-hooks.schema.json`, target JSON Schema draft-07 por compatibilidad de editores.
  Verificar soporte exacto del target con la versión fijada del conversor.
- `$id` versionado y export `./schema.json`; referencia CDN inmutable por versión, no `@latest` en ejemplos.
- No usar transforms opacas o refinamientos no exportables para restricciones estructurales.
- Validaciones entre campos (alias existente, endpoint permitido, permisos, preset/colores remotos)
  son runtime y se documentan: JSON Schema no puede garantizar acceso a archivos ni a Gather.
- Generación determinista; test de paridad sobre fixtures válidos/inválidos entre Valibot y JSON Schema.
- Conversor y validador JSON Schema de tests solo en desarrollo; no runtime Ajv/Zod ni descarga de schema.
- Publicar schema dentro de la misma versión npm; no segundo paquete ni servidor de schemas.

## 9. Build, dependencias y contenido publicado

### 9.1 Estrategia

Compilar con Bun a ESM `--target node`, tree-shaking y minificación. El usuario de Pi no necesita
Bun para ejecutar la extensión ni TypeScript para compilarla al instalar desde npm.

Incluir en el bundle:

- Código propio.
- Solo los módulos usados de Valibot.
- SDK oficial `@gathertown/webhook-object-sdk` y sus dependencias de ejecución necesarias.

Mantener externos:

- `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` y cualquier otro paquete aportado
  por Pi que realmente se importe (`typebox`, etc.). Nunca duplicar el runtime del host.
- Builtins `node:*`.

El SDK es la decisión base, no reimplementar firma solo por reducir unos KB. Primera comprobación
obligatoria: build real, compatibilidad Node, cancelación/timeout, redirects, retry, tamaño y licencias.
Si algún contrato no es soportado, documentar el bloqueo/adaptador necesario antes de seguir.
No afirmar que todos esos controles existen solo porque la SDK firma correctamente.

### 9.2 Clasificación de dependencias

- `peerDependencies`: únicamente paquetes Pi usados, rango `"*"` según contrato del host.
  Compatibilidad comprobada de Pi se documenta y se prueba en CI, sin bundlear los peers.
- `devDependencies`: TypeScript, tipos, Bun tooling, Valibot, SDK, conversor, linters y tests.
  Valibot/SDK son dependencias de ejecución **incluidas en el artefacto**, por eso no se reinstalan.
- `dependencies`: vacío mientras todo tercero ordinario esté incluido. Si queda un import externo
  no aportado por Pi, debe declararse aquí y justificarse; CI debe detectar esa situación.
- Fijar versiones y `bun.lock`. Retirar TypeScript de peers (hoy está allí por el scaffold).
- Sin `postinstall` ni `prepare` para compilar en el equipo consumidor.
- `prepack` ejecuta el build reproducible (schema + JS + avisos de licencia necesarios).

### 9.3 Manifest y tarball

```json
{
  "name": "pi-gather-smart-objects",
  "version": "0.1.0",
  "type": "module",
  "keywords": ["pi-package", "gather", "smart-objects"],
  "main": "./dist/gather.js",
  "exports": {
    ".": "./dist/gather.js",
    "./schema.json": "./dist/pi-gather-hooks.schema.json"
  },
  "pi": { "extensions": ["./dist/gather.js"] },
  "files": ["dist/gather.js", "dist/pi-gather-hooks.schema.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"],
  "publishConfig": { "access": "public" }
}
```

Fragmento orientativo: completar descripción, repository, scripts y peers durante implementación.
No prometer un repositorio remoto hasta crearlo/confirmarlo. Licencia propuesta MIT, revisar
atribuciones de dependencias empaquetadas antes del primer release.

No publicar fuentes, tests, planes, credenciales, fixtures, lockfile, caches ni source maps con
contenido local. No emitir `.d.ts` si no hay API pública de librería más allá de la extensión y el schema.
No incluir skill en v1. `package.json` es parte implícita del tarball.

Desarrollo: `pi --extension ./src/gather.ts`.
Paquete local: `bun install` + build, después `pi -e .`.
Npm: `pi install npm:pi-gather-smart-objects`.
Instalación `git:` no es objetivo soportado de v1 si `dist` no está en Git; no anunciarla hasta
probar una estrategia que no requiera scripts de instalación ni commit de artefactos.

### 9.4 Optimización verificable

“Optimizado” se prueba, no se promete como porcentaje absoluto:

| Métrica | Objetivo inicial |
| --- | --- |
| Tools declaradas | Exactamente 1 |
| Sección añadida | < 500 caracteres |
| Schema + descripción de tool | Objetivo <= 8 KiB UTF-8; reportar tokens con modelo/tokenizador identificado |
| Importaciones runtime ordinarias externas | 0 |
| Bundle ESM | Objetivo <= 150 KiB sin comprimir |
| Tarball completo | Objetivo <= 100 KiB comprimido |
| Fábrica | Sin I/O, procesos, timers ni red |
| Red en idle estable | 0 peticiones periódicas |
| Ping previo | Compartido por llamadas concurrentes; cache metadata, no estado fresco |
| Una transición | 0, 1 o 2 POST según estado/color realmente cambiados |
| Publicación | Un tarball validado; sin doble build accidental |

Medir baseline con SDK real antes de fijar budgets finales en CI. Si se excede, analizar imports,
licencias/schema/docs y ajustar justificadamente; no eliminar validación o seguridad por tamaño.
Registrar también latencia de carga sin red y encolado de hooks, sin prometer tiempos absolutos
independientes de hardware. Dedupe y coalescing no se aplican a incrementos ni entradas explícitas distintas.

## 10. Estructura propuesta

```text
src/
  gather.ts                  # registro de extensión, sin recursos en fábrica
  config/
    schema.ts                # contrato Valibot
    load.ts                  # JSON, credenciales, validación segura
  gather/
    client.ts                # adaptador SDK, abort, límites, sanitización
    events.ts                # catálogo y validación TypeBox por evento
    discovery.ts             # metadata cache + single-flight
  runtime/
    coordinator.ts           # colas, dedupe, overrides, shutdown
    presence.ts              # máquina de estados pura + bindings de hooks
    ownership.ts             # exclusión local por objeto
  tool.ts                    # única gather_send
  prompt.ts                  # función pura, condicionada a tools activas
  commands.ts                # /gather
scripts/
  build.ts
  generate-schema.ts
  verify-package.ts
  report-size.ts
test/
  config.test.ts
  protocol.test.ts
  presence.test.ts
  tool.test.ts
  prompt.test.ts
  ownership.test.ts
  package.test.ts
.github/
  actions/check/action.yml
  workflows/ci.yml
  workflows/publish.yml
PLAN.md
README.md
LICENSE
package.json
bun.lock
```

No crear interfaces/capas adicionales sin un consumidor o un test que las justifique.

## 11. CI y publicación automática

### 11.1 Checks compartidos

CI en PR y push a `main`; workflow de publicación usa la misma acción composite.
Versiones de Node/Bun/npm fijadas, compatibles con el Pi probado y con npm Trusted Publishing.
Usar revisiones verificadas de actions; idealmente fijar SHA y actualizar con automatización.

Orden del gate:

1. `bun install --frozen-lockfile`.
2. Typecheck estricto (`noEmit`), formato y lint con herramientas locales fijadas.
3. Tests unitarios/integración, sin secretos reales ni acceso a Gather.
4. `npm pack --json`: `prepack` genera schema/build; capturar ruta del `.tgz` y checksum.
5. Inspeccionar allowlist, tamaño e imports; extraer/instalar tarball en directorio temporal.
6. Smoke en Node y host Pi fijado, sin dependencia accidental de `src`/devDependencies del repo.
   Validar carga de extensión, única tool, manifest y schema exportado.
7. Guardar reporte de checks, tamaños, checksum y tarball como artifacts.

El checkout de desarrollo puede usar Bun; el smoke del artefacto debe funcionar bajo Node.
No reutilizar `node_modules` del repo como prueba de que el consumidor no necesita dependencias.
Instalar explícitamente Pi como host en el smoke; los peers del host no cuentan como runtime duplicado.
No se necesita llamar a un LLM de pago para comprobar registro, hooks o prompt efectivo.

Scripts mínimos: `typecheck`, `lint`, `test`, `generate:schema`, `build`, `prepack`,
`check`, `verify:package`, `report:size`. Evitar que `check` vuelva a empaquetar recursivamente.

### 11.2 Publish

- Trigger `release: types: [published]`; no publicar cada push a `main`.
- Checkout del tag del release, no de HEAD posterior.
- Permisos `contents: read`, `id-token: write`; environment `npm`.
- Validar tag `vX.Y.Z` vs versión de paquete antes del trabajo costoso.
- Ejecutar gate completo; publicar la ruta `.tgz` comprobada con `npm publish <tarball>`
  (acceso público y provenance explícito/validado según versión npm).
- No ejecutar un segundo build ni publicar el directorio en lugar del tarball inspeccionado.
- Stable → dist-tag `latest`; prerelease → dist-tag `next`, sin mover `latest`.
- Exclusión de publicaciones concurrentes; no cancelar a mitad de una publicación activa.
- Si versión ya existe, fallar claramente sin intentar sobrescribir ni incrementar automáticamente.
- Tras publicar, comprobar versión, integrity/provenance y accesibilidad del schema versionado
  con espera acotada por propagación. Un fallo postpublish no implica que no se haya publicado.

### 11.3 Preparación única del mantenedor

- Confirmar/crear repo y permiso sobre el nombre npm `pi-gather-smart-objects`.
- Configurar Trusted Publisher npm con owner/repo reales, workflow `publish.yml`, environment `npm`.
- Resolver bootstrap del primer paquete según soporte npm vigente (los repos revisados documentan
  primer publish manual); no prometer OIDC inicial sin verificarlo.
- No guardar `NPM_TOKEN` permanente ni secretos Gather en Actions.
- Configurar protección de `main` y checks requeridos.

Bump y release siguen siendo decisiones del mantenedor; “automático” aquí significa que publicar
el GitHub Release dispara toda la verificación y distribución. No crear tags/releases en esta tarea.

## 12. Fases y criterios de aceptación

### Fase 0 — Contratos y build mínimo

- [ ] Fijar versiones de Pi/SDK/Valibot/conversor y toolchain.
- [ ] Probar SDK: firma, retry, cancelación, timeout, redirects, límite body y compatibilidad Node.
- [ ] Medir bundle mínimo real; comprobar externals Pi y avisos de licencias.
- [ ] Confirmar que la forma compacta del schema de tool es aceptada por Pi.

### Fase 1 — Configuración y transporte

- [ ] Config JSON estricta, defaults, referencias env, resolución determinista y sin secrets inline.
- [ ] Generación reproducible del schema y fixtures de paridad estructural.
- [ ] Protocol tests con secretos sintéticos: firma sobre bytes exactos y mismo ID en retry.
- [ ] Errores saneados; `space_idle`, 429/5xx, `not_found`, WAF y fallos de red cubiertos.
- [ ] Rechazo local >4096 bytes y validación de límites multibyte.

### Fase 2 — Tool única y prompt

- [ ] `gather_send` registrada una sola vez; ningún `gather_ping`/`gather_status` adicional.
- [ ] Todos los eventos validados y operaciones no idempotentes preservadas.
- [ ] Ping explícito fresco; auto-discovery cacheado/single-flight; colores inválidos rechazados.
- [ ] Resultados estructurados acotados y sin filtración en ningún canal.
- [ ] Prompt efectivo presente/ausente al activar/excluir `gather_send`, <500 caracteres.
- [ ] `/gather debug`, ping y reload funcionan sin depender de respuestas del modelo.

### Fase 3 — Hooks y coordinación

- [ ] Estado/color desde hooks, sin calls del modelo ni lectura del contenido de la conversación.
- [ ] Fin real por `agent_settled`; retries/compaction no producen falsos estados finales.
- [ ] UI prompts anidados/concurrentes, abort y error terminal con transiciones probadas.
- [ ] Override explícito de estado/color no se pisa al terminar el mismo ciclo.
- [ ] Sin spam por tool calls, sin polling; colas ordenadas y fallos parciales independientes.
- [ ] Lock local: adquisición simultánea, propietario vivo, lock huérfano, cleanup y reload.
- [ ] Hooks apagados/no config/headless no autorizado → cero POST automático.
- [ ] Shutdown/reload/new/resume/fork: sin timers, workers o escrituras obsoletas después del cierre.
- [ ] No tocar `chunky-presence`; segundo objeto recomendado para smoke real.

### Fase 4 — Paquete y releases

- [ ] Tarball solo incluye allowlist; schema coincide con versión publicada.
- [ ] Runtime Node desde tarball limpio; sin imports externos ordinarios no declarados.
- [ ] Sin peers Pi duplicados ni TypeScript requerido en producción.
- [ ] Tamaños/contexto reportados y budgets finales aprobados con baseline.
- [ ] CI y workflow publish comparten checks; tag inválido bloquea publicación.
- [ ] Trusted Publisher configurado por mantenedor; publicación del mismo tarball probado.
- [ ] README: instalación, config/schema, secretos, hooks, única tool, permisos, overrides,
  múltiples sesiones, límites, troubleshooting y mantenimiento/publicación.

### Smoke real — solo con autorización y objeto de pruebas

1. Ping y guardar snapshot seguro del objeto elegido (sin secreto).
2. Verificar cambio de estado/icono y color por hooks durante un ciclo controlado.
3. Verificar `info.set` y `activity.add` con ID de test; actualizar mismo ID sin duplicar.
4. Eliminar únicamente la entrada de test y restaurar nombre/descripción/estado/color previos.
5. Verificar errores esperados sin rotar secretos de producción ni vaciar feeds ajenos.

La aceptación no exige exactamente 11 colores ni un UUID concreto: esos datos pertenecen al
objeto actual, no al producto genérico. Usar fixtures de presets y validar el catálogo real descubierto.

## 13. Entrega y definición de terminado

Entregar código, README, schema, tests, workflow y reporte de ejecución con evidencias reales:
comandos, resultados, tamaños, archivos del tarball, dependencias externas y limitaciones residuales.

La implementación se considera lista cuando los gates locales/CI y el smoke de tarball pasan.
La publicación se considera operativa solo después de configurar npm/GitHub y verificar un release
real autorizado. Si no se hizo smoke Gather o publish real, declararlo pendiente, no marcarlo hecho.

Este plan no modifica el servicio nanobot, no publica nada y no crea credenciales.
