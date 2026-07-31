import { SetMetadata } from '@nestjs/common';
import type { ResourceType } from './approvals.service';

// Marca um handler de escrita como sensível: o ApprovalGuard passa a exigir um
// x-approval-token confirmado e casado com a mutação. O tipo diz qual recurso é.
export const SENSITIVE_WRITE_KEY = 'sensitive_write_resource';
export const SensitiveWrite = (resourceType: ResourceType) =>
  SetMetadata(SENSITIVE_WRITE_KEY, resourceType);
