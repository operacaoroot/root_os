-- O runtime recebe apenas o endereço do state; a linha e o verifier continuam sob RLS.
CREATE FUNCTION public.app_resolver_bio_oauth(p_estado text)
RETURNS TABLE(id text, "orgId" text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT s.id, s."orgId" FROM public."BioOauthState" s
  WHERE s.estado = p_estado
    AND (public.app_org_atual() = '__resolucao_publica__'
      OR (public.app_org_resolvida() AND s."orgId" = public.app_org_atual()))
$$;
REVOKE ALL ON FUNCTION public.app_resolver_bio_oauth(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_resolver_bio_oauth(text) TO mktos_app;
