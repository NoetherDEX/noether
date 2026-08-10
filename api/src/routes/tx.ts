import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TxBuildContext } from '@noether/tx-builders';
import {
  TxSubmitService,
  type TxSubmitOpts,
  type TxSubmitOutcome,
} from '../services/txSubmit.js';

interface SubmitBody {
  signedXdr: string;
  pollTimeoutMs?: number;
}

export interface TxSubmitLike {
  submit(signedXdr: string, opts?: TxSubmitOpts): Promise<TxSubmitOutcome>;
}

export interface TxRoutesDeps {
  txCtx: TxBuildContext;
  /** Test override that mirrors TxSubmitService. */
  submitService?: TxSubmitLike;
}

const RETRY_AFTER_SEC = 2;

const CONTRACT_ERROR_SCHEMA = {
  type: ['object', 'null'],
  properties: {
    code: { type: 'integer' },
    name: { type: 'string' },
  },
} as const;

/** Set when the host aborted outside contract code, e.g. a resource overrun,
 *  which carries no contract error number and used to surface as null. */
const HOST_ERROR_SCHEMA = {
  type: ['object', 'null'],
  properties: {
    type: { type: 'string' },
    code: { type: 'string' },
  },
} as const;

export async function registerTxRoutes(app: FastifyInstance, deps: TxRoutesDeps): Promise<void> {
  const service = deps.submitService ?? new TxSubmitService(deps.txCtx);

  app.post<{ Body: SubmitBody }>(
    '/v1/tx/submit',
    {
      preHandler: app.requireAuth,
      schema: {
        description:
          'Submit a signed Soroban transaction (base64 XDR) and poll until SUCCESS, FAILED, or ' +
          'pollTimeoutMs (default 30s). Resubmitting the same XDR is idempotent: a DUPLICATE is ' +
          'polled by hash and the prior result returned. When the RPC queue is full the response ' +
          'is 503 with a Retry-After header. FAILED transactions include the decoded Noether ' +
          'contract error number + name when one is present in the diagnostic events, and ' +
          '`hostError` when the host aborted outside contract code (a resource overrun reports ' +
          'type "budget", code "exceeded_limit") — previously such failures carried no detail.',
        tags: ['trading'],
        body: {
          type: 'object',
          required: ['signedXdr'],
          properties: {
            signedXdr: { type: 'string', minLength: 4 },
            pollTimeoutMs: { type: 'integer', minimum: 1000, maximum: 60000 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              hash: { type: 'string' },
              status: { type: 'string', enum: ['SUCCESS', 'PENDING', 'FAILED'] },
              ledger: { type: 'integer' },
              contractError: CONTRACT_ERROR_SCHEMA,
              hostError: HOST_ERROR_SCHEMA,
              resultXdr: { type: 'string' },
            },
            required: ['hash', 'status'],
          },
          400: {
            type: 'object',
            additionalProperties: true,
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
              contractError: CONTRACT_ERROR_SCHEMA,
              hostError: HOST_ERROR_SCHEMA,
            },
            required: ['error'],
          },
          502: {
            type: 'object',
            additionalProperties: true,
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['error'],
          },
          503: {
            type: 'object',
            additionalProperties: true,
            properties: {
              error: { type: 'string' },
              retryable: { type: 'boolean' },
              hash: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['error', 'retryable'],
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const { signedXdr, pollTimeoutMs } = req.body;
        const outcome = await service.submit(signedXdr, { pollTimeoutMs });
        return mapOutcome(outcome, reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.log.error({ err }, 'tx/submit failed');
        return reply.code(502).send({ error: 'rpc_error', message });
      }
    },
  );
}

function mapOutcome(outcome: TxSubmitOutcome, reply: FastifyReply): FastifyReply {
  switch (outcome.kind) {
    case 'success':
      return reply.send({ hash: outcome.hash, status: 'SUCCESS', ledger: outcome.ledger });
    case 'pending':
      return reply.send({ hash: outcome.hash, status: 'PENDING' });
    case 'failed':
      return reply.send({
        hash: outcome.hash,
        status: 'FAILED',
        contractError: outcome.contractError,
        hostError: outcome.hostError ?? null,
        resultXdr: outcome.resultXdr,
      });
    case 'try_again_later':
      reply.header('Retry-After', String(RETRY_AFTER_SEC));
      return reply.code(503).send({
        error: 'try_again_later',
        retryable: true,
        hash: outcome.hash,
        message: 'RPC transaction queue is full — resubmit the same signed XDR shortly',
      });
    case 'rejected':
      return reply.code(400).send({
        error: 'submission_rejected',
        message: outcome.message,
        contractError: outcome.contractError,
        hostError: outcome.hostError ?? null,
      });
  }
}
