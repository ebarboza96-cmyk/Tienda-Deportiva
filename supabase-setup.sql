-- ============================================================
-- Tienda Deportiva — esquema para sincronizar en la nube
-- Pegá TODO esto en Supabase: menú "SQL Editor" -> "New query"
-- -> pegar -> botón "Run". Se ejecuta una sola vez.
-- ============================================================

-- 1) Tabla que guarda TODO el estado privado (apartados, ventas,
--    inventario, precios y ajustes) en una sola fila.
create table if not exists public.store_state (
  id          text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 2) Seguridad: NADIE anónimo puede leer ni escribir.
--    Así los apartados y ventas quedan privados aunque el sitio
--    sea público.
alter table public.store_state enable row level security;

-- 3) Permisos: solo usuarios autenticados (el dueño que inició
--    sesión) pueden leer y guardar.
drop policy if exists "lectura autenticada" on public.store_state;
create policy "lectura autenticada"
  on public.store_state for select to authenticated using (true);

drop policy if exists "insertar autenticado" on public.store_state;
create policy "insertar autenticado"
  on public.store_state for insert to authenticated with check (true);

drop policy if exists "actualizar autenticado" on public.store_state;
create policy "actualizar autenticado"
  on public.store_state for update to authenticated using (true) with check (true);

-- 4) Activar "tiempo real" para que los cambios se vean al
--    instante en los otros dispositivos.
alter publication supabase_realtime add table public.store_state;
