import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ZodError, ZodIssue } from 'zod';
import { Prisma } from '@prisma/client';
import {
  ERROR_STATUS,
  type ErrorCode,
  type FieldError,
  type ProblemDetails,
} from '@techpioasset/contracts';
import {
  IllegalTransitionError,
  AutomatedApprovalError,
  describeAssetStatusRefusal,
  type AssetStatus,
} from '@techpioasset/domain';
import { AppError } from '../errors/app-error.js';
import { getRequestContext } from '../request-context.js';
import { redactSecrets } from '../logging/redact.js';

const PROBLEM_BASE = 'https://techpioasset.dev/errors';

/**
 * Structural check rather than `instanceof ZodError`.
 *
 * Schemas are defined in @techpioasset/contracts, which carries its own Zod
 * dependency. When the package manager resolves two copies, the error thrown by
 * a contracts schema is not an instance of the API's ZodError class, and an
 * `instanceof` check silently degrades every validation failure into a 500.
 * Shape-checking survives duplicate copies and major-version differences alike.
 */
function isZodError(error: unknown): error is ZodError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

const TITLES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'Validation failed',
  UNAUTHENTICATED: 'Authentication required',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  CONFLICT: 'Conflict',
  SEAT_LIMIT_EXCEEDED: 'License limit exceeded',
  RATE_LIMITED: 'Too many requests',
  INTERNAL_ERROR: 'Internal server error',
};

