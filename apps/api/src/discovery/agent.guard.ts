import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AgentEnrolmentService } from './agent-enrolment.service.js';

/**
 * The identity an enrolled laptop reports under. Deliberately NOT an AuthUser:
 * an agent is not a person, holds no permissions, and can reach exactly one
 * endpoint.
 */
export interface AgentPrincipal {
  companyId: string;
  deviceAgentId: string;
  machineId: string;
}

/**
 * v2.13 — bearer auth for the inventory agent.
 *
 * The whole point of this guard is what it refuses to be: agents are installed
 * on hundreds of laptops that walk out of the building, so shipping an
 * administrator's credential with them would put estate-wide read/write on
 * every desk. A device credential is minted per machine at enrolment, is
 * accepted only here, and carries no permissions at all — the report endpoint
 * pins the payload to `machineId`, so a stolen agent token can overwrite one
 * laptop's own inventory and nothing else.
 *
 * Revocation is a column, not a deletion: unenrolling a laptop leaves the row
 * (and its history) while the credential stops working immediately.
 *
 * Guards run after body parsing but BEFORE validation pipes, so a bad
 * credential is always a 401 (agents re-enrol only on 401), and the raw body
 * is available to attribute the refusal to a laptop.
 */
@Injectable()
export class AgentGuard implements CanActivate {
  constructor(private readonly enrolment: AgentEnrolmentService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      body?: unknown;
      agent?: AgentPrincipal;
    }>();
    const header = request.headers['authorization'];
    const raw = typeof header === 'string' ? header : '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
    if (!token) throw new UnauthorizedException('The agent must present its device credential');

    const device = await this.enrolment.authenticateDevice(token);
    // One message for "unknown" and "revoked" alike: a revoked agent must not
    // learn that its credential was ever valid.
    if (!device) {
      const body = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<
        string,
        unknown
      >;
      const headerMachineId = request.headers['x-agent-machine-id'];
      await this.enrolment.recordRejection({
        machineId: body.machineId ?? (typeof headerMachineId === 'string' ? headerMachineId : undefined),
        serialNumber: body.serialNumber,
      });
      throw new UnauthorizedException('Unknown device credential');
    }

    request.agent = {
      companyId: device.companyId,
      deviceAgentId: device.id,
      machineId: device.machineId,
    };
    return true;
  }
}
