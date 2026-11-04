import { SetMetadata } from '@nestjs/common';
export const ESCOPO_CLIENTE_ADAPTADO = 'root:cliente:adaptado';
export const ESCOPO_IDENTIDADE_PROPRIA = 'root:cliente:identidade';
/** Somente em métodos cujo serviço já impõe escopo. Nunca marcar o controller. */
export const EscopoClienteAdaptado = () => SetMetadata(ESCOPO_CLIENTE_ADAPTADO, true);
export const IdentidadePropria = () => SetMetadata(ESCOPO_IDENTIDADE_PROPRIA, true);