/**
 * Single exit point for every error, emitted as RFC 9457 problem+json.
 *
 * Two rules matter here. Internal detail (stack traces, Prisma messages, SQL) is
 * logged but never returned - spec section 20 forbids leaking sensitive values.
 * And every response carries the request id so a user can quote it in a ticket.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const ctx = getRequestContext();

    const { code, status, title, detail, errors, logLevel, internal } = this.classify(exception);

    const problem: ProblemDetails = {
      type: `${PROBLEM_BASE}/${code.toLowerCase().replace(/_/g, '-')}`,
      title,
      status,
      code,
      requestId: ctx?.requestId ?? 'req_unknown',
      timestamp: new Date().toISOString(),
      ...(detail ? { detail } : {}),
      ...(request?.url ? { instance: request.url } : {}),
      ...(errors?.length ? { errors } : {}),
    };

    // Redact before logging: internal context is developer-controlled, but a
    // defect could route a credential through it, and the URL can carry a query
    // string. This is the last line of defence per spec section 20.
    const logContext = redactSecrets({
      requestId: problem.requestId,
      correlationId: ctx?.correlationId,
      method: request?.method,
      path: request?.url,
      code,
      ...internal,
    });

    if (logLevel === 'error') {
      this.logger.error(
        `${code} ${request?.method ?? ''} ${request?.url ?? ''} ${JSON.stringify(logContext)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${code} ${request?.method ?? ''} ${request?.url ?? ''}`);
    }

    response.status(status).type('application/problem+json').send(problem);
  }

  private classify(exception: unknown): {
    code: ErrorCode;
    status: number;
    title: string;
    detail?: string;
    errors?: FieldError[];
    logLevel: 'warn' | 'error';
    internal?: Record<string, unknown>;
  } {
    if (exception instanceof AppError) {
      return {
        code: exception.code,
        status: exception.status,
        title: TITLES[exception.code] ?? exception.message,
        detail: exception.detail ?? exception.message,
        errors: exception.fieldErrors,
        logLevel: exception.status >= 500 ? 'error' : 'warn',
        internal: exception.internalContext,
      };
    }

    if (isZodError(exception)) {
      return {
        code: 'VALIDATION_FAILED',
        status: ERROR_STATUS.VALIDATION_FAILED,
        title: 'Validation failed',
        detail: 'One or more fields are invalid.',
        errors: exception.issues.map((issue: ZodIssue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
        logLevel: 'warn',
      };
    }

    if (exception instanceof IllegalTransitionError) {
      return {
        code: 'ILLEGAL_STATE_TRANSITION',
        status: ERROR_STATUS.ILLEGAL_STATE_TRANSITION,
        title: 'That status change is not allowed',
        // v3.13 - for an asset, the next step in words ("Use Return first")
        // instead of "Illegal AssetStatus transition: IN_USE -> AVAILABLE".
        detail:
          exception.machine === 'AssetStatus'
            ? describeAssetStatusRefusal(exception.from as AssetStatus, exception.to as AssetStatus)
            : exception.message,
        logLevel: 'warn',
      };
    }

    if (exception instanceof AutomatedApprovalError) {
      return {
        code: 'AUTOMATED_APPROVAL_FORBIDDEN',
        status: ERROR_STATUS.AUTOMATED_APPROVAL_FORBIDDEN,
        title: 'Human approval required',
        detail: exception.message,
        logLevel: 'warn',
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.classifyPrisma(exception);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode =
        status === HttpStatus.UNAUTHORIZED
          ? 'UNAUTHENTICATED'
          : status === HttpStatus.FORBIDDEN
            ? 'FORBIDDEN'
            : status === HttpStatus.NOT_FOUND
              ? 'NOT_FOUND'
              : status === HttpStatus.TOO_MANY_REQUESTS
                ? 'RATE_LIMITED'
                : status === HttpStatus.PAYLOAD_TOO_LARGE
                  ? 'PAYLOAD_TOO_LARGE'
                  : status === HttpStatus.UNSUPPORTED_MEDIA_TYPE
                    ? 'UNSUPPORTED_MEDIA_TYPE'
                    : status >= 500
                      ? 'INTERNAL_ERROR'
                      : 'VALIDATION_FAILED';
      return {
        code,
        status,
        title: TITLES[code] ?? exception.message,
        detail: status >= 500 ? undefined : exception.message,
        logLevel: status >= 500 ? 'error' : 'warn',
      };
    }

    // Unrecognised: assume a defect, log loudly, tell the client nothing.
    return {
      code: 'INTERNAL_ERROR',
      status: ERROR_STATUS.INTERNAL_ERROR,
      title: 'Internal server error',
      detail: 'An unexpected error occurred. Quote the request id when reporting this.',
      logLevel: 'error',
    };
  }

  private classifyPrisma(error: Prisma.PrismaClientKnownRequestError): {
    code: ErrorCode;
    status: number;
    title: string;
    detail?: string;
    logLevel: 'warn' | 'error';
    internal?: Record<string, unknown>;
  } {
    const target = (error.meta?.target as string[] | string | undefined) ?? undefined;
    const targetText = Array.isArray(target) ? target.join(', ') : target;

    switch (error.code) {
      case 'P2002': {
        // Unique constraint. Map the specific business rules the spec names so the
        // client can react, rather than surfacing a generic 409.
        const code: ErrorCode = targetText?.includes('serialNumber')
          ? 'DUPLICATE_SERIAL_NUMBER'
          : targetText?.includes('assetTag')
            ? 'DUPLICATE_ASSET_TAG'
            : targetText?.includes('invoiceNumber')
              ? 'DUPLICATE_INVOICE_NUMBER'
              : targetText?.includes('sha256')
                ? 'DUPLICATE_DOCUMENT'
                : 'CONFLICT';
        return {
          code,
          status: ERROR_STATUS[code],
          title: 'Conflict',
          detail: 'A record with these values already exists.',
          logLevel: 'warn',
          internal: { prismaCode: error.code, target: targetText },
        };
      }
      case 'P2025':
        return {
          code: 'NOT_FOUND',
          status: ERROR_STATUS.NOT_FOUND,
          title: 'Not found',
          detail: 'The requested record does not exist.',
          logLevel: 'warn',
        };
      case 'P2003':
        return {
          code: 'CONFLICT',
          status: ERROR_STATUS.CONFLICT,
          title: 'Conflict',
          detail: 'A related record is missing or still in use.',
          logLevel: 'warn',
          internal: { prismaCode: error.code, target: targetText },
        };
      default:
        return {
          code: 'INTERNAL_ERROR',
          status: ERROR_STATUS.INTERNAL_ERROR,
          title: 'Internal server error',
          detail: 'A database error occurred.',
          logLevel: 'error',
          internal: { prismaCode: error.code },
        };
    }
  }
}
