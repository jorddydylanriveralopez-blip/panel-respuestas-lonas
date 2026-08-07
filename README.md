# Panel de respuestas · Lonas

Panel en tiempo real para el formulario Fillout de solicitudes de lonas.

## Local

```bash
cp .env.example .env.local
# pega FILLOUT_API_KEY
npm install
npm start
```

Abre http://localhost:3000

## Hostinger (Node.js)

1. Repositorio: `panel-respuestas-lonas`
2. Rama: `main`
3. **Estructura / framework:** Node.js (no Next.js)
4. **Archivo de inicio:** `server.js`
5. **Build:** `npm install` (o vacío)
6. **Start:** `npm start`
7. **Node.js:** 20.x (o 18.x)
8. Variables de entorno:
   - `FILLOUT_API_KEY=...`
   - `FILLOUT_FORM_ID=9LnZ4jfJXnus`

Si Hostinger sigue detectando Next.js, fuerza el framework a Node.js / Custom y usa `server.js` como entrada.
