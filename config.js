// Datos del proyecto de Supabase (panel → Settings → API).
// El "anon key" es público por diseño: lo que protege los datos es la
// seguridad por filas (RLS) + la sesión de cada usuario, no este archivo.
const CONFIG_NUBE = {
  url: 'https://frnuhcgzwipnzvvnejpo.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZybnVoY2d6d2lwbnp2dm5lanBvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MzE1NjgsImV4cCI6MjEwODAwNzU2OH0.r712hyOKMKmGJqXG4x8sh9fcFtd8_-GWZru_aSspzTc'
};

// Para que importar.js (Node) pueda leer esta misma config.
if (typeof module !== 'undefined') module.exports = CONFIG_NUBE;
