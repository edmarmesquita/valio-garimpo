-- Executar no mesmo banco de public.produtos usado pelo Valiô principal.
-- Não publica, desativa, exclui ou muda dados comerciais dos produtos.
BEGIN;
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS home_oferta_mode text NOT NULL DEFAULT 'auto';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'produtos_home_oferta_mode_check'
      AND conrelid = 'public.produtos'::regclass
  ) THEN
    ALTER TABLE public.produtos ADD CONSTRAINT produtos_home_oferta_mode_check
      CHECK (home_oferta_mode IN ('auto', 'fixada', 'fila'));
  END IF;
END $$;
COMMIT;
