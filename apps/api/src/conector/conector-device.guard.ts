import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConectorService, ConnectorDeviceIdentity } from './conector.service';

@Injectable()
export class ConectorDeviceGuard implements CanActivate {
  constructor(private readonly conector: ConectorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization as string | undefined;
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Sem credencial do conector.');
    const device = await this.conector.resolverDispositivo(authorization.slice(7));
    request.connectorDevice = device;
    return true;
  }
}

export function conectorDeviceFrom(request: { connectorDevice?: ConnectorDeviceIdentity }): ConnectorDeviceIdentity {
  if (!request.connectorDevice) throw new UnauthorizedException('Credencial do conector ausente.');
  return request.connectorDevice;
}
