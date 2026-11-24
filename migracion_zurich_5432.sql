BEGIN;

CREATE TABLE IF NOT EXISTS zr.departamentos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(10) UNIQUE NOT NULL,
    nombre VARCHAR(50) UNIQUE NOT NULL
);

INSERT INTO zr.departamentos (codigo, nombre) VALUES
    ('CBBA', 'Cochabamba'),
    ('SCZ',  'Santa Cruz'),
    ('LPZ',  'La Paz'),
    ('ORU',  'Oruro'),
    ('PTS',  'Potosí'),
    ('TJA',  'Tarija'),
    ('CHQ',  'Chuquisaca'),
    ('BEN',  'Beni'),
    ('PND',  'Pando')
ON CONFLICT (nombre) DO UPDATE SET codigo = EXCLUDED.codigo;

ALTER TABLE zr.sucursales 
ADD COLUMN IF NOT EXISTS departamento_id INTEGER REFERENCES zr.departamentos(id);

ALTER TABLE zr.sucursales 
ADD COLUMN IF NOT EXISTS departamento TEXT DEFAULT 'Cochabamba';

-- Asignar Santa Cruz a Landivar
UPDATE zr.sucursales
SET departamento_id = (SELECT id FROM zr.departamentos WHERE codigo = 'SCZ'),
    departamento = 'Santa Cruz'
WHERE lower(codigo) = 'landivar' OR lower(nombre) LIKE '%landivar%';

-- Asignar Cochabamba al resto
UPDATE zr.sucursales
SET departamento_id = (SELECT id FROM zr.departamentos WHERE codigo = 'CBBA'),
    departamento = 'Cochabamba'
WHERE departamento_id IS NULL;

ALTER TABLE zr.sucursales 
ALTER COLUMN departamento_id SET NOT NULL;

-- Actualizar vista api.sucursales
CREATE OR REPLACE VIEW api.sucursales AS
SELECT s.id,
    s.codigo,
    s.nombre,
    s.telefono,
    s.regenta,
    s.direccion,
    s.horario,
    s.dias_ruta,
    s.activa,
    s.erp_codigo,
    s.tipo,
    s.tope_diario,
    s.departamento_id,
    COALESCE(d.nombre, s.departamento) AS departamento
FROM zr.sucursales s
LEFT JOIN zr.departamentos d ON d.id = s.departamento_id;

COMMIT;
